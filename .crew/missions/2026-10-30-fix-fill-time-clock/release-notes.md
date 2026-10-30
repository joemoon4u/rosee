# Fix: real booking requests silently dropped by device-clock fill-time check

**HOLD: the launch poll is NO-GO. Do not merge until the Range Safety policy change below is resolved.**

## What changed and why
Some visitors saw the success message but the studio got no email. The server compared the visitor's device clock (`startedAt`) with its own clock. When the device clock was ahead, the elapsed time looked under 3 s, so the server returned a fake 200 and sent nothing.

- `assets/js/app.js`: the browser now measures fill time with `performance.now()` and sends `fillMs`. It no longer sends `startedAt`.
- `api/book.js`: the server drops silently only when `fillMs` is a finite number with `0 <= fillMs < 3000`. A legacy `startedAt` is ignored, so old cached clients and offline-queued requests get through. Each silent drop (honeypot or too fast) now logs one PII-free line.
- `sw.js`: `VERSION` is now `rosee-v2` so clients pick up the new JS.
- `package.json`: adds an `npm test` script (not in the original design).
- Tests: `tests/unit/book-fill-time.test.js` and `tests/acceptance/fill-time-clock.test.js`.
- **Also in this branch, outside the design:** `.crew/policy.json` and `.crew/tests/guardrails.test.js` (commit f5cb1d2). See Risks.

Spam protection is unchanged. A bot could already skip the check by omitting `startedAt`. The honeypot, validation, rate limit and response codes are untouched.

## How it was tested (Launch Director re-run)
- `npm test` (unit only): 10 pass, 0 fail.
- `node --test "tests/**/*.test.js"`: 32 pass, 0 fail (10 unit, 22 acceptance).
- `.crew/tests/*.test.js` (guardrails): 13 pass, 0 fail.
- All of AC-1 to AC-9 have tests. AC-7 (browser clock changed) is a source check only. It was not tested in a real browser. Please do a manual check.

## Security review
Security Engineer: **NO-GO**. The app code has no findings. The one open **Medium** is about guardrails. Commit f5cb1d2 changed the `blockedCommands` rules in `.crew/policy.json` to match only at the start of a command. `env curl`, `time curl`, `nohup curl`, `\curl` and quoted payloads are no longer caught. The change was made without recorded Flight Director approval. The per-role allowlist still blocks most of these.

## Risks
- Unresolved: the unapproved policy.json loosening. The Flight Director must approve it in approvals.md, or revert or split it out.
- `fillMs` can be forged, as `startedAt` could be. The next step if spam rises is a signed server timestamp or Vercel Bot protection.
- Old cached clients skip the timing check for a short time. The `sw.js` bump limits this.
- `performance.now()` can pause while a tab sleeps. A real visitor is very unlikely to be affected.
- Not changed, as agreed: the honeypot may be filled by autofill, and an offline-saved request is lost on a 400 or 429 at replay.
- `npm test` runs only the unit tests. Consider widening the glob.
- README.md:65 was not updated.

## Rollback
Revert the build commit 4112ca6 (and f5cb1d2 if the policy change is rejected), then redeploy. A human does this. No data or schema is involved. Bump `sw.js` `VERSION` again on redeploy so clients refresh.

## Flight cards
- `flight-cards/01-chief-engineer.md`: DONE
- `flight-cards/02-responsible-engineer.md`: DONE
- `flight-cards/03-test-engineer.md`: GO
- `flight-cards/04-security-engineer.md`: NO-GO
- `go-no-go.md`: NO-GO

🤖 Generated with [Claude Code](https://claude.ai/code)

https://claude.ai/code/session_01GqRUaJ9L99ds5aXa1QatmS
