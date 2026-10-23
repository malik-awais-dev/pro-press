exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }) };

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

    // Free vision models on OpenRouter, tried in order
    const models = [
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3.5-super-vl:free',
      'google/gemma-4-26b-a4b-it:free',
    ];

    let result, lastErr;
    for (const model of models) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${orKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://pro-press.netlify.app',
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
              { type: 'text', text: prompt },
            ],
          }],
          max_tokens: 200,
          temperature: 0.4,
        }),
      });

      const body = await res.json();
      if (res.ok && body.choices?.[0]?.message?.content) { result = body; break; }
      lastErr = JSON.stringify(body);
    }

    if (!result) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'All models failed: ' + lastErr }) };
    }

    let text = result.choices[0].message.content.trim();
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
