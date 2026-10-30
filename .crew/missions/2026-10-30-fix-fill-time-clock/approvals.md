DESIGN: APPROVED - Joseph Moonjely (Flight Director), 2026-10-30 18:07 AEDT
Scope: as written in design.md, Option A. Follow-ups listed in section 2 stay out of scope.

POLICY CHANGE: APPROVED - Joseph Moonjely (Flight Director), 2026-10-30 18:16 AEDT
Scope: Range Safety reader exemption in commit 9e7de9b (.crew/policy.json, .claude/hooks/range-safety.js, .crew/tests/guardrails.test.js). Supersedes the unapproved rule change in f5cb1d2. Guardrail files are owned by the Flight Director and sit outside the design's file list by design.

POLICY CHANGE: APPROVED - Joseph Moonjely (Flight Director), 2026-10-30 18:26 AEDT
Scope: strict shell parsing in commit 9427c8f (.claude/hooks/range-safety.js, .crew/policy.json, .crew/tests/guardrails.test.js, .crew/README.md). Resolves Security card 06 (two HIGH bypasses) and seven further bypasses found while fixing them.

Provenance: every approval line in this file was typed by Claude (setup assistant) on the Flight Director's instruction in chat session https://claude.ai/code/session_01GqRUaJ9L99ds5aXa1QatmS, so git shows Claude as the author. In production, approvals should be GitHub reviews by a CODEOWNER (see .crew/README.md).
