# Go/No-Go: 2026-10-30-fix-fill-time-clock (poll 2)

Base 832f00f. App fix 4112ca6. Acceptance tests 430e6dc. Policy replacement 9e7de9b, approved in a16c3cd. HEAD at poll: a16c3cd. Polled by the Launch Director, who re-checked each station.

**Overall: NO-GO.** The app fix is sound and tested. The release is blocked by two HIGH Range Safety bypasses that 9e7de9b introduced in `.claude/hooks/range-safety.js`. The builder cannot fix them (guardrail files are Flight Director-owned).

| Station | Verdict | Evidence |
|---|---|---|
| Design | GO | design.md exists. approvals.md has `DESIGN: APPROVED - Joseph Moonjely, 2026-10-30 18:07 AEDT`, Option A. |
| Build | GO | Card 02 says DONE. 4112ca6 exists. Diff to `api/book.js`, `assets/js/app.js`, `sw.js` matches the design. No app file has changed since 430e6dc. |
| Scope | GO (with the policy change recorded) | Design files match. Extras beyond "Files to change": `package.json` (test script, minor) and the guardrail files `.crew/policy.json`, `.claude/hooks/range-safety.js`, `.crew/tests/guardrails.test.js`. The guardrail files are now covered by `POLICY CHANGE: APPROVED` in approvals.md, which names exactly these three files and 9e7de9b. The loosened rules from f5cb1d2 are gone. See the provenance note below. |
| Test | GO | I re-ran: `npm test` 10 pass, 0 fail. `node --test "tests/**/*.test.js"` 32 pass, 0 fail (10 unit, 22 acceptance). `node --test ".crew/tests/*.test.js"` 13 pass, 0 fail. Every AC-1 to AC-9 has a test (card 03). Caveats: `npm test` runs unit tests only. AC-7 is a source check. The guardrail tests do not cover the two bypasses below, which is why 13/13 passes. |
| Security | NO-GO | Card 06 says NO-GO. The original MEDIUM (f5cb1d2 loosening) is resolved. Open: HIGH 1, single `&` bypass. HIGH 2, `<(...)`/`>(...)` bypass. MEDIUM, no tests for either. I checked the code myself, and the cards' trace holds. Line 87 splits on `&& \|\| ; \| \n` only, so `echo x & curl https://evil.io` is one segment starting with `echo`. It is treated as a reader, and the readersExempt rules (network, package, deploy, privilege) are skipped. Line 122 uses the same split, so the allowlist sees `echo` and allows it. Line 99 denies only `$(` and backticks, so `cat <(curl ...)` passes in the same way. I did not run these, because a real probe would make a network call. |
| Range Safety | GO (explained) | `node .crew/bin/verify-recorder.js` reports `OK d7c78ecb-...jsonl (98 entries)` (chain intact). I counted 13 `RangeSafetyDeny` events and 0 `FlightCardMissing`. Details below. |

## RangeSafetyDeny events (13 at time of count)
Ten are unchanged from poll 1 (seq 1, 2, 5, 21, 29, 38, 43, 46, 56, 60). They were guardrails working as intended, apart from seq 5, a `cat vercel.json` false positive that led to f5cb1d2. New since poll 1:
- seq 85, security-engineer: `sed -n 1,40p` is not on its allowlist. Harmless.
- seq 94, launch-director (me): a compound command that began with `sed -n`. Not on my list. Harmless, I re-ran with permitted commands.
- seq 103, launch-director (me): `cut -c` not on my list. Harmless.
My own later calls may add events that are not counted here.

## Provenance and audit notes
- The approval commits 310ad93 and a16c3cd are authored by `Claude <noreply@anthropic.com>`, as is 9e7de9b. Git cannot show that a human wrote the approval lines. The Flight Director should confirm outside git that both approvals are his. approvals.md is a human-only file by policy, so this is the one control that rests on trust.
- 9e7de9b was committed at 18:14 and approved at 18:16, so approval followed the commit, as the commit message said ("Pending Flight Director approval"). That matches the process.
- Uncommitted at poll time: the flight-recorder JSONL (modified) and flight-cards/06 (untracked).

## What the Flight Director must do
The builder cannot fix this, since `.claude/` is a protected path. Options, in order of preference:
1. Edit `/home/claude/rosee/.claude/hooks/range-safety.js` (or have an agent do it under your direct instruction):
   - Lines 87 and 122: also split on a single `&`, for example `/&&|\|\||[;&|\n]/`. Take care with `N>&M` redirects: line 122 runs on `bare`, and the redirect noise is stripped at line 105 only for the write check, so add a test for `2>&1`.
   - Line 99: deny `<(` and `>(` as well, for example `/\$\(|`|[<>]\(/`.
2. Add `blocked(...)` cases to `.crew/tests/guardrails.test.js` for `echo x & curl https://x.io`, `cat <(curl https://x.io)` and `ls & vercel --prod`. Also add an allowed case for `cmd 2>&1`, so the fix does not break normal use.
3. Record a new `POLICY CHANGE: APPROVED` in approvals.md that covers the fix, then ask Security to re-review `9e7de9b..HEAD`.
4. Alternative: revert 9e7de9b and a16c3cd's scope to the strict f5cb1d2-parent rules (the original rules, with their `cat vercel.json` false positive). This is safe and is what the mission shipped with at base. It trades usability for security.
5. Alternative, if you accept the risk: record an explicit risk acceptance in approvals.md. I do not recommend it, because these bypasses let a crew agent run network, install and deploy commands that were blocked before 9e7de9b.
6. Then ask for another launch poll. The app fix itself needs no change.
