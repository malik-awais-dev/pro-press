module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, mediaType } = req.body;
    if (!image || !mediaType) return res.status(400).json({ error: 'Missing image data' });

    const signRes = await fetch('https://www.tailwindapp.com/marketing/api/generate-temp-signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: mediaType }),
    });
    if (!signRes.ok) throw new Error('Tailwind sign URL failed: ' + await signRes.text());
    const { signedUrl, cdnUrl } = await signRes.json();

    const imageBuffer = Buffer.from(image, 'base64');
    const s3Res = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mediaType, 'x-amz-acl': 'public-read', 'x-amz-storage-class': 'STANDARD' },
      body: imageBuffer,
    });
    if (!s3Res.ok) throw new Error('S3 upload failed: ' + await s3Res.text());

    const genRes = await fetch('https://www.tailwindapp.com/marketing/tools/image-alt-text-generator/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: cdnUrl }),
    });
    if (!genRes.ok) throw new Error('Tailwind generate failed: ' + await genRes.text());
    const data = await genRes.json();

    const alt = data.altText || '';
    return res.status(200).json({ alt, title: alt, caption: '' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
