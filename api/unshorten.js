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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        let resolvedUrl = response.url;

        // 1. Unwrap Google EU consent redirect if present
        if (resolvedUrl.includes('consent.google.com') && resolvedUrl.includes('continue=')) {
            try {
                const u = new URL(resolvedUrl);
                const cont = u.searchParams.get('continue');
                if (cont) resolvedUrl = decodeURIComponent(cont);
            } catch (e) {}
        }

        // 2. Check if resolved URL has coordinates directly
        let coordMatch = resolvedUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
                         resolvedUrl.match(/[?&](?:q|ll|center|sll)=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/i);

        if (coordMatch) {
            const lat = parseFloat(coordMatch[1]);
            const lng = parseFloat(coordMatch[2]);
            return res.status(200).json({
                originalUrl: target,
                resolvedUrl,
                lat,
                lng
            });
        }

        // 3. Check for 22-character Pano ID in URL
        let panoMatch = resolvedUrl.match(/(?:!1s|pano=|panoid=)([a-zA-Z0-9_\-]{22})/);
        if (panoMatch) {
            return res.status(200).json({
                originalUrl: target,
                resolvedUrl,
                panoId: panoMatch[1]
            });
        }

        // 4. For "Dropped pin" links, extract coordinates from HTML (staticmap / center / state)
        const html = await response.text();
        const centerMatch = html.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/i) ||
                            html.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/i) ||
                            html.match(/staticmap\?[^"']*center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/i);

        if (centerMatch) {
            const lat = parseFloat(centerMatch[1]);
            const lng = parseFloat(centerMatch[2]);
            return res.status(200).json({
                originalUrl: target,
                resolvedUrl: `https://www.google.com/maps/@${lat},${lng},17z`,
                lat,
                lng
            });
        }

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
