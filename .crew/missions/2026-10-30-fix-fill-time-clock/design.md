# Design: 2026-10-30-fix-fill-time-clock

Base commit 832f00f. Author: Chief Engineer.

## 1. Problem
The suspected cause is confirmed.
- `assets/js/app.js:75` sets `startedAt = Date.now()` from the **device clock** (reset at `:179`) and sends it at `:149`.
- `api/book.js:147-150` computes `Date.now() - startedAt` using the **server clock**. If the result is below `MIN_FILL_MS` (3000, `:31`), it returns `200 {ok:true}` and sends no email. The comment at `:146` says "Pretend success, send nothing".
- `app.js:210-212` sees `ok` and shows the success message.

The result: any visitor whose device clock runs ahead of the server's by more than (their fill time minus 3 s) gets a success message and their request is thrown away. A form takes about 30 to 120 s to fill in. A phone set manually, a wrong timezone set as local time, or a drifted laptop clock is minutes or hours ahead, so its requests are always dropped. The clock gap is the whole effect. No error is shown, nothing is logged, and the studio loses the lead.

The check also does little against bots. A bot can leave out `startedAt` (`Number.isFinite` fails, so the check is skipped) or send any value. Visitors whose clock runs behind are never checked at all. So moving the measurement to one clock costs no real protection.

Other silent-drop paths I checked:
- The honeypot (`index.html:590-592`, `api/book.js:148`) also returns a fake 200. Some autofill tools and extensions ignore `autocomplete="off"`. Low likelihood, so it's a follow-up and not part of this fix.
- Invalid fields return 400, a missing config returns 503, and a provider failure returns 502 (`book.js:153-197`). All of these show an error to the visitor, so none of them are silent.
- In the offline queue (`app.js:282-287`) the pending request is removed before the send. A 400 or 429 on flush shows a message but drops the saved request. The visitor sees an error, so it isn't silent. Out of scope.
- No other silent-success path exists. The emailed-but-landed-in-spam case is outside this code.

## 2. Requirement challenge (NOT doing)
- No server-issued signed token or CAPTCHA. That needs a new endpoint and secret, or a third-party script, which the CSP and README rule out. It would also be a bigger change than the bug needs.
- The honeypot autofill hardening and the offline-queue loss on 400/429 are follow-ups, not this mission.
- `MIN_FILL_MS` and the rate limit stay as they are.

## 3. Options
- A. **The client measures the elapsed time on its own monotonic clock (`performance.now()`) and sends `fillMs`. The server checks `fillMs`.** The clock gap disappears, and it's the smallest change. The value is still client-reported, which is the same trust level as today.
- B. Keep `startedAt` and accept negative or large gaps as "clock skew". This still fails for a slow clock plus a quick fill, and it's harder to reason about.
- C. An HMAC-signed server timestamp sent with the page. This is actually trustworthy, but it needs a new endpoint, a new secret env var, and the page HTML is cached by the service worker. Too heavy for this fix.

## 4. Decision (ADR)
- **Context:** the fill-time check compares readings from two different clocks. The timing check only filters naive bots. The real protection is the honeypot, strict validation, the per-IP rate limit and the optional Vercel firewall.
- **Decision:** Option A.
  - Client: record `startedAt = performance.now()` (at load and on reset). At submit, send `fillMs = Math.round(performance.now() - startedAt)` in place of `startedAt`.
  - Server: drop silently only when `fillMs` is a finite number and `0 <= fillMs < MIN_FILL_MS`.
  - Legacy field: a legacy `startedAt` is **ignored**. It is never compared with the server clock.
  - Logging: every silent drop logs one line with no personal data, for example `booking: filtered (honeypot|too_fast)`, so the studio can spot false positives.
  - Bump `VERSION` in `sw.js` as the README asks (`README.md:57`).
- **Consequences:**
  - Clock gaps can no longer drop a real request.
  - Spam protection is equal to today: a bot could already skip the check by leaving out the field.
  - Backward compatibility: old cached `app.js` copies and offline-queued payloads still send `startedAt`. They are now accepted (no false drop) and go through all the other checks.
  - The response shape and status codes don't change.

## 5. Acceptance criteria
- AC-1: A valid request with `fillMs: 45000` and all other fields valid reaches the email provider once and returns 200.
- AC-2: A valid request built as an old client would, with `startedAt` set to the server time plus 1 hour (a fast device clock), reaches the email provider. This is the regression case for the bug.
- AC-3: A valid request with `startedAt` set to the server time minus 1 hour, and no `fillMs`, reaches the email provider.
- AC-4 (abuse): `fillMs: 500` returns 200 `{ok:true}`. The email provider is NOT called, and one log line is written that contains no name, email, phone or message.
- AC-5 (abuse): a non-empty `website` returns 200, the provider is NOT called, and a PII-free log line is written.
- AC-6 (abuse): `fillMs` set to `-5`, `"abc"`, `null`, `1e309` or missing must not crash the server (no 500). A request is never dropped by the timing check unless `0 <= fillMs < 3000`.
- AC-7: In the browser, submitting the real form sends a payload that contains a numeric `fillMs` and no `startedAt`. Changing the device clock by plus or minus 1 day between page load and submit does not change the result.
- AC-8: The existing validation (400 with `fields`), 405, 415, 403 origin, 429 and 503 behaviour is unchanged.
- AC-9: `VERSION` in `sw.js` differs from `rosee-v1`.

## 6. Files to change
- `api/book.js`: the bot-filter block (`:146-151`) and its header comment.
- `assets/js/app.js`: lines `:75`, `:149` and `:179` only.
- `sw.js`: the `VERSION` constant.
- Acceptance and unit tests live under `tests/` (owned by the test and build roles respectively).
- Optional: a one-line note in `README.md:65` if the wording about the fill time changes.

## 7. Risks and rollback
- **Risk:** `fillMs` can be forged. This was already true of `startedAt`. If spam rises, the next step is Option C or the Vercel Bot protection, not a tighter client check.
- **Risk:** `performance.now()` may pause while a tab is asleep, which undercounts the fill time. That could only lead to a drop if the visitor spent less than 3 s of awake time on the page, which is very unlikely for a real person.
- **Risk:** during rollout, old clients skip the timing check. The window is short because of the service-worker version bump.
- **Rollback:** revert the single commit and redeploy (a human does this). No data or schema is involved.
- **Repo content aimed at agents:** none was found in the files I read. The `.crew/` hooks are policy and enforcement, not instructions I acted on.
