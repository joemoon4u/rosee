# HOLD: do not merge. Launch Director verdict is NO-GO (poll 2)

The booking fix is ready and tested. The pull request is blocked by two HIGH findings in the Range Safety hook change (9e7de9b). See go-no-go.md. Once the Flight Director fixes the hook and Security re-reviews, this text can be used as the PR description.

# Fix silent drop of real booking requests (fill-time clock skew)

## What changed and why
Some visitors saw the success message but the studio never got an email. The bot filter compared `startedAt`, taken from the visitor's device clock in `assets/js/app.js`, with the server clock in `api/book.js`. A skewed device clock made a real request look "too fast", and it was dropped silently.

- `assets/js/app.js`: the client now sends `fillMs`, the elapsed time measured with `performance.now()`. This is a monotonic clock and does not depend on the wall clock. `startedAt` is no longer sent.
- `api/book.js`: the server validates `fillMs` strictly. Below 3000 ms is dropped, as before. A legacy `startedAt` from an old cached client is ignored, so old clients are not dropped. Drop log lines contain no personal data. The honeypot check is unchanged.
- `sw.js`: cache version bumped to `rosee-v2`, so visitors get the new client.
- `package.json`: adds an `npm test` script (unit tests).
- Tests: `tests/unit/book-fill-time.test.js` and `tests/acceptance/fill-time-clock.test.js`.

Spam protection is not weakened. The 3-second minimum and the honeypot remain. Bots that omit `fillMs` skip the time trap, which is accepted in the design; the honeypot still applies.

## Crew guardrail change (separate from the app fix)
Commit 9e7de9b changes `.crew/policy.json`, `.claude/hooks/range-safety.js` and `.crew/tests/guardrails.test.js`. It replaces the earlier loosened rule (f5cb1d2) with a "reader exemption". The Flight Director approved it in approvals.md. Security found two HIGH bypasses in it (below). The cleanest path may be to split this into its own reviewed PR.

## How it was tested
- `npm test`: 10 pass, 0 fail.
- `node --test "tests/**/*.test.js"`: 32 pass, 0 fail (10 unit, 22 acceptance). AC-1 to AC-9 each map to a test.
- `node --test ".crew/tests/*.test.js"`: 13 pass, 0 fail (guardrails). They do not cover the bypasses below.
- Flight recorder chain: OK (98 entries).
- Not tested: AC-7 is a source check. Test by hand in a browser with the device clock moved forward and backward.

## Security review
Card 06 (re-review of 832f00f..HEAD): NO-GO.
- App code: no findings. The original MEDIUM (f5cb1d2) is resolved.
- HIGH: `range-safety.js` ignores a single `&`, so `echo x & curl ...` skips the blocked-command rules.
- HIGH: `<(...)` process substitution is not denied, so `cat <(curl ...)` skips them.
- MEDIUM: no tests for either case.
These affect only the crew's agent guardrails, not the website.

## Risks
- Guardrail bypasses above. They must be fixed or explicitly accepted by the Flight Director.
- The approval commits are authored by `Claude <noreply@anthropic.com>`. Confirm outside git that they are the Flight Director's own.
- Follow-ups, out of scope: autofill may fill the honeypot (`index.html:592`). An offline-saved request is lost on 400/429 at replay. The README fill-time line is not updated.
- Deploying: visitors with cached pages get the new client after the service worker updates.

## Rollback
- App: revert 4112ca6 (and `git revert 430e6dc` for the tests). Revert the `sw.js` version bump with it, or bump to `rosee-v3` so caches refresh.
- Guardrails: revert 9e7de9b and a16c3cd's scope as the Flight Director decides.
- No data migration, no new dependencies.

## Flight cards
- flight-cards/01-chief-engineer.md
- flight-cards/02-responsible-engineer.md
- flight-cards/03-test-engineer.md
- flight-cards/04-security-engineer.md (NO-GO, f5cb1d2)
- flight-cards/05-launch-director.md (NO-GO, poll 1)
- flight-cards/06-security-engineer.md (NO-GO, 9e7de9b)
- go-no-go.md (poll 2)
