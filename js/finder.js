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
 * Parse input string into recognized format
 */
export function parseInput(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    const input = decodeURIComponent(rawInput.trim());

    // 1. Mobile short links
    if (input.includes('goo.gl') || input.includes('maps.app.goo.gl')) {
        return {
            type: 'SHORT_MOBILE_URL',
            error: 'Google blocks short mobile links (like maps.app.goo.gl) from being queried directly. To use this image, open the link in your browser first and copy the full, expanded address bar URL.'
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

    // 4. Coordinates in standard format: lat, lng or @lat,lng
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
        error: 'Could not find a valid Street View link, Pano ID, or coordinates. Please paste a full desktop Google Maps URL, a 22-character Pano ID, or decimal coordinates (like 40.7580, -73.9855).'
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
    const parsed = parseInput(input);
    if (!parsed) throw new Error("Please enter a link, Pano ID, or coordinates.");
    if (parsed.error) throw new Error(parsed.error);

    onLog(`Checking input format...`);
    onProgress({ percent: 5, stepText: "Checking link..." });

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
        onLog(`Searching for nearest Street View image to ${parsed.lat}, ${parsed.lng}...`);
        onProgress({ percent: 12, stepText: "Finding nearest street view image..." });

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
        onProgress({ percent: 12, stepText: "Fetching image details from Google..." });

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
            throw new Error("Couldn't find this panorama on Google's servers. It might be private, taken down, or a user-uploaded photosphere.");
        }

        baseDate = initResp.metadata.date.date;

        try {
            lat = initResp.metadata.information[0].location.location.lat;
            lng = initResp.metadata.information[0].location.location.lng;
        } catch (e) {
            throw new Error("Could not find the coordinates needed to calculate the time.");
        }
    }

    onLog(`Confirmed capture period: ${baseDate.year}-${String(baseDate.month).padStart(2, '0')}`);
    onLog(`Location: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

    baseRequestContents.location.center.lat = lat;
    baseRequestContents.location.center.lng = lng;
    baseRequestContents.location.radius = 30;

    let minTimestamp = Math.round(new Date(baseDate.year, baseDate.month - 1, 0).getTime() / 1000);
    let maxTimestamp = Math.round(new Date(baseDate.year, baseDate.month, 2).getTime() / 1000);
    const ceilingLimit = maxTimestamp;

    let pingReq = pbfish.create("SingleImageSearchRequest");
    pingReq.value = baseRequestContents;

    onLog(`Narrowing down the exact capture second...`);
    let steps = 0;
    const maxEstimatedSteps = 22;

    while (maxTimestamp - minTimestamp > 2) {
        steps++;
        const midTimestamp = Math.round((maxTimestamp + minTimestamp) / 2);
        const percent = Math.min(92, 15 + Math.round((steps / maxEstimatedSteps) * 75));

        onProgress({
            percent,
            stepText: `Searching time window (Step ${steps} of ~22)...`
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
            onLog(`Step ${steps}: Photo taken in first half`);
        } else {
            minTimestamp = midTimestamp;
            onLog(`Step ${steps}: Photo taken in second half`);
        }
    }

    onProgress({ percent: 96, stepText: "Calculating local timezone..." });

    const exactUnix = Math.round((minTimestamp + maxTimestamp) / 2);
    const exactDate = new Date(exactUnix * 1000);
    const cameraGen = estimateCameraGeneration(baseDate.year);

    // Fallback if exact timestamp ceiling was hit
    if (exactUnix >= ceilingLimit - 10) {
        onLog(`Exact second unavailable. Returning confirmed month.`);
        const fallbackMonth = MONTH_NAMES[baseDate.month - 1];

        onProgress({ percent: 100, stepText: "Done (Month-level precision)" });

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
        lat,
        lng,
        panoId,
        cameraGen,
        stepsCount: steps
    };
}
