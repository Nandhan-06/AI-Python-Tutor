const NET = "Can't reach the tutor server. Check that it is running and that you're online.";
const HDR = { "Content-Type": "application/json" };

async function fail(r) {
  const d = await r.json().catch(() => ({}));
  return new Error(typeof d.detail === "string" ? d.detail
    : r.status === 422 ? "That input wasn't valid. Please check it and try again." : "Something went wrong. Please try again.");
}
async function send(path, init) {
  let r;
  try { r = await fetch(path, init); }
  catch (e) { if (e.name === "AbortError") throw e; throw new Error(NET); }
  if (!r.ok) throw await fail(r);
  return r;
}

export const api = async (path, body, signal) =>
  (await send(path, body === undefined ? { signal } : { method: "POST", headers: HDR, body: JSON.stringify(body), signal })).json();

export async function transcribe(blob) {
  const fd = new FormData();
  fd.append("file", blob, blob.type.includes("mp4") ? "speech.m4a" : "speech.webm");
  return (await (await send("/speech/transcribe", { method: "POST", body: fd })).json()).text;
}

export async function speakBlob(text, voice, signal) {
  return (await send("/speech/speak", { method: "POST", headers: HDR, body: JSON.stringify({ text, voice }), signal })).blob();
}

// Server-sent events over fetch: calls onDelta for each text piece, returns the final lesson.
export async function streamAsk(body, { onDelta, signal }) {
  const r = await send("/tutor/ask/stream", { method: "POST", headers: HDR, body: JSON.stringify(body), signal });
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "", final = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (!line.startsWith("data: ")) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.type === "delta") onDelta(ev.text);
      else if (ev.type === "error") throw new Error(ev.message);
      else if (ev.type === "done") final = ev;
    }
  }
  if (!final) throw new Error("The lesson was cut off. Please try again.");
  return final;
}
