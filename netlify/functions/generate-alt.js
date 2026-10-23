exports.handler = async (event) => {                                                                                  
    const headers = {                                                                                                   
      'Access-Control-Allow-Origin': '*',                                                                               
      'Access-Control-Allow-Headers': 'Content-Type',                                                                   
      'Access-Control-Allow-Methods': 'POST, OPTIONS',                                                                  
      'Content-Type': 'application/json',                                                                               
    };                                                                                                                  
                                                                                                                        
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };                                  
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not       
  allowed' }) };                                                                                                        
                  
    try {                                                                                                               
      const { image, mediaType } = JSON.parse(event.body);
      if (!image || !mediaType) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image data' })
   };                                                                                                                   
                                                                                                                        
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
      return { statusCode: 200, headers, body: JSON.stringify({ alt, title: alt, caption: '' }) };                      
    } catch (err) {                                                                                                     
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };                                
    }                                                                                                                   
  };   
