// Runs student code in a Web Worker with Pyodide, so the page never freezes and
// nothing the student writes ever runs on the server.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
const ready = loadPyodide().then(py => { postMessage({ ready: true }); return py; });

const norm = x => x instanceof Set ? [...x].sort() : x instanceof Map ? Object.fromEntries([...x].map(([k, v]) => [k, norm(v)]))
  : Array.isArray(x) ? x.map(norm) : x === undefined ? null : x;
const friendly = e => {
  const msg = String(e.message || e), lines = msg.trim().split("\n");
  const n = [...msg.matchAll(/File "<exec>", line (\d+)/g)].pop();
  return n ? `${lines[lines.length - 1]} (line ${n[1]})` : lines[lines.length - 1];
};

onmessage = async ({ data: { id, code, tests, fn } }) => {
  const py = await ready;
  let out = "";
  py.setStdout({ batched: s => { out += s + "\n"; } });
  py.setStderr({ batched: s => { out += s + "\n"; } });
  py.setStdin({ stdin: () => null });                       // input() ends with EOFError instead of hanging
  try {
    if (!tests) { await py.runPythonAsync(code); return postMessage({ id, ok: true, output: out }); }
    const ns = py.globals.get("dict")();
    await py.runPythonAsync(code, { globals: ns });
    const f = ns.get(fn);
    if (!f) return postMessage({ id, ok: false, output: out, error: `I couldn't find a function named ${fn}. Define it with: def ${fn}(...):` });
    const results = tests.map(t => {
      try {
        const args = t.args.map(a => (a !== null && typeof a === "object" ? py.toPy(a) : a));
        let r = f(...args);
        if (r && r.toJs) r = r.toJs({ dict_converter: Object.fromEntries });
        return { actual: norm(r), error: null };
      } catch (e) { return { actual: null, error: friendly(e) }; }
    });
    postMessage({ id, ok: true, output: out, results });
  } catch (e) { postMessage({ id, ok: false, output: out, error: friendly(e) }); }
};
