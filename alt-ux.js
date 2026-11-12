// Alt Text UX layer - loaded AFTER app.js.
// Wraps fetch calls to /api/generate-alt without touching genAlt() logic:
//  - Caches successful results per image+style, so re-clicking Alt is instant
//  - On a transient failure (Google congestion), silently retries once -
//    exactly what a manual second click does, but the user never sees it
//  - If both attempts fail, shows a friendly actionable message instead of
//    raw provider diagnostics (raw error still goes to console.error)
//  - Updates the loading text after 5s so the wait never feels frozen
(function () {
  const realFetch = window.fetch.bind(window);
  const cache = new Map(); // key: style|mediaType|len|fingerprint -> response JSON text
  const DEFAULT_LOADING = 'Analyzing image\u2026';
  let slowTimer = null;

  function setLoadingText(t) {
    const el = document.getElementById('altLoading');
    const span = el && el.querySelector('span');
    if (span) span.textContent = t;
  }

  function cacheKeyFor(bodyText) {
    try {
      const b = JSON.parse(bodyText);
      // The resized base64 image is deterministic per file, so a short
      // fingerprint plus style is enough to recognize a repeat request.
      return (b.altStyle || 'concise') + '|' + (b.mediaType || '') + '|' +
        (b.image ? b.image.length : 0) + '|' + (b.image ? b.image.slice(0, 80) : '');
    } catch (e) { return null; }
  }

  async function attempt(args) {
    return realFetch(...args);
  }

  window.fetch = async function () {
    const args = arguments;
    const url = String(args[0]);
    const opts = args[1];
    const isAltRequest = url.indexOf('/api/generate-alt') !== -1;
    const isPost = opts && opts.method === 'POST' && typeof opts.body === 'string';
    if (!isAltRequest || !isPost) return realFetch(...args);

    const key = cacheKeyFor(opts.body);

    // 1) Cached result for the same image + style: answer instantly.
    if (key && cache.has(key)) {
      return new Response(cache.get(key), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2) Keep the loading state feeling alive during the wait.
    setLoadingText(DEFAULT_LOADING);
    clearTimeout(slowTimer);
    slowTimer = setTimeout(function () {
      setLoadingText('Taking a moment \u2014 the AI service is busy\u2026');
    }, 5000);

    // 3) First attempt.
    let res = null;
    try {
      res = await attempt(args);
      if (res && res.ok) {
        clearTimeout(slowTimer);
        if (key) cache.set(key, await res.clone().text());
        return res;
      }
      console.error('[alt-ux] first attempt failed:', res ? await res.clone().text() : 'no response');
    } catch (e) {
      console.error('[alt-ux] first attempt threw:', e);
    }

    // 4) Transient congestion is common: wait briefly and retry once silently.
    await new Promise(function (r) { setTimeout(r, 1500); });
    try {
      const retry = await attempt(args);
      if (retry && retry.ok) {
        clearTimeout(slowTimer);
        if (key) cache.set(key, await retry.clone().text());
        return retry;
      }
      console.error('[alt-ux] retry failed:', retry ? await retry.clone().text() : 'no response');
    } catch (e) {
      console.error('[alt-ux] retry threw:', e);
    }

    // 5) Both attempts failed: friendly, actionable message for the user.
    clearTimeout(slowTimer);
    return new Response(
      JSON.stringify({ error: 'The AI service is busy right now. Tap the Alt button again in a few seconds \u2014 it usually works on the second try.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  };

  // When the user switches style, reset the loading label so stale slow-text
  // never carries over to the next run.
  const styleSel = document.getElementById('altStyle');
  if (styleSel) {
    styleSel.addEventListener('change', function () { setLoadingText(DEFAULT_LOADING); });
  }
})();
