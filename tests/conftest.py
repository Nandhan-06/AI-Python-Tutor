import json
import pathlib
import sys
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "backend"))

LESSON = ("CONCEPT: for loops\n===EXPLANATION===\nA for loop repeats code. Try it!\n===CODE===\n"
          "for i in range(3):\n    print(i)\n===OUTPUT===\n0\n1\n2\n===WHY===\nrange(3) gives 0, 1, 2.\n"
          "===CHECK===\nWhat if we use range(1, 3)?")
EXERCISE = {"prompt": "Add two numbers.", "function_name": "add", "starter_code": "def add(a, b):\n    pass\n",
            "hints": ["h1", "h2", "h3"], "solution": "def add(a, b):\n    return a + b",
            "tests": [{"args": [1, 2], "expected": 3}, {"args": [0, 0], "expected": 0}, {"args": [-1, 1], "expected": 0}]}
QUIZ = {"questions": [{"question": f"Q{i}", "code": "", "options": ["a", "b", "c", "d"], "correct_index": i,
                       "explanation": f"E{i}"} for i in range(3)]}

def fake_complete(system, user):
    if "function_name" in system:
        return json.dumps(EXERCISE)
    if "next_step" in system:
        return json.dumps({"feedback": "Good effort.", "error_explanation": "", "next_step": "Try again."})
    if "questions:" in system:
        return json.dumps(QUIZ)
    return json.dumps({"summary": "You did well.", "revision": ["loops"]})

def fake_stream(system, user):
    for i in range(0, len(LESSON), 7):
        yield LESSON[i:i + 7]

@pytest.fixture
def env(tmp_path, monkeypatch):
    import llm_service, storage, tutor_service
    monkeypatch.setattr(tutor_service, "store", storage.Store(tmp_path / "learners.json"))
    monkeypatch.setattr(llm_service, "_complete", fake_complete)
    monkeypatch.setattr(llm_service, "_stream", fake_stream)
    return tmp_path

@pytest.fixture
def client(env):
    from fastapi.testclient import TestClient
    import main
    return TestClient(main.app)

@pytest.fixture
def sid(client):
    r = client.post("/tutor/start", json={"name": "Nanu", "level": "Beginner", "topic": "Loops",
                                          "style": "Simple", "mode": "Text"})
    assert r.status_code == 200
    return r.json()["session_id"]
