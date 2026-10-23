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

  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'HF_TOKEN not configured' }) };
  }

  try {
    const { image, mediaType } = JSON.parse(event.body);

    if (!image || !mediaType) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image data' }) };
    }

    const imageBuffer = Buffer.from(image, 'base64');

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Try BLIP large first, fall back to BLIP base
    const models = [
      'Salesforce/blip-image-captioning-large',
      'Salesforce/blip-image-captioning-base',
    ];

    let alt = '';
    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await sleep(attempt * 2000);

        const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': mediaType,
          },
          body: imageBuffer,
        });

        if (res.status === 503) continue; // model loading, retry

        if (!res.ok) {
          const err = await res.text();
          return { statusCode: res.status, headers, body: JSON.stringify({ error: 'HF error: ' + err }) };
        }

        const data = await res.json();
        alt = Array.isArray(data) ? (data[0]?.generated_text || '') : (data.generated_text || '');
        if (alt) break;
      }
      if (alt) break;
    }

    if (!alt) {
      return { statusCode: 503, headers, body: JSON.stringify({ error: 'Model is loading, please try again in 20 seconds.' }) };
    }

    // Capitalise first letter
    alt = alt.charAt(0).toUpperCase() + alt.slice(1);

    const title = alt.length > 80 ? alt.slice(0, 77) + '...' : alt;
    const html = `<img src="image.jpg" alt="${alt.replace(/"/g, '&quot;')}" title="${title.replace(/"/g, '&quot;')}" />`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ alt, title, caption: '', html }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
