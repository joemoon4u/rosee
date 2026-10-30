#!/usr/bin/env node
/* Checks every Flight Recorder log is intact: each line's hash must match its content
   and the hash of the line before it. Any edit, deletion or reordering breaks the chain.

   Usage: node .crew/bin/verify-recorder.js [file.jsonl ...]   (default: all logs) */

const fs = require("fs");
const path = require("path");
const { hashEntry, RECORDER_DIR } = require("../../.claude/hooks/lib");

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (fs.existsSync(RECORDER_DIR) ? fs.readdirSync(RECORDER_DIR) : [])
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(RECORDER_DIR, f));

let bad = 0;
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  let prev = "GENESIS";
  let problem = null;
  lines.forEach((line, i) => {
    if (problem) return;
    let e;
    try { e = JSON.parse(line); } catch (err) { problem = `line ${i + 1}: not valid JSON`; return; }
    const { hash, ...body } = e;
    if (e.seq !== i) problem = `line ${i + 1}: sequence ${e.seq}, expected ${i} (entry missing or reordered)`;
    else if (body.prev_hash !== prev) problem = `line ${i + 1}: chain broken (previous entry changed or removed)`;
    else if (hashEntry(prev, body) !== hash) problem = `line ${i + 1}: content changed after it was written`;
    prev = hash;
  });
  if (problem) bad++;
  console.log(`${problem ? "TAMPERED" : "OK      "}  ${path.basename(file)}  (${lines.length} entries)${problem ? "  " + problem : ""}`);
}
if (!files.length) console.log("No flight recorder logs yet.");
process.exit(bad ? 1 : 0);
