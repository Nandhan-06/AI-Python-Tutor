const TIPS = {
  NameError: "Python doesn't know that name. Check the spelling, and create the variable before you use it.",
  SyntaxError: "Python couldn't read this line. Look for a missing colon (:), bracket or quote.",
  IndentationError: "The spaces at the start of a line don't line up. Use 4 spaces inside loops, functions and if blocks.",
  TypeError: "You're mixing types that don't fit together, like adding a number to text. Try str() or int().",
  ZeroDivisionError: "You divided by zero. Check the number you're dividing by.",
  IndexError: "You asked for a list position that doesn't exist. Lists start at 0.",
  KeyError: "That key isn't in the dictionary. Check the spelling.",
  ValueError: "The value has the right type but the wrong content, like int('abc').",
  AttributeError: "That object doesn't have that method or attribute. Check the spelling.",
  EOFError: "input() isn't available here. Put a test value in a variable instead.",
};
export const tipFor = msg => TIPS[Object.keys(TIPS).find(k => msg?.includes(k))] || "";

let worker, readyP, readyOk, readyFail;
function boot() {
  readyP = new Promise((ok, fail) => { readyOk = ok; readyFail = fail; });
  worker = new Worker("js/pyworker.js");
  worker.onmessage = e => { if (e.data.ready) readyOk(); };
  worker.onerror = () => { readyFail(new Error("Couldn't load Python. It needs an internet connection the first time (about 10 MB).")); worker = null; };
}

// Runs code (or code + tests). Stops runaway loops after `timeout` ms.
export async function runPython(code, { tests, fn, timeout = 6000, onStatus } = {}) {
  if (!worker) boot();
  onStatus?.("Loading Python…");
  try { await readyP; } catch (e) { worker = null; return { ok: false, output: "", error: e.message }; }
  onStatus?.("Running…");
  const w = worker, id = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      w.terminate(); worker = null;
      resolve({ ok: false, output: "", error: "Your code ran for more than 6 seconds, so I stopped it. Is there a loop that never ends, like `while True`?" });
    }, timeout);
    const h = e => { if (e.data.id !== id) return; clearTimeout(timer); w.removeEventListener("message", h); resolve(e.data); };
    w.addEventListener("message", h);
    w.postMessage({ id, code, tests, fn });
  });
}
