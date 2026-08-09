/**
 * Black Box system terminal — 5-tap About title + PIN, session-authenticated.
 *
 * Cloud upload strategy (V8_08.10+):
 * - Full console dump → sys_logs/blackbox/{id} (once)
 * - Lean index card → sys_logs/crashes/{id} (summary + preview only)
 * Crash Analytics lists the index; Copy Log / Load Full fetches the blob on demand.
 * Escalate to Roadmap uses the summary, not the megabyte dump.
 */
import { APP_VERSION, DYNAMIC_BASE_URL } from './config.js';
import { escapeHTML } from './utils.js';
import { $deviceId } from '../store.js';
import { openSmoothModal, closeSmoothModal, showToast, triggerHaptic } from './ui.js';

const LOG_KEY = 'nt_blackbox_logs';
const AUTH_KEY = 'nt_bb_session_authed';
const PIN = '10101';
/** Hard cap so one export cannot blow RTDB / admin fetch. */
const MAX_UPLOAD_LINES = 600;

function getDeviceId() {
    try {
        return $deviceId.get()
            || window.NEXT_TRAIN_DEVICE_ID
            || localStorage.getItem('next_train_device_id')
            || 'unknown';
    } catch {
        return 'unknown';
    }
}

function isSessionAuthed() {
    try { return sessionStorage.getItem(AUTH_KEY) === '1'; } catch { return false; }
}

function setSessionAuthed() {
    try { sessionStorage.setItem(AUTH_KEY, '1'); } catch { /* ignore */ }
}

/** Prefer ERROR/WARN + recent LOG when over the line cap. */
function selectLogsForUpload(logs) {
    const arr = Array.isArray(logs) ? logs : [];
    if (arr.length <= MAX_UPLOAD_LINES) return { logs: arr, truncated: false, originalCount: arr.length };

    const signal = arr.filter((l) => {
        const t = String(l?.type || '').toUpperCase();
        return t === 'ERROR' || t === 'WARN';
    });
    const rest = arr.filter((l) => {
        const t = String(l?.type || '').toUpperCase();
        return t !== 'ERROR' && t !== 'WARN';
    });
    const errCap = signal.slice(-Math.min(400, MAX_UPLOAD_LINES));
    const restCap = rest.slice(-(MAX_UPLOAD_LINES - errCap.length));
    const merged = [...restCap, ...errCap].sort((a, b) => (a?.t || 0) - (b?.t || 0));
    return { logs: merged, truncated: true, originalCount: arr.length };
}

/** Compact summary for crash inbox + roadmap escalate (no full dump). */
export function summarizeBlackBoxLogs(logs) {
    const arr = Array.isArray(logs) ? logs : [];
    const counts = { LOG: 0, WARN: 0, ERROR: 0, OTHER: 0 };
    const signal = [];
    for (const l of arr) {
        const t = String(l?.type || 'OTHER').toUpperCase();
        if (counts[t] != null) counts[t] += 1;
        else counts.OTHER += 1;
        if (t === 'ERROR' || t === 'WARN') {
            signal.push({
                t: l?.t || 0,
                type: t,
                msg: String(l?.msg || '').slice(0, 220),
            });
        }
    }
    const recentSignal = signal.slice(-40);
    const recentTail = arr.slice(-12).map((l) => ({
        t: l?.t || 0,
        type: String(l?.type || 'LOG'),
        msg: String(l?.msg || '').slice(0, 180),
    }));
    return {
        lineCount: arr.length,
        counts,
        recentSignal,
        recentTail,
    };
}

function formatPreviewText(summary, meta = {}) {
    const c = summary?.counts || {};
    const lines = [
        `Black Box export · ${summary?.lineCount || 0} lines`,
        `ERROR ${c.ERROR || 0} · WARN ${c.WARN || 0} · LOG ${c.LOG || 0}`,
        meta.truncated ? `(upload truncated from ${meta.originalCount} → ${summary?.lineCount} lines)` : null,
        meta.deviceId ? `Device: ${meta.deviceId}` : null,
        meta.appVersion ? `App: ${meta.appVersion}` : null,
        '',
        '— Recent ERROR / WARN —',
        ...(summary?.recentSignal || []).map((l) => {
            const d = l.t ? new Date(l.t) : null;
            const ts = d && !Number.isNaN(d.getTime())
                ? `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                : '--';
            return `[${ts}] ${l.type}: ${l.msg}`;
        }),
    ].filter((x) => x != null);
    if (!(summary?.recentSignal || []).length) {
        lines.push('(no ERROR/WARN in this export)');
        lines.push('', '— Tail —');
        for (const l of summary?.recentTail || []) {
            lines.push(`${l.type}: ${l.msg}`);
        }
    }
    return lines.join('\n').slice(0, 3500);
}

export function renderBlackBoxLogs() {
    const bbConsole = document.getElementById('blackbox-console');
    if (!bbConsole) return;

    const deviceId = getDeviceId();
    const header = `<div class="mb-2 pb-2 border-b border-green-900/60 text-green-600 font-bold sticky top-0 bg-[#0a0a0a] z-10">DEVICE ${escapeHTML(deviceId)} · ${escapeHTML(APP_VERSION)}</div>`;

    try {
        const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
        if (!Array.isArray(logs) || logs.length === 0) {
            bbConsole.innerHTML = `${header}<span class="text-gray-500">System Nominal. No logs recorded.</span>`;
            return;
        }

        // Chronological: oldest → newest (recent at bottom)
        const body = logs.map((l) => {
            const d = new Date(l.t);
            const timeStr = `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
            let color = 'text-blue-400';
            if (l.type === 'WARN') color = 'text-yellow-400';
            if (l.type === 'ERROR') color = 'text-red-400';
            return `<div class="mb-1.5 border-b border-gray-800/50 pb-1.5"><span class="text-gray-500">[${timeStr}]</span> <span class="${color} font-bold">${escapeHTML(l.type)}</span>: ${escapeHTML(l.msg)}</div>`;
        }).join('');

        bbConsole.innerHTML = header + body;
        bbConsole.scrollTop = bbConsole.scrollHeight;
    } catch {
        bbConsole.innerHTML = `${header}<span class="text-red-500">Failed to parse local logs.</span>`;
    }
}

export function clearBlackBoxLogs() {
    if (!confirm('Wipe all system logs?')) return;
    try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ }
    renderBlackBoxLogs();
}

export function copyBlackBoxLogs() {
    const rawLogs = localStorage.getItem(LOG_KEY) || '[]';
    const payload = JSON.stringify({
        deviceId: getDeviceId(),
        appVersion: APP_VERSION,
        exportedAt: Date.now(),
        logs: JSON.parse(rawLogs),
    }, null, 2);
    navigator.clipboard?.writeText(payload).then(() => {
        showToast('Full log copied', 'success');
    }).catch(() => showToast('Copy failed', 'error'));
}

/**
 * Upload: full dump → sys_logs/blackbox/{id}; lean card → sys_logs/crashes/{id}.
 * Does not triple-store stack/raw/logs on the crash node.
 */
export async function sendBlackBoxLogsToCloud() {
    const sendBtn = document.getElementById('bb-send-btn');
    if (sendBtn) {
        sendBtn.textContent = 'SENDING...';
        sendBtn.disabled = true;
    }
    try {
        const rawLogs = localStorage.getItem(LOG_KEY) || '[]';
        let parsed = [];
        try { parsed = JSON.parse(rawLogs); } catch { parsed = []; }

        const selected = selectLogsForUpload(parsed);
        const summary = summarizeBlackBoxLogs(selected.logs);
        const deviceId = getDeviceId();
        const crashId = `bb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const preview = formatPreviewText(summary, {
            truncated: selected.truncated,
            originalCount: selected.originalCount,
            deviceId,
            appVersion: APP_VERSION,
        });

        const blobBody = {
            deviceId,
            appVersion: APP_VERSION,
            exportedAt: Date.now(),
            truncated: selected.truncated,
            originalCount: selected.originalCount,
            logs: selected.logs,
        };

        const blobRes = await fetch(`${DYNAMIC_BASE_URL}sys_logs/blackbox/${crashId}.json`, {
            method: 'PUT',
            body: JSON.stringify(blobBody),
        });
        if (!blobRes.ok) throw new Error(`blob HTTP ${blobRes.status}`);

        const indexPayload = {
            error: `BLACK_BOX_EXPORT (${summary.lineCount} lines · ${summary.counts.ERROR || 0}E/${summary.counts.WARN || 0}W)`,
            kind: 'blackbox_export',
            blobPath: `sys_logs/blackbox/${crashId}`,
            summary,
            preview,
            line: '0:0',
            url: 'BlackBox Export',
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            appVersion: APP_VERSION,
            deviceId,
            routeId: 'blackbox',
            truncated: selected.truncated,
            originalCount: selected.originalCount,
        };

        const res = await fetch(`${DYNAMIC_BASE_URL}sys_logs/crashes/${crashId}.json`, {
            method: 'PUT',
            body: JSON.stringify(indexPayload),
        });
        if (!res.ok) throw new Error(`index HTTP ${res.status}`);

        showToast(
            selected.truncated
                ? `Black box sent (trimmed ${selected.originalCount}→${summary.lineCount} lines)`
                : 'Black box sent (summary + full log)',
            'success'
        );
    } catch (e) {
        console.error('Black box upload failed', e);
        showToast('Transmission failed.', 'error');
    } finally {
        if (sendBtn) {
            sendBtn.textContent = 'Send to Cloud';
            sendBtn.disabled = false;
        }
    }
}

function ensurePinModal() {
    let pinModal = document.getElementById('bb-pin-modal');
    if (pinModal) return pinModal;

    pinModal = document.createElement('div');
    pinModal.id = 'bb-pin-modal';
    pinModal.className = 'fixed inset-0 bg-black/90 z-[200] hidden flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
    pinModal.innerHTML = `
        <div class="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-xs p-6 transform transition-all scale-95 border border-gray-700">
            <div class="text-center">
                <div class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-900/30 mb-4 shadow-inner ring-2 ring-green-500/50">
                    <span class="text-2xl">📟</span>
                </div>
                <h3 class="text-lg font-mono font-black text-green-500 mb-2 tracking-tight">System Terminal</h3>
                <p class="text-xs font-mono text-gray-400 mb-6">Enter access PIN.</p>
                <input type="password" id="bb-pin-input" inputmode="numeric" class="w-full text-center tracking-[0.5em] text-lg p-3 rounded-xl bg-black border border-gray-700 text-green-500 focus:ring-2 focus:ring-green-500 focus:outline-none transition-all mb-4 placeholder-gray-700" placeholder="•••••">
                <div class="flex space-x-3">
                    <button type="button" id="bb-pin-cancel" class="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold py-2.5 px-4 rounded-xl transition-colors focus:outline-none text-sm">Abort</button>
                    <button type="button" id="bb-pin-submit" class="flex-1 bg-green-800 hover:bg-green-700 text-green-400 hover:text-green-300 border border-green-700 font-bold py-2.5 px-4 rounded-xl shadow-md transition-colors focus:outline-none text-sm">Verify</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(pinModal);

    const pinInput = document.getElementById('bb-pin-input');
    const processPin = () => {
        if (pinInput.value === PIN) {
            triggerHaptic();
            setSessionAuthed();
            closeSmoothModal('bb-pin-modal');
            closeSmoothModal('about-modal');
            pinInput.value = '';
            setTimeout(openBlackBox, 350);
        } else {
            showToast('Access Denied', 'error');
            pinInput.value = '';
            closeSmoothModal('bb-pin-modal');
        }
    };

    document.getElementById('bb-pin-submit')?.addEventListener('click', processPin);
    document.getElementById('bb-pin-cancel')?.addEventListener('click', () => {
        pinInput.value = '';
        closeSmoothModal('bb-pin-modal');
    });
    pinInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') processPin();
    });

    return pinModal;
}

function openBlackBox() {
    try { history.pushState({ modal: 'blackbox' }, '', '#blackbox'); } catch { /* ignore */ }
    openSmoothModal('blackbox-modal');
    renderBlackBoxLogs();
}

/** Close terminal and restore About — PIN stays valid for this browser session. */
function closeBlackBoxToAbout() {
    const reopenAbout = () => {
        try { openSmoothModal('about-modal'); } catch { /* ignore */ }
    };
    if (location.hash === '#blackbox') {
        const onPop = () => {
            window.removeEventListener('popstate', onPop);
            setTimeout(reopenAbout, 40);
        };
        window.addEventListener('popstate', onPop);
        try { history.back(); } catch {
            window.removeEventListener('popstate', onPop);
            closeSmoothModal('blackbox-modal');
            setTimeout(reopenAbout, 320);
        }
        return;
    }
    closeSmoothModal('blackbox-modal');
    setTimeout(reopenAbout, 320);
}

function promptPinOrOpen() {
    triggerHaptic();
    if (isSessionAuthed()) {
        closeSmoothModal('about-modal');
        setTimeout(openBlackBox, 200);
        return;
    }
    ensurePinModal();
    try { history.pushState({ modal: 'bb-pin-modal' }, '', '#bb-pin'); } catch { /* ignore */ }
    openSmoothModal('bb-pin-modal');
    setTimeout(() => document.getElementById('bb-pin-input')?.focus(), 300);
}

export function setupBlackBoxLogger() {
    if (typeof window === 'undefined' || window.__ntBlackboxBound) return;
    window.__ntBlackboxBound = true;

    window.renderBlackBoxLogs = renderBlackBoxLogs;
    window.clearBlackBoxLogs = clearBlackBoxLogs;
    window.copyBlackBoxLogs = copyBlackBoxLogs;
    window.sendBlackBoxLogsToCloud = sendBlackBoxLogsToCloud;

    document.getElementById('bb-clear-btn')?.addEventListener('click', clearBlackBoxLogs);
    document.getElementById('bb-copy-btn')?.addEventListener('click', copyBlackBoxLogs);
    document.getElementById('bb-send-btn')?.addEventListener('click', sendBlackBoxLogsToCloud);
    document.getElementById('bb-close-btn')?.addEventListener('click', closeBlackBoxToAbout);

    const aboutTitle = document.getElementById('about-app-title');
    if (!aboutTitle) return;

    let bbClickCount = 0;
    let bbClickTimer = null;
    aboutTitle.classList.add('cursor-pointer');
    aboutTitle.addEventListener('click', (e) => {
        e.preventDefault();
        bbClickCount += 1;
        if (bbClickTimer) clearTimeout(bbClickTimer);
        bbClickTimer = setTimeout(() => { bbClickCount = 0; }, 2000);
        if (bbClickCount >= 5) {
            bbClickCount = 0;
            promptPinOrOpen();
        }
    });
}
