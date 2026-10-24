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
        history = history.filter(h => h.panoId !== item.panoId);
        history.unshift(item);
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
                <span class="history-time">${escapeHtml(item.timeStr || item.dateStr || 'Saved')}</span>
                <span class="history-pano">${escapeHtml(item.panoId)} (${item.lat.toFixed(4)}, ${item.lng.toFixed(4)})</span>
            </div>
            <button class="history-reload-btn" data-pano="${escapeHtml(item.panoId)}" title="Check this location again">Load</button>
        </div>
    `).join('');

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

// Logs and Progress
function resetLogs() {
    if (logTerminal) logTerminal.textContent = '';
}

function appendLog(msg) {
    const timestamp = new Date().toISOString().substring(11, 19);
    const line = `[${timestamp}] ${msg}`;
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

    runBtn.disabled = true;
    runBtn.innerHTML = `Searching...`;
    resultDiv.style.display = 'none';
    resultDiv.innerHTML = '';
    resetLogs();
    if (logDrawer) logDrawer.style.display = 'block';

    try {
        const result = await extractTimestamp(val, updateProgress, appendLog);

        if (progressCard) progressCard.style.display = 'none';
        resultDiv.style.display = 'block';

        if (result.isCeilingLimit) {
            resultDiv.innerHTML = `
                <div class="result-card">
                    <div class="warning-fallback-box">
                        <div class="warning-fallback-title">
                            Exact Second Not Available For This Frame
                        </div>
                        <p>Google's database couldn't narrow down this specific image to the exact second, but we confirmed the general capture period:</p>
                        <div style="margin-top: 8px;">
                            <span style="color: var(--text-tertiary); font-size: 0.82rem; text-transform: uppercase;">Confirmed Month & Year:</span>
                            <div class="fallback-month-tag">${escapeHtml(result.fallbackMonth)} ${result.year}</div>
                        </div>
                    </div>

                    <div class="metrics-grid" style="margin-top: 1.25rem;">
                        <div class="metric-tile">
                            <span class="metric-label">Pano ID</span>
                            <span class="metric-val">${escapeHtml(result.panoId)}</span>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Coordinates</span>
                            <span class="metric-val coord-value">${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}</span>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Camera Model</span>
                            <span class="metric-val">${escapeHtml(result.cameraGen.gen)} (${escapeHtml(result.cameraGen.years)})</span>
                        </div>
                    </div>

                    <div style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 0.85rem; line-height: 1.5;">
                        💡 <strong>Quick Tip:</strong> Click one spot forward or backward down the road in Google Maps and paste that new URL. Adjacent frames often have the exact second available!
                    </div>
                </div>
            `;
        } else {
            const mapsUrl = `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(result.panoId)}`;
            const osmUrl = `https://www.openstreetmap.org/?mlat=${result.lat}&mlon=${result.lng}#map=18/${result.lat}/${result.lng}`;
            const shareUrl = `${window.location.origin}/?pano=${encodeURIComponent(result.panoId)}`;

            const summaryText = `Street View Capture Details:
- Location Time: ${result.localPanoTime}
- UTC Time: ${result.utcIso}
- Unix Timestamp: ${result.exactUnix}
- Coordinates: ${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}
- Pano ID: ${result.panoId}
- Camera: ${result.cameraGen.gen} (${result.cameraGen.years})
- Link: https://streetviewdate.com/?pano=${result.panoId}`;

            resultDiv.innerHTML = `
                <div class="result-card">
                    <div class="result-header-verified">
                        <div class="result-status-tag">
                            Exact Timestamp Found
                        </div>
                        <div class="hero-timestamp timestamp-display">${escapeHtml(result.localPanoTime)}</div>
                        <div class="secondary-timestamp">Your local time: <strong>${escapeHtml(result.yourLocalTime)}</strong></div>
                    </div>

                    <!-- Metrics Grid -->
                    <div class="metrics-grid">
                        <div class="metric-tile">
                            <span class="metric-label">UTC (ISO 8601)</span>
                            <span class="metric-val tabular-nums">${escapeHtml(result.utcIso)}</span>
                            <button class="metric-copy-action copy-utc-btn" data-copy="${escapeHtml(result.utcIso)}">Copy</button>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Unix Timestamp</span>
                            <span class="metric-val tabular-nums">${result.exactUnix}</span>
                            <button class="metric-copy-action copy-unix-btn" data-copy="${result.exactUnix}">Copy</button>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Pano ID</span>
                            <span class="metric-val" style="font-size: 0.8rem;">${escapeHtml(result.panoId)}</span>
                            <button class="metric-copy-action copy-pano-btn" data-copy="${escapeHtml(result.panoId)}">Copy</button>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Coordinates</span>
                            <span class="metric-val coord-value">${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}</span>
                            <div style="display: flex; gap: 8px; margin-top: 4px;">
                                <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="metric-copy-action" style="text-decoration: none;">Google Maps ↗</a>
                                <a href="${osmUrl}" target="_blank" rel="noopener noreferrer" class="metric-copy-action" style="text-decoration: none;">OSM ↗</a>
                            </div>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Timezone</span>
                            <span class="metric-val" style="font-size: 0.85rem;">${escapeHtml(result.timezone)}</span>
                        </div>
                        <div class="metric-tile">
                            <span class="metric-label">Camera</span>
                            <span class="metric-val">${escapeHtml(result.cameraGen.gen)}</span>
                            <span style="font-size: 0.72rem; color: var(--text-tertiary);">${escapeHtml(result.cameraGen.desc)}</span>
                        </div>
                    </div>

                    <!-- Action Bar -->
                    <div class="result-toolbar">
                        <button class="btn-action copy-summary-btn">
                            Copy Info
                        </button>
                        <button class="btn-action share-link-btn">
                            Share Link
                        </button>
                        <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-action">
                            Open in Google Maps ↗
                        </a>
                    </div>
                </div>
            `;

            const copySummaryBtn = resultDiv.querySelector('.copy-summary-btn');
            if (copySummaryBtn) {
                copySummaryBtn.addEventListener('click', () => copyToClipboard(summaryText, copySummaryBtn, 'Copied!'));
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
        appendLog(`Error: ${err.message}`);

        resultDiv.innerHTML = `
            <div class="result-card">
                <div class="error-alert-box">
                    <div class="error-alert-title">
                        Couldn't find the date
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
        toggleLogBtn.textContent = isHidden ? 'Hide Logs ▲' : 'View Protocol Logs ▼';
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
