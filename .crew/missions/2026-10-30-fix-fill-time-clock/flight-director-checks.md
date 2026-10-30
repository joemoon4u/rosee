# Flight Director checks (independent of the crew)

Run by Claude for the Flight Director on 2026-10-30, outside the crew, so the crew isn't grading its own work.

## 1. Bug reproduced, fix confirmed (server handler)

Same request sent to the old `api/book.js` (832f00f) and the new one (4112ca6), with the email provider stubbed.

| Case | HTTP | Visitor sees | Emails sent |
|---|---|---|---|
| OLD: visitor clock 10 min fast, 60 s fill | 200 ok | Success | **0** (silently dropped) |
| NEW: same old cached client (`startedAt`) | 200 ok | Success | 1 |
| NEW: new client, `fillMs` 60000 | 200 ok | Success | 1 |
| NEW: bot, `fillMs` 500 | 200 ok | Success | 0 (filtered, logged without personal data) |

## 2. AC-7 in a real browser (Chromium via Playwright)

The real site was served locally, `/api/book` was routed to the real handler, and the device clock was skewed from page load. The form was filled and submitted like a visitor would.

| Site | Device clock | Payload sent | Success shown | Emails sent |
|---|---|---|---|---|
| OLD | +10 min | `startedAt` | Yes | **0** |
| OLD | +1 day | `startedAt` | Yes | **0** |
| OLD | -1 day | `startedAt` | Yes | 1 |
| NEW | +10 min | `fillMs≈3.7s` | Yes | 1 |
| NEW | +1 day | `fillMs≈3.7s` | Yes | 1 |
| NEW | -1 day | `fillMs≈3.7s` | Yes | 1 |

A clock jump *between* page load and submit made no difference on either version, because the old code read the clock once at page load. The bug only bites when the device clock is already wrong, which is the common case: a phone set manually or to the wrong timezone.

## 3. Test suites

- `node --test tests/unit/book-fill-time.test.js tests/acceptance/fill-time-clock.test.js`: 32 pass, 0 fail
- `npm run test:crew`: 21 pass, 0 fail
- `node .crew/bin/verify-recorder.js`: OK, hash chain intact
