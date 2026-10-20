/* POST /api/book
   Receives a consultation request, validates it, and emails it to the studio
   through Resend (https://resend.com). Nothing is stored on the server.

   Environment variables (set in Vercel > Project > Settings > Environment Variables):
     RESEND_API_KEY       required  API key from Resend
     BOOKING_TO_EMAIL     required  where requests are delivered, e.g. hello@yourdomain.com.au
     BOOKING_FROM_EMAIL   required  a sender on a domain verified in Resend, e.g. "Rosée bookings <bookings@yourdomain.com.au>"
     ALLOWED_ORIGIN       optional  e.g. https://yourdomain.com.au (blocks posts from other sites)

   Security notes
     - Strict validation and length limits on every field
     - Honeypot field and minimum fill time to filter simple bots
     - Best-effort rate limit per IP (per server instance)
     - No auto-reply to the visitor's address, so the form can't be used to spam others
     - Personal details are never written to logs */

const PLANS = {
  "first-light": "First Light (45 min, online, $95)",
  "the-ritual": "The Ritual (90 min, $240)",
  "the-season": "The Season (3 months, $620)",
  "the-atelier": "The Atelier (6 months, $1,450)",
  "not-sure": "Not sure yet, please advise"
};
const FORMATS = { studio: "In the home studio", online: "Online, by video" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMES = ["Morning", "Afternoon", "Evening"];

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const PHONE_RE = /^[0-9 +()\-]{6,20}$/;
const MIN_FILL_MS = 3000;

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_MAX;
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  // drop control characters except newlines and tabs, then trim and cap
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validate(body) {
  const data = {
    name: clean(body.name, 80),
    email: clean(body.email, 254).toLowerCase(),
    phone: clean(body.phone, 20),
    plan: clean(body.plan, 40),
    format: clean(body.format, 20),
    days: Array.isArray(body.days) ? body.days.filter((d) => DAYS.includes(d)) : [],
    times: Array.isArray(body.times) ? body.times.filter((t) => TIMES.includes(t)) : [],
    message: clean(body.message, 600),
    consent: body.consent === true
  };

  const fields = {};
  if (data.name.length < 2) fields.name = "Add your name so I know who to reply to.";
  if (!EMAIL_RE.test(data.email)) fields.email = "Check your email address. It looks incomplete.";
  if (data.phone && !PHONE_RE.test(data.phone)) fields.phone = "Use digits, spaces, brackets or + only.";
  if (!PLANS[data.plan]) fields.plan = "Choose a consultation, or pick “I’m not sure yet”.";
  if (!FORMATS[data.format]) data.format = "studio";
  if (!data.consent) fields.consent = "Tick this box so I can use your details to arrange your consultation.";

  return { data, fields };
}

function buildEmail(d) {
  const rows = [
    ["Name", d.name],
    ["Email", d.email],
    ["Mobile", d.phone || "Not given"],
    ["Consultation", PLANS[d.plan]],
    ["Where", FORMATS[d.format]],
    ["Days", d.days.length ? d.days.join(", ") : "Any"],
    ["Times", d.times.length ? d.times.join(", ") : "Any"],
    ["Their words", d.message || "Nothing added"],
    ["Consent", "Agreed to the privacy note and that this is skin advice, not medical care"]
  ];

  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    "\n\nReply to this email to answer them directly.";

  const html = `<!doctype html><html><body style="margin:0;background:#F8ECEB;font-family:Helvetica,Arial,sans-serif;color:#4B2433">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:24px;margin:0 0 16px">New consultation request</p>
<table cellpadding="0" cellspacing="0" style="width:100%;background:#FFF9F8;border-radius:16px;padding:8px 20px">
${rows.map(([k, v]) => `<tr><td style="padding:10px 12px 10px 0;vertical-align:top;color:#7A5160;font-size:14px;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:10px 0;font-size:15px;line-height:1.5">${escapeHtml(v).replace(/\n/g, "<br>")}</td></tr>`).join("\n")}
</table>
<p style="font-size:13px;color:#7A5160;margin-top:16px">Reply to this email to answer them directly.</p>
</div></body></html>`;

  return { text, html };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.includes("application/json")) {
    return res.status(415).json({ error: "unsupported_media_type" });
  }

  const allowed = process.env.ALLOWED_ORIGIN;
  const origin = req.headers.origin;
  if (allowed && origin && origin !== allowed) {
    return res.status(403).json({ error: "forbidden" });
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "too_many_requests" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "invalid_body" });
  }

  // Bots: filled the hidden field, or submitted impossibly fast. Pretend success, send nothing.
  const startedAt = Number(body.startedAt);
  if ((typeof body.website === "string" && body.website.trim() !== "") ||
      (Number.isFinite(startedAt) && Date.now() - startedAt < MIN_FILL_MS)) {
    return res.status(200).json({ ok: true });
  }

  const { data, fields } = validate(body);
  if (Object.keys(fields).length) {
    return res.status(400).json({ error: "invalid_fields", fields });
  }

  const { RESEND_API_KEY, BOOKING_TO_EMAIL, BOOKING_FROM_EMAIL } = process.env;
  if (!RESEND_API_KEY || !BOOKING_TO_EMAIL || !BOOKING_FROM_EMAIL) {
    return res.status(503).json({ error: "not_configured" });
  }

  const { text, html } = buildEmail(data);
  const subject = `Consultation request: ${PLANS[data.plan].split(" (")[0]} from ${data.name}`.replace(/[\r\n]/g, " ");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: BOOKING_FROM_EMAIL,
        to: [BOOKING_TO_EMAIL],
        reply_to: data.email,
        subject,
        text,
        html
      })
    });

    if (!response.ok) {
      console.error("booking: email provider responded with status", response.status);
      return res.status(502).json({ error: "send_failed" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("booking: email provider unreachable");
    return res.status(502).json({ error: "send_failed" });
  }
};
