// Import external dependencies via CDN
import Pbfish from 'https://esm.sh/@gmaps-tools/pbfish';
import tz from 'https://esm.sh/@photostructure/tz-lookup';

// Import our local schema dictionary
import { SingleImageSearch } from './schema.js';

const endpoint = "https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch";
const headers = { "Content-Type": "application/json+protobuf" };

// Grab UI elements
const runBtn = document.getElementById('runBtn');
const urlInput = document.getElementById('urlInput');
const logsDiv = document.getElementById('logs');
const resultDiv = document.getElementById('result');

function logInfo(msg) {
    logsDiv.innerHTML += `> ${msg}\n`;
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

function showError(msg) {
    logInfo(`ERROR: ${msg}`);
}

async function extractDate() {
    logsDiv.style.display = 'block';
    logsDiv.innerHTML = '';
    resultDiv.style.display = 'none';
    resultDiv.className = '';
    runBtn.disabled = true;

    const inputVal = decodeURIComponent(urlInput.value.trim());
    let panoId = null;

    // 1. Try to extract from a standard long URL or direct ID
    const urlMatch = inputVal.match(/(?:!1s|pano=)([a-zA-Z0-9_\-]{22})/);
    if (urlMatch) {
        panoId = urlMatch[1];
    } else if (inputVal.length === 22 && /^[a-zA-Z0-9_\-]{22}$/.test(inputVal)) {
        panoId = inputVal;
    }

    // 2. NEW: If it's a short link, use a proxy to expand it and find the hidden ID
    if (!panoId && inputVal.startsWith('http')) {
        logInfo("Mobile link detected. Unpacking URL via proxy...");
        try {
            const proxyUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent(inputVal);
            const proxyRes = await fetch(proxyUrl).then(r => r.json());
            
            const finalUrl = proxyRes.status.url || "";
            const html = proxyRes.contents || "";
            
            // Look for the ID in the newly expanded URL
            const proxyMatch = finalUrl.match(/(?:!1s|pano=)([a-zA-Z0-9_\-]{22})/);
            if (proxyMatch) {
                panoId = proxyMatch[1];
            } else {
                // Last resort: search the actual HTML code of the page for the hidden ID
                const htmlMatch = html.match(/(?:!1s|pano=|panoid=|"panoId":")([a-zA-Z0-9_\-]{22})/);
                if (htmlMatch) panoId = htmlMatch[1];
            }
        } catch (e) {
            logInfo("Proxy failed to unpack the mobile link.");
        }
    }

    // 3. If we STILL don't have an ID, throw an error
    if (!panoId) {
        showError("Could not extract a 22-character Pano ID. Make sure it's a valid Street View link.");
        runBtn.disabled = false;
        return;
    }

    logInfo(`Found Pano ID: ${panoId}`);
    logInfo(`Initializing Pbfish Translator...`);

    try {
        const pbfish = new Pbfish(SingleImageSearch);
        
        const baseRequestContents = {
            context: { productId: "apiv3" },
            location: { center: { lat: 0, lng: 0 }, radius: 30 },
            queryOptions: {
                clientCapabilities: { renderStrategy: [{ frontend: "OFFICIAL", tiled: true, imageFormat: "OFFICIAL_FORMAT" }] },
                rankingOptions: { rankingStrategy: "CLOSEST" }
            },
            responseSpecification: { component: ["INCLUDE_DESCRIPTION", "INCLUDE_LINKED_PANORAMAS"] }
        };

        let request = pbfish.create("SingleImageSearchRequest");
        request.value = {
            ...baseRequestContents,
            imageKey: { frontend: "OFFICIAL", id: panoId }
        };

        logInfo("Fetching baseline month and year from Google...");
        
        const initialRes = await fetch(endpoint, {
            method: "POST", headers, body: JSON.stringify(request.toArray())
        }).then(r => r.json());

        const response = pbfish.create("SingleImageSearchResponse");
        response.fromArray(initialRes);
        
        if (response.status.code !== "OK") throw new Error("Could not find this panorama on Google's servers.");
        
        const baseDate = response.metadata.date.date;
        logInfo(`Baseline found: ${baseDate.year}-${baseDate.month}`);

        let lat = 0;
        let lng = 0;
        try {
            lat = response.metadata.information[0].location.location.lat;
            lng = response.metadata.information[0].location.location.lng;
            logInfo(`Target Coordinates found: ${lat}, ${lng}`);
        } catch (e) {
            throw new Error("Could not extract geographic coordinates required to perform the search.");
        }

        baseRequestContents.location.center.lat = lat;
        baseRequestContents.location.center.lng = lng;

        let maxTimestamp = Math.round(new Date(baseDate.year, baseDate.month, 2).getTime() / 1000);
        let minTimestamp = Math.round(new Date(baseDate.year, baseDate.month - 1, 0).getTime() / 1000);
        
        const ceilingLimit = maxTimestamp;

        request = pbfish.create("SingleImageSearchRequest");
        request.value = baseRequestContents;

        logInfo("Starting binary search to pinpoint exact time...");
        let steps = 0;

        while (maxTimestamp - minTimestamp > 2) {
            steps++;
            const midTimestamp = Math.round((maxTimestamp + minTimestamp) / 2);

            request.value = {
                ...baseRequestContents,
                queryOptions: {
                    ...baseRequestContents.queryOptions,
                    filterOptions: {
                        photoAge: { startSeconds: minTimestamp, endSeconds: midTimestamp }
                    }
                }
            };

            const pingRes = await fetch(endpoint, {
                method: "POST", headers, body: JSON.stringify(request.toArray())
            }).then(r => r.json());

            const pingResponse = pbfish.create("SingleImageSearchResponse");
            pingResponse.fromArray(pingRes);
            const hasImage = pingResponse.status.code === "OK";

            if (hasImage) {
                maxTimestamp = midTimestamp;
                logInfo(`Step ${steps}: Image found in FIRST half.`);
            } else {
                minTimestamp = midTimestamp;
                logInfo(`Step ${steps}: Image found in SECOND half.`);
            }
        }

        const exactUnix = (minTimestamp + maxTimestamp) / 2;
        const exactDate = new Date(exactUnix * 1000);
        
        resultDiv.style.display = 'block';

        if (exactUnix >= ceilingLimit - 10) {
            logInfo(`Search hit the absolute ceiling limit. Exact time unavailable.`);
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const fallbackMonth = monthNames[baseDate.month - 1]; 
            
            resultDiv.innerHTML = `
                <div class="warning-box">
                    <div class="warning-title">Exact Time Unavailable</div>
                    <div style="margin-bottom: 6px;">Google's database rejected the exact time filter for this spot.</div>
                    Known Capture Month: <span class="success-time" style="color: var(--text-primary); display: inline-block; font-size: 1.1rem; margin-left: 4px;">${fallbackMonth} ${baseDate.year}</span>
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 10px;"><b>Tip:</b> Move one click down the street and try the new URL.</div>
                </div>
            `;
        } else {
            logInfo(`Success! Pinpointed in ${steps} requests.`);
            
            const imageTimezone = tz(lat, lng);
            const options = { 
                year: 'numeric', month: 'long', day: 'numeric', 
                hour: 'numeric', minute: '2-digit', second: '2-digit', 
                timeZoneName: 'short' 
            };

            const localPanoTime = new Intl.DateTimeFormat('en-US', { ...options, timeZone: imageTimezone }).format(exactDate);
            const yourLocalTime = new Intl.DateTimeFormat('en-US', options).format(exactDate);
            
            resultDiv.innerHTML = `
                <div class="success-box">
                    <div class="result-label">Location Local Time:</div>
                    <span class="success-time" style="color: var(--accent-secondary);">${localPanoTime}</span>
                    
                    <div class="result-label" style="margin-top: 8px;">Your Local Time:</div>
                    <span class="success-time" style="font-size: 1rem; color: var(--text-secondary);">${yourLocalTime}</span>
                </div>
            `;
        }
        
    } catch (err) {
        showError(err.message);
    }
    
    runBtn.disabled = false;
}

// Attach event listener
runBtn.addEventListener('click', extractDate);





