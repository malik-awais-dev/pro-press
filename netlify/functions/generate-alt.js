exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'GROQ_API_KEY not configured' }) };

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

    const payload = {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
          { type: 'text', text: prompt },
        ],
      }],
      max_tokens: 200,
      temperature: 0.4,
    };

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, headers, body: JSON.stringify({ error: 'Groq error: ' + err }) };
    }

    const data = await res.json();
    let text = data.choices[0].message.content.trim();
    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { alt: text, title: text };
    }

    parsed.caption = parsed.caption || '';
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
