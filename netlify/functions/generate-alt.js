const https = require('https');

function hfRequest(token, model, imageBuffer, mediaType) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api-inference.huggingface.co',
      path: `/models/${model}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': mediaType,
        'Content-Length': imageBuffer.length,
      },
    };
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(imageBuffer);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) return { statusCode: 500, headers, body: JSON.stringify({ error: 'HF_TOKEN not configured' }) };

  try {
    const { image, mediaType } = JSON.parse(event.body);
    if (!image || !mediaType) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image data' }) };

    const imageBuffer = Buffer.from(image, 'base64');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const models = ['Salesforce/blip-image-captioning-large', 'Salesforce/blip-image-captioning-base'];

    let alt = '';
    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await sleep(attempt * 2000);
        const { status, body } = await hfRequest(hfToken, model, imageBuffer, mediaType);
        if (status === 503) continue;
        if (status !== 200) return { statusCode: status, headers, body: JSON.stringify({ error: 'HF error: ' + body }) };
        const data = JSON.parse(body);
        alt = Array.isArray(data) ? (data[0]?.generated_text || '') : (data.generated_text || '');
        if (alt) break;
      }
      if (alt) break;
    }

    if (!alt) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Model is loading, please try again in 20 seconds.' }) };

    alt = alt.charAt(0).toUpperCase() + alt.slice(1);
    const title = alt.length > 80 ? alt.slice(0, 77) + '...' : alt;

    return { statusCode: 200, headers, body: JSON.stringify({ alt, title, caption: '' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
