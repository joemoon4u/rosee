# Go/No-Go: 2026-10-30-fix-fill-time-clock (poll 4)

Base 832f00f. App fix 4112ca6 and acceptance tests 430e6dc, both unchanged (`git log 430e6dc..HEAD -- api assets sw.js tests` is empty). Guardrail commit since poll 3: d4c7b37 (Range Safety v3 parser), approved in 8c0fe7d. HEAD at poll: 8c0fe7d. Polled by the Launch Director, who re-checked each station.

**Overall: NO-GO.** The app fix is sound and tested, and the v3 parser fixed every card-08 finding. The release is blocked by Security card 10: one new HIGH (the builder may run `git switch` or `git checkout -b` with any arguments, which can roll back or delete the Range Safety hook) and one MEDIUM (secret-path reads via `cd` or attached short options). I confirmed that `.crew/policy.json` line 80 still lists `git switch` and `git checkout -b` in `bashExtra`. I did not run exploits. The builder cannot fix this (guardrail files are Flight Director-owned).

| Station | Verdict | Evidence |
|---|---|---|
| Design | GO | design.md exists. approvals.md has `DESIGN: APPROVED - Joseph Moonjely, 2026-10-30 18:07 AEDT`, Option A. |
| Build | GO | Card 02 says DONE. 4112ca6 exists. No app file changed since 430e6dc. |
| Scope | GO (with recorded policy approvals) | Design files match: `api/book.js`, `assets/js/app.js`, `sw.js`, tests. Extras: `package.json` (npm test script, minor), guardrail files (`.claude/hooks/*`, `.claude/agents/*` wording, `.crew/policy.json`, `.crew/tests/guardrails.test.js`, `.crew/README.md`) and the flight-recorder JSONL. approvals.md has four `POLICY CHANGE: APPROVED` entries; the latest (18:41) covers d4c7b37 and names those files. "Approved" is not "safe"; that is the Security station's call. |
| Test | GO | I re-ran `node --test tests/acceptance/fill-time-clock.test.js tests/unit/book-fill-time.test.js .crew/tests/guardrails.test.js`: 51 pass, 0 fail (22 acceptance, 10 unit, 19 guardrail). Every AC-1 to AC-9 has a test (card 03). Caveats: AC-7 is a source check. The guardrail suite has no case for the card-10 findings. |
| Security | NO-GO | Card 10 says NO-GO. Fixed since card 08: all seven findings (reader-named function, quote-split find/--output, `>&1file`, `node --test --import`, quote and wildcard secret paths, test gap, fail-open on bad input). Open: (1) HIGH, `git switch` / `git checkout -b` are unrestricted. `main` has no hook script, so `git switch main` removes it. A missing script makes node exit 1, which does not block, so every role is then unguarded. `git checkout -b x 9e365f5` restores the old regex hook. Security flagged the fail-open part as Medium confidence until confirmed. (2) MEDIUM, secret patterns need a separator before the name, so `cd /proc && cat self/environ`, `date -f/proc/self/environ` and `git commit --allow-empty -F/proc/self/environ` get through. Seven Low items are listed in the card. |
| Range Safety | GO (explained) | `node .crew/bin/verify-recorder.js` reports `OK d7c78ecb-...jsonl (206 entries)`. Counting `"event":"RangeSafetyDeny"` gives 27; `"event":"FlightCardMissing"` gives 0. A plain `grep -c FlightCardMissing` returns 8, all `ToolCall` records quoting the word. Details below. |

## RangeSafetyDeny events (27 at time of count)
Twenty-one are unchanged from poll 3 (seq 1, 2, 5, 21, 29, 38, 43, 46, 56, 60, 85, 94, 103, 113, 126, 127, 128, 131, 145, 146, 163). Poll 3 explained them: guardrails working as intended, or harmless allowlist misses; seq 127 and 128 are Security's probes proving the card-06 fixes. New since poll 3:
- seq 189, security-engineer: `sed -n` not on its list. Harmless (Security noted it).
- seq 193, security-engineer: a command that named the env file path was blocked as a secrets touch. Harmless, guardrail working. Security noted it.
- seq 196, security-engineer: a backslash inside double quotes, denied by the v3 parser. Harmless.
- seq 204, 205, 208, launch-director (me): `$` in a command, `*` in a command, and `cut` are not allowed or not on my list. Harmless, re-run with permitted commands. These are the v3 parser behaving as designed.

No FlightCardMissing events exist. Chain verification passes, so there is no sign of recorder tampering. My later calls may add events not counted here.

## Provenance and audit notes
- Approval commits (310ad93, a16c3cd, 97e4fe8, 8c0fe7d) are authored by Claude. approvals.md states that every approval line was typed by Claude on the Flight Director's instruction in chat. Git cannot prove the Flight Director wrote them. In production this should be a CODEOWNER GitHub review.
- d4c7b37 was committed before its approval (8c0fe7d). The approval names exactly the files that commit changed.
- Uncommitted at poll time: the flight-recorder JSONL (modified) and flight-cards/10 (untracked, included in my commit).
- Security's own note that Medium-confidence parts of finding (1) are from code reading, not execution. I did not run it either.

## What the Flight Director must do
The builder cannot fix this. `.claude/` and `.crew/policy.json` are protected.
1. Restrict git branch commands in `.crew/policy.json`: allow only `git switch -c <name>` and `git checkout -b <name>` with exactly that many words (no start point, `--detach`, `--orphan`, or bare `git switch <ref>`). Consider limiting `git stash` to `push`.
2. Make the hook fail closed when the script is missing (for example a wrapper in `.claude/settings.json` that turns any non-zero exit into exit 2), and confirm how Claude Code treats exit 1 in this setup.
3. Fix the MEDIUM: check each word with a leading short option removed, resolve paths against the cwd after `cd`, deny `cd` into `/proc`, and deny `date -f/--file` and `git commit -F/--file`. The simplest version is to deny `cd` outside the project directory.
4. Optional Lows: `date --s` abbreviation, git long-option abbreviations, test-engineer path dodges.
5. Add `blocked(...)` tests for each new input, add a new `POLICY CHANGE: APPROVED` entry, have Security re-review `d4c7b37..HEAD`, then request another poll.
6. Alternative: ship the booking fix alone and move the guardrail commits to their own PR. This changes Scope and needs a new poll.
7. Not recommended: accept the risk. Finding (1) lets a crew agent switch off the guardrails for all roles.
