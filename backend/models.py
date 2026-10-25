from typing import Literal
from pydantic import BaseModel, Field, field_validator
from learning_path import PATH

class StartReq(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    level: Literal["Beginner", "Intermediate", "Advanced"]
    topic: str
    style: Literal["Simple", "Example-based", "Step-by-step"]
    mode: Literal["Voice", "Text", "Both"]

    @field_validator("topic")
    @classmethod
    def known_topic(cls, v):
        if v not in PATH:
            raise ValueError("unknown topic")
        return v

class SessionReq(BaseModel):
    session_id: str

class TopicReq(SessionReq):
    topic: str

    @field_validator("topic")
    @classmethod
    def known_topic(cls, v):
        if v not in PATH:
            raise ValueError("unknown topic")
        return v

class AskReq(SessionReq):
    question: str = Field(min_length=1, max_length=1000)
    line_by_line: bool = False

class ExerciseRef(SessionReq):
    exercise_id: str

class EvalReq(ExerciseRef):
    code: str = Field(max_length=4000)
    results: list[dict] = Field(default_factory=list, max_length=10)
    error: str | None = Field(default=None, max_length=800)

class QuizSubmitReq(SessionReq):
    answers: list[int] = Field(min_length=3, max_length=3)

class SpeakReq(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    voice: str | None = None
