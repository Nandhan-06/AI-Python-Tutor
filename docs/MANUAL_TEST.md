# Manual test checklist

Run with a real key (`uvicorn main:app --reload` from `backend/`). Use Chrome or Edge first, then Firefox and Safari.
Tick each box and note the browser. Anything that fails is worth an issue.

## Lessons and voice
- [ ] Start a lesson: text streams in word by word, Maya begins speaking after the first sentence, captions show the current sentence.
- [ ] **Stop speaking** stops audio at once; the avatar returns to idle.
- [ ] Switching the voice dropdown changes the next reply's voice.
- [ ] Turning off "Spoken replies" gives text only; turning off "Captions" hides captions.
- [ ] Wrong API key in `.env`: a clear message about the key appears (no stack trace).
- [ ] Stop the server mid-session: "Can't reach the tutor server" message.

## Microphone
- [ ] **Talk to Maya**: browser asks for permission; speak; recording stops by itself about 1.3 s after you stop.
- [ ] Deny permission: friendly message, typing still works.
- [ ] Stay silent for 8 s: "I didn't hear anything".
- [ ] **Hands-free**: ask, Maya answers, then listens again automatically. Three silent rounds pause it with a message.
- [ ] Barge-in (headphones): talk over Maya, she stops and listens.

## Playground and exercises
- [ ] First run shows "Loading Python…" then output. `print("hi")` shows `hi`.
- [ ] `print(x)` shows a NameError plus a tip. `while True: pass` stops after about 6 s with a message and works again afterwards.
- [ ] Practice: new exercise, wrong answer shows Expected vs Yours and a feedback paragraph; correct answer shows all Pass.
- [ ] Hints appear one at a time; the solution button unlocks only after 3 hints or 3 attempts.
- [ ] Offline (after Pyodide has loaded once) the playground still runs.

## Learning and UI
- [ ] Quiz scores are shown; the Progress tab shows mastery bars and a recommended next topic.
- [ ] Restart the server, start with the same name: "Welcome back" and progress is kept.
- [ ] Dark mode, A- and A+ work and persist after reload.
- [ ] Phone width (about 390 px): no sideways scrolling; avatar and controls stay usable.
- [ ] Keyboard only: tabs, buttons and editors reachable (Esc then Tab leaves an editor).
