#!/usr/bin/env node
/* FLIGHT RECORDER: append-only, hash-chained audit log of what each crew agent did.

   Events: SubagentStart, PostToolUse, SubagentStop (Range Safety logs its own denials).
   Output: .crew/flight-recorder/<session_id>.jsonl  (verify with: node .crew/bin/verify-recorder.js)

   Also enforces explainability: a crew agent can't finish without returning a flight card
   (Verdict + Evidence lines). If it tries, it is sent back once to write one. */

const { readStdin, loadPolicy, summarise, record } = require("./lib");

const input = readStdin() || {};
const role = input.agent_type || null;

function crewRole() {
  try {
    return role && loadPolicy().crewRoles.includes(role);
  } catch (e) {
    return false;
  }
}

function toolResult(resp) {
  if (resp === undefined || resp === null) return null;
  if (typeof resp === "object" && ("stdout" in resp || "stderr" in resp)) {
    return summarise(`${resp.stdout || ""}${resp.stderr ? "\n[stderr] " + resp.stderr : ""}`, 600);
  }
  return summarise(resp, 300);
}

try {
  if (!crewRole()) process.exit(0); // human-driven sessions are not recorded here
  const base = { agent: role, agent_id: input.agent_id || null };

  switch (input.hook_event_name) {
    case "SubagentStart":
      record(input.session_id, { event: "SubagentStart", ...base });
      break;

    case "PostToolUse":
      record(input.session_id, {
        event: "ToolCall",
        ...base,
        tool: input.tool_name,
        input: summarise(input.tool_input, 600),
        result: toolResult(input.tool_response),
        duration_ms: input.duration_ms || null
      });
      break;

    case "SubagentStop": {
      const card = String(input.last_assistant_message || "");
      const hasCard = /^\s*\**Verdict\**\s*:/im.test(card) && /^\s*\**Evidence\**\s*:/im.test(card);
      record(input.session_id, {
        event: hasCard ? "FlightCard" : "FlightCardMissing",
        ...base,
        card: summarise(card, 4000)
      });
      if (!hasCard && !input.stop_hook_active) {
        process.stderr.write(
          "FLIGHT RECORDER: finish with a flight card. Lines required: Role, Verdict (GO / NO-GO / DONE / BLOCKED), " +
          "What I did, Why, Evidence (files, commands, test results), Risks, Confidence.\n"
        );
        process.exit(2);
      }
      break;
    }

    default:
      break;
  }
  process.exit(0);
} catch (err) {
  process.stderr.write(`flight recorder error: ${err.message}\n`);
  process.exit(0); // never block work because logging failed; Range Safety still guards actions
}
