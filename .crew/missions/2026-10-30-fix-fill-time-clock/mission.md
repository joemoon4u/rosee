# Mission 2026-10-30-fix-fill-time-clock

## Request (verbatim)
> Some visitors say they submitted a booking request and saw the success message, but the studio never received an email. Suspected cause: the bot filter's minimum fill-time check compares the visitor's device clock (startedAt, sent by assets/js/app.js) with the server's clock in api/book.js. Fix it so real requests are never silently dropped, without weakening spam protection. Run the mission up to the design approval gate.

- Base commit: 832f00f20181c66a3e9430fc491fdece557275cf
- Branch: crew/sdlc-agents

## Tasks
| Task | Owner | Status |
|---|---|---|
| Design | chief-engineer | done (design.md, flight-cards/01) |
| Human gate: design approval | Flight Director | AWAITING |
| Build | responsible-engineer | not started (gated) |
| Acceptance tests | test-engineer | not started |
| Security review | security-engineer | not started |
| Launch poll | launch-director | not started |

## Status log
- Mission opened. (First attempt via shell was blocked by Range Safety; redone with Write tool.)
- Chief engineer confirmed cause and wrote design.md.
- Stopped at design gate: no `DESIGN: APPROVED` in approvals.md.

## Risks
- Out-of-scope follow-ups from design: autofill may fill honeypot (index.html:592); offline-saved request lost on 400/429 at replay.
