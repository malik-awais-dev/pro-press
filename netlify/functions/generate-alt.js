exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { image, mediaType } = JSON.parse(event.body);
    if (!image || !mediaType) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image data' }) };

    // Step 1: get pre-signed S3 URL from Tailwind
    const signRes = await fetch('https://www.tailwindapp.com/marketing/api/generate-temp-signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: mediaType }),
    });
    if (!signRes.ok) throw new Error('Tailwind sign URL failed: ' + await signRes.text());
    const signData = await signRes.json();
    if (!signData) throw new Error('Empty response from Tailwind sign URL');
    // Return raw response so we can see the actual field names
    return { statusCode: 200, headers, body: JSON.stringify({ debug: signData }) };

    // Step 2: PUT image to S3
    const imageBuffer = Buffer.from(image, 'base64');
    const s3Res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mediaType },
      body: imageBuffer,
    });
    if (!s3Res.ok) throw new Error('S3 upload failed: ' + await s3Res.text());

    // Step 3: generate alt text
    const genRes = await fetch('https://www.tailwindapp.com/marketing/tools/image-alt-text-generator/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl }),
    });
    if (!genRes.ok) throw new Error('Tailwind generate failed: ' + await genRes.text());
    const data = await genRes.json();

    const alt = data.altText || '';
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ alt, title: alt, caption: '' }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
