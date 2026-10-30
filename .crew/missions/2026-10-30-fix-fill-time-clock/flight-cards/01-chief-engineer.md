Role: Chief Engineer
Verdict: DONE
What I did: Confirmed the cause. The server compares the visitor's device-clock startedAt with its own clock, and when the gap is under 3 s it returns a fake 200 and sends no email. Design: the browser measures fill time itself with performance.now(), sends fillMs, and the server checks only that number.
Why: Both readings then come from the same clock, so clock differences can't drop real requests. Spam protection stays the same: a bot can already skip today's check by leaving out startedAt, and every request is client-reported either way. The old startedAt field is ignored, so cached old app.js copies and saved offline requests still get delivered.
Evidence: /home/claude/rosee/.crew/missions/2026-10-30-fix-fill-time-clock/design.md; api/book.js:146-150 (fake 200, nothing sent), api/book.js:31 (MIN_FILL_MS); assets/js/app.js:75, :149, :179 (device-clock startedAt), app.js:210-212 (shows success on ok)
Risks: fillMs can be faked, just as startedAt can today (the stronger fix, a signed server timestamp, is out of scope). Old cached clients skip the timing check briefly during rollout; the sw.js VERSION bump keeps that short. Follow-ups found but not in scope: browser autofill could fill the honeypot field (index.html:592), and a request saved offline is lost if it gets a 400 or 429 when it finally sends (the visitor does see an error).
Confidence: High

(Report notes: each fake-success drop also writes one log line with no personal data. Nine acceptance criteria; AC-2 is the fast-device-clock case, AC-4 to AC-6 are abuse cases. Planned changes: api/book.js, three lines in assets/js/app.js, VERSION in sw.js. No new dependencies or env vars.)
