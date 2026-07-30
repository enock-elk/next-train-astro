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

const GUEST_GLOBAL_MS = 45 * 60 * 1000;
const GUEST_ROUTE_MS = 2 * 60 * 60 * 1000;
const AUTH_GLOBAL_MS = 30 * 60 * 1000;
const AUTH_GLOBAL_MAX = 5;
const AUTH_ROUTE_MS = 8 * 60 * 1000;
const SURFACE_WINDOW_MS = 3 * 60 * 60 * 1000;
const REPORT_WINDOW_SEC = 20 * 60; // ±20 min around scheduled station time
const RATE_KEY = 'delayReportRateV1';

const LATE_MID = { '1-5': 3, '6-10': 8, '11-20': 15, '21+': 25, unsure: 10 };

/** @type {Record<string, object[]>} */
let routeReportCache = {};
let routeReportCacheAt = {};

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
    matched.forEach((r) => {
        const s = r.trainStatus || r.status;
        if (s === 'early' || s === 'on_time' || s === 'late' || s === 'cancelled') counts[s] += 1;
        else if (r.severity === 'severe') counts.late += 1;
        else counts.late += 1;
        if ((r.trainStatus || r.status) === 'late' || r.lateBucket) {
            lateSum += LATE_MID[r.lateBucket] || 10;
            lateN += 1;
        }
    });

    let top = 'late';
    let topN = -1;
    Object.entries(counts).forEach(([k, n]) => {
        if (n > topN) { top = k; topN = n; }
    });

    return {
        count: matched.length,
        status: top,
        avgLateMin: lateN ? Math.round(lateSum / lateN) : null,
        scheduledTime: keyParts.scheduledTime,
        arrivalTime: keyParts.arrivalTime || matched[0]?.arrivalTime || null,
    };
}

function statusLabel(agg) {
    if (!agg) return '';
    if (agg.status === 'cancelled') return 'Cancelled / not coming';
    if (agg.status === 'early') return `Now ~ ${agg.avgLateMin || 3} min early`;
    if (agg.status === 'on_time') return 'On time';
    return `Now ~ ${agg.avgLateMin || 10} min late`;
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

/** HTML injected into journey description box */
export function buildTrainReportSlotHtml({
    routeId, trainId, scheduledTime, arrivalTime, station, destination,
}) {
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

    if (!reportable) {
        return `<div class="mt-1.5 w-full px-0.5" ${attrs}></div>`;
    }

    return `<div class="mt-1.5 w-full px-0.5" ${attrs}>
      <button type="button" class="train-report-flag inline-flex items-center justify-center gap-1 mx-auto px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:outline-none border border-transparent hover:border-blue-200 dark:hover:border-blue-800" data-open-train-report title="Report this train">
        <svg class="w-3.5 h-3.5 ${flagColorClass(null)}" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3a1 1 0 011-1h.5a1 1 0 01.8.4L7 5h8a1 1 0 01.8 1.6l-1.5 2a1 1 0 000 1.2l1.5 2A1 1 0 0115 13H7l-1.7 2.6A1 1 0 014.5 16H4a1 1 0 01-1-1V3z"/></svg>
        Report
      </button>
    </div>`;
}

export async function hydrateTrainReportSlots(root = document) {
    const slots = (root || document).querySelectorAll?.('[data-train-report-slot][data-reportable="1"]');
    if (!slots?.length) return;

    const routeIds = [...new Set([...slots].map((s) => s.getAttribute('data-route')).filter(Boolean))];
    const byRoute = {};
    await Promise.all(routeIds.map(async (rid) => {
        byRoute[rid] = await fetchRecentRouteReports(rid);
    }));

    slots.forEach((slot) => {
        const routeId = slot.getAttribute('data-route');
        const trainId = slot.getAttribute('data-train');
        const scheduledTime = slot.getAttribute('data-dep');
        const arrivalTime = slot.getAttribute('data-arr');
        const station = slot.getAttribute('data-station');
        const destination = slot.getAttribute('data-dest');
        const agg = aggregateTrainReports(byRoute[routeId] || [], {
            routeId, trainId, scheduledTime, station, arrivalTime,
        });

        if (!agg) return;

        const usual = formatTimeDisplay(arrivalTime || scheduledTime);
        const usualLabel = arrivalTime ? `Usually arrives ${usual}` : `Usually ${usual}`;
        const liveCls = statusColorClass(agg.status);
        const flagCls = flagColorClass(agg.status);

        slot.innerHTML = `
          <button type="button" class="train-live-chip w-full text-left px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 shadow-sm focus:outline-none hover:border-blue-300 dark:hover:border-blue-700" data-open-train-report
            data-route="${escapeHTML(routeId || '')}" data-train="${escapeHTML(trainId || '')}" data-dep="${escapeHTML(scheduledTime || '')}"
            data-arr="${escapeHTML(arrivalTime || '')}" data-station="${escapeHTML(station || '')}" data-dest="${escapeHTML(destination || '')}">
            <div class="flex items-center gap-1 mb-0.5">
              <span class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
              <span class="text-[8px] font-black uppercase tracking-widest text-gray-500">Live update</span>
              <svg class="w-3 h-3 ml-auto ${flagCls}" fill="currentColor" viewBox="0 0 20 20"><path d="M3 3a1 1 0 011-1h.5a1 1 0 01.8.4L7 5h8a1 1 0 01.8 1.6l-1.5 2a1 1 0 000 1.2l1.5 2A1 1 0 0115 13H7l-1.7 2.6A1 1 0 014.5 16H4a1 1 0 01-1-1V3z"/></svg>
            </div>
            <p class="text-[9px] text-gray-500 dark:text-gray-400 leading-tight">${escapeHTML(usualLabel)}</p>
            <p class="text-[10px] font-black ${liveCls} leading-tight">${escapeHTML(statusLabel(agg))}</p>
            <p class="text-[9px] text-gray-400 mt-0.5 flex items-center gap-0.5">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"/></svg>
              ${agg.count} report${agg.count === 1 ? '' : 's'}
            </p>
          </button>`;
    });
}

function showTrainReportStep(step) {
    document.getElementById('tr-step-status')?.classList.toggle('hidden', step !== 'status');
    document.getElementById('tr-step-late')?.classList.toggle('hidden', step !== 'late');
    document.getElementById('tr-step-done')?.classList.toggle('hidden', step !== 'done');
}

export function openTrainReportModal(opts = {}) {
    const routeId = opts.routeId || $currentRouteId.get() || '';
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

    if (!routeId) {
        banner.classList.add('hidden');
        return;
    }

    const reports = await fetchRecentRouteReports(routeId);
    const withTrain = reports.filter((r) => r.trainId);
    if (!withTrain.length) {
        banner.classList.add('hidden');
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
    banner.classList.remove('hidden');
    if (badge) {
        badge.textContent = String(count);
        badge.classList.remove('hidden');
    }
}

export async function getPlannerCrowdDelayHtml(routeIds = []) {
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

    document.getElementById('delay-report-cancel')?.addEventListener('click', () => closeSmoothModal('delay-report-modal'));
    document.getElementById('tr-done-btn')?.addEventListener('click', () => closeSmoothModal('delay-report-modal'));
    document.getElementById('tr-late-back')?.addEventListener('click', () => showTrainReportStep('status'));

    document.querySelectorAll('[data-tr-status]').forEach((btn) => {
        btn.addEventListener('click', () => finishSimpleStatus(btn.getAttribute('data-tr-status')));
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

    // Legacy corridor entry (banner) → open with current station, no train (still usable)
    document.getElementById('delay-report-banner-cta')?.addEventListener('click', () => {
        openTrainReportModal({
            routeId: $currentRouteId.get(),
            station: document.getElementById('station-select')?.value || '',
        });
    });

    $currentRouteId.subscribe((id) => {
        if (id) {
            refreshDelayReportSurface(id);
            setTimeout(() => hydrateTrainReportSlots(document.getElementById('view-next-train') || document), 400);
        }
    });

    const rid = $currentRouteId.get();
    if (rid) refreshDelayReportSurface(rid);
}

if (typeof window !== 'undefined') {
    window.openDelayReportModal = openDelayReportModal;
    window.openTrainReportModal = openTrainReportModal;
    window.refreshDelayReportSurface = refreshDelayReportSurface;
    window.hydrateTrainReportSlots = hydrateTrainReportSlots;
    window.buildTrainReportSlotHtml = buildTrainReportSlotHtml;
}
