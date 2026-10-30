const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const handler = require(path.join(ROOT, "api", "book.js"));

let ipCounter = 0;
function valid(extra) {
  return Object.assign({
    name: "Jane Citizen", email: "jane.secret@example.com", phone: "0412 345 678",
    plan: "first-light", format: "online", days: ["Mon"], times: ["Morning"],
    message: "PRIVATE-MESSAGE-TEXT", consent: true, website: ""
  }, extra);
}
function mkRes() {
  return {
    code: null, payload: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(p) { this.payload = p; return this; }
  };
}
function configure() {
  process.env.RESEND_API_KEY = "k";
  process.env.BOOKING_TO_EMAIL = "to@example.com";
  process.env.BOOKING_FROM_EMAIL = "from@example.com";
  delete process.env.ALLOWED_ORIGIN;
}
async function call(body, opts) {
  opts = opts || {};
  const calls = [];
  const logs = [];
  const origFetch = global.fetch;
  const orig = { warn: console.warn, error: console.error, log: console.log, info: console.info };
  global.fetch = async (...a) => { calls.push(a); return { ok: true, status: 200 }; };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.join(" "));
  configure();
  const req = {
    method: opts.method || "POST",
    headers: Object.assign({ "content-type": "application/json", "x-forwarded-for": "10.9.8." + (++ipCounter) }, opts.headers),
    body
  };
  const res = mkRes();
  try { await handler(req, res); }
  finally { global.fetch = origFetch; Object.assign(console, orig); }
  return { res, calls, logs };
}

test("AC-1: fillMs 45000 with valid fields sends one email and returns 200", async () => {
  const { res, calls } = await call(valid({ fillMs: 45000 }));
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(res.payload, { ok: true });
  assert.strictEqual(calls.length, 1);
});

test("AC-2: legacy startedAt = server time + 1h still reaches provider", async () => {
  const { res, calls } = await call(valid({ startedAt: Date.now() + 3600e3 }));
  assert.strictEqual(res.code, 200);
  assert.strictEqual(calls.length, 1);
});

test("AC-2: legacy startedAt 5s, 1 day and 1 year ahead all reach provider", async () => {
  for (const off of [5000, 86400e3, 365 * 86400e3]) {
    const { calls } = await call(valid({ startedAt: Date.now() + off }));
    assert.strictEqual(calls.length, 1, "offset " + off);
  }
});

test("AC-3: legacy startedAt = server time - 1h, no fillMs, reaches provider", async () => {
  const { res, calls } = await call(valid({ startedAt: Date.now() - 3600e3 }));
  assert.strictEqual(res.code, 200);
  assert.strictEqual(calls.length, 1);
});

test("AC-3: legacy startedAt equal to now (old code would drop) is ignored", async () => {
  const { calls } = await call(valid({ startedAt: Date.now() }));
  assert.strictEqual(calls.length, 1);
});

test("AC-4: fillMs 500 returns 200 ok, no provider call, one PII-free log line", async () => {
  const { res, calls, logs } = await call(valid({ fillMs: 500 }));
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(res.payload, { ok: true });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(logs.length, 1);
  for (const pii of ["Jane", "Citizen", "jane.secret", "example.com", "0412", "345 678", "PRIVATE-MESSAGE"]) {
    assert.ok(!logs[0].includes(pii), "log leaks " + pii);
  }
});

test("AC-4: boundaries 0 and 2999 dropped, 3000 and 3001 accepted", async () => {
  for (const ms of [0, 2999]) {
    const { res, calls } = await call(valid({ fillMs: ms }));
    assert.strictEqual(res.code, 200);
    assert.strictEqual(calls.length, 0, "fillMs " + ms);
  }
  for (const ms of [3000, 3001]) {
    const { calls } = await call(valid({ fillMs: ms }));
    assert.strictEqual(calls.length, 1, "fillMs " + ms);
  }
});

test("AC-4: log does not echo hostile field values", async () => {
  const { logs } = await call(valid({ fillMs: 10, name: "ZZZ-NAME-ZZZ", email: "zzz@leak.test" }));
  assert.ok(logs.length >= 1);
  const all = logs.join("\n");
  assert.ok(!all.includes("ZZZ-NAME") && !all.includes("leak.test"));
});

test("AC-5: non-empty honeypot returns 200, no provider call, PII-free log", async () => {
  const { res, calls, logs } = await call(valid({ website: "http://spam.example", fillMs: 45000 }));
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(res.payload, { ok: true });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(logs.length, 1);
  for (const pii of ["Jane", "jane.secret", "0412", "PRIVATE-MESSAGE", "spam.example"]) {
    assert.ok(!logs[0].includes(pii), "log leaks " + pii);
  }
});

test("AC-5: whitespace-only honeypot is not treated as a bot", async () => {
  const { calls } = await call(valid({ website: "   ", fillMs: 45000 }));
  assert.strictEqual(calls.length, 1);
});

test("AC-6: hostile fillMs values never 500 and are never dropped by timing", async () => {
  const cases = [
    ["-5", valid({ fillMs: -5 })],
    ["abc", valid({ fillMs: "abc" })],
    ["null", valid({ fillMs: null })],
    ["missing", valid()],
    ["array", valid({ fillMs: [1] })],
    ["object", valid({ fillMs: { a: 1 } })],
    ["numeric string 100", valid({ fillMs: "100" })],
    ["true", valid({ fillMs: true })],
    ["huge", valid({ fillMs: 1e300 })]
  ];
  for (const [label, b] of cases) {
    const { res, calls } = await call(b);
    assert.notStrictEqual(res.code, 500, label);
    assert.strictEqual(res.code, 200, label);
    assert.strictEqual(calls.length, 1, label + " should not be dropped");
  }
});

test("AC-6: raw JSON text with fillMs 1e309 (Infinity) does not crash or drop", async () => {
  const raw = JSON.stringify(valid()).replace(/}$/, ',"fillMs":1e309}');
  const { res, calls } = await call(raw);
  assert.notStrictEqual(res.code, 500);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(calls.length, 1);
});

test("AC-6: malformed, array, null and absent bodies do not 500", async () => {
  for (const b of ["{not json", "null", "[]", 5, undefined]) {
    const { res } = await call(b);
    assert.ok(res.code === 400 || res.code === 200, String(b) + " got " + res.code);
  }
});

test("AC-8: invalid fields return 400 with fields", async () => {
  const { res, calls } = await call(valid({ fillMs: 45000, name: "", email: "bad", plan: "nope", consent: false }));
  assert.strictEqual(res.code, 400);
  assert.strictEqual(res.payload.error, "invalid_fields");
  for (const f of ["name", "email", "plan", "consent"]) assert.ok(res.payload.fields[f], f);
  assert.strictEqual(calls.length, 0);
});

test("AC-8: 405 for non-POST with Allow header", async () => {
  const { res } = await call(valid(), { method: "GET" });
  assert.strictEqual(res.code, 405);
  assert.strictEqual(res.headers.Allow, "POST");
});

test("AC-8: 415 for wrong content type", async () => {
  const { res } = await call(valid(), { headers: { "content-type": "text/plain" } });
  assert.strictEqual(res.code, 415);
});

test("AC-8: 403 for foreign origin", async () => {
  configure();
  process.env.ALLOWED_ORIGIN = "https://good.example";
  const res = mkRes();
  try {
    await handler({ method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", "x-forwarded-for": "10.7.7.7" }, body: valid({ fillMs: 45000 }) }, res);
  } finally { delete process.env.ALLOWED_ORIGIN; }
  assert.strictEqual(res.code, 403);
});

test("AC-8: 429 after more than 5 requests from one IP", async () => {
  const codes = [];
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: true });
  configure();
  try {
    for (let i = 0; i < 7; i++) {
      const res = mkRes();
      await handler({ method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.55.55.55" }, body: valid({ fillMs: 45000 }) }, res);
      codes.push(res.code);
    }
  } finally { global.fetch = origFetch; }
  assert.deepStrictEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
});

test("AC-8: 503 when not configured", async () => {
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: true });
  configure();
  delete process.env.RESEND_API_KEY;
  const res = mkRes();
  try {
    await handler({ method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.66.66.66" }, body: valid({ fillMs: 45000 }) }, res);
  } finally { global.fetch = origFetch; }
  assert.strictEqual(res.code, 503);
});

test("AC-8: provider failure returns 502", async () => {
  const origFetch = global.fetch;
  const e = console.error;
  global.fetch = async () => ({ ok: false, status: 500 });
  console.error = () => {};
  configure();
  const res = mkRes();
  try {
    await handler({ method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.77.77.78" }, body: valid({ fillMs: 45000 }) }, res);
  } finally { global.fetch = origFetch; console.error = e; }
  assert.strictEqual(res.code, 502);
});

test("AC-7: client sends numeric fillMs from performance.now() and no startedAt (source check)", () => {
  const src = fs.readFileSync(path.join(ROOT, "assets", "js", "app.js"), "utf8");
  assert.match(src, /fillMs\s*:\s*Math\.round\(\s*performance\.now\(\)\s*-\s*startedAt\s*\)/);
  assert.doesNotMatch(src, /startedAt\s*:/, "payload must not contain startedAt key");
  assert.doesNotMatch(src, /startedAt\s*=\s*Date\.now/, "startedAt must not use device clock");
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*startedAt/);
  const inits = src.match(/startedAt\s*=\s*performance\.now\(\)/g) || [];
  assert.ok(inits.length >= 2, "set at load and on reset");
});

test("AC-9: sw.js VERSION differs from rosee-v1", () => {
  const src = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const m = src.match(/const VERSION\s*=\s*["']([^"']+)["']/);
  assert.ok(m);
  assert.notStrictEqual(m[1], "rosee-v1");
});
