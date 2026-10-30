# HOLD: do not merge. Launch Director verdict is NO-GO (poll 4)

The booking fix is ready and tested. The pull request is blocked by Security card 10: one HIGH in the Range Safety policy (`git switch` / `git checkout -b` can roll back or remove the hook) and one MEDIUM (secret-path reads via `cd` or attached short options). See go-no-go.md. Once the Flight Director fixes these, Security re-reviews and a new poll passes, this text can be used as the PR description. Alternatively, split the guardrail commits into their own PR and ship the booking fix alone (needs a new poll).

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
These touch `.claude/hooks/*`, `.claude/agents/*` (wording), `.crew/policy.json`, `.crew/tests/guardrails.test.js` and `.crew/README.md`. They affect only the crew's agent guardrails, not the website.
- 9e7de9b replaced an unapproved loosened rule (f5cb1d2) with a reader exemption. Approved in a16c3cd.
- 9427c8f strict shell parsing. Approved in 97e4fe8.
- d4c7b37 Range Safety v3: parses shell commands instead of regex matching. Approved in 8c0fe7d. It fixes all card-08 findings.
- Security card 10 finds the policy still allows branch commands that can remove the hook (below). The cleanest path may be to split these into their own reviewed PR.

## How it was tested
Re-run by the Launch Director with `node --test` on explicit file paths:
- `tests/acceptance/fill-time-clock.test.js`, `tests/unit/book-fill-time.test.js` and `.crew/tests/guardrails.test.js` together: 51 pass, 0 fail (22 acceptance, 10 unit, 19 guardrail). AC-1 to AC-9 each map to a test.
- Guardrail tests do not cover the card-10 findings.
- Flight recorder chain: OK (206 entries). 27 `RangeSafetyDeny` events, all explained in go-no-go.md. 0 `FlightCardMissing` events.
- Not tested: AC-7 is a source check. Test by hand in a browser with the device clock moved forward and backward.

## Security review
Card 10 (re-review of 9e365f5..HEAD, covering d4c7b37): NO-GO.
- App code (4112ca6, 430e6dc): no findings in earlier reviews. Cards 08 and 10 did not re-review it.
- Fixed since card 08: reader-named function, quote-split `find`/`--output`, `>&1file`, `node --test --import`, quote and wildcard secret paths, missing tests, fail-open on malformed input.
- HIGH (open): `git switch` and `git checkout -b` are allowed with any arguments. `git switch main` deletes the hook script, and a missing script exits 1, which does not block. `git checkout -b x 9e365f5` restores the old regex hook. From code reading only; fail-open is Medium confidence.
- MEDIUM (open): `cd /proc && cat self/environ`, `date -f/proc/self/environ` and `git commit -F/proc/self/environ` evade the secret-path patterns.
- Seven Low items (see card 10).

## Risks
- Guardrail issues above. They must be fixed, split out, or explicitly accepted by the Flight Director.
- The approval and policy commits are authored by Claude; approvals.md records that the Flight Director instructed them in chat. A production flow should use CODEOWNER reviews.
- Follow-ups, out of scope: autofill may fill the honeypot (`index.html:592`). An offline-saved request is lost on 400/429 at replay. The README fill-time line is not updated.
- Deploying: visitors with cached pages get the new client after the service worker updates.

## Rollback
- App: revert 4112ca6 (and `git revert 430e6dc` for the tests). Revert the `sw.js` version bump with it, or bump to `rosee-v3` so caches refresh.
- Guardrails: revert d4c7b37, 9427c8f and 9e7de9b as the Flight Director decides.
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
- flight-cards/09-launch-director.md (NO-GO, poll 3)
- flight-cards/10-security-engineer.md (NO-GO, d4c7b37)
- go-no-go.md (poll 4)
