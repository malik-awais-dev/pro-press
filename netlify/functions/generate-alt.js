exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' }) };

  try {
    const { image, mediaType, context, style } = JSON.parse(event.body);
    if (!image || !mediaType) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image data' }) };

    let prompt = 'Generate concise, descriptive alt text for this image. Requirements:\n';
    prompt += '- Accurate and descriptive\n- 10-125 characters when possible\n- SEO-friendly\n- Accessible for screen readers\n- Plain, clear language\n\n';

    if (style === 'detailed') prompt += 'Provide a detailed description (up to 200 characters) including colors, composition, and mood.\n\n';
    else if (style === 'seo') prompt += 'Optimize for SEO with natural keyword usage.\n\n';
    else if (style === 'ecommerce') prompt += 'Write for an e-commerce product image: include product type, key features, and color.\n\n';
    if (context) prompt += `Additional context: "${context}"\n\n`;

    prompt += 'Respond with ONLY a JSON object, no markdown:\n{"alt":"alt text here","title":"slightly longer title attribute"}';

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let response, lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(attempt * 2000);
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: image } }, { text: prompt }] }],
            generationConfig: { maxOutputTokens: 200, temperature: 0.4 },
          }),
        }
      );
      if (response.ok) break;
      lastErr = await response.text();
      if (response.status !== 503) break;
    }

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: 'Gemini error: ' + lastErr }) };
    }

    const data = await response.json();
    let text = data.candidates[0].content.parts[0].text.trim();
    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { parsed = { alt: text, title: text }; }

    parsed.caption = parsed.caption || '';
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
