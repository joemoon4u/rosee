const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const handler = require("../../api/book.js");

const valid = () => ({
  name: "Jane Citizen", email: "jane@example.com", phone: "0400 000 000",
  plan: "first-light", format: "online", days: ["Mon"], times: ["Morning"],
  message: "Hello there", consent: true, website: ""
});

let calls, logs, realFetch, realWarn, realLog, n = 0;
beforeEach(() => {
  calls = 0; logs = [];
  process.env.RESEND_API_KEY = "k";
  process.env.BOOKING_TO_EMAIL = "to@example.com";
  process.env.BOOKING_FROM_EMAIL = "from@example.com";
  delete process.env.ALLOWED_ORIGIN;
  realFetch = global.fetch; realWarn = console.warn; realLog = console.log;
  global.fetch = async () => { calls++; return { ok: true, status: 200 }; };
  console.warn = console.log = (...a) => logs.push(a.join(" "));
});
afterEach(() => { global.fetch = realFetch; console.warn = realWarn; console.log = realLog; });

async function post(extra, raw) {
  const body = raw || Object.assign(valid(), extra);
  const res = {
    code: 0, payload: null, setHeader() {},
    status(c) { this.code = c; return this; },
    json(j) { this.payload = j; return this; }
  };
  const req = {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0." + (++n) },
    body
  };
  await handler(req, res);
  return res;
}

test("AC-1 fillMs 45000 sends email", async () => {
  const r = await post({ fillMs: 45000 });
  assert.equal(r.code, 200); assert.equal(calls, 1);
});

test("AC-2 legacy startedAt in the future is not dropped", async () => {
  const r = await post({ startedAt: Date.now() + 3600e3 });
  assert.equal(r.code, 200); assert.equal(calls, 1);
});

test("AC-3 legacy startedAt in the past, no fillMs", async () => {
  const r = await post({ startedAt: Date.now() - 3600e3 });
  assert.equal(r.code, 200); assert.equal(calls, 1);
});

test("AC-4 too fast is dropped silently with PII-free log", async () => {
  const r = await post({ fillMs: 500 });
  assert.equal(r.code, 200); assert.deepEqual(r.payload, { ok: true }); assert.equal(calls, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /too_fast/);
  for (const s of ["Jane", "jane@example.com", "0400", "Hello"]) assert.ok(!logs[0].includes(s));
});

test("AC-5 honeypot dropped with PII-free log", async () => {
  const r = await post({ website: "http://spam", fillMs: 45000 });
  assert.equal(r.code, 200); assert.equal(calls, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /honeypot/);
  for (const s of ["Jane", "jane@example.com", "0400", "Hello", "spam"]) assert.ok(!logs[0].includes(s));
});

test("AC-6 odd fillMs values never crash or wrongly drop", async () => {
  for (const v of [-5, "abc", null, Infinity, undefined, "500", NaN, {}, [], true]) {
    calls = 0;
    const r = await post({ fillMs: v });
    assert.equal(r.code, 200, String(v)); assert.equal(calls, 1, String(v));
  }
  calls = 0;
  const raw = JSON.parse(JSON.stringify(valid()).replace(/}$/, ',"fillMs":1e309}'));
  const r = await post(null, raw);
  assert.equal(r.code, 200); assert.equal(calls, 1);
});

test("fillMs boundaries: 0 and 2999 dropped, 3000 accepted", async () => {
  for (const [v, sent] of [[0, 0], [2999, 0], [3000, 1]]) {
    calls = 0;
    await post({ fillMs: v });
    assert.equal(calls, sent, String(v));
  }
});

test("AC-8 validation still returns 400 with fields", async () => {
  const r = await post({ email: "bad", fillMs: 45000 });
  assert.equal(r.code, 400); assert.ok(r.payload.fields.email);
});

test("AC-9 service worker version bumped", () => {
  const sw = fs.readFileSync(path.join(__dirname, "../../sw.js"), "utf8");
  assert.ok(!sw.includes('VERSION = "rosee-v1"'));
  assert.match(sw, /VERSION = "rosee-v\d+"/);
});

test("client sends fillMs from performance.now and no startedAt field", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../assets/js/app.js"), "utf8");
  assert.match(src, /fillMs: Math\.round\(performance\.now\(\) - startedAt\)/);
  assert.ok(!/startedAt:/.test(src));
  assert.ok(!/startedAt = Date\.now/.test(src));
});
