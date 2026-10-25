import json
import llm_service as llm
from conftest import EXERCISE

def new_ex(client, sid):
    r = client.post("/tutor/exercise", json={"session_id": sid}); assert r.status_code == 200
    return r.json()

def ev(client, sid, eid, actuals, error=None):
    return client.post("/tutor/evaluate", json={"session_id": sid, "exercise_id": eid, "code": "x",
                       "results": [{"actual": a, "error": None} for a in actuals], "error": error}).json()

def test_exercise_hides_solution(client, sid):
    d = new_ex(client, sid)
    assert "solution" not in json.dumps(d) and d["function_name"] == "add" and len(d["tests"]) == 3

def test_server_decides_correctness_not_the_llm(client, sid):
    d = new_ex(client, sid)
    bad = ev(client, sid, d["exercise_id"], [3, 0, 5])        # last result wrong
    assert bad["correct"] is False and bad["passed"] == 2 and bad["results"][2]["passed"] is False
    good = ev(client, sid, d["exercise_id"], [3, 0.0, 0])
    assert good["correct"] is True and good["progress"]["exercises_correct"] == 1

def test_run_error_marks_all_failed(client, sid):
    d = new_ex(client, sid)
    r = ev(client, sid, d["exercise_id"], [], error="NameError: name 'x' is not defined (line 2)")
    assert r["correct"] is False and r["passed"] == 0

def test_ai_failure_falls_back(client, sid, monkeypatch):
    d = new_ex(client, sid)
    def down(system, user): raise llm.LLMError("down", 503)
    monkeypatch.setattr(llm, "_complete", down)
    r = ev(client, sid, d["exercise_id"], [3, 0, 0])
    assert r["correct"] is True and r["ai_available"] is False and r["feedback"]

def test_hints_then_solution_unlock(client, sid):
    d = new_ex(client, sid); body = {"session_id": sid, "exercise_id": d["exercise_id"]}
    assert client.post("/tutor/solution", json=body).status_code == 403
    hints = [client.post("/tutor/hint", json=body).json() for _ in range(4)]
    assert [h["hint"] for h in hints] == ["h1", "h2", "h3", None] and hints[2]["solution_unlocked"] is True
    r = client.post("/tutor/solution", json=body)
    assert r.status_code == 200 and "return a + b" in r.json()["solution"]

def test_solution_unlocks_after_three_attempts(client, sid):
    d = new_ex(client, sid); body = {"session_id": sid, "exercise_id": d["exercise_id"]}
    for _ in range(3): ev(client, sid, d["exercise_id"], [9, 9, 9])
    assert client.post("/tutor/solution", json=body).status_code == 200

def test_malformed_exercise_rejected(client, sid, monkeypatch):
    monkeypatch.setattr(llm, "_complete", lambda s, u: json.dumps({**EXERCISE, "tests": []}))
    assert client.post("/tutor/exercise", json={"session_id": sid}).status_code == 502

def test_difficulty_follows_performance(client, sid):
    for _ in range(2):
        d = new_ex(client, sid); body = {"session_id": sid, "exercise_id": d["exercise_id"]}
        for _ in range(3): ev(client, sid, d["exercise_id"], [9, 9, 9])
        client.post("/tutor/solution", json=body)
    assert new_ex(client, sid)["difficulty"] == "easier"
