// Alt text generator - uses the official AshnaAI API (OpenAI-compatible)
// The ASHNA_API_KEY lives in the hosting platform env vars, never in code.
const STYLES = {
  concise: 'Write a concise alt text (under 125 characters) describing the essential content of this image.',
  detailed: 'Write a detailed alt text describing this image: key objects, colors, setting, and mood.',
  seo: 'Write SEO-friendly alt text for this image: descriptive, natural, and including relevant keywords.',
  ecommerce: 'Write e-commerce product alt text for this image: name the product and highlight key features and use context.'
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const image = body.image;
    const mediaType = body.mediaType;
    const altStyle = body.altStyle;
    if (!image || !mediaType) return res.status(400).json({ error: 'Missing image data' });

    const prompt = (STYLES[altStyle] || STYLES.concise) + ' Return only the alt text itself.';

    const apiRes = await fetch('https://api.ashna.ai/v1/api/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.ASHNA_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'glm-5.3-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + image } }
            ]
          }
        ]
      })
    });
    if (!apiRes.ok) throw new Error('Upstream error ' + apiRes.status);

    const data = await apiRes.json();
    const choice = data.choices && data.choices[0];
    const alt = ((choice && choice.message && choice.message.content) || '').trim();
    if (!alt) throw new Error('Empty response');

    return res.status(200).json({ alt: alt, title: alt, caption: '' });
  } catch (err) {
    return res.status(500).json({ error: 'Alt text is temporarily unavailable. Please try again.' });
  }
};
