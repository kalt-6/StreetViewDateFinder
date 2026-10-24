// Core Street View Date Finder Engine
import Pbfish from 'https://esm.sh/@gmaps-tools/pbfish';
import tz from 'https://esm.sh/@photostructure/tz-lookup';
import { SingleImageSearch } from './schema.js';

const ENDPOINT = "https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch";
const HEADERS = { "Content-Type": "application/json+protobuf" };

/**
 * Filter out noisy protobuf index warnings from pbfish
 */
function silencePbfishWarnings(callback) {
    const origWarn = console.warn;
    console.warn = (...args) => {
        if (typeof args[0] === 'string' && args[0].includes('Invalid index') && args[0].includes('skipping')) {
            return;
        }
        origWarn.apply(console, args);
    };
    try {
        return callback();
    } finally {
        console.warn = origWarn;
    }
}

/**
 * Check if input is a shortened Google Maps mobile link
 */
export function isMobileShortLink(str) {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    return /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(trimmed);
}

/**
 * Unwrap Google EU cookie consent redirect if present
 */
function unwrapConsentRedirect(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.includes('consent.google.com') && url.includes('continue=')) {
        try {
            const u = new URL(url);
            const cont = u.searchParams.get('continue');
            if (cont) return decodeURIComponent(cont);
        } catch (e) {}
    }
    return url;
}

/**
 * Check if a URL contains identifiable Street View coordinate or Pano ID data
 */
function containsUsableLocationData(url) {
    if (!url || typeof url !== 'string') return false;
    // Standard coordinates: @lat,lng or lat, lng
    if (/@-?\d+\.\d+,\s*-?\d+\.\d+/.test(url)) return true;
    // Query parameters: q=lat,lng or ll=lat,lng or center=lat,lng
    if (/[?&](?:q|ll|center|sll)=-?\d+\.\d+(?:%2C|,)-?\d+\.\d+/i.test(url)) return true;
    // Pano ID in URL
    if (/(?:!1s|pano=|panoid=)[a-zA-Z0-9_\-]{22}/.test(url)) return true;
    return false;
}

/**
 * Attempt to unshorten a mobile Google Maps URL.
 * Checks local edge proxy route first, then public resolver, and falls back gracefully.
 */
export async function unshortenMobileUrl(shortUrl, onLog = () => {}) {
    let cleanUrl = shortUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = 'https://' + cleanUrl;
    }

    onLog(`Attempting to expand mobile short link...`);

    // Method 1: Check local serverless edge proxy (if hosted on Vercel/Netlify/Node)
    try {
        const localApi = `/api/unshorten?url=${encodeURIComponent(cleanUrl)}`;
        const localRes = await fetch(localApi);
        if (localRes.ok) {
            const data = await localRes.json();
            if (data.lat !== undefined && data.lng !== undefined) {
                onLog(`Extracted coordinates from pin: ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`);
                return `${data.lat}, ${data.lng}`;
            }
            if (data.resolvedUrl && data.resolvedUrl !== cleanUrl) {
                const unwrapped = unwrapConsentRedirect(data.resolvedUrl);
                if (containsUsableLocationData(unwrapped)) {
                    onLog(`Expanded via edge API`);
                    return unwrapped;
                }
            }
        }
    } catch (e) {
        // Local API route not running in static-only environment
    }

    // Method 2: Public unshortener API with strict timeout
    try {
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 3500);
        const res = await fetch(`https://unshorten.me/json/${encodeURIComponent(cleanUrl)}`, {
            signal: ctrl.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.resolved_url) {
                const unwrapped = unwrapConsentRedirect(data.resolved_url);
                if (containsUsableLocationData(unwrapped)) {
                    onLog(`Expanded via resolver`);
                    return unwrapped;
                } else {
                    onLog(`Dropped pin requires browser opening to resolve coordinates`);
                    return null;
                }
            }
        }
    } catch (e) {
        onLog(`Automatic unshortener unavailable`);
    }

    return null;
}

/**
 * Parse input string into recognized format
 */
export function parseInput(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    let input = decodeURIComponent(rawInput.trim());

    // Unwrap consent.google.com redirect if passed directly
    input = unwrapConsentRedirect(input);

    // 1. Mobile short links
    if (isMobileShortLink(input)) {
        return {
            type: 'SHORT_MOBILE_URL',
            url: input
        };
    }

    // 2. Direct 22-character Pano ID
    if (/^[a-zA-Z0-9_\-]{22}$/.test(input)) {
        return { type: 'PANO_ID', panoId: input };
    }

    // 3. Extract pano ID from standard Google Maps URL
    const panoMatch = input.match(/(?:!1s|pano=|panoid=)([a-zA-Z0-9_\-]{22})/);
    if (panoMatch) {
        return { type: 'PANO_ID', panoId: panoMatch[1] };
    }

    // 4. Coordinates in standard format: lat, lng or @lat,lng or ?q=lat,lng or center=lat,lng or ll=lat,lng
    const coordMatch = input.match(/@?(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/) ||
                       input.match(/[?&](?:q|ll|center|sll)=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/i);
    if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            return { type: 'COORDINATES', lat, lng };
        }
    }

    return {
        type: 'INVALID',
        error: 'Could not find a valid Street View link, Pano ID, or coordinates. Please paste a desktop Google Maps link, a 22-character Pano ID, or coordinates (like 40.7580, -73.9855).'
    };
}

/**
 * Estimate camera generation based on capture year
 */
export function estimateCameraGeneration(year) {
    if (year <= 2008) {
        return { gen: 'Gen 1', years: '2007–2008', desc: 'Low resolution, washed-out skies, rough stitching' };
    } else if (year === 2009) {
        return { gen: 'Gen 2', years: '2008–2009', desc: 'Early HD with purple halo artifact around the sun' };
    } else if (year >= 2010 && year <= 2017) {
        return { gen: 'Gen 3', years: '2009–2017', desc: '15-lens rosette (75 MP), crisp blue skies, clear signs' };
    } else {
        return { gen: 'Gen 4', years: '2017–Present', desc: 'Ultra-clear 140 MP imagery, vivid colors, smooth depth' };
    }
}

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

/**
 * Execute SingleImageSearch extraction
 */
export async function extractTimestamp(input, onProgress = () => {}, onLog = () => {}) {
    let targetInput = (input || '').trim();
    if (!targetInput) throw new Error("Please enter a link, Pano ID, or coordinates.");

    const isShortMobile = isMobileShortLink(targetInput);
    let originalMobileUrl = targetInput;
    if (isShortMobile) {
        if (!originalMobileUrl.startsWith('http://') && !originalMobileUrl.startsWith('https://')) {
            originalMobileUrl = 'https://' + originalMobileUrl;
        }

        onLog(`Mobile short link detected: ${targetInput}`);
        onProgress({ percent: 5, stepText: "Expanding mobile link..." });

        const expanded = await unshortenMobileUrl(targetInput, onLog);
        if (expanded) {
            targetInput = expanded;
            onLog(`Successfully expanded mobile link`);
        } else {
            const mobileErr = new Error(`Mobile short link requires browser opening`);
            mobileErr.isMobileLink = true;
            mobileErr.originalUrl = originalMobileUrl;
            throw mobileErr;
        }
    }

    const parsed = parseInput(targetInput);
    if (!parsed || parsed.type === 'INVALID' || parsed.error) {
        if (isShortMobile) {
            const mobileErr = new Error(`Mobile short link requires browser opening`);
            mobileErr.isMobileLink = true;
            mobileErr.originalUrl = originalMobileUrl;
            throw mobileErr;
        }
        throw new Error(parsed?.error || "Could not find a valid Street View link, Pano ID, or coordinates. Please paste a desktop Google Maps link, a 22-character Pano ID, or coordinates (like 40.7580, -73.9855).");
    }

    onLog(`Checking input format...`);
    onProgress({ percent: 8, stepText: "Connecting to Google..." });

    const pbfish = new Pbfish(SingleImageSearch);

    let panoId = null;
    let lat = 0;
    let lng = 0;
    let baseDate = null;

    const baseRequestContents = {
        context: { productId: "apiv3" },
        location: { center: { lat: 0, lng: 0 }, radius: 30 },
        queryOptions: {
            clientCapabilities: {
                renderStrategy: [{ frontend: "OFFICIAL", tiled: true, imageFormat: "OFFICIAL_FORMAT" }]
            },
            rankingOptions: { rankingStrategy: "CLOSEST" }
        },
        responseSpecification: { component: ["INCLUDE_DESCRIPTION", "INCLUDE_LINKED_PANORAMAS"] }
    };

    // Case A: Query by coordinates
    if (parsed.type === 'COORDINATES') {
        onLog(`Searching for nearest Street View image to ${parsed.lat.toFixed(6)}, ${parsed.lng.toFixed(6)}...`);
        onProgress({ percent: 15, stepText: "Finding nearest street view image..." });

        baseRequestContents.location.center.lat = parsed.lat;
        baseRequestContents.location.center.lng = parsed.lng;
        baseRequestContents.location.radius = 50;

        let coordReq = pbfish.create("SingleImageSearchRequest");
        coordReq.value = baseRequestContents;

        const coordRes = await fetch(ENDPOINT, {
            method: "POST", headers: HEADERS, body: JSON.stringify(coordReq.toArray())
        }).then(r => r.json());

        const coordResp = silencePbfishWarnings(() => {
            const resp = pbfish.create("SingleImageSearchResponse");
            resp.fromArray(coordRes);
            return resp;
        });

        if (coordResp.status.code !== "OK" || !coordResp.metadata) {
            throw new Error(`Couldn't find any official Street View imagery near ${parsed.lat}, ${parsed.lng}. Try moving closer to a mapped road.`);
        }

        panoId = coordResp.metadata.pano.id;
        baseDate = coordResp.metadata.date.date;
        lat = coordResp.metadata.information[0].location.location.lat;
        lng = coordResp.metadata.information[0].location.location.lng;

        onLog(`Found panorama: ${panoId}`);
    } else {
        // Case B: Direct Pano ID
        panoId = parsed.panoId;
        onLog(`Looking up panorama ID: ${panoId}`);
        onProgress({ percent: 15, stepText: "Fetching image details from Google..." });

        let initReq = pbfish.create("SingleImageSearchRequest");
        initReq.value = {
            ...baseRequestContents,
            imageKey: { frontend: "OFFICIAL", id: panoId }
        };

        const initialRes = await fetch(ENDPOINT, {
            method: "POST", headers: HEADERS, body: JSON.stringify(initReq.toArray())
        }).then(r => r.json());

        const initialResp = silencePbfishWarnings(() => {
            const resp = pbfish.create("SingleImageSearchResponse");
            resp.fromArray(initialRes);
            return resp;
        });

        if (initialResp.status.code !== "OK" || !initialResp.metadata) {
            throw new Error(`Google could not find panorama ID "${panoId}". The image may be private, removed, or a third-party upload.`);
        }

        baseDate = initialResp.metadata.date.date;
        lat = initialResp.metadata.information[0].location.location.lat;
        lng = initialResp.metadata.information[0].location.location.lng;
    }

    const fallbackMonth = MONTH_NAMES[baseDate.month - 1] || 'Unknown';
    onLog(`Confirmed capture period: ${fallbackMonth} ${baseDate.year}`);

    // Set search window based on confirmed month & year
    let minTimestamp = Date.UTC(baseDate.year, baseDate.month - 1, 1, 0, 0, 0) / 1000;
    let maxTimestamp = Date.UTC(baseDate.year, baseDate.month, 1, 0, 0, 0) / 1000;

    let searchReq = pbfish.create("SingleImageSearchRequest");
    searchReq.value = {
        ...baseRequestContents,
        imageKey: { frontend: "OFFICIAL", id: panoId },
        queryOptions: {
            ...baseRequestContents.queryOptions,
            filter: { photoAge: { minTimestamp: 0, maxTimestamp: 0 } }
        }
    };

    onLog(`Starting binary search for the exact second...`);
    let steps = 0;
    const maxSteps = 28;

    while (maxTimestamp - minTimestamp > 1) {
        steps++;
        let midTimestamp = Math.floor((minTimestamp + maxTimestamp) / 2);
        searchReq.value.queryOptions.filter.photoAge.minTimestamp = minTimestamp;
        searchReq.value.queryOptions.filter.photoAge.maxTimestamp = midTimestamp;

        const progressPercent = Math.min(20 + Math.round((steps / 22) * 75), 95);
        onProgress({ 
            percent: progressPercent, 
            stepText: `Splitting time window (step ${steps})...` 
        });

        const res = await fetch(ENDPOINT, {
            method: "POST", headers: HEADERS, body: JSON.stringify(searchReq.toArray())
        }).then(r => r.json());

        const resp = silencePbfishWarnings(() => {
            const p = pbfish.create("SingleImageSearchResponse");
            p.fromArray(res);
            return p;
        });

        if (resp.status.code === "OK") {
            maxTimestamp = midTimestamp;
        } else {
            minTimestamp = midTimestamp;
        }

        if (steps >= maxSteps) {
            onLog(`Ceiling limit reached at step ${steps}.`);
            break;
        }
    }

    onProgress({ percent: 96, stepText: "Calculating local timezone..." });

    const exactUnix = Math.round((minTimestamp + maxTimestamp) / 2);
    const exactDate = new Date(exactUnix * 1000);
    const cameraGen = estimateCameraGeneration(baseDate.year);

    // Fallback if binary search didn't narrow down (e.g. pre-2015 imagery)
    if (maxTimestamp - minTimestamp > 60) {
        onLog(`Binary search could not resolve to the exact second.`);
        return {
            success: true,
            isExact: false,
            isCeilingLimit: true,
            fallbackMonth,
            year: baseDate.year,
            month: baseDate.month,
            panoId,
            lat,
            lng,
            cameraGen,
            stepsCount: steps
        };
    }

    onLog(`Found exact second in ${steps} steps!`);

    let timezone = 'UTC';
    try {
        timezone = tz(lat, lng) || 'UTC';
    } catch (e) {
        onLog(`Timezone fallback to UTC`);
    }

    let tzShort = '';
    let tzOffsetStr = '';
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'shortOffset'
        }).formatToParts(exactDate);
        const offsetPart = parts.find(p => p.type === 'timeZoneName');
        if (offsetPart) tzOffsetStr = offsetPart.value;
    } catch (e) {}

    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'short'
        }).formatToParts(exactDate);
        const tzPart = parts.find(p => p.type === 'timeZoneName');
        if (tzPart) tzShort = tzPart.value;
    } catch (e) {}

    const localTimeFormat = {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit',
        timeZoneName: 'short', timeZone: timezone
    };
    const viewerTimeFormat = {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit',
        timeZoneName: 'short'
    };

    const localPanoTime = new Intl.DateTimeFormat('en-US', localTimeFormat).format(exactDate);
    const yourLocalTime = new Intl.DateTimeFormat('en-US', viewerTimeFormat).format(exactDate);

    onProgress({ percent: 100, stepText: "Finished!" });

    return {
        success: true,
        isExact: true,
        isCeilingLimit: false,
        exactDate,
        exactUnix,
        utcIso: exactDate.toISOString(),
        localPanoTime,
        yourLocalTime,
        timezone,
        tzShort,
        tzOffsetStr,
        lat,
        lng,
        panoId,
        cameraGen,
        stepsCount: steps
    };
}
