"""Sessions (in memory) linked to a learner profile (JSON file)."""
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
import learning_path as lp
import llm_service as llm
from storage import Store

store: Store | None = None

def _store() -> Store:
    global store
    if store is None:
        store = Store(Path(os.getenv("DATA_DIR", Path(__file__).parent.parent / "data")) / "learners.json")
    return store

@dataclass
class Session:
    name: str
    level: str
    topic: str
    style: str
    mode: str
    profile: dict = field(default_factory=dict)
    concepts: list = field(default_factory=list)
    questions: int = 0
    exercises: dict = field(default_factory=dict)
    attempts: int = 0
    correct: int = 0
    quiz: list = field(default_factory=list)
    quiz_score: int | None = None
    mistakes: list = field(default_factory=list)

    def context(self):
        return (f"name={self.name}, level={self.level}, topic={self.topic}, style={self.style}, "
                f"concepts so far={self.concepts[-8:]}, common mistakes={self.mistakes[-5:]}")

    def exercise_prompts(self):
        return [e["prompt"][:60] for e in self.exercises.values()][-3:]

    def note_mistake(self, text):
        if text and text not in self.mistakes:
            self.mistakes.append(text[:120])

    def difficulty(self):
        return lp.difficulty(self.profile, self.topic)

    def save(self):
        self.profile["name"], self.profile["updated"] = self.name, int(time.time())
        _store().save(self.name, self.profile)

    def record_quiz(self, score):
        lp.record_quiz(self.profile, self.topic, score); self.save()

    def record_exercise(self, credit):
        lp.record_exercise(self.profile, self.topic, credit); self.save()

    def progress(self):
        return {"topic": self.topic, "level": self.level, "questions": self.questions,
                "exercises_attempted": self.attempts, "exercises_correct": self.correct,
                "quiz_score": self.quiz_score, "mistakes": self.mistakes[-5:],
                **lp.summary(self.profile, self.topic)}

_sessions: dict[str, Session] = {}

def start(req):
    if len(_sessions) > 200:
        _sessions.pop(next(iter(_sessions)))
    existing = _store().get(req.name)
    s = Session(req.name.strip(), req.level, req.topic, req.style, req.mode, profile=existing or {})
    lp.rec(s.profile, s.topic)
    s.save()
    sid = uuid.uuid4().hex
    _sessions[sid] = s
    return sid, s, existing is not None

def get(sid):
    return _sessions.get(sid)

def set_topic(s: Session, topic: str):
    s.topic = topic
    lp.rec(s.profile, topic)
    s.save()

def finish_lesson(s: Session, lesson: dict) -> dict:
    s.questions += 1
    concept = (lesson.get("concept") or s.topic)[:40]
    if concept not in s.concepts:
        s.concepts.append(concept)
    return {k: lesson.get(k, "") for k in ("explanation", "code", "expected_output", "why_output", "check_question")}

def ask(s: Session, question, line_by_line):
    return finish_lesson(s, llm.explain(s, question, line_by_line))
