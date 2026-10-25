import httpx, openai
import pytest
import tutor_service
from errors import friendly
from storage import Store

def answer_quiz(client, sid, answers):
    assert client.post("/tutor/quiz", json={"session_id": sid}).status_code == 200
    return client.post("/tutor/quiz/submit", json={"session_id": sid, "answers": answers}).json()

def test_health(client):
    assert client.get("/health").json()["status"] == "ok"

def test_validation_and_unknown_session(client, sid):
    assert client.post("/tutor/ask", json={"session_id": sid, "question": ""}).status_code == 422
    assert client.post("/tutor/ask", json={"session_id": "nope", "question": "hi"}).status_code == 404
    bad = {"name": "A", "level": "Beginner", "topic": "Cooking", "style": "Simple", "mode": "Text"}
    assert client.post("/tutor/start", json=bad).status_code == 422

def test_quiz_scores_server_side_and_persists(client, sid, env):
    r = answer_quiz(client, sid, [0, 0, 0])             # correct indexes are 0,1,2 -> score 1
    assert r["score"] == 1 and r["results"][1]["correct_index"] == 1
    reloaded = Store(env / "learners.json").get("Nanu")
    assert reloaded["topics"]["Loops"]["quiz"] == [0.33]

def test_returning_learner_and_recommendation(client, sid):
    answer_quiz(client, sid, [0, 1, 2])
    r = client.post("/tutor/start", json={"name": "nanu", "level": "Beginner", "topic": "Loops",
                                          "style": "Simple", "mode": "Text"}).json()
    assert r["returning"] is True and r["progress"]["recommendation"]["next_topic"] == "Lists"
    assert "Loops" in r["progress"]["strengths"]

def test_topic_switch(client, sid):
    p = client.post("/tutor/topic", json={"session_id": sid, "topic": "Lists"}).json()["progress"]
    assert p["topic"] == "Lists"

def test_summary(client, sid):
    assert client.post("/tutor/summary", json={"session_id": sid}).json()["revision"] == ["loops"]

def test_openai_error_mapping():
    req = httpx.Request("POST", "http://x")
    assert friendly(openai.AuthenticationError("x", response=httpx.Response(401, request=req), body=None))[0] == 401
    assert friendly(openai.RateLimitError("x", response=httpx.Response(429, request=req), body=None))[0] == 429
    assert friendly(openai.APITimeoutError(request=req))[0] == 504
    assert friendly(openai.APIConnectionError(request=req))[0] == 503
    assert friendly(openai.OpenAIError("The api_key client option must be set"))[0] == 401

def test_speech_endpoints(client, monkeypatch):
    import speech_service
    seen = {}
    monkeypatch.setattr(speech_service, "speak", lambda t, v=None: seen.update(v=v) or b"ID3")
    assert "nova" in client.get("/speech/voices").json()["voices"]
    r = client.post("/speech/speak", json={"text": "hi", "voice": "onyx"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and seen["v"] == "onyx"
    assert client.post("/speech/speak", json={"text": "hi", "voice": "robot"}).status_code == 422

def test_transcribe_limits_and_errors(client, monkeypatch):
    import speech_service
    assert client.post("/speech/transcribe", files={"file": ("a.webm", b"")}).status_code == 413
    def fail(d, n): raise speech_service.SpeechError("Transcription failed.", 429)
    monkeypatch.setattr(speech_service, "transcribe", fail)
    assert client.post("/speech/transcribe", files={"file": ("a.webm", b"1234")}).status_code == 429
