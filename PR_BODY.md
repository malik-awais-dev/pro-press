# Replace Tailwind proxy with official AshnaAI API

## Why
The alt text generator was proxying through Tailwind's internal marketing-tool API: it uploaded the user's image to a third-party public CDN (`x-amz-acl: public-read`) and spoofed Origin/Referer headers. This was fragile, against their terms, and contradicted PRO-PRESS's "100% private" promise.

## What changes
- `api/generate-alt.js` rewritten: calls the official AshnaAI API (OpenAI-compatible chat completions, model `glm-5.3-flash`, vision via base64 data URL - no CDN upload)
- `app.js` now sends `altStyle`, so the style selector (Concise / Detailed / SEO / E-Commerce) actually works
- `index.html` credits "Powered by AshnaAI" with a disclosure that the alt feature sends the image for AI analysis

## Setup needed before merge
Add the environment variable `ASHNA_API_KEY` in the hosting platform (already done for Vercel: Production, Preview, Development).

## Testing
1. Open the preview deployment
2. Drop any image and click the "Alt" button
3. Try each style option - the wording should change accordingly
4. Verify compression and all other features are unaffected
