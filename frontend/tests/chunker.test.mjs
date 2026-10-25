import test from "node:test";
import assert from "node:assert/strict";
import { chunker } from "../js/text.js";

const run = (pieces) => { const out = []; const c = chunker(t => out.push(t)); pieces.forEach(p => c.push(p)); c.flush(); return out; };

test("splits on sentence ends once a sentence is long enough", () => {
  assert.deepEqual(run(["A for loop repeats code. ", "It runs once per item! Neat."]),
    ["A for loop repeats code.", "It runs once per item!", "Neat."]);
});
test("short openers stay joined to the next sentence", () => {
  assert.deepEqual(run(["Hi. That means variables store values. Ok."]), ["Hi. That means variables store values.", "Ok."]);
});
test("works when text arrives a few characters at a time", () => {
  const text = "Variables hold values for later. You can change them anytime.";
  assert.deepEqual(run(text.match(/.{1,5}/g)), ["Variables hold values for later.", "You can change them anytime."]);
});
test("long text without punctuation is still chunked", () => {
  const out = run(["word ".repeat(80)]); assert.ok(out.length > 1 && out.every(s => s.length <= 230));
});
test("nothing is lost", () => {
  const text = "One two three four five six. Seven eight nine ten eleven twelve? Yes.";
  assert.equal(run([text]).join(" "), text);
});
