exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const { image, mediaType, context, style } = JSON.parse(event.body);

    if (!image || !mediaType) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image data' }) };
    }

    let prompt = 'Generate concise, descriptive alt text for this image. The alt text should be:\n';
    prompt += '- Accurate and descriptive of the image content\n';
    prompt += '- Between 10-125 characters when possible\n';
    prompt += '- SEO-friendly with natural keyword usage\n';
    prompt += '- Accessible for screen reader users\n';
    prompt += '- Written in plain, clear language\n\n';

    if (style === 'detailed') {
      prompt += 'Provide a more detailed description (up to 200 characters). Include colors, composition, and mood.\n\n';
    } else if (style === 'seo') {
      prompt += 'Optimize heavily for SEO. Include likely search keywords naturally.\n\n';
    } else if (style === 'ecommerce') {
      prompt += 'Write alt text suitable for an e-commerce product image. Include product type, key features, and color.\n\n';
    }

    if (context) {
      prompt += `Additional context from the user: "${context}"\n\n`;
    }

    prompt += 'Respond with ONLY a JSON object in this exact format (no markdown, no code fences):\n';
    prompt += '{"alt": "the alt text here", "title": "a slightly longer title attribute suggestion", "caption": "an optional 1-sentence caption for social media or blog use"}';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mediaType,
                    data: image,
                  },
                },
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.4,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return { statusCode: response.status, headers, body: JSON.stringify({ error: 'API error: ' + err }) };
    }

    const data = await response.json();
    let text = data.candidates[0].content.parts[0].text.trim();

    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { alt: text, title: text, caption: '' };
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
