import { api, streamAsk, transcribe } from "./api.js";
import { createPlayer, createMic, getCtx } from "./voice.js";
import { chunker } from "./text.js";
import { runPython, tipFor } from "./playground.js";

const $ = s => document.querySelector(s);
const el = (t, p = {}, ...k) => { const n = document.createElement(t); Object.assign(n, p); n.append(...k); return n; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prefs = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: ignore */ } },
};

// ---------- theme and text size ----------
const FS = [16, 18, 20, 23];
let fsI = Math.min(FS.length - 1, Math.max(0, +prefs.get("fs", 1))), accent = "#0f7b6c";
function applyPrefs() {
  const theme = prefs.get("theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--fs", FS[fsI] + "px");
  $("#theme").textContent = theme === "dark" ? "Light" : "Dark";
  accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || accent;
}
$("#theme").onclick = () => { prefs.set("theme", document.documentElement.dataset.theme === "dark" ? "light" : "dark"); applyPrefs(); };
$("#fsUp").onclick = () => { fsI = Math.min(FS.length - 1, fsI + 1); prefs.set("fs", fsI); applyPrefs(); };
$("#fsDown").onclick = () => { fsI = Math.max(0, fsI - 1); prefs.set("fs", fsI); applyPrefs(); };
applyPrefs();

// ---------- shared UI helpers ----------
let sid = null, busy = false, lastQ = "", streamCtl = null, micActive = false, listening = false;
let handsFree = false, voiceBroken = false, stopWatch = null, silences = 0, ex = null, hintsLeft = 0;
const avatarState = () => $("#avatar").dataset.state;
const LABELS = { idle: "Ready when you are", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…", error: "Something went wrong" };
const setState = (s, label) => { $("#avatar").dataset.state = s; $("#status").textContent = label || LABELS[s]; };
const say = msg => { const t = $("#toast"); t.textContent = msg; t.hidden = !msg; };
const speakOn = () => $("#speakOn").checked && !voiceBroken;
const fail = e => { say(e.message); setState("error"); setTimeout(() => { if (avatarState() === "error") setState("idle"); }, 4000); };
const setBusy = b => { busy = b; $("#askForm button").disabled = b; $("#q").disabled = b; };
function add(node, cls = "") {
  const m = el("div", { className: "msg " + cls }); m.append(node);
  $("#feed").append(m); m.scrollIntoView({ behavior: "smooth", block: "end" }); return m;
}
const bubble = (t, cls = "") => add(el("p", { textContent: t }), cls);
const label = t => el("p", { className: "lbl", textContent: t });

// Wraps every non-streaming action: thinking face, one-at-a-time, friendly errors.
async function run(lbl, fn) {
  if (busy) return;
  setBusy(true); say(""); setState("thinking", lbl);
  try { return await fn(); } catch (e) { fail(e); }
  finally { setBusy(false); if (avatarState() === "thinking") setState("idle"); }
}

const TABS = ["learn", "practice", "play", "quiz", "progress"];
function showTab(n) {
  TABS.forEach(t => { $("#tab-" + t).hidden = t !== n; document.querySelector(`[data-tab=${t}]`).setAttribute("aria-selected", t === n); });
}
document.querySelectorAll(".tabs button").forEach(b => { b.onclick = () => showTab(b.dataset.tab); });

// ---------- voice: player, mic, waveform ----------
const mic = createMic();
const player = createPlayer({
  getVoice: () => $("#voice").value || undefined,
  onState: s => {
    $("#stop").disabled = s !== "speaking";
    if (s === "speaking") {
      setState("speaking");
      if (handsFree && !stopWatch) stopWatch = mic.watchBargeIn(() => { stopWatch = null; interrupt(); });
    } else { stopWatch?.(); stopWatch = null; if (!busy && !micActive) setState("idle"); }
  },
  onCaption: t => { $("#caption").textContent = $("#captions").checked ? t : ""; },
  onError: e => { if (!voiceBroken) { voiceBroken = true; say(e.message + " I'll continue in text."); } },
});
const interrupt = () => { streamCtl?.abort(); player.stop(); };
$("#stop").onclick = interrupt;

const cv = $("#wave"), g = cv.getContext("2d"), fbuf = new Uint8Array(128);
const sizeCanvas = () => { const d = devicePixelRatio || 1; cv.width = cv.clientWidth * d; cv.height = 40 * d; };
addEventListener("resize", sizeCanvas);
(function frame() {
  requestAnimationFrame(frame);
  if (!cv.clientWidth) return;
  const an = player.speaking() ? player.analyser() : micActive ? mic.analyser : null;
  const W = cv.width, H = cv.height, bars = 26, bw = W / bars;
  g.clearRect(0, 0, W, H); g.fillStyle = accent;
  if (an) an.getByteFrequencyData(fbuf);
  for (let i = 0; i < bars; i++) { const h = Math.max(4, (an ? fbuf[i + 2] / 255 : 0) * H); g.fillRect(i * bw + bw * 0.2, (H - h) / 2, bw * 0.6, h); }
  const lvl = Math.min(1, (player.speaking() ? player.level() : 0) * 5), m = $("#mouth");
  m.setAttribute("ry", (2 + lvl * 11).toFixed(1)); m.setAttribute("rx", (12 - lvl * 2).toFixed(1));
})();

// ---------- progress ----------
function stats(p) {
  const rows = [["Topic", p.topic], ["Questions", p.questions], ["Exercises", `${p.exercises_correct}/${p.exercises_attempted}`], ["Quiz", p.quiz_score == null ? "-" : `${p.quiz_score}/3`]];
  $("#stats").replaceChildren(...rows.map(([k, v]) => el("div", {}, el("b", { textContent: v }), el("span", { textContent: k }))));
  const r = p.recommendation, go = r.next_topic && r.next_topic !== p.topic;
  $("#reco").replaceChildren(el("div", { className: "try" }, el("p", { textContent: r.reason }),
    ...(r.next_topic ? [el("button", { className: "primary", textContent: go ? `Start ${r.next_topic}` : "Take the quiz", onclick: () => (go ? startTopic(r.next_topic) : showTab("quiz")) })] : [])));
  $("#path").replaceChildren(...p.path.map(t => el("li", { className: t.current ? "current" : "", title: t.mastery == null ? "Not started" : `Mastery ${Math.round(t.mastery * 100)}%` },
    el("span", { textContent: (t.completed ? "✓ " : "") + t.topic }),
    el("div", { className: "meter" }, el("i", { style: `width:${Math.round((t.mastery || 0) * 100)}%` })))));
  const list = (id, items) => $(id).replaceChildren(...(items.length ? items : ["Nothing yet"]).map(x => el("li", { textContent: x })));
  list("#strengths", p.strengths); list("#needs", p.needs_work);
}
async function startTopic(topic) {
  try { stats((await api("/tutor/topic", { session_id: sid, topic })).progress); } catch (e) { return fail(e); }
  ask(`Teach me the basics of ${topic}.`, { quiet: true });
}
$("#sumBtn").onclick = () => run("Writing your summary…", async () => {
  const r = await api("/tutor/summary", { session_id: sid });
  $("#sumBox").replaceChildren(el("p", { textContent: r.summary }), el("ul", {}, ...r.revision.map(x => el("li", { textContent: x }))));
  if (speakOn()) player.say(r.summary);
});

// ---------- learn: streamed lesson + chunked speech ----------
function renderLesson(msg, holder, r) {
  holder.className = ""; holder.textContent = r.explanation;
  if (r.code) msg.append(label("Code"), el("pre", { textContent: r.code }),
    el("div", { className: "row" }, el("button", { className: "primary", textContent: "Run this in the playground", onclick: () => { $("#pgCode").value = r.code; showTab("play"); runPlayground(); } })),
    label("Output Maya expects (the playground shows the real output)"), el("pre", { textContent: r.expected_output }),
    el("p", { className: "muted", textContent: r.why_output }));
  if (r.check_question) msg.append(el("p", { className: "try", textContent: "Try this: " + r.check_question }));
  msg.append(el("button", { textContent: "Explain line by line", onclick: () => ask(lastQ, { lbl: true }) }));
}

async function ask(q, { lbl = false, quiet = false } = {}) {
  if (busy || !sid) return undefined;
  showTab("learn");
  if (!quiet) bubble(lbl ? "Please explain that line by line." : q, "user");
  player.stop(); voiceBroken = false; setBusy(true); say(""); setState("thinking");
  const holder = el("p", { className: "muted", textContent: "Maya is thinking…" }), msg = add(holder);
  const sp = speakOn() ? chunker(t => player.say(t)) : null;
  let text = "", ok = false;
  streamCtl = new AbortController();
  try {
    if (!lbl) lastQ = q;
    const r = await streamAsk({ session_id: sid, question: lbl ? lastQ : q, line_by_line: lbl }, {
      signal: streamCtl.signal,
      onDelta: d => { text += d; holder.className = ""; holder.textContent = text.trimStart(); setState("thinking", "Writing…"); sp?.push(d); msg.scrollIntoView({ block: "end" }); },
    });
    sp?.flush(); renderLesson(msg, holder, r); stats(r.progress);
    if (speakOn() && r.check_question) player.say("Try this: " + r.check_question);
    ok = true;
  } catch (e) {
    if (e.name === "AbortError") { holder.className = ""; holder.textContent = text.trim() + " (interrupted)"; ok = true; }
    else { holder.className = "muted"; holder.textContent = "I couldn't finish that answer."; fail(e); }
  } finally { setBusy(false); streamCtl = null; if (avatarState() === "thinking") setState("idle"); }
  await player.drained();
  return ok;
}
$("#askForm").onsubmit = e => { e.preventDefault(); const q = $("#q").value.trim(); if (q) { $("#q").value = ""; ask(q); } };

// ---------- listening: single question or hands-free ----------
const setMicUi = on => { $("#mic").textContent = on ? "Done talking" : "Talk to Maya"; $("#mic").classList.toggle("on", on); };
function stopHandsFree() { handsFree = false; $("#handsfree").checked = false; if (micActive) mic.stop(); }

async function capture() {          // returns text, null (heard nothing) or false (fatal)
  try { await mic.open(); } catch (e) {
    stopHandsFree();
    say(e.name === "NotAllowedError" || e.name === "SecurityError"
      ? "Microphone access is blocked. Allow it in your browser's address bar, or type your question."
      : "I couldn't open the microphone. Please type your question instead.");
    setState("error"); setTimeout(() => setState("idle"), 3000); return false;
  }
  micActive = true; setMicUi(true); setState("listening");
  const blob = await mic.record({ onSpeech: () => setState("listening", "I hear you…") });
  micActive = false; setMicUi(false);
  if (!blob) {
    setState("idle");
    if (handsFree && ++silences >= 3) { stopHandsFree(); say("Hands-free paused because I didn't hear anything. Switch it back on when you're ready."); return false; }
    if (!handsFree) say("I didn't hear anything. Press Talk and try again.");
    return null;
  }
  silences = 0; setState("thinking", "Listening back…");
  try {
    const text = (await transcribe(blob)).trim();
    if (!text) { say("I couldn't make out any words. Please try again."); setState("idle"); return null; }
    return text;
  } catch (e) { stopHandsFree(); fail(e); return false; }
}
async function listenOnce() {       // true/null: carry on, false: stop, undefined: already busy
  if (listening || busy) return undefined;
  listening = true;
  let text;
  try { text = await capture(); } finally { listening = false; }
  if (text === false) return false;
  if (text === null) return handsFree;
  return ask(text);
}
async function listenLoop() {
  while (handsFree && sid) {
    const r = await listenOnce();
    if (r === false) break;
    if (r === undefined) await sleep(300);
  }
  if (handsFree) stopHandsFree();
  if (!micActive && !listening) mic.close();
}
$("#handsfree").onchange = e => { if (e.target.checked) { handsFree = true; silences = 0; listenLoop(); } else stopHandsFree(); };
$("#mic").onclick = async () => {
  if (micActive) { mic.stop(); return; }
  interrupt();
  await listenOnce();
  if (!handsFree) mic.close();
};

// ---------- playground and exercise editors ----------
function editorKeys(ta, onRun) {
  let free = false;                  // Esc then Tab leaves the editor (keyboard accessibility)
  ta.addEventListener("blur", () => { free = false; });
  ta.addEventListener("keydown", e => {
    if (e.key === "Escape") free = true;
    else if (e.key === "Tab" && !e.shiftKey && !free) { e.preventDefault(); ta.setRangeText("    ", ta.selectionStart, ta.selectionEnd, "end"); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onRun(); }
  });
}
const PG_DEFAULT = '# Change the message, then press Run\nname = "Maya"\nprint("Hello from", name)\n';
$("#pgCode").value = PG_DEFAULT;
async function runPlayground() {
  const out = $("#pgOut"), tip = $("#pgTip");
  tip.hidden = true; out.className = ""; $("#pgRun").disabled = true;
  const res = await runPython($("#pgCode").value, { onStatus: t => { $("#pgStatus").textContent = t; } });
  $("#pgStatus").textContent = ""; $("#pgRun").disabled = false;
  out.textContent = (res.output || "") + (res.error ? (res.output ? "\n" : "") + res.error : "") || "(no output)";
  if (!res.ok) { out.className = "err"; const t = tipFor(res.error); if (t) { tip.textContent = t; tip.hidden = false; } }
}
$("#pgRun").onclick = runPlayground;
$("#pgReset").onclick = () => { $("#pgCode").value = PG_DEFAULT; $("#pgOut").textContent = ""; $("#pgTip").hidden = true; };
editorKeys($("#pgCode"), runPlayground);

// ---------- practice: real test runs + AI explanation + progressive hints ----------
const show = v => (v === undefined ? "None" : JSON.stringify(v));
function hintUi(left, unlocked) {
  hintsLeft = left;
  $("#hintBtn").textContent = left ? `Hint (${left} left)` : "No more hints";
  $("#hintBtn").disabled = !left; $("#solBtn").disabled = !unlocked;
}
function renderEval(r, res) {
  const t = el("table"); t.append(el("tr", {}, ...["Input", "Expected", "Yours", ""].map(h => el("th", { textContent: h }))));
  r.results.forEach(x => t.append(el("tr", {}, el("td", { textContent: show(x.args) }), el("td", { textContent: show(x.expected) }),
    el("td", { textContent: x.error || show(x.actual) }), el("td", { className: x.passed ? "ok" : "bad", textContent: x.passed ? "Pass" : "Fail" }))));
  const tip = tipFor(res.error || r.results.map(x => x.error).find(Boolean));
  $("#exResult").replaceChildren(
    el("p", { className: r.correct ? "ok" : "bad", textContent: r.correct ? "All tests passed!" : `${r.passed} of ${r.total} tests passed.` }),
    ...(res.error ? [el("pre", { className: "err", textContent: res.error })] : []), t,
    ...(res.output ? [label("Your print output"), el("pre", { textContent: res.output })] : []),
    el("p", { textContent: r.feedback }),
    ...(r.error_explanation ? [el("p", { textContent: r.error_explanation })] : []),
    ...(tip ? [el("p", { className: "tip", textContent: tip })] : []),
    ...(r.next_step ? [el("p", { className: "muted", textContent: "Next: " + r.next_step })] : []));
}
$("#newEx").onclick = () => run("Writing an exercise…", async () => {
  ex = await api("/tutor/exercise", { session_id: sid });
  $("#exBox").hidden = false; $("#exIntro").hidden = true;
  $("#exLevel").textContent = { easier: "Easier", harder: "Challenge" }[ex.difficulty] || "Standard";
  $("#exPrompt").textContent = ex.prompt; $("#exCode").value = ex.starter_code;
  $("#hints").replaceChildren(); $("#exResult").replaceChildren(); $("#exStatus").textContent = "";
  hintUi(ex.hint_count, false); stats(ex.progress);
  if (speakOn()) player.say(ex.prompt);
});
$("#hintBtn").onclick = () => run("Thinking of a hint…", async () => {
  const h = await api("/tutor/hint", { session_id: sid, exercise_id: ex.exercise_id });
  if (h.hint) $("#hints").append(el("li", { textContent: h.hint }));
  hintUi(h.remaining, h.solution_unlocked);
});
$("#solBtn").onclick = () => {
  if (!confirm("Show the full solution? This exercise will then count as not solved.")) return;
  run("Getting the solution…", async () => {
    const r = await api("/tutor/solution", { session_id: sid, exercise_id: ex.exercise_id });
    $("#exResult").append(el("h3", { textContent: "Solution" }), el("pre", { textContent: r.solution })); stats(r.progress);
  });
};
const runTests = () => run("Running your tests…", async () => {
  const code = $("#exCode").value;
  if (!code.trim()) { say("Write some code first."); return; }
  const res = await runPython(code, { tests: ex.tests, fn: ex.function_name, onStatus: t => { $("#exStatus").textContent = t; } });
  $("#exStatus").textContent = "";
  const r = await api("/tutor/evaluate", {
    session_id: sid, exercise_id: ex.exercise_id, code,
    results: (res.results || []).map(x => ({ actual: x.actual, error: x.error })),
    error: res.ok ? null : String(res.error || "Unknown error").slice(0, 780),
  });
  renderEval(r, res); stats(r.progress); hintUi(hintsLeft, r.solution_unlocked);
  if (speakOn()) player.say(r.feedback);
});
$("#runTests").onclick = runTests;
editorKeys($("#exCode"), runTests);

// ---------- quiz ----------
$("#newQuiz").onclick = () => run("Building your quiz…", async () => {
  const r = await api("/tutor/quiz", { session_id: sid });
  const box = $("#quizBox"), score = el("p"), submit = el("button", { className: "primary", textContent: "Submit answers" });
  box.replaceChildren(...r.questions.map((q, i) => el("fieldset", { className: "qq" },
    el("legend", { textContent: `${i + 1}. ${q.question}` }),
    ...(q.code ? [el("pre", { textContent: q.code })] : []),
    ...q.options.map((o, j) => el("label", {}, el("input", { type: "radio", name: "q" + i, value: j }), el("span", { textContent: o }))))), submit, score);
  submit.onclick = () => run("Scoring…", async () => {
    const answers = [0, 1, 2].map(i => { const c = box.querySelector(`input[name=q${i}]:checked`); return c ? +c.value : -1; });
    if (answers.includes(-1)) { say("Please answer all three questions first."); return; }
    const s = await api("/tutor/quiz/submit", { session_id: sid, answers });
    box.querySelectorAll("fieldset").forEach((fs, i) => {
      const x = s.results[i]; fs.disabled = true;
      fs.append(el("p", { className: x.correct ? "ok" : "bad", textContent: (x.correct ? "Correct. " : `Not quite. The answer was option ${x.correct_index + 1}. `) + x.explanation }));
    });
    submit.hidden = true; score.textContent = `You scored ${s.score} out of 3. See the Progress tab for what to do next.`;
    stats(s.progress); if (speakOn()) player.say(`You scored ${s.score} out of 3.`);
  });
  stats(r.progress);
});

// ---------- settings, setup and start-up ----------
$("#captions").checked = prefs.get("captions", "1") === "1";
$("#captions").onchange = e => { prefs.set("captions", e.target.checked ? "1" : "0"); if (!e.target.checked) $("#caption").textContent = ""; };
api("/speech/voices").then(v => {
  const sel = $("#voice");
  v.voices.forEach(n => sel.append(new Option("Voice: " + n[0].toUpperCase() + n.slice(1), n)));
  sel.value = v.voices.includes(prefs.get("voice", v.default)) ? prefs.get("voice", v.default) : v.default;
  sel.onchange = () => prefs.set("voice", sel.value);
}).catch(() => { $("#voice").hidden = true; });
api("/health").then(h => { if (!h.openai_configured) $("#health").textContent = "OpenAI key missing: add it to the .env file and restart the server."; })
  .catch(() => { $("#health").textContent = "Can't reach the server. Is it running?"; });

$("#setup").onsubmit = async e => {
  e.preventDefault();
  const form = Object.fromEntries(new FormData(e.target));
  try { await getCtx().resume(); } catch { /* audio will be re-tried on first sound */ }
  $("#speakOn").checked = form.mode !== "Text";
  const ok = await run("Getting ready…", async () => {
    const r = await api("/tutor/start", form);
    sid = r.session_id;
    $("#setup").hidden = true; $("#app").hidden = false; sizeCanvas(); stats(r.progress);
    bubble(r.returning ? `Welcome back, ${form.name}! ${r.progress.recommendation.reason}`
      : `Hi ${form.name}! Let's start with ${form.topic.toLowerCase()}. Type a question any time, or press "Talk to Maya".`);
    return true;
  });
  if (ok) ask(`Teach me the basics of ${form.topic}.`, { quiet: true });
};
