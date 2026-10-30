#!/usr/bin/env node
/* RANGE SAFETY: runs before every tool call (PreToolUse hook).

   Applies .crew/policy.json to crew agents only (calls whose agent_type is a crew role).
   A normal human-driven Claude session in this repo has no agent_type and is not restricted.

   Exit 0 = allow. Exit 2 = block; stderr is shown to the agent as the reason.
   Fails closed: if this script errors on a crew call, the call is blocked. */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { PROJECT_DIR, CREW_DIR, STATE_DIR, readStdin, loadPolicy, withLock, summarise, record } = require("./lib");

const input = readStdin();
const role = input.agent_type || null;

function deny(reason) {
  try {
    record(input.session_id, {
      event: "RangeSafetyDeny",
      agent: role,
      agent_id: input.agent_id || null,
      tool: input.tool_name,
      input: summarise(input.tool_input, 400),
      reason
    });
  } catch (_) { /* logging must never unblock */ }
  process.stderr.write(`RANGE SAFETY NO-GO (${role}): ${reason}\n`);
  process.exit(2);
}

function rel(p) {
  if (!p) return null;
  const abs = path.resolve(input.cwd || PROJECT_DIR, String(p));
  return path.relative(PROJECT_DIR, abs).split(path.sep).join("/");
}

function isSecretPath(policy, text) {
  return policy.secretPathPatterns.some((re) => new RegExp(re, "i").test(String(text)));
}

function startsWithPrefix(relPath, prefix) {
  return prefix === "*" || relPath === prefix.replace(/\/$/, "") || relPath.startsWith(prefix);
}

function checkWrite(policy, rules, p) {
  const r = rel(p);
  if (r === null) deny("No file path given.");
  if (r.startsWith("..") || path.isAbsolute(r)) deny(`${p} is outside the project.`);
  if (isSecretPath(policy, r)) deny(`${r} looks like a secrets file.`);
  if (policy.protectedPaths.some((pre) => startsWithPrefix(r, pre))) {
    deny(`${r} is a guardrail or audit file. Only the Flight Director (a human) changes it.`);
  }
  if (policy.humanOnlyFileNames.includes(path.basename(r))) {
    deny(`${path.basename(r)} records human approvals. Agents can't write it.`);
  }
  if ((rules.writeDeny || []).some((pre) => startsWithPrefix(r, pre))) {
    deny(`${role} may not change ${r}. Maker and checker stay separate.`);
  }
  if (!(rules.write || []).some((pre) => startsWithPrefix(r, pre))) {
    deny(`${role} can only write to: ${(rules.write || []).join(", ") || "nothing (report-only role)"}. Tried ${r}.`);
  }
}

function stripQuoted(cmd) {
  return cmd.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function currentBranch(cwd) {
  try {
    return execFileSync("git", ["-C", cwd || PROJECT_DIR, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch (e) {
    return "";
  }
}

// fd duplications (2>&1, >&2, <&0) are neither writes nor separators.
// &> and >& mean "write stdout and stderr", the same as > for our checks; |& is a pipe.
function normaliseShell(s) {
  return s.replace(/\d*[<>]&\d+-?/g, " ").replace(/&>/g, ">").replace(/>&/g, ">").replace(/\|&/g, "|");
}

// Split on every command separator, including a single & (run in background).
function splitSegments(s) {
  return s.split(/&&|\|\||[;&|\n]/).map((x) => x.trim()).filter(Boolean);
}

const PLAIN_PATH = /^[A-Za-z0-9_./@+-]+$/;

function checkBash(policy, rules, command) {
  const cmd = String(command || "");

  // 1. Anything that runs hidden commands is denied outright.
  if (/\$\(|`|[<>]\(/.test(cmd.replace(/'[^']*'/g, "''"))) {
    deny("Command or process substitution ($(...), backticks, <(...), >(...)) hides what runs. Run each command on its own.");
  }

  const raw = normaliseShell(cmd);
  const bare = normaliseShell(stripQuoted(cmd));
  const rawSegments = splitSegments(raw);
  const segments = splitSegments(bare)
    .map((x) => x.replace(/^[({]\s*/, "").replace(/\s*[)}]$/, ""))
    .filter(Boolean);

  // 2. Blocked commands. Rules match the raw text, quotes included, so `node -e "...curl..."` is caught.
  //    A readersExempt rule skips a segment that starts with a pure reader (cat, grep, ...),
  //    which only prints text that mentions a tool name and can't run it.
  const readers = policy.readerCommands || [];
  const isReader = (seg) => readers.some((r) => seg === r || seg.startsWith(r + " "));
  for (const b of policy.blockedCommands) {
    const re = new RegExp(b.pattern, "i");
    const hit = b.readersExempt ? rawSegments.some((seg) => !isReader(seg) && re.test(seg)) : re.test(cmd);
    if (hit) deny(b.reason);
  }
  if (isSecretPath(policy, cmd)) deny("The command touches a secrets file.");

  // 3. Environment variables can change what a command runs (GIT_EXTERNAL_DIFF, NODE_OPTIONS, PAGER).
  if (segments.some((seg) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(seg))) {
    deny("Setting environment variables in a command can change what it runs (for example GIT_EXTERNAL_DIFF or NODE_OPTIONS). Not allowed for crew agents.");
  }
  if (/\bfind\b[^;&|\n]*\s-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)\b/.test(bare)) deny("find with -delete, -exec or -fprint is not allowed.");

  // 4. File writes from the shell must obey the same write rules as the Write tool.
  if (/(^|\s)--output(=|\s|$)/.test(bare) || /\bsort\b[^;&|\n]*\s-[a-zA-Z]*o/.test(bare)) {
    deny("Writing files through --output or sort -o isn't allowed. Use the Write or Edit tool.");
  }
  if (/--(compress-program|pre|ext-diff|textconv)\b/.test(bare)) {
    deny("Options that start another program (--compress-program, --pre, --ext-diff, --textconv) aren't allowed.");
  }
  if (/\btee\b/.test(bare) || /\bsed\b[^;&|\n]*\s(-[a-zA-Z]*i|--in-place)/.test(bare)) {
    deny("tee and sed -i write files outside the write rules. Use the Write or Edit tool.");
  }
  const devNull = /\d*>>?\|?\s*\/dev\/null(?=\s|$|[;&|)])/g;
  if (/>/.test(bare.replace(devNull, " "))) {
    if (!rules.allowRedirects) deny(`${role} can't write files from the shell. Use the Write or Edit tool so the write rules apply.`);
    if (segments.some((seg) => /^(cd|pushd|popd)(\s|$)/.test(seg))) {
      deny("Don't change directory in a command that writes files. Write paths are checked from the project root.");
    }
    for (const m of raw.replace(devNull, " ").matchAll(/>+\|?\s*([^\s;&|<>()]*)/g)) {
      if (!PLAIN_PATH.test(m[1])) deny(`Shell writes must go to a plain file path (no quotes, variables or wildcards). Got "${m[1]}".`);
      checkWrite(policy, rules, m[1]);
    }
  }
  for (const seg of segments) {
    const m = /^(mkdir|touch)\s+(.*)$/.exec(seg);
    if (!m) continue;
    for (const arg of m[2].split(/\s+/).filter((a) => a && !a.startsWith("-"))) {
      if (!PLAIN_PATH.test(arg)) deny(`${m[1]} needs a plain path (no quotes, variables or wildcards). Got "${arg}".`);
      checkWrite(policy, rules, arg);
    }
  }

  if (/\bgit\s+commit\b/.test(bare)) {
    const branch = currentBranch(input.cwd);
    if (branch === "main" || branch === "master" || branch === "HEAD" || branch === "") {
      deny(`Commits to "${branch || "unknown"}" are not allowed. Work on a feature branch.`);
    }
  }

  // 5. Every command must be on the role's list.
  const allowed = policy.readOnlyCommands.concat(rules.bashExtra || []);
  for (const seg of segments) {
    const ok = allowed.some((a) => seg === a || seg.startsWith(a + " "));
    if (!ok) deny(`"${seg.split(/\s+/).slice(0, 3).join(" ")}" isn't on the ${role} command list.`);
  }
}

function missionState(fn) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, "missions.json");
  return withLock(file + ".lock", () => {
    const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    const out = fn(state);
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    return out;
  });
}

function checkDispatch(policy, rules, toolInput) {
  const target = toolInput.subagent_type;
  if (!(rules.canDispatch || []).includes(target)) {
    deny(`${role} can't dispatch "${target || "an unnamed agent"}". Only crew roles: ${(rules.canDispatch || []).join(", ") || "none"}.`);
  }
  const m = /MISSION-ID:\s*([A-Za-z0-9._-]+)/.exec(String(toolInput.prompt || ""));
  if (!m) deny("Every dispatch must include a line 'MISSION-ID: <id>' so the work is traceable.");
  const missionId = m[1];
  const missionDir = path.join(CREW_DIR, "missions", missionId);
  if (!fs.existsSync(path.join(missionDir, "mission.md"))) {
    deny(`Mission ${missionId} has no mission.md yet. The Chief of Staff opens the mission record first.`);
  }

  const gate = (policy.roles[target] || {}).gate;
  if (gate) {
    const approvals = path.join(missionDir, gate.approvalFile);
    const text = fs.existsSync(approvals) ? fs.readFileSync(approvals, "utf8") : "";
    if (!text.includes(gate.mustContain)) {
      deny(`HUMAN GATE: ${target} can't start until the Flight Director writes "${gate.mustContain}" in ${path.relative(PROJECT_DIR, approvals)}. Stop and ask for approval.`);
    }
  }

  if (target === "responsible-engineer") {
    const max = policy.budget.maxBuildCyclesPerMission;
    const ok = missionState((s) => {
      s[missionId] = s[missionId] || { buildCycles: 0 };
      if (s[missionId].buildCycles >= max) return false;
      s[missionId].buildCycles += 1;
      return true;
    });
    if (!ok) deny(`${max} build cycles used on ${missionId}. Escalate to the Flight Director instead of trying again.`);
  }
}

function checkBudget(policy) {
  const n = missionState((s) => {
    s._sessions = s._sessions || {};
    s._sessions[input.session_id] = (s._sessions[input.session_id] || 0) + 1;
    return s._sessions[input.session_id];
  });
  if (n > policy.budget.maxToolCallsPerSession) {
    deny(`Mission budget used (${policy.budget.maxToolCallsPerSession} tool calls). Stop and report to the Flight Director.`);
  }
}

try {
  if (input.hook_event_name && input.hook_event_name !== "PreToolUse") process.exit(0);
  const policy = loadPolicy();
  if (!role || !policy.crewRoles.includes(role)) process.exit(0); // not a crew agent

  const rules = policy.roles[role];
  const ti = input.tool_input || {};
  checkBudget(policy);

  // Role-specific read limits (e.g. Test Engineer independence from the builder's work)
  const readTargets = {
    Read: () => rel(ti.file_path) || "",
    Grep: () => `${rel(ti.path || ".")} ${ti.glob || ""}`,
    Glob: () => `${rel(ti.path || ".")} ${ti.pattern || ""}`,
    Bash: () => String(ti.command || "")
  };
  if (rules.readDenyPatterns && readTargets[input.tool_name]) {
    const target = readTargets[input.tool_name]();
    if (rules.readDenyPatterns.some((re) => new RegExp(re).test(target))) deny(rules.readDenyReason || "Not allowed to read that.");
  }

  switch (input.tool_name) {
    case "Write":
    case "Edit":
    case "MultiEdit":
      checkWrite(policy, rules, ti.file_path);
      break;
    case "NotebookEdit":
      checkWrite(policy, rules, ti.notebook_path);
      break;
    case "Read":
      if (isSecretPath(policy, rel(ti.file_path) || "")) deny("Reading secrets files is not allowed.");
      break;
    case "Grep":
    case "Glob":
      if (isSecretPath(policy, `${ti.path || ""} ${ti.pattern || ""} ${ti.glob || ""}`)) deny("Searching secrets files is not allowed.");
      break;
    case "Bash":
      checkBash(policy, rules, ti.command);
      break;
    case "Agent":
    case "Task":
      checkDispatch(policy, rules, ti);
      break;
    case "WebFetch":
    case "WebSearch":
      deny("No web access for crew agents. Outside content is a prompt-injection risk.");
      break;
    default:
      break;
  }
  process.exit(0);
} catch (err) {
  if (role) {
    process.stderr.write(`RANGE SAFETY NO-GO: policy check failed (${err.message}). Failing closed.\n`);
    process.exit(2);
  }
  process.exit(0);
}
