import learning_path as lp

def test_mastery_and_completion():
    p = {}
    assert lp.mastery(lp.rec(p, "Loops")) is None
    lp.record_quiz(p, "Loops", 3); lp.record_exercise(p, "Loops", 1.0)
    assert lp.mastery(lp.rec(p, "Loops")) == 1.0 and lp.completed(p, "Loops")

def test_recommendation_moves_on_or_reviews():
    p = {}
    lp.record_quiz(p, "Variables", 3)
    assert lp.recommend(p, "Variables")["next_topic"] == "Data types"
    lp.record_quiz(p, "Loops", 0)
    r = lp.recommend(p, "Loops")
    assert r["action"] == "review" and r["next_topic"] == "Loops"

def test_difficulty_adapts():
    p = {}
    for c in (0.0, 0.0): lp.record_exercise(p, "Lists", c)
    assert lp.difficulty(p, "Lists") == "easier"
    for c in (1.0, 1.0, 1.0): lp.record_exercise(p, "Lists", c)
    assert lp.difficulty(p, "Lists") == "harder"

def test_summary_lists_strengths_and_needs_work():
    p = {}
    lp.record_quiz(p, "Variables", 3); lp.record_quiz(p, "Loops", 1)
    s = lp.summary(p, "Loops")
    assert "Variables" in s["strengths"] and "Loops" in s["needs_work"] and len(s["path"]) == len(lp.PATH)
