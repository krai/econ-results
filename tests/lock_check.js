/* The page's own lock under node: web/lock.js opens, with WebCrypto, what tools/lock.py sealed, refuses anything that
   is not it, and finds the key in a link. Run by tests/test_lock.py: node tests/lock_check.js INPUT.json; prints a
   JSON summary, exits 1 on a difference. */
"use strict";
const fs = require("fs");
const path = require("path");
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require("crypto").webcrypto;  // node 18 has it here
require(path.join(__dirname, "..", "web", "lock.js"));
const L = globalThis.EconLock;
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

(async function () {
  const bad = [];
  const page = await L.open(input.key, input.iv, input.sealed);
  if (page !== input.page) bad.push("the page that opened is not the page that was locked");
  for (const [name, key, iv, sealed] of [["another key", input.other_key, input.iv, input.sealed],
                                        ["another IV", input.key, input.other_iv, input.sealed],
                                        ["a changed page", input.key, input.iv, input.changed]]) {
    let opened = false;
    try { await L.open(key, iv, sealed); opened = true; } catch (e) { /* refused, as it must be */ }
    if (opened) bad.push(`${name} opened the page`);
  }
  for (const [text, want] of input.keys) {
    if (L.keyOf(text) !== want) bad.push(`the key of ${JSON.stringify(text)}: got ${JSON.stringify(L.keyOf(text))}, want ${JSON.stringify(want)}`);
  }
  if (L.FORMAT !== input.format) bad.push(`the format is ${L.FORMAT} here and ${input.format} in tools/lock.py`);
  console.log(JSON.stringify({characters: page.length, refused: 3, keys: input.keys.length, bad}));
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.log(JSON.stringify({bad: [String(e && e.stack || e)]})); process.exit(1); });
