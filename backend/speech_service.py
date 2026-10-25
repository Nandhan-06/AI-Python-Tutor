import logging
import os
from openai import OpenAI, OpenAIError
from errors import ServiceError, friendly

log = logging.getLogger("tutor.speech")
VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]   # voices supported by tts-1

class SpeechError(ServiceError):
    pass

def _client():
    return OpenAI(timeout=float(os.getenv("OPENAI_TIMEOUT", "30")), max_retries=2)

def _fail(e, fallback):
    status, msg = friendly(e)
    log.warning("Speech call failed: %s", type(e).__name__)
    return SpeechError(fallback if status == 502 else msg, status)

def transcribe(data: bytes, filename: str) -> str:
    try:
        return _client().audio.transcriptions.create(model="whisper-1", file=(filename, data)).text.strip()
    except OpenAIError as e:
        raise _fail(e, "Transcription failed. Please type your question instead.") from e

def speak(text: str, voice: str | None = None) -> bytes:
    try:
        return _client().audio.speech.create(model=os.getenv("TTS_MODEL", "tts-1"),
                                             voice=voice or os.getenv("TTS_VOICE", "nova"), input=text).content
    except OpenAIError as e:
        raise _fail(e, "Voice is unavailable right now. Continuing in text.") from e
