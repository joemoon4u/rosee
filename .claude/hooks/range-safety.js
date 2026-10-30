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
if (input === null) {
  process.stderr.write("RANGE SAFETY NO-GO: hook input was not valid JSON. Failing closed.\n");
  process.exit(2);
}
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
  if (policy.protectedFileNames.includes(path.basename(r))) {
    deny(`${path.basename(r)} is human-only. Approvals, CLAUDE.md and .mcp.json can't be written by agents.`);
  }
  if ((rules.writeDeny || []).some((pre) => startsWithPrefix(r, pre))) {
    deny(`${role} may not change ${r}. Maker and checker stay separate.`);
  }
  if (!(rules.write || []).some((pre) => startsWithPrefix(r, pre))) {
    deny(`${role} can only write to: ${(rules.write || []).join(", ") || "nothing (report-only role)"}. Tried ${r}.`);
  }
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

/* Shell model: parse, don't guess.
   A crew command is parsed into simple commands the way bash would split words.
   Only plain words, quotes and the separators && || ; | are accepted. Anything else
   ($, backticks, ( ) { } < > &, globs, backslashes, newlines, ~ or # at a word start)
   is denied. The only redirections allowed throw output away or merge stderr into
   stdout: 2>&1, >/dev/null, 2>/dev/null. Files are written with the Write or Edit tool. */
const SAFE_REDIRECT = /^(2>&1|[12]?>\s*\/dev\/null|&>\s*\/dev\/null)(?=[\s;|&]|$)/;
const ALWAYS_SPECIAL = new Set(["$", "`", "\\", "(", ")", "{", "}", "<", ">", "&", "*", "?", "[", "]", "!", "\n", "\r"]);
const WORD_START_SPECIAL = new Set(["~", "#"]);

function parseShell(cmd) {
  const commands = [];
  let words = [];
  let word = "";
  let inWord = false;
  const endWord = () => { if (inWord) { words.push(word); word = ""; inWord = false; } };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };

  for (let i = 0; i < cmd.length;) {
    const c = cmd[i];
    if (!inWord) {
      const m = SAFE_REDIRECT.exec(cmd.slice(i));
      if (m) { i += m[0].length; continue; }
      if (WORD_START_SPECIAL.has(c)) deny(`"${c}" at the start of a word isn't allowed in crew shell commands.`);
    }
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      if (j < 0) deny("Unclosed single quote.");
      word += cmd.slice(i + 1, j); inWord = true; i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === "$" || cmd[j] === "`" || cmd[j] === "\\") {
          deny("$, backticks and backslashes aren't allowed inside double quotes. Use single quotes for literal text.");
        }
        j++;
      }
      if (j >= cmd.length) deny("Unclosed double quote.");
      word += cmd.slice(i + 1, j); inWord = true; i = j + 1; continue;
    }
    if (c === " " || c === "\t") { endWord(); i++; continue; }
    if (cmd.startsWith("&&", i) || cmd.startsWith("||", i)) { endCommand(); i += 2; continue; }
    if (c === ";" || c === "|") { endCommand(); i++; continue; }
    if (ALWAYS_SPECIAL.has(c)) {
      const what = c === "\n" || c === "\r" ? "A newline" : `"${c}"`;
      deny(`${what} isn't allowed in crew shell commands. Use plain commands joined with &&, ||, ; or |, and the Write tool for files.`);
    }
    word += c; inWord = true; i++;
  }
  endCommand();
  return commands;
}

const PLAIN_PATH = /^[A-Za-z0-9_./@+-]+$/;
const TEST_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_./*@+-]+$/;
const startsWithWords = (words, entry) => entry.split(" ").every((w, k) => words[k] === w);

// Flags that make an allowed command run another program, write files, or rewrite history.
function checkFlags(words) {
  const [cmd, sub] = words;
  const rest = words.slice(1);
  const has = (re) => rest.some((w) => re.test(w));

  if (has(/^(--no-verify)$/)) deny("Skipping checks is not allowed.");
  if (cmd === "node") {
    if (sub !== "--test" && sub !== "--check") deny("node is only allowed as node --test <test files> or node --check <file>.");
    for (const w of words.slice(2)) {
      if (w.startsWith("-") && !/^--test-name-pattern=/.test(w) && !/^--test-reporter=(spec|tap|dot)$/.test(w)) {
        deny(`node option ${w.split("=")[0]} isn't allowed (it can load extra code).`);
      }
      if (!w.startsWith("-") && !TEST_PATH.test(w)) deny(`node --test takes project-relative file paths only. Got "${w}".`);
    }
  }
  if (cmd === "find" && has(/^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/)) deny("find with -exec, -delete or -fprint is not allowed.");
  if (cmd === "date" && has(/^(-[a-zA-Z]*s|--set)/)) deny("Changing the clock is not allowed.");
  if (cmd === "git") {
    if (has(/^--(output|ext-diff|textconv|exec|upload-pack|receive-pack|config|git-dir|work-tree)/)) deny("git options that write files or start other programs are not allowed.");
    if (sub === "branch" && !words.slice(2).every((w) => ["--show-current", "-a", "-r", "-v", "-vv", "--list", "--all", "--remotes"].includes(w))) {
      deny("git branch is for listing only. Use git switch -c or git checkout -b to create a branch.");
    }
    if (sub === "commit" && has(/^(-n|--amend|--no-gpg-sign)$/)) deny("git commit -n, --amend and --no-gpg-sign are not allowed.");
    if ((sub === "switch" || sub === "checkout") && has(/^(-C|-B|-f|--force|--force-create|--discard-changes)$/)) deny("Forced branch switches can throw away work.");
    if (sub === "stash" && has(/^(drop|clear)$/)) deny("Dropping stashes throws away work.");
  }
}

function checkBash(policy, rules, command) {
  const cmd = String(command || "");
  if (!cmd.trim()) deny("Empty command.");
  const commands = parseShell(cmd);
  const allowed = policy.readOnlyCommands.concat(rules.bashExtra || []);
  const writesState = ["mkdir", "touch", "git add", "git commit", "git switch", "git checkout", "git stash"];
  if (commands.some((w) => w[0] === "cd") && commands.some((w) => writesState.some((e) => startsWithWords(w, e)))) {
    deny("Don't change directory in a command that changes files or git state. Paths are checked from the project root.");
  }

  for (const words of commands) {
    const head = words.slice(0, 2).join(" ");
    for (const b of policy.blockedCommands) {
      if (new RegExp(b.pattern, "i").test(head)) deny(b.reason);
    }
    for (const w of words) {
      if (isSecretPath(policy, w)) deny("The command touches a secrets file.");
    }

    // Exact entries (prefixed "=") must match the whole command; others match leading words.
    const exact = allowed.some((a) => a.startsWith("=") && words.join(" ") === a.slice(1));
    const ok = exact || allowed.some((a) => !a.startsWith("=") && startsWithWords(words, a));
    if (!ok) deny(`"${words.slice(0, 3).join(" ")}" isn't on the ${role} command list.`);
    if (!exact) checkFlags(words);

    if (words[0] === "mkdir" || words[0] === "touch") {
      for (const arg of words.slice(1).filter((a) => !a.startsWith("-"))) {
        if (!PLAIN_PATH.test(arg)) deny(`${words[0]} needs a plain path. Got "${arg}".`);
        checkWrite(policy, rules, arg);
      }
    }
    if (words[0] === "git" && words[1] === "commit") {
      const branch = currentBranch(input.cwd);
      if (branch === "main" || branch === "master" || branch === "HEAD" || branch === "") {
        deny(`Commits to "${branch || "unknown"}" are not allowed. Work on a feature branch.`);
      }
    }
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
    Bash: () => String(ti.command || "").replace(/["'\\]/g, "")
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
      if (isSecretPath(policy, rel(ti.file_path) || "") || isSecretPath(policy, path.resolve(input.cwd || PROJECT_DIR, String(ti.file_path || "")))) {
        deny("Reading secrets files is not allowed.");
      }
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
      if (!(policy.crewTools || []).includes(input.tool_name)) deny(`${input.tool_name} isn't on the crew tool list.`);
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
