from dotenv import load_dotenv
load_dotenv()

import json
import logging
import os
import time
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
import avatar_service, exercise_service as ex, llm_service as llm, models as m
import speech_service as speech, tutor_service as tutor
from errors import ServiceError

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("tutor.api")
app = FastAPI(title="AI Python Tutor")

@app.middleware("http")
async def access_log(request: Request, call_next):   # method, path, status, time only: never bodies
    t = time.perf_counter()
    response = await call_next(request)
    if request.url.path != "/health":
        log.info("%s %s -> %s (%.0f ms)", request.method, request.url.path, response.status_code, (time.perf_counter() - t) * 1000)
    return response

def _session(sid):
    s = tutor.get(sid)
    if not s:
        raise HTTPException(404, "Session expired. Please start a new session.")
    return s

def _guard(fn, *args):
    try:
        return fn(*args)
    except ServiceError as e:
        raise HTTPException(e.status, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))

@app.get("/health")
def health():
    return {"status": "ok", "openai_configured": bool(os.getenv("OPENAI_API_KEY"))}

@app.post("/tutor/start")
def start(req: m.StartReq):
    sid, s, returning = tutor.start(req)
    return {"session_id": sid, "returning": returning, "progress": s.progress()}

@app.get("/tutor/progress")
def progress(session_id: str):
    return _session(session_id).progress()

@app.post("/tutor/topic")
def topic(req: m.TopicReq):
    s = _session(req.session_id)
    tutor.set_topic(s, req.topic)
    return {"progress": s.progress()}

@app.post("/tutor/ask")
def ask(req: m.AskReq):
    s = _session(req.session_id)
    return {**_guard(tutor.ask, s, req.question, req.line_by_line), "progress": s.progress()}

def _sse(obj) -> str:
    return f"data: {json.dumps(obj)}\n\n"

@app.post("/tutor/ask/stream")
def ask_stream(req: m.AskReq):
    s = _session(req.session_id)

    def gen():
        try:
            for kind, val in llm.stream_explain(s, req.question, req.line_by_line):
                if kind == "delta":
                    yield _sse({"type": "delta", "text": val})
                else:
                    yield _sse({"type": "done", **tutor.finish_lesson(s, val), "progress": s.progress()})
        except ServiceError as e:
            yield _sse({"type": "error", "message": str(e)})
        except Exception:
            log.exception("stream failed")
            yield _sse({"type": "error", "message": "Something went wrong. Please try again."})
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.post("/tutor/exercise")
def exercise(req: m.SessionReq):
    s = _session(req.session_id)
    return {**_guard(ex.create_exercise, s), "progress": s.progress()}

@app.post("/tutor/hint")
def hint(req: m.ExerciseRef):
    return _guard(ex.next_hint, _session(req.session_id), req.exercise_id)

@app.post("/tutor/solution")
def solution(req: m.ExerciseRef):
    s = _session(req.session_id)
    return {**_guard(ex.reveal_solution, s, req.exercise_id), "progress": s.progress()}

@app.post("/tutor/evaluate")
def evaluate(req: m.EvalReq):
    s = _session(req.session_id)
    return {**_guard(ex.evaluate, s, req.exercise_id, req.code, req.results, req.error), "progress": s.progress()}

@app.post("/tutor/quiz")
def quiz(req: m.SessionReq):
    s = _session(req.session_id)
    return {"questions": _guard(ex.create_quiz, s), "progress": s.progress()}

@app.post("/tutor/quiz/submit")
def quiz_submit(req: m.QuizSubmitReq):
    s = _session(req.session_id)
    return {**_guard(ex.submit_quiz, s, req.answers), "progress": s.progress()}

@app.post("/tutor/summary")
def summary(req: m.SessionReq):
    d = _guard(llm.summary, _session(req.session_id))
    return {"summary": str(d.get("summary", "")), "revision": [str(x) for x in d.get("revision", [])][:4]}

@app.get("/speech/voices")
def voices():
    return {"voices": speech.VOICES, "default": os.getenv("TTS_VOICE", "nova")}

@app.post("/speech/transcribe")
async def transcribe(file: UploadFile = File(...)):
    data = await file.read()
    if not data or len(data) > 5_000_000:
        raise HTTPException(413, "The recording is empty or too long. Try a shorter question.")
    return {"text": await run_in_threadpool(_guard, speech.transcribe, data, file.filename or "speech.webm")}

@app.post("/speech/speak")
def speak(req: m.SpeakReq):
    if req.voice and req.voice not in speech.VOICES:
        raise HTTPException(422, "Unknown voice.")
    return Response(_guard(speech.speak, req.text, req.voice), media_type="audio/mpeg")

@app.get("/avatar/status")
def avatar():
    return avatar_service.status()

app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "frontend", html=True), name="ui")
