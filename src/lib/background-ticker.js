/**
 * Throttle-resistant interval for an active live share.
 *
 * Mobile browsers slow main-thread timers once a tab is hidden (Chrome
 * intensive throttling clamps setInterval to once a minute after ~5 min).
 * A dedicated Worker's timers are not subject to that clamp, so the share
 * loop ticks from an inline Blob worker and only falls back to setInterval
 * when Workers or Blob URLs are unavailable (old WebViews, CSP).
 *
 * This does not keep GPS alive on a locked screen; the screen wake lock in
 * geo-watch.js does that. It keeps the publish cadence honest while the
 * commuter switches apps, and lets a resumed tab publish immediately.
 */

const WORKER_SOURCE = `
let timer = 0;
self.onmessage = function (ev) {
    const data = ev && ev.data || {};
    if (data.type === 'start') {
        if (timer) clearInterval(timer);
        const ms = Math.max(250, Number(data.ms) || 1000);
        timer = setInterval(function () { self.postMessage({ type: 'tick', at: Date.now() }); }, ms);
    } else if (data.type === 'stop') {
        if (timer) clearInterval(timer);
        timer = 0;
    }
};
`;

let sharedBlobUrl = '';

function workerUrl() {
    if (sharedBlobUrl) return sharedBlobUrl;
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
    try {
        sharedBlobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }));
    } catch {
        sharedBlobUrl = '';
    }
    return sharedBlobUrl;
}

/**
 * @param {() => void} fn
 * @param {number} ms
 * @returns {{ stop: () => void, usingWorker: boolean }}
 */
export function startBackgroundTicker(fn, ms) {
    const interval = Math.max(250, Number(ms) || 1000);
    let worker = null;
    let fallback = 0;
    let stopped = false;
    const fire = () => {
        if (stopped) return;
        try { fn(); } catch { /* tick handler */ }
    };
    const url = typeof Worker !== 'undefined' ? workerUrl() : '';
    if (url) {
        try {
            worker = new Worker(url);
            worker.onmessage = (ev) => {
                if (ev?.data?.type === 'tick') fire();
            };
            worker.onerror = () => {
                try { worker?.terminate(); } catch { /* ignore */ }
                worker = null;
                if (!stopped && !fallback) fallback = setInterval(fire, interval);
            };
            worker.postMessage({ type: 'start', ms: interval });
        } catch {
            worker = null;
        }
    }
    if (!worker) fallback = setInterval(fire, interval);
    return {
        usingWorker: !!worker,
        stop() {
            stopped = true;
            if (worker) {
                try { worker.postMessage({ type: 'stop' }); } catch { /* ignore */ }
                try { worker.terminate(); } catch { /* ignore */ }
                worker = null;
            }
            if (fallback) {
                clearInterval(fallback);
                fallback = 0;
            }
        },
    };
}
