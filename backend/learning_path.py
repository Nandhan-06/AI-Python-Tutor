"""Learning path, mastery and next-topic recommendation. Pure functions, easy to test."""
from statistics import mean

PATH = ["Variables", "Data types", "Operators", "Conditions", "Loops", "Lists", "Tuples",
        "Dictionaries", "Sets", "Functions", "Exceptions", "File handling", "Object-oriented programming"]
PASS_MARK, REVIEW_MARK = 0.7, 0.5

def rec(profile: dict, topic: str) -> dict:
    return profile.setdefault("topics", {}).setdefault(topic, {"quiz": [], "ex": []})

def record_quiz(profile, topic, score, total=3):
    r = rec(profile, topic); r["quiz"] = (r["quiz"] + [round(score / total, 2)])[-5:]

def record_exercise(profile, topic, credit):
    r = rec(profile, topic); r["ex"] = (r["ex"] + [round(credit, 2)])[-10:]

def mastery(r: dict):
    parts = [mean(r["quiz"][-3:])] if r["quiz"] else []
    if r["ex"]:
        parts.append(mean(r["ex"][-5:]))
    return round(mean(parts), 2) if parts else None

def completed(profile, topic) -> bool:
    r = rec(profile, topic); m = mastery(r)
    return bool(r["quiz"]) and m is not None and m >= PASS_MARK

def difficulty(profile, topic) -> str:
    e = rec(profile, topic)["ex"][-3:]
    if len(e) >= 2 and mean(e) < 0.5:
        return "easier"
    if len(e) >= 2 and mean(e) >= 0.85:
        return "harder"
    return "standard"

def recommend(profile, current) -> dict:
    m = mastery(rec(profile, current))
    if m is not None and m < REVIEW_MARK:
        return {"next_topic": current, "action": "review",
                "reason": f"{current} still feels shaky. Another round with easier practice will help."}
    if not completed(profile, current):
        return {"next_topic": current, "action": "continue",
                "reason": f"Keep going with {current}: finish a quiz and an exercise to show what you know."}
    i = PATH.index(current) if current in PATH else -1
    for t in PATH[i + 1:] + PATH[:max(i, 0)]:
        if not completed(profile, t):
            return {"next_topic": t, "action": "learn", "reason": f"You've got {current}. {t} is the next step."}
    return {"next_topic": None, "action": "done", "reason": "You've completed the whole path. Great work!"}

def summary(profile, current) -> dict:
    rows = []
    for t in PATH:
        m = mastery(rec(profile, t))
        rows.append({"topic": t, "mastery": m, "completed": completed(profile, t), "current": t == current})
    return {"path": rows, "recommendation": recommend(profile, current), "difficulty": difficulty(profile, current),
            "strengths": [r["topic"] for r in rows if r["mastery"] is not None and r["mastery"] >= 0.8],
            "needs_work": [r["topic"] for r in rows if r["mastery"] is not None and r["mastery"] < 0.6]}
