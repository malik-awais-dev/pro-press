# PRO-PRESS

Image compressor & optimizer deployed on Netlify.
- **Live:** https://pro-press.vercel.app/
- **Repo:** https://github.com/malik-awais-dev/pro-press.git
- **Stack:** Vanilla HTML/CSS/JS, Netlify Functions

## Alt Text Generator (in progress)

AI-powered alt text generator integrated into the compressor page. Each image row has an "Alt" button that calls a Netlify serverless function → Gemini 2.0 Flash vision API.

### Status: Blocked on Gemini API quota
- Feature is built and deployed
- Gemini free tier quota shows "limit: 0" error
- **Fix:** Create a new API key in a fresh Google Cloud project at https://aistudio.google.com/apikey, then update `GEMINI_API_KEY` env var in Netlify and redeploy

### Key Files
- `index.html` — alt text panel section after preview section
- `app.js` — genAlt(), resizeForAlt(), showAltResult() at the bottom
- `styles.css` — .alt-* styles
- `netlify/functions/generate-alt.js` — serverless function calling Gemini API
- `netlify.toml` — function config

### Features Built
- Alt button on all image rows (not just compressed)
- Style selector (concise/detailed/SEO/e-commerce)
- Image resized to 1024px before API call for reliability
- Button loading state with spinner, prevents double-clicks
- Copy buttons for alt text, title, HTML snippet
- Character count indicator (warns if over 125 chars)
