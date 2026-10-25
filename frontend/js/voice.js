import { speakBlob } from "./api.js";

let ctx;
export const getCtx = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
const rms = (an, buf) => {
  an.getByteTimeDomainData(buf);
  let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
  return Math.sqrt(s / buf.length);
};

// Speaks sentences in order. Each sentence is fetched as soon as it is queued, so the next one is ready.
export function createPlayer({ onState = () => {}, onCaption = () => {}, onError = () => {}, getVoice = () => undefined } = {}) {
  let analyser, tbuf, epoch = 0, q = [], running = false, cur = null, ctl = new AbortController(), waiters = [];
  const ensure = () => {
    if (analyser) return;
    const c = getCtx(); analyser = c.createAnalyser(); analyser.fftSize = 256;
    analyser.connect(c.destination); tbuf = new Uint8Array(analyser.fftSize);
  };
  const release = () => waiters.splice(0).forEach(r => r());

  function play(it, blob) {
    return new Promise(res => {
      const c = getCtx(), a = new Audio(URL.createObjectURL(blob));
      const done = () => { if (cur?.a !== a) return; URL.revokeObjectURL(a.src); cur = null; res(); };
      cur = { a, done }; a.onended = done; a.onerror = done;
      c.createMediaElementSource(a).connect(analyser);
      onCaption(it.text); onState("speaking");
      c.resume().then(() => a.play()).catch(() => { done(); onError(new Error("Your browser blocked audio. Click the page once, then try again.")); });
    });
  }
  async function pump() {
    if (running) return;
    running = true;
    while (q.length) {
      const it = q.shift(), blob = await it.p;
      if (it.epoch === epoch && blob) await play(it, blob);
    }
    running = false; onState("idle"); onCaption(""); release();
  }
  return {
    say(text) {
      ensure();
      const p = speakBlob(text, getVoice(), ctl.signal).catch(e => { if (e.name !== "AbortError") onError(e); return null; });
      q.push({ text, p, epoch }); pump();
    },
    stop() {
      epoch++; ctl.abort(); ctl = new AbortController(); q.length = 0;
      if (cur) { cur.a.pause(); cur.done(); }
      if (!running) release();
    },
    drained: () => (running || q.length ? new Promise(r => waiters.push(r)) : Promise.resolve()),
    speaking: () => running,
    analyser: () => analyser,
    level: () => (analyser ? rms(analyser, tbuf) : 0),
  };
}

// Microphone with simple voice-activity detection (stops by itself when you stop talking).
export function createMic() {
  let stream, an, tbuf, rec, forced = false;
  const api = {
    async open() {
      if (stream?.active) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const c = getCtx(); await c.resume();
      an = c.createAnalyser(); an.fftSize = 512; tbuf = new Uint8Array(an.fftSize);
      c.createMediaStreamSource(stream).connect(an);
    },
    close() { stream?.getTracks().forEach(t => t.stop()); stream = null; },
    get analyser() { return an; },
    level: () => (an ? rms(an, tbuf) : 0),
    stop() { forced = true; if (rec?.state === "recording") rec.stop(); },
    record({ maxMs = 30000, silenceMs = 1300, waitMs = 8000, onSpeech } = {}) {
      return new Promise(resolve => {
        const chunks = []; forced = false;
        let started = false, last = 0, hot = 0, floor = 0, n = 0;
        const t0 = performance.now();
        rec = new MediaRecorder(stream);
        rec.ondataavailable = e => e.data.size && chunks.push(e.data);
        rec.onstop = () => {
          clearInterval(iv);
          const blob = new Blob(chunks, { type: rec.mimeType });
          resolve((started || forced) && blob.size > 1500 ? blob : null);
        };
        rec.start();
        const halt = () => rec.state === "recording" && rec.stop();
        const iv = setInterval(() => {
          const t = performance.now() - t0, l = api.level();
          if (t < 400) { floor += l; n++; return; }                      // learn the room's background noise
          const th = Math.max(0.02, (floor / Math.max(n, 1)) * 2.5 + 0.01);
          if (l > th) { hot++; last = t; if (hot >= 3 && !started) { started = true; onSpeech?.(); } } else hot = 0;
          if ((!started && t > waitMs) || (started && t - last > silenceMs) || t > maxMs) halt();
        }, 50);
      });
    },
    // While Maya talks: a sustained loud sound from you means "I'm interrupting".
    watchBargeIn(cb, threshold = 0.08) {
      let hot = 0;
      const iv = setInterval(() => { if (api.level() > threshold) { if (++hot >= 8) { clearInterval(iv); cb(); } } else hot = 0; }, 60);
      return () => clearInterval(iv);
    },
  };
  return api;
}
