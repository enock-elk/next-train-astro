/**
 * Per-train live status reports (board flags + Live update chips)
 *
 * RTDB: delay_reports/{reportId}
 * {
 *   reportId, routeId, region, station, trainId, scheduledTime, arrivalTime,
 *   destination, status: early|on_time|late|cancelled,
 *   lateBucket, note, uid, deviceId, isGuest, timestamp, statusOpen: 'open',
 *   severity (legacy map), appVersion, source
 * }
 */
import { APP_VERSION, DYNAMIC_BASE_URL } from './config.js';
import { safeStorage, timeToSeconds, normalizeStationName, escapeHTML, formatTimeDisplay } from './utils.js';
import { $currentRouteId, $userRegion, $deviceId } from '../store.js';
import { $account } from './account.js';
import { showToast, triggerHaptic, openSmoothModal, closeSmoothModal } from './ui.js';
import { bootFirebase } from './firebase-boot.js';
import {
    prune,
    readRateData,
    writeRateData,
    isShadowBanned,
    isBlockedLocally,
    checkContentSafety,
} from './trust.js';
import { FEATURE_KEYS, fetchFeatures, isFeatureEnabled } from './features.js';

/** @deprecated Prefer isDelayReportsUiEnabled(routeId) — kept for any external reads. */
export let DELAY_REPORTS_UI_ENABLED = false;

/**
 * Commuter-facing delay / status report UI — gated by config/features.delayReportsUi
 * (lab defaults on; production defaults off until corridor allow-list is set).
 */
export function isDelayReportsUiEnabled(routeId = $currentRouteId.get()) {
    const on = isFeatureEnabled(FEATURE_KEYS.DELAY_REPORTS_UI, routeId || '');
    DELAY_REPORTS_UI_ENABLED = on;
    return on;
}

const GUEST_GLOBAL_MS = 45 * 60 * 1000;
const GUEST_ROUTE_MS = 2 * 60 * 60 * 1000;
const AUTH_GLOBAL_MS = 30 * 60 * 1000;
const AUTH_GLOBAL_MAX = 5;
const AUTH_ROUTE_MS = 8 * 60 * 1000;
const SURFACE_WINDOW_MS = 3 * 60 * 60 * 1000;
const REPORT_WINDOW_SEC = 20 * 60; // ±20 min around scheduled station time
const RATE_KEY = 'delayReportRateV1';
const VALIDATE_RATE_KEY = 'delayValidateRateV1';
/** Distinct devices needed before a chip goes fully public (prototype: 3). */
export const VERIFY_THRESHOLD = 3;

const LATE_MID = { '1-5': 3, '6-10': 8, '11-20': 15, '21+': 25, unsure: 10 };

/** @type {Record<string, object[]>} */
let routeReportCache = {};
let routeReportCacheAt = {};
/** @type {Record<string, () => void>} */
const routeListeners = {};
/** trainKey → localStorage validated this session/device */
const VALIDATED_PREFIX = 'delayValidated_';

function getDeviceId() {
    return $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown';
}

function getNowSeconds() {
    const t = (typeof window !== 'undefined' && window.currentTime) ? window.currentTime : null;
    return timeToSeconds(t || '12:00:00');
}

function readRate() {
    return readRateData(RATE_KEY, { global: [], routes: {} });
}

function writeRate(data) {
    writeRateData(RATE_KEY, data);
}

export function checkDelayReportRateLimit(routeId) {
    const signed = $account.get().status === 'signed-in';
    const data = readRate();
    const now = Date.now();
    data.global = prune(data.global, signed ? AUTH_GLOBAL_MS : GUEST_GLOBAL_MS);
    const routeTimes = prune(data.routes?.[routeId] || [], signed ? AUTH_ROUTE_MS * 4 : GUEST_ROUTE_MS);
    if (!data.routes) data.routes = {};
    data.routes[routeId] = routeTimes;

    if (signed) {
        if (data.global.length >= AUTH_GLOBAL_MAX) {
            return { ok: false, message: 'Slow down — try again in a few minutes.' };
        }
        if (routeTimes.some((t) => now - t < AUTH_ROUTE_MS)) {
            return { ok: false, message: 'You already reported this route recently.' };
        }
    } else if (data.global.length >= 1) {
        return { ok: false, message: 'Guests can report once every 45 minutes. Sign in for higher limits.' };
    } else if (routeTimes.length >= 1) {
        return { ok: false, message: 'Already reported for this route. Sign in to report again sooner.' };
    }
    return { ok: true };
}

function recordRateHit(routeId) {
    const signed = $account.get().status === 'signed-in';
    const data = readRate();
    const now = Date.now();
    data.global = prune(data.global, signed ? AUTH_GLOBAL_MS : GUEST_GLOBAL_MS);
    data.global.push(now);
    if (!data.routes) data.routes = {};
    data.routes[routeId] = prune(data.routes[routeId] || [], signed ? AUTH_ROUTE_MS * 4 : GUEST_ROUTE_MS);
    data.routes[routeId].push(now);
    writeRate(data);
}

async function ensureAuthToken() {
    if (!window.firebaseAuth) await bootFirebase();
    if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
        try { await window.firebaseSignInAnonymously(window.firebaseAuth); } catch { /* optional */ }
    }
    if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
        try { return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true); } catch { return ''; }
    }
    return '';
}

export function trainReportKey({ routeId, trainId, scheduledTime, station }) {
    return [
        routeId || '',
        String(trainId || '').trim(),
        String(scheduledTime || '').slice(0, 5),
        normalizeStationName(station || ''),
    ].join('|');
}

/** ±20 minutes around this station’s scheduled departure */
export function isTrainInReportWindow(scheduledTime) {
    if (!scheduledTime) return false;
    const dep = timeToSeconds(scheduledTime);
    if (!dep && dep !== 0) return false;
    return Math.abs(getNowSeconds() - dep) <= REPORT_WINDOW_SEC;
}

export async function fetchRecentRouteReports(routeId, maxAgeMs = SURFACE_WINDOW_MS) {
    if (!routeId || !navigator.onLine) return [];
    const cached = routeReportCache[routeId];
    const at = routeReportCacheAt[routeId] || 0;
    if (cached && Date.now() - at < 45000) return cached;

    try {
        let res = await fetch(`${DYNAMIC_BASE_URL}delay_reports.json?orderBy="routeId"&equalTo="${encodeURIComponent(routeId)}"&limitToLast=60`);
        let data = null;
        if (res.ok) data = await res.json();
        else {
            res = await fetch(`${DYNAMIC_BASE_URL}delay_reports.json`);
            if (!res.ok) return [];
            const all = await res.json();
            if (!all) return [];
            data = Object.fromEntries(Object.entries(all).filter(([, r]) => r && r.routeId === routeId));
        }
        if (!data) {
            routeReportCache[routeId] = [];
            routeReportCacheAt[routeId] = Date.now();
            return [];
        }
        const cut = Date.now() - maxAgeMs;
        const list = Object.values(data)
            .filter((r) => r && r.statusOpen !== 'closed' && r.status !== 'closed' && (r.timestamp || 0) > cut)
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        routeReportCache[routeId] = list;
        routeReportCacheAt[routeId] = Date.now();
        return list;
    } catch {
        return [];
    }
}

export function aggregateTrainReports(reports, keyParts) {
    const key = trainReportKey(keyParts);
    const matched = (reports || []).filter((r) => {
        if (r.trainKey) return r.trainKey === key;
        return trainReportKey({
            routeId: r.routeId,
            trainId: r.trainId,
            scheduledTime: r.scheduledTime,
            station: r.station,
        }) === key;
    });
    if (!matched.length) return null;

    const counts = { early: 0, on_time: 0, late: 0, cancelled: 0 };
    let lateSum = 0;
    let lateN = 0;
    const devices = new Set();
    matched.forEach((r) => {
        const s = r.trainStatus || r.status;
        if (s === 'early' || s === 'on_time' || s === 'late' || s === 'cancelled') counts[s] += 1;
        else if (r.severity === 'severe') counts.late += 1;
        else counts.late += 1;
        if ((r.trainStatus || r.status) === 'late' || r.lateBucket) {
            lateSum += LATE_MID[r.lateBucket] || 10;
            lateN += 1;
        }
        if (r.deviceId) devices.add(String(r.deviceId));
        else if (r.uid) devices.add(`u:${r.uid}`);
    });

    let top = 'late';
    let topN = -1;
    Object.entries(counts).forEach(([k, n]) => {
        if (n > topN) { top = k; topN = n; }
    });

    const distinct = devices.size || matched.length;
    const isVerified = distinct >= VERIFY_THRESHOLD;

    return {
        count: matched.length,
        distinctDevices: distinct,
        isVerified,
        status: top,
        avgLateMin: lateN ? Math.round(lateSum / lateN) : (top === 'late' ? 10 : top === 'early' ? 3 : null),
        scheduledTime: keyParts.scheduledTime,
        arrivalTime: keyParts.arrivalTime || matched[0]?.arrivalTime || null,
        trainKey: key,
    };
}

function statusLabel(agg) {
    if (!agg) return '';
    if (agg.status === 'cancelled') return 'Cancelled / not coming';
    if (agg.status === 'early') return `~${agg.avgLateMin || 3} min early`;
    if (agg.status === 'on_time') return 'On time';
    return `~${agg.avgLateMin || 10} min late`;
}

function expectedTimeLabel(agg) {
    if (!agg || agg.status === 'on_time' || agg.status === 'cancelled') return '';
    const base = agg.arrivalTime || agg.scheduledTime;
    if (!base) return '';
    const sec = timeToSeconds(base);
    if (sec == null || Number.isNaN(sec)) return '';
    const delta = (agg.avgLateMin || 0) * 60;
    const adj = agg.status === 'early' ? Math.max(0, sec - delta) : sec + delta;
    const hh = String(Math.floor(adj / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor((adj % 3600) / 60)).padStart(2, '0');
    return `${hh}:${mm}`;
}

function hasLocalValidated(trainKey) {
    return !!safeStorage.getItem(VALIDATED_PREFIX + trainKey);
}

function markLocalValidated(trainKey) {
    safeStorage.setItem(VALIDATED_PREFIX + trainKey, '1');
}

function showBanner(banner, on) {
    if (!banner) return;
    if (on) {
        banner.classList.remove('hidden');
        banner.removeAttribute('hidden');
        banner.setAttribute('aria-hidden', 'false');
    } else {
        banner.classList.add('hidden');
        banner.setAttribute('hidden', '');
        banner.setAttribute('aria-hidden', 'true');
    }
}

/**
 * Live RTDB listener for a route's delay_reports (invalidates cache + rehydrates board).
 */
export async function startDelayReportsListener(routeId) {
    if (!routeId) return;
    stopDelayReportsListener(routeId);
    await fetchFeatures();
    if (!isDelayReportsUiEnabled(routeId)) return;

    await bootFirebase();
    if (!window.firebaseDb || !window.firebaseDbRef || !window.firebaseDbOnValue) return;
    if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
        try { await window.firebaseSignInAnonymously(window.firebaseAuth); } catch { /* optional */ }
    }

    try {
        const baseRef = window.firebaseDbRef(window.firebaseDb, 'delay_reports');
        const q = (window.firebaseDbQuery && window.firebaseDbOrderByChild && window.firebaseDbEqualTo)
            ? window.firebaseDbQuery(
                baseRef,
                window.firebaseDbOrderByChild('routeId'),
                window.firebaseDbEqualTo(routeId)
            )
            : baseRef;

        const unsub = window.firebaseDbOnValue(q, (snap) => {
            const data = snap?.val?.() || null;
            const cut = Date.now() - SURFACE_WINDOW_MS;
            let list = [];
            if (data) {
                list = Object.values(data)
                    .filter((r) => r && r.routeId === routeId && r.statusOpen !== 'closed' && r.status !== 'closed' && (r.timestamp || 0) > cut)
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            }
            routeReportCache[routeId] = list;
            routeReportCacheAt[routeId] = Date.now();
            if ($currentRouteId.get() === routeId) {
                refreshDelayReportSurface(routeId);
                hydrateTrainReportSlots(document.getElementById('view-next-train') || document);
            }
        }, (err) => {
            console.warn('Delay reports realtime failed', err);
            stopDelayReportsListener(routeId);
        });
        routeListeners[routeId] = typeof unsub === 'function' ? unsub : () => {};
    } catch (e) {
        console.warn('Delay reports listener start failed', e);
    }
}

export function stopDelayReportsListener(routeId) {
    if (routeId && routeListeners[routeId]) {
        try { routeListeners[routeId](); } catch { /* ignore */ }
        delete routeListeners[routeId];
        return;
    }
    Object.keys(routeListeners).forEach((id) => {
        try { routeListeners[id](); } catch { /* ignore */ }
        delete routeListeners[id];
    });
}

function statusColorClass(status) {
    if (status === 'cancelled') return 'text-red-600 dark:text-red-400';
    if (status === 'early') return 'text-green-600 dark:text-green-400';
    if (status === 'on_time') return 'text-amber-700 dark:text-amber-300';
    return 'text-red-600 dark:text-red-400';
}

function flagColorClass(status) {
    if (status === 'cancelled') return 'text-red-500';
    if (status === 'late') return 'text-amber-500';
    if (status === 'early') return 'text-green-500';
    if (status === 'on_time') return 'text-emerald-500';
    return 'text-blue-500';
}

/** HTML injected into journey description box (live chip host; report CTA is on train title) */
export function buildTrainReportSlotHtml({
    routeId, trainId, scheduledTime, arrivalTime, station, destination,
}) {
    if (!isDelayReportsUiEnabled(routeId)) return '';
    const reportable = isTrainInReportWindow(scheduledTime);
    const attrs = [
        `data-train-report-slot`,
        `data-route="${escapeHTML(routeId || '')}"`,
        `data-train="${escapeHTML(String(trainId || ''))}"`,
        `data-dep="${escapeHTML(String(scheduledTime || ''))}"`,
        `data-arr="${escapeHTML(String(arrivalTime || ''))}"`,
        `data-station="${escapeHTML(station || '')}"`,
        `data-dest="${escapeHTML(destination || '')}"`,
        reportable ? 'data-reportable="1"' : 'data-reportable="0"',
    ].join(' ');

    // Empty host for hydrateTrainReportSlots live chip; reporting is on the train title button
    return `<div class="mt-1.5 w-full px-0.5" ${attrs}></div>`;
}

/** Clickable train title — opens report modal for that train (disabled during parity cutover). */
export function buildTrainTitleReportButton({
    label,
    routeId, trainId, scheduledTime, arrivalTime, station, destination,
    className = '',
}) {
    if (!isDelayReportsUiEnabled(routeId)) {
        return `<span class="${className}"><span class="truncate">${escapeHTML(label)}</span></span>`;
    }
    const attrs = [
        `data-open-train-report`,
        `data-route="${escapeHTML(routeId || '')}"`,
        `data-train="${escapeHTML(String(trainId || ''))}"`,
        `data-dep="${escapeHTML(String(scheduledTime || ''))}"`,
        `data-arr="${escapeHTML(String(arrivalTime || ''))}"`,
        `data-station="${escapeHTML(station || '')}"`,
        `data-dest="${escapeHTML(destination || '')}"`,
    ].join(' ');
    return `<button type="button" class="${className}" ${attrs} title="Report train ${escapeHTML(String(trainId || ''))}">
      <span class="truncate">${escapeHTML(label)}</span>
    </button>`;
}

function chipAttrs(routeId, trainId, scheduledTime, arrivalTime, station, destination) {
    return `data-route="${escapeHTML(routeId || '')}" data-train="${escapeHTML(trainId || '')}" data-dep="${escapeHTML(scheduledTime || '')}" data-arr="${escapeHTML(arrivalTime || '')}" data-station="${escapeHTML(station || '')}" data-dest="${escapeHTML(destination || '')}"`;
}

export async function hydrateTrainReportSlots(root = document) {
    await fetchFeatures();
    if (!isDelayReportsUiEnabled()) return;
    const slots = (root || document).querySelectorAll?.('[data-train-report-slot]');
    if (!slots?.length) return;

    const routeIds = [...new Set([...slots].map((s) => s.getAttribute('data-route')).filter(Boolean))];
    const byRoute = {};
    await Promise.all(routeIds.map(async (rid) => {
        byRoute[rid] = await fetchRecentRouteReports(rid);
        if (!routeListeners[rid]) startDelayReportsListener(rid);
    }));

    slots.forEach((slot) => {
        const routeId = slot.getAttribute('data-route');
        const trainId = slot.getAttribute('data-train');
        const scheduledTime = slot.getAttribute('data-dep');
        const arrivalTime = slot.getAttribute('data-arr');
        const station = slot.getAttribute('data-station');
        const destination = slot.getAttribute('data-dest');
        const reportable = slot.getAttribute('data-reportable') === '1';
        const attrs = chipAttrs(routeId, trainId, scheduledTime, arrivalTime, station, destination);
        const agg = aggregateTrainReports(byRoute[routeId] || [], {
            routeId, trainId, scheduledTime, station, arrivalTime,
        });

        if (!agg) {
            if (!reportable) {
                slot.innerHTML = '';
                return;
            }
            slot.innerHTML = `
              <button type="button" class="w-full mt-0.5 text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 py-2 rounded-lg transition-colors flex justify-center items-center shadow-sm focus:outline-none" data-open-train-report ${attrs}>
                Report status
              </button>`;
            return;
        }

        const liveCls = statusColorClass(agg.status);
        const exp = expectedTimeLabel(agg);
        const validated = hasLocalValidated(agg.trainKey);

        if (agg.isVerified) {
            slot.innerHTML = `
              <div class="train-live-chip w-full text-left px-2 py-1.5 rounded-lg border border-orange-200 dark:border-orange-800/50 bg-orange-50 dark:bg-orange-950/30 shadow-sm" data-train-key="${escapeHTML(agg.trainKey)}">
                <div class="flex items-center gap-1 mb-0.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shrink-0"></span>
                  <span class="text-[8px] font-black uppercase tracking-widest text-orange-700 dark:text-orange-300">Live alert</span>
                  ${exp ? `<span class="ml-auto text-[9px] font-black text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/50 px-1.5 py-0.5 rounded border border-orange-200 dark:border-orange-800">EXP ${escapeHTML(exp)}</span>` : ''}
                </div>
                <p class="text-[10px] font-black ${liveCls} leading-tight">${escapeHTML(statusLabel(agg))}</p>
                <div class="mt-1.5 pt-1.5 border-t border-orange-200/60 dark:border-orange-800/40 flex justify-between items-center gap-2">
                  <span class="text-[9px] text-orange-600/90 dark:text-orange-400 font-bold">${agg.count} report${agg.count === 1 ? '' : 's'}</span>
                  ${validated
                ? `<span class="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded text-[8px] font-bold">Validated</span>`
                : `<div class="flex gap-1">
                        <button type="button" class="delay-validate-btn bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 text-gray-500 hover:text-green-600 px-1.5 py-1 rounded shadow-sm focus:outline-none" data-validate="up" ${attrs} data-train-key="${escapeHTML(agg.trainKey)}" data-status="${escapeHTML(agg.status)}" aria-label="Confirm report">👍</button>
                        <button type="button" class="delay-validate-btn bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 text-gray-500 hover:text-red-600 px-1.5 py-1 rounded shadow-sm focus:outline-none" data-validate="down" ${attrs} data-train-key="${escapeHTML(agg.trainKey)}" aria-label="Disagree">👎</button>
                      </div>`}
                </div>
              </div>`;
            return;
        }

        // Pending corroboration
        slot.innerHTML = `
          <div class="train-live-chip w-full text-left px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 shadow-sm">
            <p class="text-[9px] text-gray-600 dark:text-gray-300 leading-tight">
              <span class="font-bold">Pending:</span> Commuters report ${escapeHTML(statusLabel(agg))} (${agg.distinctDevices}/${VERIFY_THRESHOLD})
            </p>
            ${validated
            ? `<span class="mt-1 inline-block text-[8px] font-bold text-green-700 dark:text-green-300">Thanks — counted</span>`
            : `<button type="button" class="delay-validate-btn mt-1.5 w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-[9px] font-bold text-gray-700 dark:text-gray-200 py-1 rounded shadow-sm hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none" data-validate="up" ${attrs} data-train-key="${escapeHTML(agg.trainKey)}" data-status="${escapeHTML(agg.status)}">Verify delay</button>`}
          </div>`;
    });
}

/** Thumb / verify — writes a corroborating report (counts toward threshold). */
export async function submitDelayValidation({ routeId, trainId, scheduledTime, arrivalTime, station, destination, trainKey, status, agree }) {
    if (!routeId || !agree) return { ok: false, message: 'Dismissed' };
    if (trainKey && hasLocalValidated(trainKey)) return { ok: true, message: 'Already validated' };

    const rate = checkDelayReportRateLimit(routeId);
    // Softer: allow validate even if full report rate hit — use short local cooldown
    const last = Number(safeStorage.getItem(VALIDATE_RATE_KEY) || 0);
    if (Date.now() - last < 60 * 1000) {
        return { ok: false, message: 'Slow down — try again in a minute.' };
    }

    const key = trainKey || trainReportKey({ routeId, trainId, scheduledTime, station });
    const token = await ensureAuthToken();
    const authParam = token ? `?auth=${encodeURIComponent(token)}` : '';
    const reportId = `dv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const acct = $account.get();
    const payload = {
        reportId,
        routeId,
        region: $userRegion.get() || 'GP',
        station: station || null,
        trainId: trainId || null,
        scheduledTime: scheduledTime || null,
        arrivalTime: arrivalTime || null,
        destination: destination || null,
        trainKey: key,
        trainStatus: status || 'late',
        status: status || 'late',
        lateBucket: status === 'late' ? 'unsure' : null,
        note: null,
        severity: 'moderate',
        uid: acct.status === 'signed-in' ? acct.uid : null,
        deviceId: getDeviceId(),
        isGuest: acct.status !== 'signed-in',
        timestamp: Date.now(),
        statusOpen: 'open',
        appVersion: APP_VERSION,
        source: 'live_board_validate',
        isValidation: true,
    };

    try {
        const res = await fetch(`${DYNAMIC_BASE_URL}delay_reports/${reportId}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`Validate failed (${res.status})`);
        markLocalValidated(key);
        safeStorage.setItem(VALIDATE_RATE_KEY, String(Date.now()));
        if (!rate.ok) { /* skip full rate hit for validates */ }
        else recordRateHit(routeId);
        delete routeReportCache[routeId];
        delete routeReportCacheAt[routeId];
        await hydrateTrainReportSlots(document.getElementById('view-next-train') || document);
        showToast('Thanks — your confirm helps others', 'success');
        return { ok: true };
    } catch (e) {
        return { ok: false, message: e?.message || 'Could not confirm' };
    }
}

function showTrainReportStep(step) {
    document.getElementById('tr-step-status')?.classList.toggle('hidden', step !== 'status');
    document.getElementById('tr-step-late')?.classList.toggle('hidden', step !== 'late');
    document.getElementById('tr-step-done')?.classList.toggle('hidden', step !== 'done');
}

export function openTrainReportModal(opts = {}) {
    const routeId = opts.routeId || $currentRouteId.get() || '';
    if (!isDelayReportsUiEnabled(routeId)) return;
    const trainId = opts.trainId || '';
    const scheduledTime = opts.scheduledTime || '';
    const station = opts.station || document.getElementById('station-select')?.value || '';

    if (trainId && scheduledTime && !isTrainInReportWindow(scheduledTime)) {
        showToast('You can only report trains within 20 minutes of their scheduled time.', 'info');
        return;
    }

    document.getElementById('tr-route').value = routeId;
    document.getElementById('tr-train').value = trainId;
    document.getElementById('tr-dep').value = scheduledTime;
    document.getElementById('tr-arr').value = opts.arrivalTime || '';
    document.getElementById('tr-station').value = station;
    document.getElementById('tr-dest').value = opts.destination || '';
    document.getElementById('tr-status').value = '';
    document.getElementById('tr-late-bucket').value = '';
    const note = document.getElementById('tr-note');
    if (note) note.value = '';
    const err = document.getElementById('tr-error');
    if (err) err.textContent = '';

    const title = document.getElementById('train-report-title');
    if (title) {
        title.textContent = trainId
            ? `Report train ${trainId}`
            : 'Report status';
    }

    document.querySelectorAll('.tr-bucket-btn').forEach((b) => {
        b.classList.remove('border-blue-500', 'bg-blue-50', 'dark:bg-blue-950/40');
    });

    showTrainReportStep('status');
    triggerHaptic();
    openSmoothModal('delay-report-modal');
}

/** @deprecated use openTrainReportModal */
export function openDelayReportModal(opts = {}) {
    openTrainReportModal({
        routeId: opts.routeId,
        station: opts.station,
        trainId: opts.trainId,
        scheduledTime: opts.scheduledTime,
        arrivalTime: opts.arrivalTime,
        destination: opts.destination,
    });
}

function severityFromStatus(status, bucket) {
    if (status === 'cancelled') return 'severe';
    if (status === 'early' || status === 'on_time') return 'minor';
    if (bucket === '21+' || bucket === '11-20') return 'severe';
    if (bucket === '6-10') return 'moderate';
    return 'moderate';
}

async function submitTrainReportPayload({ status, lateBucket, note }) {
    const routeId = document.getElementById('tr-route')?.value || $currentRouteId.get();
    const trainId = document.getElementById('tr-train')?.value || '';
    const scheduledTime = document.getElementById('tr-dep')?.value || '';
    const arrivalTime = document.getElementById('tr-arr')?.value || '';
    const station = document.getElementById('tr-station')?.value || '';
    const destination = document.getElementById('tr-dest')?.value || '';
    const errEl = document.getElementById('tr-error');

    const showErr = (m) => { if (errEl) errEl.textContent = m; };

    if (!routeId) { showErr('Missing route.'); return false; }
    if (trainId && scheduledTime && !isTrainInReportWindow(scheduledTime)) {
        showErr('Outside the 20-minute report window.');
        return false;
    }

    const limit = checkDelayReportRateLimit(routeId);
    if (!limit.ok) { showErr(limit.message); return false; }

    if (note) {
        const safety = checkContentSafety(note);
        if (!safety.ok) { showErr(safety.message); return false; }
    }

    if (!navigator.onLine) { showErr('You appear offline.'); return false; }

    const acct = $account.get();
    if (acct.status === 'signed-in' && acct.uid) {
        if (isBlockedLocally(acct.uid)) { showErr('Unable to submit right now.'); return false; }
        if (await isShadowBanned(acct.uid)) { showErr('Unable to submit right now.'); return false; }
    }

    const spinner = document.getElementById('tr-spinner');
    const submitText = document.getElementById('tr-late-submit-text');
    const submitBtn = document.getElementById('tr-late-submit');
    if (submitBtn) submitBtn.disabled = true;
    if (submitText) submitText.textContent = 'Sending…';
    spinner?.classList.remove('hidden');
    showErr('');

    try {
        const isGuest = acct.status !== 'signed-in';
        const reportId = `dr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const trainKey = trainReportKey({ routeId, trainId, scheduledTime, station });
        const payload = {
            reportId,
            routeId,
            region: $userRegion.get() || 'GP',
            station: station || null,
            trainId: trainId || null,
            scheduledTime: scheduledTime || null,
            arrivalTime: arrivalTime || null,
            destination: destination || null,
            trainKey,
            trainStatus: status,
            status: status, // also used by older filters
            lateBucket: lateBucket || null,
            note: note || null,
            severity: severityFromStatus(status, lateBucket),
            uid: isGuest ? null : (acct.uid || null),
            deviceId: getDeviceId(),
            isGuest,
            timestamp: Date.now(),
            statusOpen: 'open',
            appVersion: APP_VERSION,
            source: 'live_board_train',
        };

        const token = await ensureAuthToken();
        const authParam = token ? `?auth=${encodeURIComponent(token)}` : '';
        const res = await fetch(`${DYNAMIC_BASE_URL}delay_reports/${reportId}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`Submit failed (${res.status})`);

        recordRateHit(routeId);
        delete routeReportCache[routeId];
        delete routeReportCacheAt[routeId];

        const summary = document.getElementById('tr-done-summary');
        if (summary) {
            let label = 'On time';
            if (status === 'early') label = 'Came early';
            else if (status === 'cancelled') label = 'Cancelled / not coming';
            else if (status === 'late') {
                const map = { '1-5': '1–5 min late', '6-10': '6–10 min late', '11-20': '11–20 min late', '21+': '21+ min late', unsure: 'Late (not sure how long)' };
                label = map[lateBucket] || 'Running late';
            }
            summary.textContent = `You reported: ${label}`;
        }
        showTrainReportStep('done');
        refreshDelayReportSurface(routeId);
        hydrateTrainReportSlots(document.getElementById('view-next-train') || document);
        return true;
    } catch (e) {
        showErr(e?.message || 'Could not send report.');
        return false;
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (submitText) submitText.textContent = 'Submit report';
        spinner?.classList.add('hidden');
    }
}

async function finishSimpleStatus(status) {
    document.getElementById('tr-status').value = status;
    if (status === 'late') {
        showTrainReportStep('late');
        return;
    }
    // early / on_time / cancelled — submit immediately
    document.querySelectorAll('[data-tr-status]').forEach((b) => { b.disabled = true; });
    const ok = await submitTrainReportPayload({ status, lateBucket: null, note: '' });
    document.querySelectorAll('[data-tr-status]').forEach((b) => { b.disabled = false; });
    if (!ok) {
        const msg = document.getElementById('tr-error')?.textContent;
        if (msg) showToast(msg, 'error');
    }
}

export async function refreshDelayReportSurface(routeId = $currentRouteId.get()) {
    const banner = document.getElementById('delay-report-banner');
    const badge = document.getElementById('delay-report-badge');
    const text = document.getElementById('delay-report-banner-text');
    if (!banner) return;

    await fetchFeatures();
    if (!isDelayReportsUiEnabled(routeId)) {
        showBanner(banner, false);
        badge?.classList.add('hidden');
        return;
    }

    if (!routeId) {
        showBanner(banner, false);
        return;
    }

    if (!routeListeners[routeId]) startDelayReportsListener(routeId);

    const reports = await fetchRecentRouteReports(routeId);
    const withTrain = reports.filter((r) => r.trainId);
    if (!withTrain.length) {
        showBanner(banner, false);
        badge?.classList.add('hidden');
        return;
    }

    const top = withTrain[0];
    const count = withTrain.length;
    const mins = Math.max(1, Math.round((Date.now() - (top.timestamp || Date.now())) / 60000));
    const when = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
    if (text) {
        text.textContent = count === 1
            ? `Train ${top.trainId}: ${statusLabel({ status: top.trainStatus || 'late', avgLateMin: LATE_MID[top.lateBucket] || 10 })} · ${when}`
            : `${count} recent train reports · latest ${when}`;
    }
    showBanner(banner, true);
    if (badge) {
        badge.textContent = String(count);
        badge.classList.remove('hidden');
    }
}

export async function getPlannerCrowdDelayHtml(routeIds = []) {
    await fetchFeatures();
    if (!isDelayReportsUiEnabled()) return '';
    const ids = [...new Set((routeIds || []).filter(Boolean))];
    if (!ids.length) return '';
    const batches = await Promise.all(ids.slice(0, 4).map((id) => fetchRecentRouteReports(id)));
    const flat = batches.flat().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (!flat.length) return '';
    const top = flat[0];
    const n = flat.length;
    const label = top.trainId
        ? `Train ${escapeHTML(top.trainId)} · ${escapeHTML(statusLabel({ status: top.trainStatus || 'late', avgLateMin: LATE_MID[top.lateBucket] || 10 }))}`
        : 'Delays reported on this journey’s lines';
    return `<div class="mt-3 p-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/30 text-left">
        <p class="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1">Commuter reports</p>
        <p class="text-xs font-bold text-gray-800 dark:text-gray-200">${n} recent report${n === 1 ? '' : 's'}</p>
        <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">${label}</p>
    </div>`;
}

export function bindDelayReportUi() {
    if (typeof document === 'undefined' || window.__ntDelayReportBound) return;
    window.__ntDelayReportBound = true;

    const hideBannerIfOff = () => {
        if (!isDelayReportsUiEnabled()) {
            showBanner(document.getElementById('delay-report-banner'), false);
        }
    };

    document.getElementById('delay-report-cancel')?.addEventListener('click', () => closeSmoothModal('delay-report-modal'));
    document.getElementById('tr-done-btn')?.addEventListener('click', () => closeSmoothModal('delay-report-modal'));
    document.getElementById('tr-late-back')?.addEventListener('click', () => showTrainReportStep('status'));

    document.querySelectorAll('[data-tr-status]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (!isDelayReportsUiEnabled()) return;
            finishSimpleStatus(btn.getAttribute('data-tr-status'));
        });
    });

    document.querySelectorAll('[data-tr-bucket]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tr-bucket-btn').forEach((b) => {
                b.classList.remove('border-blue-500', 'bg-blue-50', 'dark:bg-blue-950/40');
            });
            btn.classList.add('border-blue-500', 'bg-blue-50', 'dark:bg-blue-950/40');
            document.getElementById('tr-late-bucket').value = btn.getAttribute('data-tr-bucket') || '';
        });
    });

    document.getElementById('tr-late-submit')?.addEventListener('click', async () => {
        if (!isDelayReportsUiEnabled()) return;
        const bucket = document.getElementById('tr-late-bucket')?.value;
        if (!bucket) {
            const err = document.getElementById('tr-error');
            if (err) err.textContent = 'Pick how late the train was.';
            return;
        }
        await submitTrainReportPayload({
            status: 'late',
            lateBucket: bucket,
            note: document.getElementById('tr-note')?.value?.trim() || '',
        });
    });

    document.addEventListener('click', (e) => {
        const validateBtn = e.target?.closest?.('.delay-validate-btn');
        if (validateBtn) {
            e.preventDefault();
            e.stopPropagation();
            const agree = validateBtn.getAttribute('data-validate') !== 'down';
            if (!agree) {
                showToast('Thanks — report noted', 'info');
                const key = validateBtn.getAttribute('data-train-key');
                if (key) markLocalValidated(key);
                hydrateTrainReportSlots(document.getElementById('view-next-train') || document);
                return;
            }
            submitDelayValidation({
                routeId: validateBtn.getAttribute('data-route') || $currentRouteId.get(),
                trainId: validateBtn.getAttribute('data-train'),
                scheduledTime: validateBtn.getAttribute('data-dep'),
                arrivalTime: validateBtn.getAttribute('data-arr'),
                station: validateBtn.getAttribute('data-station'),
                destination: validateBtn.getAttribute('data-dest'),
                trainKey: validateBtn.getAttribute('data-train-key'),
                status: validateBtn.getAttribute('data-status') || 'late',
                agree: true,
            }).then((r) => {
                if (!r.ok && r.message) showToast(r.message, 'error');
            });
            return;
        }

        const btn = e.target?.closest?.('[data-open-train-report]');
        if (!btn) return;
        e.preventDefault();
        const slot = btn.closest('[data-train-report-slot]') || btn;
        openTrainReportModal({
            routeId: btn.getAttribute('data-route') || slot.getAttribute('data-route') || $currentRouteId.get(),
            trainId: btn.getAttribute('data-train') || slot.getAttribute('data-train'),
            scheduledTime: btn.getAttribute('data-dep') || slot.getAttribute('data-dep'),
            arrivalTime: btn.getAttribute('data-arr') || slot.getAttribute('data-arr'),
            station: btn.getAttribute('data-station') || slot.getAttribute('data-station'),
            destination: btn.getAttribute('data-dest') || slot.getAttribute('data-dest'),
        });
    });

    document.getElementById('delay-report-banner-cta')?.addEventListener('click', () => {
        openTrainReportModal({
            routeId: $currentRouteId.get(),
            station: document.getElementById('station-select')?.value || '',
        });
    });

    let lastRouteListen = '';
    $currentRouteId.subscribe((id) => {
        if (lastRouteListen && lastRouteListen !== id) stopDelayReportsListener(lastRouteListen);
        lastRouteListen = id || '';
        if (id) {
            startDelayReportsListener(id);
            refreshDelayReportSurface(id);
            setTimeout(() => hydrateTrainReportSlots(document.getElementById('view-next-train') || document), 400);
        }
    });

    window.addEventListener('nt-features-updated', () => {
        hideBannerIfOff();
        const rid = $currentRouteId.get();
        if (rid) {
            startDelayReportsListener(rid);
            refreshDelayReportSurface(rid);
            hydrateTrainReportSlots(document.getElementById('view-next-train') || document);
        }
    });

    fetchFeatures().then(() => {
        hideBannerIfOff();
        const rid = $currentRouteId.get();
        if (rid) {
            startDelayReportsListener(rid);
            refreshDelayReportSurface(rid);
        }
    }).catch(hideBannerIfOff);
}

if (typeof window !== 'undefined') {
    window.openDelayReportModal = openDelayReportModal;
    window.openTrainReportModal = openTrainReportModal;
    window.refreshDelayReportSurface = refreshDelayReportSurface;
    window.hydrateTrainReportSlots = hydrateTrainReportSlots;
    window.buildTrainReportSlotHtml = buildTrainReportSlotHtml;
    window.startDelayReportsListener = startDelayReportsListener;
}
