// Street View Date Finder - Application Controller
import { extractTimestamp, parseInput } from './finder.js';

// DOM Elements
const urlInput = document.getElementById('urlInput');
const runBtn = document.getElementById('runBtn');
const pasteBtn = document.getElementById('pasteBtn');
const clearInputBtn = document.getElementById('clearInputBtn');
const progressCard = document.getElementById('progressCard');
const progressStepText = document.getElementById('progressStepText');
const progressPercent = document.getElementById('progressPercent');
const progressFill = document.getElementById('progressFill');
const logDrawer = document.getElementById('logDrawer');
const logTerminal = document.getElementById('logTerminal');
const toggleLogBtn = document.getElementById('toggleLogBtn');
const resultDiv = document.getElementById('result');
const historySection = document.getElementById('historySection');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const mobileNavToggle = document.getElementById('mobileNavToggle');
const siteNav = document.getElementById('siteNav');

// History Management
const HISTORY_STORAGE_KEY = 'svdf_recent_extractions_v2';

function getHistory() {
    try {
        const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

function saveHistoryItem(item) {
    try {
        let history = getHistory();
        // Remove duplicate if same panoId exists
        history = history.filter(h => h.panoId !== item.panoId);
        // Prepend new item
        history.unshift(item);
        // Keep max 8
        if (history.length > 8) history = history.slice(0, 8);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
        renderHistory();
    } catch (e) {
        console.warn('LocalStorage save failed:', e);
    }
}

function renderHistory() {
    if (!historyList || !historySection) return;
    const history = getHistory();
    if (history.length === 0) {
        historySection.style.display = 'none';
        return;
    }

    historySection.style.display = 'block';
    historyList.innerHTML = history.map(item => `
        <div class="history-item">
            <div class="history-item-left">
                <span class="history-time">${escapeHtml(item.timeStr || item.dateStr || 'Archived')}</span>
                <span class="history-pano">${escapeHtml(item.panoId)} (${item.lat.toFixed(4)}, ${item.lng.toFixed(4)})</span>
            </div>
            <button class="history-reload-btn" data-pano="${escapeHtml(item.panoId)}" title="Inspect this panorama again">Inspect</button>
        </div>
    `).join('');

    // Attach reload listeners
    historyList.querySelectorAll('.history-reload-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pano = btn.getAttribute('data-pano');
            if (pano) {
                urlInput.value = pano;
                clearInputBtn.style.display = 'block';
                runExtraction();
            }
        });
    });
}

function clearHistory() {
    try {
        localStorage.removeItem(HISTORY_STORAGE_KEY);
        renderHistory();
    } catch (e) {
        console.warn('History clear failed:', e);
    }
}

// Logging and Progress
let logBuffer = [];

function resetLogs() {
    logBuffer = [];
    if (logTerminal) logTerminal.textContent = '';
}

function appendLog(msg) {
    const timestamp = new Date().toISOString().substring(11, 19);
    const line = `[${timestamp}] ${msg}`;
    logBuffer.push(line);
    if (logTerminal) {
        logTerminal.textContent += `${line}\n`;
        logTerminal.scrollTop = logTerminal.scrollHeight;
    }
}

function updateProgress({ percent, stepText }) {
    if (!progressCard) return;
    progressCard.style.display = 'block';
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressStepText) progressStepText.textContent = stepText;
}

// Helpers
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function copyToClipboard(text, triggerBtn, successLabel = 'Copied!') {
    try {
        await navigator.clipboard.writeText(text);
        const originalText = triggerBtn.innerHTML;
        triggerBtn.innerHTML = `✓ ${successLabel}`;
        triggerBtn.style.borderColor = 'var(--accent-emerald)';
        triggerBtn.style.color = 'var(--accent-emerald)';
        setTimeout(() => {
            triggerBtn.innerHTML = originalText;
            triggerBtn.style.borderColor = '';
            triggerBtn.style.color = '';
        }, 1800);
    } catch (err) {
        console.warn('Clipboard write failed:', err);
    }
}

// Main Extraction Controller
async function runExtraction() {
    const val = (urlInput.value || '').trim();
    if (!val) {
        urlInput.focus();
        return;
    }

    // UI state
    runBtn.disabled = true;
    runBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin-icon">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        Analyzing...
    `;
    resultDiv.style.display = 'none';
    resultDiv.innerHTML = '';
    resetLogs();
    if (logDrawer) logDrawer.style.display = 'block';

    try {
        const result = await extractTimestamp(val, updateProgress, appendLog);

        if (progressCard) progressCard.style.display = 'none';
        resultDiv.style.display = 'block';

        if (result.isCeilingLimit) {
            // Ceiling limit fallback
            resultDiv.innerHTML = `
                <div class="result-card">
                    <div class="warning-fallback-box">
                        <div class="warning-fallback-title">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="8" x2="12" y2="12"/>
                                <line x1="12" y1="16" x2="12.01" y2="16"/>
                            </svg>
                            Exact Second Ceiling Limit Reached
                        </div>
                        <p>Google's backend returned imagery for this sector but hit its internal timestamp indexing ceiling. Second-level precision is unavailable for this specific camera frame.</p>
                        <div style="margin-top: 8px;">
                            <span style="color: var(--text-tertiary); font-size: 0.82rem; text-transform: uppercase;">Confirmed Capture Period:</span>
                            <div class="fallback-month-tag">${escapeHtml(result.fallbackMonth)} ${result.year}</div>
                        </div>
                    </div>

                    <div class="metrics-grid" style="margin-top: 1.25rem;">
                        <div class="metric-tile">
                            <span class="metric-label">Panorama ID</span>
                            <span class="metric-val">${escapeHtml(result.panoId)}</span>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Coordinates</span>
                            <span class="metric-val coord-value">${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}</span>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Camera Rig</span>
                            <span class="metric-val">${escapeHtml(result.cameraGen.gen)} (${escapeHtml(result.cameraGen.years)})</span>
                        </div>
                    </div>

                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.75rem;">
                        💡 <strong>OSINT Tip:</strong> Move one click down the road in Google Maps and re-test the new URL. Consecutive frames often index cleanly!
                    </div>
                </div>
            `;
        } else {
            // Full precision success!
            const mapsUrl = `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(result.panoId)}`;
            const osmUrl = `https://www.openstreetmap.org/?mlat=${result.lat}&mlon=${result.lng}#map=18/${result.lat}/${result.lng}`;
            const shareUrl = `${window.location.origin}/?pano=${encodeURIComponent(result.panoId)}`;

            const dossierText = `[Street View Image Capture Dossier]
Panorama ID: ${result.panoId}
Coordinates: ${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}
Location Time: ${result.localPanoTime}
UTC Timestamp: ${result.utcIso}
Unix Epoch: ${result.exactUnix}
Timezone: ${result.timezone}
Camera Generation: ${result.cameraGen.gen} (${result.cameraGen.years})
Solar Elevation: ${result.sunPosition.elevation}°
Solar Azimuth: ${result.sunPosition.azimuth}° ${result.sunPosition.azimuthCardinal}
Shadow Vector: Cast toward ${result.sunPosition.shadowDirection}° ${result.sunPosition.shadowCardinal}
Verified via: https://streetviewdate.com/?pano=${result.panoId}`;

            resultDiv.innerHTML = `
                <div class="result-card">
                    <div class="result-header-verified">
                        <div class="result-status-tag">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Exact Timestamp Verified
                        </div>
                        <div class="hero-timestamp timestamp-display">${escapeHtml(result.localPanoTime)}</div>
                        <div class="secondary-timestamp">Your Browser Time: <strong>${escapeHtml(result.yourLocalTime)}</strong></div>
                    </div>

                    <!-- Metrics Grid -->
                    <div class="metrics-grid">
                        <div class="metric-tile">
                            <span class="metric-label">UTC (ISO 8601)</span>
                            <span class="metric-val tabular-nums">${escapeHtml(result.utcIso)}</span>
                            <button class="metric-copy-action copy-utc-btn" data-copy="${escapeHtml(result.utcIso)}">Copy UTC</button>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Unix Epoch</span>
                            <span class="metric-val tabular-nums">${result.exactUnix}</span>
                            <button class="metric-copy-action copy-unix-btn" data-copy="${result.exactUnix}">Copy Epoch</button>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Pano ID</span>
                            <span class="metric-val" style="font-size: 0.8rem;">${escapeHtml(result.panoId)}</span>
                            <button class="metric-copy-action copy-pano-btn" data-copy="${escapeHtml(result.panoId)}">Copy ID</button>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Geographic Coordinates</span>
                            <span class="metric-val coord-value">${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}</span>
                            <div style="display: flex; gap: 8px; margin-top: 4px;">
                                <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="metric-copy-action" style="text-decoration: none;">Maps ↗</a>
                                <a href="${osmUrl}" target="_blank" rel="noopener noreferrer" class="metric-copy-action" style="text-decoration: none;">OSM ↗</a>
                            </div>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Timezone (IANA)</span>
                            <span class="metric-val" style="font-size: 0.85rem;">${escapeHtml(result.timezone)}</span>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Camera System</span>
                            <span class="metric-val">${escapeHtml(result.cameraGen.gen)}</span>
                            <span style="font-size: 0.72rem; color: var(--text-tertiary);">${escapeHtml(result.cameraGen.desc)}</span>
                        </div>
                    </div>

                    <!-- Solar & Shadow Dossier for OSINT / GeoGuessr -->
                    <div class="solar-card">
                        <div class="solar-header">
                            <span class="solar-title">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="5"/>
                                    <line x1="12" y1="1" x2="12" y2="3"/>
                                    <line x1="12" y1="21" x2="12" y2="23"/>
                                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                                    <line x1="1" y1="12" x2="3" y2="12"/>
                                    <line x1="21" y1="12" x2="23" y2="12"/>
                                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                                </svg>
                                Calculated Sun Position & Shadow Direction
                            </span>
                            <span style="font-size: 0.72rem; color: var(--text-tertiary);">NOAA Solar Equations</span>
                        </div>
                        <div class="solar-stats">
                            <div class="solar-stat-item">
                                <div class="solar-stat-name">Solar Altitude (Elevation)</div>
                                <div class="solar-stat-value tabular-nums">${result.sunPosition.elevation > 0 ? '+' : ''}${result.sunPosition.elevation}°</div>
                                <span style="font-size: 0.72rem; color: var(--text-tertiary);">${result.sunPosition.isDaylight ? 'Sun above horizon' : 'Dawn / Dusk or Night'}</span>
                            </div>
                            <div class="solar-stat-item">
                                <div class="solar-stat-name">Solar Azimuth (Sun Angle)</div>
                                <div class="solar-stat-value tabular-nums">${result.sunPosition.azimuth}° ${result.sunPosition.azimuthCardinal}</div>
                                <span style="font-size: 0.72rem; color: var(--text-tertiary);">Clockwise from North</span>
                            </div>
                            <div class="solar-stat-item">
                                <div class="solar-stat-name">Projected Ground Shadow</div>
                                <div class="solar-stat-value tabular-nums" style="color: var(--accent-cyan);">${result.sunPosition.shadowDirection}° ${result.sunPosition.shadowCardinal}</div>
                                <span style="font-size: 0.72rem; color: var(--text-tertiary);">Shadow fall direction</span>
                            </div>
                        </div>
                    </div>

                    <!-- Action Bar -->
                    <div class="result-toolbar">
                        <button class="btn-action copy-summary-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                            Copy OSINT Dossier
                        </button>
                        <button class="btn-action share-link-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="18" cy="5" r="3"/>
                                <circle cx="6" cy="12" r="3"/>
                                <circle cx="18" cy="19" r="3"/>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                            </svg>
                            Share Result Link
                        </button>
                        <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-action">
                            Open in Google Maps ↗
                        </a>
                    </div>
                </div>
            `;

            // Wire action buttons
            const copySummaryBtn = resultDiv.querySelector('.copy-summary-btn');
            if (copySummaryBtn) {
                copySummaryBtn.addEventListener('click', () => copyToClipboard(dossierText, copySummaryBtn, 'Dossier Copied!'));
            }

            const shareLinkBtn = resultDiv.querySelector('.share-link-btn');
            if (shareLinkBtn) {
                shareLinkBtn.addEventListener('click', () => copyToClipboard(shareUrl, shareLinkBtn, 'Link Copied!'));
            }

            resultDiv.querySelectorAll('.copy-utc-btn').forEach(b => {
                b.addEventListener('click', () => copyToClipboard(result.utcIso, b));
            });
            resultDiv.querySelectorAll('.copy-unix-btn').forEach(b => {
                b.addEventListener('click', () => copyToClipboard(String(result.exactUnix), b));
            });
            resultDiv.querySelectorAll('.copy-pano-btn').forEach(b => {
                b.addEventListener('click', () => copyToClipboard(result.panoId, b));
            });

            // Save to recent searches
            saveHistoryItem({
                panoId: result.panoId,
                timeStr: result.localPanoTime.split('at')[0].trim(),
                lat: result.lat,
                lng: result.lng,
                timestamp: Date.now()
            });
        }

    } catch (err) {
        if (progressCard) progressCard.style.display = 'none';
        resultDiv.style.display = 'block';
        appendLog(`ERROR: ${err.message}`);

        resultDiv.innerHTML = `
            <div class="result-card">
                <div class="error-alert-box">
                    <div class="error-alert-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        Extraction Error
                    </div>
                    <p>${escapeHtml(err.message)}</p>
                </div>
            </div>
        `;
    } finally {
        runBtn.disabled = false;
        runBtn.innerHTML = `Extract Time`;
    }
}

// Event Listeners
if (runBtn) {
    runBtn.addEventListener('click', runExtraction);
}

if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runExtraction();
        } else if (e.key === 'Escape') {
            urlInput.value = '';
            clearInputBtn.style.display = 'none';
        }
    });

    urlInput.addEventListener('input', () => {
        clearInputBtn.style.display = urlInput.value ? 'block' : 'none';
    });
}

if (clearInputBtn) {
    clearInputBtn.addEventListener('click', () => {
        urlInput.value = '';
        clearInputBtn.style.display = 'none';
        urlInput.focus();
    });
}

if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
        try {
            const clipText = await navigator.clipboard.readText();
            if (clipText) {
                urlInput.value = clipText.trim();
                clearInputBtn.style.display = 'block';
                runExtraction();
            }
        } catch (e) {
            urlInput.focus();
        }
    });
}

if (toggleLogBtn && logTerminal) {
    toggleLogBtn.addEventListener('click', () => {
        const isHidden = logTerminal.style.display === 'none';
        logTerminal.style.display = isHidden ? 'block' : 'none';
        toggleLogBtn.textContent = isHidden ? 'Hide Protocol Logs ▲' : 'View Protocol Logs ▼';
    });
}

// Sample Pill Listeners
document.querySelectorAll('.sample-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        const query = pill.getAttribute('data-query');
        if (query && urlInput) {
            urlInput.value = query;
            clearInputBtn.style.display = 'block';
            runExtraction();
        }
    });
});

// Clear History Button
if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', clearHistory);
}

// FAQ Accordion toggles
document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        if (item) {
            item.classList.toggle('open');
        }
    });
});

// Mobile Nav Toggle
if (mobileNavToggle && siteNav) {
    mobileNavToggle.addEventListener('click', () => {
        siteNav.classList.toggle('open');
    });
}

// Smooth scrolling for in-page anchors
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href');
        if (targetId && targetId !== '#') {
            const targetEl = document.querySelector(targetId);
            if (targetEl) {
                e.preventDefault();
                targetEl.scrollIntoView({ behavior: 'smooth' });
                if (siteNav && siteNav.classList.contains('open')) {
                    siteNav.classList.remove('open');
                }
            }
        }
    });
});

// Auto-run from URL parameters (e.g. ?pano=... or ?q=...)
window.addEventListener('DOMContentLoaded', () => {
    renderHistory();

    const params = new URLSearchParams(window.location.search);
    const panoParam = params.get('pano') || params.get('q') || params.get('url');
    if (panoParam && urlInput) {
        urlInput.value = decodeURIComponent(panoParam);
        if (clearInputBtn) clearInputBtn.style.display = 'block';
        runExtraction();
    }
});
