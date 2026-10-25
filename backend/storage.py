"""Tiny JSON-file persistence for learner progress (one file, atomic writes)."""
import json
import os
import re
import tempfile
import threading
from pathlib import Path

def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")[:40] or "learner"

class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.lock = threading.Lock()

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text("utf-8"))
        except (FileNotFoundError, ValueError):
            return {}

    def get(self, name: str) -> dict | None:
        with self.lock:
            return self._load().get(slug(name))

    def save(self, name: str, profile: dict) -> None:
        with self.lock:
            data = self._load()
            data[slug(name)] = profile
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=1)
            os.replace(tmp, self.path)
