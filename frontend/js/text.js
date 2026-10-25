// Splits streamed text into speakable sentences (so Maya can start talking before the reply is finished).
export function chunker(emit, minLen = 20, maxLen = 220) {
  let buf = "";
  const take = n => { const s = buf.slice(0, n).trim(); buf = buf.slice(n).trimStart(); if (s) emit(s); };
  return {
    push(t) {
      buf += t;
      for (;;) {
        const re = /[.!?]["')\]]*\s/g; re.lastIndex = minLen - 1;
        const m = re.exec(buf);
        if (!m) break;
        take(m.index + m[0].length);
      }
      if (buf.length > maxLen) take(Math.max(buf.lastIndexOf(" ", maxLen - 20), minLen));
    },
    flush() { take(buf.length); },
  };
}
