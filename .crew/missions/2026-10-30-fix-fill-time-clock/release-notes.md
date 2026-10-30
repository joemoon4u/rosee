# HOLD: do not merge. Launch Director verdict is NO-GO (poll 3)

The booking fix is ready and tested. The pull request is blocked by Security card 08: three new HIGH bypasses in the Range Safety hook (9427c8f), one pre-existing HIGH through `node --test --import`, and two MEDIUM findings. See go-no-go.md. Once the Flight Director fixes the hook, Security re-reviews and a new poll passes, this text can be used as the PR description. Alternatively, split the guardrail commits into their own PR and ship the booking fix alone (needs a new poll).

# Fix silent drop of real booking requests (fill-time clock skew)

## What changed and why
Some visitors saw the success message but the studio never got an email. The bot filter compared `startedAt`, taken from the visitor's device clock in `assets/js/app.js`, with the server clock in `api/book.js`. A skewed device clock made a real request look "too fast", and it was dropped silently.

- `assets/js/app.js`: the client now sends `fillMs`, the elapsed time measured with `performance.now()`. This is a monotonic clock and does not depend on the wall clock. `startedAt` is no longer sent.
- `api/book.js`: the server validates `fillMs` strictly. Below 3000 ms is dropped, as before. A legacy `startedAt` from an old cached client is ignored, so old clients are not dropped. Drop log lines contain no personal data. The honeypot check is unchanged.
- `sw.js`: cache version bumped to `rosee-v2`, so visitors get the new client.
- `package.json`: adds an `npm test` script (unit tests).
- Tests: `tests/unit/book-fill-time.test.js` and `tests/acceptance/fill-time-clock.test.js`.

Spam protection is not weakened. The 3-second minimum and the honeypot remain. Bots that omit `fillMs` skip the time trap, which is accepted in the design; the honeypot still applies.

## Crew guardrail changes (separate from the app fix)
These touch `.claude/hooks/range-safety.js`, `.crew/policy.json`, `.crew/tests/guardrails.test.js` and `.crew/README.md`. They affect only the crew's agent guardrails, not the website.
- 9e7de9b replaced an unapproved loosened rule (f5cb1d2) with a "reader exemption". Approved in a16c3cd.
- 9427c8f rewrote the shell parsing to fix the two HIGH bypasses from card 06 and seven others. Approved in 97e4fe8.
- Security card 08 shows the rewrite is still bypassable (below). The cleanest path may be to split these into their own reviewed PR.

## How it was tested
- `npm test`: 10 pass, 0 fail.
- `node --test "tests/**/*.test.js"`: 32 pass, 0 fail (10 unit, 22 acceptance). AC-1 to AC-9 each map to a test.
- `node --test .crew/tests/guardrails.test.js`: 16 pass, 0 fail. They do not cover the card 08 bypasses.
- Flight recorder chain: OK (167 entries). 21 `RangeSafetyDeny` events, all explained in go-no-go.md. 0 `FlightCardMissing` events.
- Not tested: AC-7 is a source check. Test by hand in a browser with the device clock moved forward and backward.

## Security review
Card 08 (re-review of 9e7de9b..HEAD): NO-GO.
- App code (4112ca6, 430e6dc): no findings in earlier reviews. Card 08 did not re-review it.
- Fixed since card 06: single `&` bypass, `<(...)` bypass, and the test gap for them.
- HIGH: a shell function named after a reader (`echo () { curl ...; }; echo`) skips the blocked-command rules.
- HIGH: `find -exec` and `--output` checks can be dodged with quote splitting (`-ex"ec"`, `--out"put"=`).
- HIGH: `>&1file` is read as an fd duplication, so a file write goes unchecked.
- HIGH (pre-existing): `node --test --import 'data:...'` runs any JavaScript.
- MEDIUM: secret-path check can be dodged with quotes and wildcards.
- MEDIUM: no tests for any of the above.

## Risks
- Guardrail bypasses above. They must be fixed, or split out, or explicitly accepted by the Flight Director.
- The approval and policy commits are authored by Claude; approvals.md records that the Flight Director instructed them in chat. A production flow should use CODEOWNER reviews.
- Follow-ups, out of scope: autofill may fill the honeypot (`index.html:592`). An offline-saved request is lost on 400/429 at replay. The README fill-time line is not updated.
- Deploying: visitors with cached pages get the new client after the service worker updates.

## Rollback
- App: revert 4112ca6 (and `git revert 430e6dc` for the tests). Revert the `sw.js` version bump with it, or bump to `rosee-v3` so caches refresh.
- Guardrails: revert 9427c8f and 9e7de9b as the Flight Director decides.
- No data migration, no new dependencies.

## Flight cards
- flight-cards/01-chief-engineer.md
- flight-cards/02-responsible-engineer.md
- flight-cards/03-test-engineer.md
- flight-cards/04-security-engineer.md (NO-GO, f5cb1d2)
- flight-cards/05-launch-director.md (NO-GO, poll 1)
- flight-cards/06-security-engineer.md (NO-GO, 9e7de9b)
- flight-cards/07-launch-director.md (NO-GO, poll 2)
- flight-cards/08-security-engineer.md (NO-GO, 9427c8f)
- go-no-go.md (poll 3)
