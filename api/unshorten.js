/**
 * Serverless Edge / Node endpoint to unshorten mobile Google Maps links (e.g. maps.app.goo.gl).
 * Compatible with Vercel, Netlify, and standard Node server environments.
 */
export default async function handler(req, res) {
    // Set CORS headers so frontend can call this endpoint
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url } = req.query || {};
    if (!url) {
        return res.status(400).json({ error: 'Missing url query parameter' });
    }

    try {
        let target = decodeURIComponent(url);
        if (!target.startsWith('http://') && !target.startsWith('https://')) {
            target = 'https://' + target;
        }

        const response = await fetch(target, {
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        });

        const resolvedUrl = response.url;
        return res.status(200).json({
            originalUrl: target,
            resolvedUrl
        });
    } catch (err) {
        return res.status(500).json({
            error: err.message || 'Failed to expand short URL'
        });
    }
}
