/* Shared helpers for the crew's deterministic controls (Range Safety, Flight Recorder).
   No dependencies: Node built-ins only. */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CREW_DIR = path.join(PROJECT_DIR, ".crew");
const RECORDER_DIR = path.join(CREW_DIR, "flight-recorder");
const STATE_DIR = path.join(CREW_DIR, "state");

// Returns the hook input, {} if there was none, or null if it wasn't valid JSON.
function readStdin() {
  let raw = "";
  try { raw = fs.readFileSync(0, "utf8"); } catch (e) { return {}; }
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function loadPolicy() {
  return JSON.parse(fs.readFileSync(path.join(CREW_DIR, "policy.json"), "utf8"));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Simple cross-process lock so parallel tool calls can't break the hash chain.
function withLock(lockPath, fn) {
  for (let i = 0; i < 200; i++) {
    let fd;
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (e) {
      // stale lock older than 10s: remove and retry
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 10000) fs.unlinkSync(lockPath);
      } catch (_) { /* ignore */ }
      sleep(25);
      continue;
    }
    try {
      return fn();
    } finally {
      fs.closeSync(fd);
      try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ }
    }
  }
  throw new Error("could not acquire lock " + lockPath);
}

const SECRET_VALUE_RE = /\b(re_|sk-|sk_live_|ghp_|gho_|ghs_|github_pat_|xox[abposr]-|AKIA)[A-Za-z0-9_\-]{8,}/g;
const SECRET_KV_RE = /((?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?(?:Bearer\s+)?)([^\s"',}]{6,})/gi;

function redact(text) {
  return String(text)
    .replace(SECRET_VALUE_RE, "[REDACTED]")
    .replace(SECRET_KV_RE, "$1[REDACTED]");
}

function summarise(value, max) {
  if (value === undefined || value === null) return null;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  const r = redact(s);
  return r.length > max ? r.slice(0, max) + `… [${r.length - max} more chars]` : r;
}

function hashEntry(prevHash, entry) {
  return crypto.createHash("sha256").update(prevHash + "\n" + JSON.stringify(entry)).digest("hex");
}

// Append one tamper-evident entry. Each line carries the hash of the line before it.
function record(sessionId, entry) {
  fs.mkdirSync(RECORDER_DIR, { recursive: true });
  const file = path.join(RECORDER_DIR, `${sessionId || "unknown-session"}.jsonl`);
  return withLock(file + ".lock", () => {
    let prevHash = "GENESIS";
    let seq = 0;
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length) {
        const last = JSON.parse(lines[lines.length - 1]);
        prevHash = last.hash;
        seq = last.seq + 1;
      }
    }
    const body = { seq, ts: new Date().toISOString(), ...entry, prev_hash: prevHash };
    const line = { ...body, hash: hashEntry(prevHash, body) };
    fs.appendFileSync(file, JSON.stringify(line) + "\n");
    return line;
  });
}

module.exports = {
  PROJECT_DIR, CREW_DIR, RECORDER_DIR, STATE_DIR,
  readStdin, loadPolicy, withLock, redact, summarise, hashEntry, record
};
