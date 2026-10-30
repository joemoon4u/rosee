# Mission 2026-10-30-fix-fill-time-clock

## Request (verbatim)
> Some visitors say they submitted a booking request and saw the success message, but the studio never received an email. Suspected cause: the bot filter's minimum fill-time check compares the visitor's device clock (startedAt, sent by assets/js/app.js) with the server's clock in api/book.js. Fix it so real requests are never silently dropped, without weakening spam protection. Run the mission up to the design approval gate.

- Base commit: 832f00f20181c66a3e9430fc491fdece557275cf
- Branch: crew/sdlc-agents

## Tasks
| Task | Owner | Status |
|---|---|---|
| Design | chief-engineer | done (design.md, flight-cards/01) |
| Human gate: design approval | Flight Director | APPROVED (approvals.md, commit 310ad93) |
| Build | responsible-engineer | done, commit 4112ca6 (flight-cards/02) |
| Acceptance tests | test-engineer | GO, 22/22, commit 430e6dc (flight-cards/03) |
| Security review | security-engineer | NO-GO: unapproved policy.json change (flight-cards/04) |
| Launch poll | launch-director | NO-GO, release pack on HOLD, commit ef23f9b (flight-cards/05) |
| Security re-review (9e7de9b) | security-engineer | NO-GO: 2 HIGH bypasses in range-safety.js + MEDIUM test gap (flight-cards/06) |
| Launch re-poll | launch-director | NO-GO, HOLD, commit bba46b7 (flight-cards/07) |

## Status log
- Mission opened. (First attempt via shell was blocked by Range Safety; redone with Write tool.)
- Chief engineer confirmed cause and wrote design.md.
- Stopped at design gate: no `DESIGN: APPROVED` in approvals.md.
- Design approved by Flight Director (310ad93). Build done (4112ca6).
- Acceptance tests GO (430e6dc).
- Security NO-GO on policy.json loosening from commit f5cb1d2 (not app code). Not fixable by the builder (guardrail files off-limits); needs Flight Director decision, so no fix loop was run. Build cycles used: 1 of 3.
- Launch poll NO-GO; go-no-go.md and release-notes.md (HOLD) written (ef23f9b).
- A shell write by the Chief of Staff was blocked by Range Safety; records written with Write tool instead.

- Policy change 9e7de9b approved (a16c3cd). Security re-review: original MEDIUM resolved, but NO-GO on two new HIGH bypasses in range-safety.js (single `&`, `<(...)`) and a MEDIUM test gap (flight-cards/06).
- Launch re-poll NO-GO, release pack HOLD (bba46b7, flight-cards/07). Guardrail files are Flight Director-owned, so no fix loop was run. Build cycles used: 1 of 3.
- A shell attempt by the Chief of Staff to save card 07 was blocked by Range Safety (the card text contained a URL-fetching command name); saved with the Write tool instead, no other route tried.

- Strict shell parsing 9427c8f approved (97e4fe8). Security re-review (card 08): both card-06 HIGHs and test gap fixed, but NO-GO on 3 new HIGH bypasses of checkBash (reader-named function, quote-split find/--output, `>&1file`), a pre-existing HIGH (`node --test --import`) and 2 MEDIUMs. Launch re-poll NO-GO, release pack HOLD (9e365f5, card 09). No fix loop (guardrails are Flight Director-owned). Build cycles used: 1 of 3.

- Range Safety v3 parser d4c7b37 approved (8c0fe7d). Security re-review (card 10): all card-08 findings FIXED, but NO-GO on a new HIGH (`git switch` / `git checkout -b` unrestricted in policy.json:80, can roll back or delete the hook script, so the hook may fail open) and a MEDIUM (secret paths via `cd` or attached short options, e.g. `date -f/proc/self/environ`). Launch re-poll NO-GO, release pack HOLD (3d28b09, card 11); tests 51/51 pass. No fix loop (guardrails are Flight Director-owned). Build cycles used: 1 of 3.
- A shell attempt by the Chief of Staff to update this file was blocked by Range Safety (a `$` inside double quotes); updated with the Edit tool instead, no other route tried.

| Task (cont.) | Owner | Status |
|---|---|---|
| Security re-review (9427c8f) | security-engineer | NO-GO: 3 HIGH + pre-existing HIGH (flight-cards/08) |
| Launch re-poll | launch-director | NO-GO, HOLD, 9e365f5 (flight-cards/09) |
| Security re-review (d4c7b37) | security-engineer | NO-GO: 1 new HIGH (git switch), 1 MEDIUM (flight-cards/10) |
| Launch re-poll | launch-director | NO-GO, HOLD, 3d28b09 (flight-cards/11) |

## Risks
- BLOCKER (card 10): `git switch` / `git checkout -b` unrestricted (policy.json:80) lets the builder remove or roll back range-safety.js; hook exit 1 does not block. Fail-open severity is Medium confidence until the Flight Director confirms. Also MEDIUM: secret reads via `cd` or `date -f/proc/self/environ`. Lows: `date --s` abbreviation, git option abbreviations, tester-test-path dodges, `git stash`. No guardrail tests cover these.
- BLOCKER (card 08, now fixed in d4c7b37): range-safety.js still bypassable: `echo () { ...; }; echo`, `find -ex"ec"` / `--out"put"=`, `>&1file`, and `node --test --import`. Needs Flight Director fix, new policy approval, Security re-review, fresh poll. Security suggests a word-splitting allowlist instead of regex. Alternative: ship the booking fix alone, move guardrail commits to a separate PR.
- Security flagged harness-neutralized instruction-shaped text in its output (settings-json pattern); treated as data, no action taken.
- BLOCKER: 9e7de9b range-safety.js bypasses (HIGH): `echo x & curl ...` and `cat <(curl ...)` skip the blocked-command rules. Needs a Flight Director fix, a new policy approval, then re-review.
- Approval commits (310ad93, 9e7de9b, a16c3cd) are authored by Claude noreply; human authorship of the approval lines can't be verified in git.
- BLOCKER: commit f5cb1d2 loosened blockedCommands in .crew/policy.json with no recorded approval; approvals.md covers design.md Option A only.
- Out-of-scope follow-ups from design: autofill may fill honeypot (index.html:592); offline-saved request lost on 400/429 at replay.
- AC-7 is a source check only; test manually in a browser with a changed clock.
- npm test runs unit tests only (acceptance not included); README fill-time line not updated.
- Flight-recorder JSONL modified but uncommitted.
