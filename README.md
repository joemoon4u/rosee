# Rosée Skin Atelier - THE ONE

A one-page website for an independent skin consultancy, with a booking form.
It's a Progressive Web App (installable on phones, works offline) and is ready to deploy on Vercel.

No frameworks, no build step, no tracking, no third-party scripts or fonts.

## What's in the folder

| Path | What it is |
|---|---|
| `index.html` | The whole site: hero, philosophy, consultations, letter, reading room, booking form |
| `assets/css/styles.css` | Theme, layout and the bloom animation |
| `assets/js/app.js` | Menu, form validation and sending, offline queue, install button |
| `assets/fonts/` | Self-hosted fonts (Fraunces, Figtree, Mrs Saint Delafield), all SIL Open Font Licence |
| `assets/icons/`, `og-image.png`, `assets/screenshots/` | App icons, social sharing image, install screenshots |
| `manifest.webmanifest`, `sw.js`, `offline.html` | The PWA layer |
| `api/book.js` | Serverless function that emails booking requests to you |
| `vercel.json` | Security headers (strict CSP, HSTS and more) and caching rules |

## Before going live: personalise

Search `index.html` for `EDIT:` to find every spot. In short:

1. **Brand name.** "Rosée Skin Atelier" is a placeholder. Check the name is free on the ASIC business name register before using it.
   It also appears in `manifest.webmanifest`, `offline.html` and the footer.
2. **Founder name.** Replace `Your Name` in the signature.
3. **Portrait.** Add a photo at `assets/img/portrait.jpg` and swap it in for the placeholder flower.
4. **Credentials.** Add a credentials line only once the qualification is complete.
5. **Prices and inclusions.** These are suggestions. Change them in both the consultation list and the form's dropdown.
   If you rename a consultation, update `PLANS` in `api/book.js` too.
6. **Contact email.** Replace `hello@rosee-skin.example`.
7. **Social image.** Once you have a domain, make `og:image` an absolute URL.

## Deploy to Vercel

1. Put this folder in a GitHub repository, or use the Vercel CLI: `npm i -g vercel`, then run `vercel` inside the folder.
2. In Vercel, import the project. Framework preset: **Other**. No build command, output directory is the root.
3. Set up email delivery for the booking form:
   - Create a free account at [resend.com](https://resend.com) and verify your domain.
   - In Vercel, go to Project > Settings > Environment Variables and add:

     | Name | Example |
     |---|---|
     | `RESEND_API_KEY` | `re_...` |
     | `BOOKING_TO_EMAIL` | `hello@yourdomain.com.au` |
     | `BOOKING_FROM_EMAIL` | `Rosée bookings <bookings@yourdomain.com.au>` |
     | `ALLOWED_ORIGIN` (optional) | `https://yourdomain.com.au` |

   - Redeploy so the variables take effect.
4. Add your custom domain under Project > Settings > Domains.

Until the email variables are set, the form tells visitors that online booking isn't switched on yet and shows your email address instead. Nothing is lost silently.

## Updating the site

When you change anything, bump `VERSION` at the top of `sw.js` (for example `rosee-v2`).
Returning visitors then get the new version instead of their cached copy.

## Security, privacy and safety choices

- **Data minimisation.** The form asks only for what's needed to book. It tells visitors to keep medical details for the consultation.
- **Nothing stored on the server.** Requests go straight to your inbox. Server logs never include personal details.
- **Strict Content Security Policy.** Only the site's own files can load or run. There are no inline scripts and no third parties.
- **Spam protection.** A hidden honeypot field, a minimum fill time, strict validation and length limits, and a per-IP rate limit.
  For stronger protection later, turn on Vercel's Firewall or Bot protection.
- **No auto-reply to the visitor.** This stops the form being used to send spam to other people's addresses. You reply personally, which suits the brand anyway.
- **Studio address kept private.** The site says the address is shared on confirmation, so your home address is never published.
- **Clear scope of advice.** Every page carries the "skin advice, not medical care" note, along with the commitment to refer to a GP or dermatologist.
- **Offline requests.** A request made offline is saved only on the visitor's own device and cleared as soon as it sends.

## Run locally

```
npx vercel dev
```

This serves the site and the booking function together at http://localhost:3000.
