/* Proves the deterministic controls do what the policy says.
   Runs the real hook scripts against a throwaway project. Run: npm run test:crew */

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "../..");
const RANGE_SAFETY = path.join(REPO, ".claude/hooks/range-safety.js");
const RECORDER = path.join(REPO, ".claude/hooks/flight-recorder.js");
const VERIFY = path.join(REPO, ".crew/bin/verify-recorder.js");
const MISSION = "2026-01-01-fixture";
let proj;

before(() => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), "crew-fixture-"));
  fs.mkdirSync(path.join(proj, ".crew/missions", MISSION), { recursive: true });
  fs.copyFileSync(path.join(REPO, ".crew/policy.json"), path.join(proj, ".crew/policy.json"));
  fs.writeFileSync(path.join(proj, ".crew/missions", MISSION, "mission.md"), "# fixture\n");
  const git = (...a) => execFileSync("git", ["-C", proj, ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
});

function run(script, payload) {
  const r = spawnSync("node", [script], {
    input: JSON.stringify({ session_id: "s1", cwd: proj, hook_event_name: "PreToolUse", ...payload }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
    encoding: "utf8"
  });
  return { code: r.status, err: r.stderr };
}
const pre = (agent_type, tool_name, tool_input) => run(RANGE_SAFETY, { agent_type, tool_name, tool_input });
const blocked = (r, why) => {
  assert.equal(r.code, 2, "expected block: " + why);
  assert.doesNotMatch(r.err, /Failing closed|flight recorder error/, "blocked by a script error, not by policy: " + r.err);
};
const allowed = (r) => { assert.equal(r.code, 0, "expected allow, got: " + r.err); };
const bash = (role, command) => pre(role, "Bash", { command });
const write = (role, file_path) => pre(role, "Write", { file_path: path.join(proj, file_path), content: "x" });
const dispatch = (role, subagent_type, prompt) => pre(role, "Agent", { subagent_type, prompt });

test("a human-driven session (no crew role) is not restricted", () => {
  allowed(bash(undefined, "git push origin main"));
});

test("no crew agent can push, install packages, use the network or deploy", () => {
  blocked(bash("responsible-engineer", "git push origin feature"), "push");
  blocked(bash("responsible-engineer", "npm install left-pad"), "install");
  blocked(bash("responsible-engineer", "npx some-tool"), "npx");
  blocked(bash("launch-director", "curl https://example.com"), "network");
  blocked(bash("launch-director", "vercel --prod"), "deploy");
  blocked(pre("chief-engineer", "WebFetch", { url: "https://example.com" }), "web");
});

test("secrets can't be read by any crew agent", () => {
  blocked(pre("security-engineer", "Read", { file_path: path.join(proj, ".env") }), ".env");
  blocked(bash("responsible-engineer", "cat .env.local"), ".env.local");
  blocked(bash("responsible-engineer", "printenv"), "printenv");
  allowed(bash("security-engineer", 'grep -n "process.env" api/book.js'));
});

test("maker and checker are separated", () => {
  allowed(write("responsible-engineer", "api/book.js"));
  blocked(write("responsible-engineer", "tests/acceptance/book.test.js"), "builder edits checker's tests");
  blocked(bash("responsible-engineer", "cat x > tests/acceptance/book.test.js"), "builder shell-writes checker's tests");
  allowed(write("test-engineer", "tests/acceptance/book.test.js"));
  blocked(write("test-engineer", "api/book.js"), "tester edits source");
  blocked(pre("test-engineer", "Read", { file_path: path.join(proj, "tests/unit/book.test.js") }), "tester reads builder's tests");
  blocked(pre("test-engineer", "Read", { file_path: path.join(proj, ".crew/missions", MISSION, "flight-cards/02-responsible-engineer.md") }), "tester reads builder's card");
});

test("report-only roles can't write, even through the shell", () => {
  blocked(write("security-engineer", "api/book.js"), "security writes");
  blocked(bash("security-engineer", "echo hacked > api/book.js"), "shell redirect");
  blocked(bash("chief-engineer", "sed -i s/a/b/ api/book.js"), "sed -i");
  blocked(bash("chief-engineer", "echo x | tee api/book.js"), "tee");
  blocked(bash("chief-engineer", "node -e \"require('fs').writeFileSync('a','b')\""), "node -e not on list");
  allowed(bash("security-engineer", "cd /tmp && git diff HEAD~1 --stat 2>&1 | head -50"));
});

test("guardrails, audit logs and approvals can't be changed by agents", () => {
  blocked(write("responsible-engineer", ".claude/hooks/range-safety.js"), "hook");
  blocked(write("responsible-engineer", ".crew/policy.json"), "policy");
  blocked(write("chief-of-staff", ".crew/flight-recorder/s1.jsonl"), "recorder");
  blocked(write("chief-of-staff", `.crew/missions/${MISSION}/approvals.md`), "approvals");
  allowed(write("chief-of-staff", `.crew/missions/${MISSION}/mission.md`));
  blocked(bash("responsible-engineer", "echo $(whoami)"), "command substitution");
  blocked(bash("responsible-engineer", "git commit --no-verify -m x"), "no-verify");
});

test("no commits on main", () => {
  blocked(bash("responsible-engineer", "git commit -m x"), "commit on main");
  execFileSync("git", ["-C", proj, "checkout", "-q", "-b", "mission/fixture"]);
  allowed(bash("responsible-engineer", "git commit -m x"));
});

test("Chief of Staff can only dispatch crew roles, with a mission id", () => {
  blocked(dispatch("chief-of-staff", "general-purpose", `MISSION-ID: ${MISSION}`), "non-crew agent");
  blocked(dispatch("chief-of-staff", "chief-engineer", "design something"), "no mission id");
  blocked(dispatch("chief-of-staff", "chief-engineer", "MISSION-ID: no-such-mission"), "no mission record");
  allowed(dispatch("chief-of-staff", "chief-engineer", `MISSION-ID: ${MISSION}`));
  blocked(dispatch("chief-engineer", "responsible-engineer", `MISSION-ID: ${MISSION}`), "only CoS dispatches");
});

test("human design gate, then a 3-cycle build cap", () => {
  const brief = `MISSION-ID: ${MISSION}\nbuild it`;
  blocked(dispatch("chief-of-staff", "responsible-engineer", brief), "no approval");
  fs.writeFileSync(path.join(proj, ".crew/missions", MISSION, "approvals.md"), "DESIGN: APPROVED by Flight Director\n");
  allowed(dispatch("chief-of-staff", "responsible-engineer", brief));
  allowed(dispatch("chief-of-staff", "responsible-engineer", brief));
  allowed(dispatch("chief-of-staff", "responsible-engineer", brief));
  blocked(dispatch("chief-of-staff", "responsible-engineer", brief), "4th build cycle");
});

test("every block is written to the flight recorder", () => {
  const log = fs.readFileSync(path.join(proj, ".crew/flight-recorder/s1.jsonl"), "utf8");
  assert.match(log, /"event":"RangeSafetyDeny"/);
  assert.match(log, /git push origin feature/);
});

test("Flight Recorder redacts secrets and enforces a flight card", () => {
  const post = run(RECORDER, {
    hook_event_name: "PostToolUse", agent_type: "responsible-engineer", agent_id: "a1",
    tool_name: "Bash", tool_input: { command: "echo re_abcdefghijklmnop" }, tool_response: { stdout: "token=supersecretvalue" }
  });
  allowed(post);
  const noCard = { hook_event_name: "SubagentStop", agent_type: "test-engineer", agent_id: "a2", last_assistant_message: "all good!" };
  blocked(run(RECORDER, noCard), "no flight card");
  allowed(run(RECORDER, { ...noCard, stop_hook_active: true }));
  allowed(run(RECORDER, { ...noCard, last_assistant_message: "Role: Test Engineer\nVerdict: GO\nEvidence: 12/12 pass" }));
  const log = fs.readFileSync(path.join(proj, ".crew/flight-recorder/s1.jsonl"), "utf8");
  assert.doesNotMatch(log, /re_abcdefghijklmnop|supersecretvalue/);
  assert.match(log, /FlightCardMissing/);
  assert.match(log, /"event":"FlightCard"/);
});

test("tampering with the flight recorder is detected", () => {
  const file = path.join(proj, ".crew/flight-recorder/s1.jsonl");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj };
  assert.equal(spawnSync("node", [VERIFY, file], { env }).status, 0);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines[1] = lines[1].replace("RangeSafetyDeny", "ToolCall");
  fs.writeFileSync(file, lines.join("\n"));
  const r = spawnSync("node", [VERIFY, file], { env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /TAMPERED/);
});
