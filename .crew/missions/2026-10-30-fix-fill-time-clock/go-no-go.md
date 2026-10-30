# Go/No-Go: 2026-10-30-fix-fill-time-clock (poll 3)

Base 832f00f. App fix 4112ca6. Acceptance tests 430e6dc (both unchanged). Guardrail commits since poll 2: 9427c8f (strict shell parsing), approved in 97e4fe8. HEAD at poll: 97e4fe8. Polled by the Launch Director, who re-checked each station.

**Overall: NO-GO.** The app fix is sound and tested. The release is blocked by Security (card 08): the 9427c8f hook rewrite fixed the two old HIGH bypasses, but Security found three new HIGH bypasses of `checkBash` in `.claude/hooks/range-safety.js`, a pre-existing HIGH hole through `node --test --import`, and two MEDIUM findings. I read the code and each root cause is present. The builder cannot fix them (guardrail files are Flight Director-owned).

| Station | Verdict | Evidence |
|---|---|---|
| Design | GO | design.md exists. approvals.md has `DESIGN: APPROVED - Joseph Moonjely, 2026-10-30 18:07 AEDT`, Option A. |
| Build | GO | Card 02 says DONE. 4112ca6 exists. `git log 430e6dc..HEAD -- api assets sw.js tests package.json` is empty, so no app file changed since the acceptance tests. |
| Scope | GO (with recorded policy approvals) | Design files match: `api/book.js`, `assets/js/app.js`, `sw.js`, tests. Extras: `package.json` (npm test script, minor) and guardrail files `.crew/policy.json`, `.claude/hooks/range-safety.js`, `.crew/tests/guardrails.test.js`, `.crew/README.md`, plus the flight-recorder JSONL. approvals.md has two `POLICY CHANGE: APPROVED` entries: 9e7de9b (18:16) and 9427c8f (18:26), the latter naming exactly the four files it changed. The Scope verdict says only that the extras are approved. It does not say they are safe, which is the Security station's call. |
| Test | GO | I re-ran: `npm test` 10 pass, 0 fail. `node --test "tests/**/*.test.js"` 32 pass, 0 fail (10 unit, 22 acceptance). `node --test .crew/tests/guardrails.test.js` 16 pass, 0 fail. Every AC-1 to AC-9 has a test (card 03). Caveats: `npm test` runs unit tests only. AC-7 is a source check. The guardrail tests have no case for the new bypasses, which is why 16/16 passes (Security MEDIUM). |
| Security | NO-GO | Card 08 says NO-GO. Fixed since card 06: single `&`, `<(...)`, and the test gap for those. Open, none with a test: (1) HIGH, a function definition named after a reader (`echo () { curl ...; }; echo`) is treated as a reader and skips the blocked-command rules and the allowlist. I confirmed in code: `isReader` at line 112 and the allowlist at lines 165-166 both match on a leading word, and `segments` keeps `echo () { curl --version`. (2) HIGH, the `find -exec` and `--output` checks (lines 124, 127, 130) run on `bare`, which has quoted text removed, so `-ex"ec"` and `--out"put"=` pass while bash rejoins them. (3) HIGH, `normaliseShell` (line 83) strips `>&1` from `>&1probe.txt` and leaves a file write that no write check sees. (4) HIGH, pre-existing: `node --test` in `readOnlyCommands` (policy.json line 57) allows `--import 'data:...'`, so any JavaScript runs. (5) MEDIUM, secret-path check sees quotes and wildcards as typed. (6) MEDIUM, no `blocked(...)` tests for any of these. Security ran harmless probes and showed each works. I did not run them myself because they execute real commands. |
| Range Safety | GO (explained) | `node .crew/bin/verify-recorder.js` reports `OK d7c78ecb-...jsonl (167 entries)` (chain intact). By event field I count 21 `RangeSafetyDeny` and 0 `FlightCardMissing`. A plain `grep -c` shows 27 and 3, but the extras are tool-call records that quote the words. Details below. |

## RangeSafetyDeny events (21 at time of count)
Thirteen are unchanged from poll 2 (seq 1, 2, 5, 21, 29, 38, 43, 46, 56, 60, 85, 94, 103). Poll 1 and 2 explained them: guardrails working as intended, except seq 5, a `cat vercel.json` false positive that led to f5cb1d2, and the harmless allowlist misses at seq 85, 94 and 103. New since poll 2:
- seq 113, chief-of-staff: a shell write of card 07 was blocked (the text contained a network command name). Saved with the Write tool. Guardrail working.
- seq 126, security-engineer: `rg --version` is not on its list. Harmless.
- seq 127, security-engineer: probe `echo x & curl --version`. Blocked by the new hook ("No network access"). This is the card 06 HIGH proven fixed.
- seq 128, security-engineer: probe `cat <(curl --version)`. Blocked ("Command or process substitution"). Also proven fixed.
- seq 131, security-engineer: probe using `git -C /home/claude/rosee` is not on its list. Harmless.
- seq 145 and 146, launch-director (me): `git -C ...` and a `for` loop are not on my list. Harmless, re-run with permitted commands.
- seq 163, launch-director (me): `node /home/claude/rosee/.crew/bin/verify-recorder.js` with an absolute path is not on my list. Re-run with the relative path from the repo root.
My later calls may add events that are not counted here.

## FlightCardMissing: 0 real events
`grep -c FlightCardMissing` returns 3. All three lines are `ToolCall` records (seq 70, 105, 164) whose text contains the word, from earlier polls' counting commands. Counting `"event":"FlightCardMissing"` gives 0.

## Provenance and audit notes
- Approval commits 310ad93, a16c3cd and 97e4fe8, and the policy commits 9e7de9b and 9427c8f, are authored by Claude. approvals.md now says so: every approval line was typed by Claude on the Flight Director's instruction in chat. Git cannot prove the Flight Director wrote them. In production this should be a GitHub review by a CODEOWNER.
- 9427c8f was committed before its approval (97e4fe8), which matches the process the commit message described.
- Uncommitted at poll time: the flight-recorder JSONL (modified) and flight-cards/08 (untracked, included in my commit).
- Security left probe files in its scratchpad (`1probe-fd.txt`, `probe-output.txt`). They are outside the repo.
- Observation: `node --test` is on my own allowlist too, so the pre-existing hole applies to every crew role including this one.

## What the Flight Director must do
The builder cannot fix this, since `.claude/` is a protected path. Options, in order of preference:
1. Fix `.claude/hooks/range-safety.js` along the lines of card 08:
   - Deny `name () {`, `function`, and bare `(`, `)`, `{`, `}` outside quotes.
   - Run the `find`, `--output`, `sort -o`, `--compress-prog`, `--ext-diff` and secret-path checks on the command with `"`, `'` and `\` deleted. Deny `$'...'`.
   - Only treat `>&N` as an fd duplication when the digits end the word, for example `/\d*[<>]&\d+-?(?=\s|$|[;&|)])/`.
   - Deny wildcards (`? * [`) in words containing `.env`, `id_`, `.npmrc`, `.ssh`, `.aws` or `.vercel`.
2. Fix `node --test` in `.crew/policy.json`: deny `--import`, `--require`, `-r`, `--loader`, `--experimental-loader` and `data:`, or allow only `node --test <plain path>`.
3. Add a `blocked(...)` test for every bypass input in card 08, and keep an allowed case for `2>&1`.
4. Add a new `POLICY CHANGE: APPROVED` entry to approvals.md, then have Security re-review `9427c8f..HEAD`, then ask for another launch poll.
5. Consider Security's structural advice: a regex blocklist over a shell string keeps losing to bash grammar. A word-splitting allowlist with no shell metacharacters, or running crew commands without a shell, would end the cycle.
6. Alternative: ship the website fix on its own. The guardrail work (9e7de9b, 9427c8f and the related files) could move to a separate PR so it does not hold the booking fix. This is your decision. It changes Scope, so it needs a new poll.
7. Not recommended: record an explicit risk acceptance in approvals.md. The bypasses let a crew agent run network, install, deploy and file-writing commands that the rules are meant to block.
