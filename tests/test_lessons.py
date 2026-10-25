import json
import llm_service as llm
from conftest import LESSON

def test_parse_lesson_and_unfence():
    d = llm.parse_lesson(LESSON.replace("for i", "```python\nfor i").replace("print(i)\n", "print(i)\n```\n"))
    assert d["concept"] == "for loops" and d["code"].startswith("for i") and "```" not in d["code"]
    assert d["check_question"].startswith("What if")

def test_hold_partial_marker():
    assert llm._hold_partial("Hello ==") == "Hello " and llm._hold_partial("Hello") == "Hello"

def test_stream_never_leaks_markers(client, sid):
    r = client.post("/tutor/ask/stream", json={"session_id": sid, "question": "loops?"})
    events = [json.loads(l[6:]) for l in r.text.split("\n\n") if l.startswith("data: ")]
    streamed = "".join(e["text"] for e in events if e["type"] == "delta")
    assert "===" not in streamed and streamed.strip() == "A for loop repeats code. Try it!"
    done = events[-1]
    assert done["type"] == "done" and done["code"].startswith("for i") and done["progress"]["questions"] == 1

def test_ask_non_stream(client, sid):
    r = client.post("/tutor/ask", json={"session_id": sid, "question": "loops?"})
    assert r.status_code == 200 and r.json()["expected_output"].startswith("0")

def test_llm_errors_are_friendly(client, sid, monkeypatch):
    def boom(s, u):
        raise llm.LLMError("OpenAI rejected the API key.", 401)
        yield
    monkeypatch.setattr(llm, "_stream", boom)
    assert client.post("/tutor/ask", json={"session_id": sid, "question": "x"}).status_code == 401
    ev = client.post("/tutor/ask/stream", json={"session_id": sid, "question": "x"}).text
    assert '"type": "error"' in ev and "API key" in ev
