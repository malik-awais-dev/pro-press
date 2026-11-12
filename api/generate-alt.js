// Alt text generator - tries Google Gemini (free tier) first, then AshnaAI.
// API keys live in hosting platform env vars, never in code.
// Every outbound call has a hard timeout and the whole handler runs inside a
// time budget, so the function ALWAYS responds quickly (success or clean error)
// instead of hanging past the platform's function timeout.
const STYLES = {
  concise: 'Write a concise alt text (under 125 characters) describing the essential content of this image.',
  detailed: 'Write a detailed alt text describing this image: key objects, colors, setting, and mood.',
  seo: 'Write SEO-friendly alt text for this image: descriptive, natural, and including relevant keywords.',
  ecommerce: 'Write e-commerce product alt text for this image: name the product and highlight key features and use context.'
};

// Free-tier vision models, tried in order. gemini-3.5-flash-lite is Google's
// low-latency, high-throughput model, so it goes FIRST (typical reply in 1-3s);
// the heavier gemini-3.8-flash is only a fallback lane.
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];

const CALL_TIMEOUT_MS = 8000;  // hard cap per outbound HTTP call (normal vision reply: 2-6s)
const BUDGET_MS = 9000;        // total wall-clock budget (platforms kill functions ~10s)

module.exports = async (req, res) => {
  const start = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const remaining = () => BUDGET_MS - (Date.now() - start);

  try {
    const body = req.body || {};
    const image = body.image;       // base64 (no data: prefix)
    const mediaType = body.mediaType; // e.g. image/jpeg
    const altStyle = body.altStyle;
    if (!image || !mediaType) return res.status(400).json({ error: 'Missing image data' });

    const prompt = (STYLES[altStyle] || STYLES.concise) + ' Return only the alt text itself.';

    // ---- Provider 1: Google Gemini (free tier) ----
    const geminiKey = process.env.GEMINI_API_KEY;
    let geminiError = null;
    if (geminiKey) {
      for (const model of GEMINI_MODELS) {
        if (remaining() < 1500) { geminiError = 'Ran out of time budget trying Gemini models'; break; }
        try {
          const alt = await callGemini(geminiKey, model, prompt, image, mediaType, Math.min(CALL_TIMEOUT_MS, remaining()));
          if (alt) return res.status(200).json({ alt: alt, title: alt, caption: '', provider: 'gemini' });
        } catch (err) {
          geminiError = err.message;
          console.error('Gemini model ' + model + ' failed:', geminiError);
          // 503 = temporary congestion: one quick retry of the same model if budget allows.
          if (err.status === 503 && remaining() > 2500) {
            await new Promise(r => setTimeout(r, 300));
            try {
              const alt = await callGemini(geminiKey, model, prompt, image, mediaType, Math.min(CALL_TIMEOUT_MS, remaining()));
              if (alt) return res.status(200).json({ alt: alt, title: alt, caption: '', provider: 'gemini' });
            } catch (retryErr) {
              geminiError = retryErr.message;
            }
          }
        }
      }
    } else {
      geminiError = 'GEMINI_API_KEY env var is NOT present in this deployment build';
    }

    // ---- Provider 2: AshnaAI (fallback) ----
    const ashnaKey = process.env.ASHNA_API_KEY;
    let ashnaError = null;
    if (ashnaKey && remaining() > 1500) {
      try {
        const alt = await callAshna(ashnaKey, prompt, image, mediaType, Math.min(CALL_TIMEOUT_MS, remaining()));
        return res.status(200).json({ alt: alt, title: alt, caption: '', provider: 'ashna' });
      } catch (err) {
        ashnaError = err.message;
      }
    } else {
      ashnaError = ashnaKey ? 'Skipped AshnaAI fallback (out of time budget)' : 'ASHNA_API_KEY env var is NOT present in this deployment build';
    }

    // Both providers failed or unconfigured - report both so we can diagnose.
    return res.status(502).json({ error: 'Gemini: ' + geminiError + ' || AshnaAI: ' + ashnaError });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Alt text generation failed' });
  }
};

async function callGemini(key, model, prompt, imageBase64, mediaType, timeoutMs) {
  // AQ.* auth keys must be sent as a header, not as a ?key= query parameter.
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const apiRes = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mediaType, data: imageBase64 } }
        ]
      }]
    })
  });
  if (!apiRes.ok) {
    const detail = await apiRes.text().catch(() => '');
    const err = new Error('Gemini API returned ' + apiRes.status + ' - ' + String(detail).slice(0, 300));
    err.status = apiRes.status;
    throw err;
  }
  const data = await apiRes.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const alt = parts.map(p => p.text || '').join(' ').trim();
  if (!alt) throw new Error('Gemini returned an empty response');
  return alt;
}

async function callAshna(key, prompt, imageBase64, mediaType, timeoutMs) {
  const apiRes = await fetch('https://api.ashna.ai/v1/api/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: 'glm-5.3-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + imageBase64 } }
        ]
      }]
    })
  });
  if (!apiRes.ok) {
    const detail = await apiRes.text().catch(() => '');
    const err = new Error('API returned ' + apiRes.status + ' - ' + String(detail).slice(0, 300));
    err.status = apiRes.status;
    throw err;
  }
  const data = await apiRes.json();
  const choice = data.choices && data.choices[0];
  const alt = ((choice && choice.message && choice.message.content) || '').trim();
  if (!alt) throw new Error('AI provider returned an empty response');
  return alt;
}
