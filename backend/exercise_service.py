"""Exercises are judged by REAL code execution (in the student's browser via Pyodide).
The server compares actual vs expected values itself; the LLM only explains."""
import math
import re
import uuid
import llm_service as llm

def _valid(d: dict) -> bool:
    fn, tests, hints = d.get("function_name"), d.get("tests"), d.get("hints")
    return (isinstance(fn, str) and re.fullmatch(r"[A-Za-z_]\w{0,40}", fn) is not None
            and isinstance(d.get("prompt"), str) and isinstance(d.get("solution"), str)
            and isinstance(tests, list) and 3 <= len(tests) <= 8
            and all(isinstance(t, dict) and isinstance(t.get("args"), list) and "expected" in t for t in tests)
            and isinstance(hints, list) and len(hints) >= 2)

def create_exercise(s):
    d = llm.exercise(s, s.difficulty())
    if not _valid(d):
        raise llm.LLMError("The exercise came back malformed. Please generate a new one.", 502)
    fn = d["function_name"]
    starter = d.get("starter_code") or ""
    if f"def {fn}" not in starter:
        starter = f"def {fn}(*args):\n    # your code here\n    pass\n"
    eid = uuid.uuid4().hex[:8]
    s.exercises[eid] = {"prompt": d["prompt"], "solution": d["solution"], "tests": d["tests"],
                        "hints": [str(h) for h in d["hints"][:3]], "fn": fn,
                        "hints_used": 0, "attempts": 0, "resolved": False, "difficulty": s.difficulty()}
    return {"exercise_id": eid, "prompt": d["prompt"], "function_name": fn, "starter_code": starter,
            "tests": d["tests"], "hint_count": len(s.exercises[eid]["hints"]), "difficulty": s.exercises[eid]["difficulty"]}

def _get(s, eid):
    ex = s.exercises.get(eid)
    if not ex:
        raise LookupError("Exercise not found. Generate a new one.")
    return ex

def _equal(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_equal(a[k], b[k]) for k in a)
    return a == b

def _unlocked(ex) -> bool:
    return ex["hints_used"] >= len(ex["hints"]) or ex["attempts"] >= 3

def _resolve(s, ex, credit):
    if not ex["resolved"]:
        ex["resolved"] = True
        s.record_exercise(credit)

def next_hint(s, eid):
    ex = _get(s, eid)
    hint = None
    if ex["hints_used"] < len(ex["hints"]):
        hint = ex["hints"][ex["hints_used"]]
        ex["hints_used"] += 1
    return {"hint": hint, "remaining": len(ex["hints"]) - ex["hints_used"], "solution_unlocked": _unlocked(ex)}

def reveal_solution(s, eid):
    ex = _get(s, eid)
    if not _unlocked(ex):
        raise PermissionError("Try the hints first. The solution unlocks after all hints or three attempts.")
    _resolve(s, ex, 0.0)  # seeing the solution counts as not solved
    return {"solution": ex["solution"]}

def evaluate(s, eid, code, results, error):
    ex = _get(s, eid)
    tests = ex["tests"]
    if not error and len(results) != len(tests):
        raise ValueError("Result count doesn't match the tests.")
    rows = []
    for i, t in enumerate(tests):
        r = results[i] if i < len(results) else {}
        err = r.get("error") if not error else None
        passed = not error and err is None and _equal(r.get("actual"), t["expected"])
        rows.append({"args": t["args"], "expected": t["expected"], "actual": r.get("actual"), "passed": passed, "error": err})
    ok = all(r["passed"] for r in rows)
    ex["attempts"] += 1
    s.attempts += 1
    if ok:
        s.correct += 1
        _resolve(s, ex, max(0.4, 1 - 0.2 * ex["hints_used"]))
    else:
        s.note_mistake(error or next((r["error"] for r in rows if r["error"]), "") or f"Exercise on {s.topic}")
    try:
        ai = llm.explain_result(s, ex, code, [r for r in rows if not r["passed"]][:3] or rows[:1], error)
        ai = {k: str(ai.get(k, "")) for k in ("feedback", "error_explanation", "next_step")}
        ai["ai_available"] = True
    except llm.LLMError:
        ai = {"feedback": "All tests passed. Nice work!" if ok else "Some tests didn't pass yet. Compare expected and actual below.",
              "error_explanation": "", "next_step": "", "ai_available": False}
    return {"correct": ok, "passed": sum(r["passed"] for r in rows), "total": len(rows), "results": rows,
            "hints_used": ex["hints_used"], "solution_unlocked": _unlocked(ex), **ai}

def create_quiz(s):
    qs = llm.quiz(s).get("questions", [])[:3]
    for q in qs:
        if not (isinstance(q.get("options"), list) and len(q["options"]) == 4
                and isinstance(q.get("correct_index"), int) and 0 <= q["correct_index"] < 4 and q.get("question")):
            raise llm.LLMError("The quiz came back malformed. Please generate it again.", 502)
    if len(qs) != 3:
        raise llm.LLMError("The quiz came back incomplete. Please generate it again.", 502)
    s.quiz, s.quiz_score = qs, None
    return [{"question": str(q["question"]), "code": str(q.get("code", "")), "options": [str(o) for o in q["options"]]} for q in qs]

def submit_quiz(s, answers):
    if not s.quiz:
        raise LookupError("Generate a quiz first.")
    results, score = [], 0
    for q, a in zip(s.quiz, answers):
        ok = a == q["correct_index"]
        score += ok
        if not ok:
            s.note_mistake(f"Quiz: {str(q['question'])[:90]}")
        results.append({"correct": ok, "correct_index": q["correct_index"], "explanation": str(q.get("explanation", ""))})
    s.quiz_score = score
    s.record_quiz(score)
    return {"score": score, "results": results}
