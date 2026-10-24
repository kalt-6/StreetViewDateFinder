// Core Street View Date Finder Engine
import Pbfish from 'https://esm.sh/@gmaps-tools/pbfish';
import tz from 'https://esm.sh/@photostructure/tz-lookup';
import { SingleImageSearch } from './schema.js';
import { calculateSunPosition } from './sun.js';

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
 * Parse input string into recognized format
 */
export function parseInput(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    const input = decodeURIComponent(rawInput.trim());

    // 1. Mobile short links
    if (input.includes('goo.gl') || input.includes('maps.app.goo.gl')) {
        return {
            type: 'SHORT_MOBILE_URL',
            error: 'Google blocks automated extraction from short mobile sharing links (goo.gl / maps.app.goo.gl). Please open the link in a browser, wait for the full page to load, and paste the expanded URL or coordinates.'
        };
    }

    // 2. Direct 22-character Pano ID
    if (/^[a-zA-Z0-9_\-]{22}$/.test(input)) {
        return { type: 'PANO_ID', panoId: input };
    }

    // 3. Extract pano ID from standard Google Maps URL
    // Matches !1s<22-char-id> or pano=<22-char-id> or panoid=<22-char-id>
    const panoMatch = input.match(/(?:!1s|pano=|panoid=)([a-zA-Z0-9_\-]{22})/);
    if (panoMatch) {
        return { type: 'PANO_ID', panoId: panoMatch[1] };
    }

    // 4. Coordinates in standard format: lat, lng or @lat,lng
    // Matches "@40.7580033,-73.9855681" or "40.7580033, -73.9855681"
    const coordMatch = input.match(/@?(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
    if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            return { type: 'COORDINATES', lat, lng };
        }
    }

    return {
        type: 'INVALID',
        error: 'Could not extract a valid Street View Pano ID or geographic coordinates. Make sure you paste a full desktop Google Maps URL, a 22-character Pano ID, or valid decimal coordinates (e.g. 40.7580, -73.9855).'
    };
}

/**
 * Estimate camera generation based on capture year and parameters
 */
export function estimateCameraGeneration(year) {
    if (year <= 2008) {
        return { gen: 'Gen 1', years: '2007–2008', desc: 'Low resolution, blown-out white skies, prominent stitch lines' };
    } else if (year === 2009) {
        return { gen: 'Gen 2', years: '2008–2009', desc: 'Early high definition, subtle circular sun halo artifact' };
    } else if (year >= 2010 && year <= 2017) {
        return { gen: 'Gen 3', years: '2009–2017', desc: '15-lens rosette (75 MP), crisp blue skies, clear road signage' };
    } else {
        return { gen: 'Gen 4 / Next-Gen', years: '2017–Present', desc: '140 MP high-dynamic range, vivid color grading, LiDAR-assisted' };
    }
}

/**
 * Month names for fallback
 */
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

/**
 * Execute SingleImageSearch extraction
 * 
 * @param {string} input - URL, Pano ID, or Coordinates
 * @param {Function} onProgress - Callback for step/progress updates: ({ percent, stepText, stepNum, totalSteps })
 * @param {Function} onLog - Callback for detailed protocol log messages: (message)
 * @returns {Promise<Object>}
 */
export async function extractTimestamp(input, onProgress = () => {}, onLog = () => {}) {
    const parsed = parseInput(input);
    if (!parsed) throw new Error("No input provided.");
    if (parsed.error) throw new Error(parsed.error);

    onLog(`Initializing Street View Protocol Engine...`);
    onProgress({ percent: 5, stepText: "Parsing input format...", stepNum: 1, totalSteps: 24 });

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
        onLog(`Searching closest official Street View panorama near coordinates ${parsed.lat}, ${parsed.lng}...`);
        onProgress({ percent: 12, stepText: "Locating nearest panorama to coordinates...", stepNum: 2, totalSteps: 24 });

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
            throw new Error(`No official Google Street View imagery found within 50 meters of coordinates ${parsed.lat}, ${parsed.lng}. Try adjusting coordinates closer to a mapped road.`);
        }

        panoId = coordResp.metadata.pano.id;
        baseDate = coordResp.metadata.date.date;
        lat = coordResp.metadata.information[0].location.location.lat;
        lng = coordResp.metadata.information[0].location.location.lng;

        onLog(`Resolved Pano ID from coordinates: ${panoId}`);
    } else {
        // Case B: Direct Pano ID
        panoId = parsed.panoId;
        onLog(`Targeting Panorama ID: ${panoId}`);
        onProgress({ percent: 12, stepText: "Fetching initial panorama metadata...", stepNum: 2, totalSteps: 24 });

        let initReq = pbfish.create("SingleImageSearchRequest");
        initReq.value = {
            ...baseRequestContents,
            imageKey: { frontend: "OFFICIAL", id: panoId }
        };

        const initialRes = await fetch(ENDPOINT, {
            method: "POST", headers: HEADERS, body: JSON.stringify(initReq.toArray())
        }).then(r => r.json());

        const initResp = silencePbfishWarnings(() => {
            const resp = pbfish.create("SingleImageSearchResponse");
            resp.fromArray(initialRes);
            return resp;
        });

        if (initResp.status.code !== "OK" || !initResp.metadata) {
            throw new Error("Could not find this panorama on Google's servers. The image may be private, retired, or an unofficial user photosphere.");
        }

        baseDate = initResp.metadata.date.date;

        try {
            lat = initResp.metadata.information[0].location.location.lat;
            lng = initResp.metadata.information[0].location.location.lng;
        } catch (e) {
            throw new Error("Could not extract geographic coordinates required for timestamp convergence.");
        }
    }

    onLog(`Baseline capture window identified: ${baseDate.year}-${String(baseDate.month).padStart(2, '0')}`);
    onLog(`Geographic coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

    baseRequestContents.location.center.lat = lat;
    baseRequestContents.location.center.lng = lng;
    baseRequestContents.location.radius = 30;

    // Time boundaries (months in JS are 0-indexed)
    let minTimestamp = Math.round(new Date(baseDate.year, baseDate.month - 1, 0).getTime() / 1000);
    let maxTimestamp = Math.round(new Date(baseDate.year, baseDate.month, 2).getTime() / 1000);
    const ceilingLimit = maxTimestamp;

    let pingReq = pbfish.create("SingleImageSearchRequest");
    pingReq.value = baseRequestContents;

    onLog(`Commencing binary search convergence algorithm...`);
    let steps = 0;
    const maxEstimatedSteps = 22;

    while (maxTimestamp - minTimestamp > 2) {
        steps++;
        const midTimestamp = Math.round((maxTimestamp + minTimestamp) / 2);
        const percent = Math.min(92, 15 + Math.round((steps / maxEstimatedSteps) * 75));

        onProgress({
            percent,
            stepText: `Binary search step ${steps} of ~22 (window: ${Math.round(maxTimestamp - minTimestamp)}s)...`,
            stepNum: 2 + steps,
            totalSteps: 24
        });

        pingReq.value = {
            ...baseRequestContents,
            queryOptions: {
                ...baseRequestContents.queryOptions,
                filterOptions: {
                    photoAge: { startSeconds: minTimestamp, endSeconds: midTimestamp }
                }
            }
        };

        const pingRes = await fetch(ENDPOINT, {
            method: "POST", headers: HEADERS, body: JSON.stringify(pingReq.toArray())
        }).then(r => r.json());

        const pingResponse = silencePbfishWarnings(() => {
            const resp = pbfish.create("SingleImageSearchResponse");
            resp.fromArray(pingRes);
            return resp;
        });

        const hasImage = pingResponse.status.code === "OK";

        if (hasImage) {
            maxTimestamp = midTimestamp;
            onLog(`Ping ${steps}: Matched in lower half [${minTimestamp} - ${midTimestamp}]`);
        } else {
            minTimestamp = midTimestamp;
            onLog(`Ping ${steps}: Matched in upper half [${midTimestamp} - ${maxTimestamp}]`);
        }
    }

    onProgress({ percent: 96, stepText: "Calculating timezone and solar angles...", stepNum: 23, totalSteps: 24 });

    const exactUnix = Math.round((minTimestamp + maxTimestamp) / 2);
    const exactDate = new Date(exactUnix * 1000);
    const cameraGen = estimateCameraGeneration(baseDate.year);

    // Fallback if exact timestamp ceiling was hit
    if (exactUnix >= ceilingLimit - 10) {
        onLog(`Convergence hit Google's ceiling boundary. Exact second unavailable.`);
        const fallbackMonth = MONTH_NAMES[baseDate.month - 1];

        onProgress({ percent: 100, stepText: "Completed (Month-level precision)", stepNum: 24, totalSteps: 24 });

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
            stepsCount: steps,
            logsCount: steps
        };
    }

    onLog(`Pinpointed exact capture second in ${steps} requests!`);

    // Timezone lookup via lat/lng
    let timezone = 'UTC';
    try {
        timezone = tz(lat, lng) || 'UTC';
    } catch (e) {
        onLog(`Timezone lookup fallback to UTC: ${e.message}`);
    }

    // Solar angle calculations
    const sunPosition = calculateSunPosition(exactDate, lat, lng);

    // Date formatting
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

    onProgress({ percent: 100, stepText: "Completed successfully", stepNum: 24, totalSteps: 24 });

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
        lat,
        lng,
        panoId,
        cameraGen,
        sunPosition,
        stepsCount: steps
    };
}
