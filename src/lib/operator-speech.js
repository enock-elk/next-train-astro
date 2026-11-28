/**
 * Operator-only read-aloud. The phone sends the words to the reply worker.
 * The worker checks the allowlisted sign-in, then calls Chirp 3 HD.
 * The Cloud key never reaches the page. A clip that already played on this
 * phone is kept here, so Play again does not ask the worker a second time.
 */
import { REPLY_WORKER_URL } from './config.js';
import { isAdminAuthed } from './admin-chrome.js';
import { bootFirebase } from './firebase-boot.js';

const SPEAK_MAX = 24000;
const CLIP_CACHE_MAX = 20;
const PLAY_ICON = '<svg data-speech-icon class="mx-auto h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg data-speech-icon class="mx-auto h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
const STOP_ICON = '<svg class="mx-auto h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';

let playing = null;
let pending = false;
let generation = 0;
let clockTimer = 0;
/** @type {Map<string, string>} */
const clipCache = new Map();

function clock(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

function paintSpeechControls() {
    const playingNow = operatorSpeechState() === 'playing';
    document.querySelectorAll('[data-speech="toggle"]').forEach((btn) => {
        btn.setAttribute('aria-label', playingNow ? 'Pause' : 'Play');
        const icon = btn.querySelector('[data-speech-icon]');
        const label = btn.querySelector('[data-speech-label]');
        if (label) label.textContent = playingNow ? 'Pause' : 'Play';
        if (icon) {
            const size = [...icon.classList].filter((name) => name.startsWith('h-') || name.startsWith('w-')).join(' ') || 'h-4 w-4';
            icon.outerHTML = (playingNow ? PAUSE_ICON : PLAY_ICON).replace('h-4 w-4', size);
            return;
        }
        if (!label) btn.innerHTML = playingNow ? PAUSE_ICON : PLAY_ICON;
    });
}

function speechBar() {
    let bar = document.getElementById('nt-operator-speech');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'nt-operator-speech';
    bar.className = 'hidden fixed z-[180] left-1/2 -translate-x-1/2 bottom-[5.5rem] flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1.5 shadow-2xl dark:border-gray-600 dark:bg-gray-900';
    bar.innerHTML = `
        <button type="button" data-speech="toggle" class="h-9 w-9 rounded-full text-gray-800 dark:text-gray-100 focus:outline-none" aria-label="Play">${PLAY_ICON}</button>
        <button type="button" data-speech="stop" class="h-9 w-9 rounded-full text-gray-800 dark:text-gray-100 focus:outline-none" aria-label="Stop">${STOP_ICON}</button>
        <span data-speech-status class="min-w-[7.5rem] px-1 text-xs font-semibold text-gray-700 dark:text-gray-200">Preparing voice</span>
        <button type="button" data-speech="close" class="h-9 w-9 rounded-full text-gray-500 focus:outline-none" aria-label="Close"><svg class="mx-auto h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    bar.addEventListener('click', (event) => {
        const act = event.target.closest?.('[data-speech]')?.getAttribute('data-speech');
        if (act === 'toggle') {
            const state = operatorSpeechState();
            if (state === 'playing') pauseOperatorSpeech();
            else if (state === 'paused') resumeOperatorSpeech();
        }
        if (act === 'stop' || act === 'close') stopOperatorSpeech();
    });
    document.body.appendChild(bar);
    return bar;
}

function copilotTray() {
    const modal = document.getElementById('admin-reply-modal');
    const tray = document.getElementById('admin-reply-speech');
    if (!modal || !tray || modal.classList.contains('hidden')) return null;
    return tray;
}

function readAloudPanel() {
    const panel = document.getElementById('alert-speech');
    if (!panel || panel.classList.contains('hidden')) return null;
    return panel;
}

function setSpeechStatus(text) {
    paintSpeechControls();
    const tray = copilotTray();
    if (tray) {
        document.getElementById('nt-operator-speech')?.classList.add('hidden');
        const label = tray.querySelector('[data-speech-status]');
        if (label) label.textContent = text;
        return;
    }
    const panel = readAloudPanel();
    if (panel) {
        document.getElementById('nt-operator-speech')?.classList.add('hidden');
        const label = document.getElementById('alert-speech-status');
        if (label) label.textContent = text;
        return;
    }
    const bar = speechBar();
    bar.classList.remove('hidden');
    const label = bar.querySelector('[data-speech-status]');
    if (label) label.textContent = text;
}

function resetSpeechDock() {
    const elapsed = document.getElementById('alert-speech-elapsed');
    const total = document.getElementById('alert-speech-total');
    const seek = document.getElementById('alert-speech-seek');
    if (elapsed) elapsed.textContent = '0:00';
    if (total) total.textContent = '0:00';
    if (seek) seek.value = '0';
}

function hideSpeechBar() {
    document.getElementById('nt-operator-speech')?.classList.add('hidden');
    const trayLabel = document.getElementById('admin-reply-speech')?.querySelector('[data-speech-status]');
    if (trayLabel) trayLabel.textContent = 'Not playing';
    const alertLabel = document.getElementById('alert-speech-status');
    if (alertLabel) alertLabel.textContent = 'Not playing';
    resetSpeechDock();
    paintSpeechControls();
}

function paintClock() {
    if (!playing) return;
    const total = Number.isFinite(playing.duration) ? playing.duration : 0;
    const now = playing.currentTime || 0;
    const elapsed = document.getElementById('alert-speech-elapsed');
    const totalEl = document.getElementById('alert-speech-total');
    const seek = document.getElementById('alert-speech-seek');
    if (elapsed) elapsed.textContent = clock(now);
    if (totalEl) totalEl.textContent = total ? clock(total) : '0:00';
    if (seek && document.activeElement !== seek) seek.value = total ? String(Math.round((now / total) * 1000)) : '0';
    if (readAloudPanel() && elapsed) {
        setSpeechStatus(playing.paused ? 'Paused' : 'Playing');
        return;
    }
    setSpeechStatus(playing.paused ? `Paused ${clock(now)}` : (total ? `${clock(now)} / ${clock(total)}` : `Playing ${clock(now)}`));
}

function plainSpeech(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(?:#x[0-9a-f]+|#\d+|[a-z]+);/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function operatorToken() {
    if (typeof window === 'undefined') return '';
    if (!window.firebaseAuth) {
        try { await bootFirebase(); } catch { return ''; }
    }
    if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
        try {
            return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true) || '';
        } catch {
            return '';
        }
    }
    return '';
}

async function clipKey(text, preview) {
    const raw = preview ? `${text}\n${JSON.stringify(preview)}` : text;
    if (!globalThis.crypto?.subtle) return raw;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function rememberClip(key, blob) {
    const existing = clipCache.get(key);
    if (existing) {
        clipCache.delete(key);
        clipCache.set(key, existing);
        return existing;
    }
    const url = URL.createObjectURL(blob);
    clipCache.set(key, url);
    while (clipCache.size > CLIP_CACHE_MAX) {
        const oldest = clipCache.keys().next().value;
        const gone = clipCache.get(oldest);
        clipCache.delete(oldest);
        if (gone && playing?.src !== gone) {
            try { URL.revokeObjectURL(gone); } catch { /* ignore */ }
        }
    }
    return url;
}

function stopSpeech() {
    if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = 0;
    }
    if (playing) {
        try { playing.pause(); } catch { /* already stopped */ }
        playing = null;
    }
    hideSpeechBar();
}

function startClip(url, gen) {
    const audio = new Audio(url);
    pending = false;
    playing = audio;
    audio.addEventListener('ended', () => {
        if (playing === audio) stopSpeech();
    }, { once: true });
    audio.addEventListener('timeupdate', paintClock);
    clockTimer = window.setInterval(paintClock, 500);
    return audio.play().then(() => {
        if (gen !== generation) return { ok: true, stopped: true };
        paintClock();
        if (typeof window.showToast === 'function') window.showToast('Playing', 'success');
        return { ok: true };
    }).catch(() => {
        if (gen === generation) stopSpeech();
        return { ok: false, message: 'Could not play that.' };
    });
}

export function pauseOperatorSpeech() {
    if (!playing) return { ok: false };
    playing.pause();
    paintClock();
    return { ok: true, paused: true };
}

export function resumeOperatorSpeech() {
    if (!playing) return { ok: false, message: 'Nothing is ready to play.' };
    playing.play().then(paintClock).catch(() => {});
    return { ok: true };
}

export function seekOperatorSpeech(ratio) {
    if (!playing) return { ok: false };
    const total = Number(playing.duration);
    if (!Number.isFinite(total) || total <= 0) return { ok: false };
    const next = Math.min(1, Math.max(0, Number(ratio) || 0)) * total;
    playing.currentTime = next;
    paintClock();
    return { ok: true };
}

export function restartOperatorSpeech() {
    if (!playing) return { ok: false, message: 'Nothing is ready to play.' };
    playing.currentTime = 0;
    playing.play().then(paintClock).catch(() => {});
    return { ok: true };
}

/** Stop and remove the bar. Used when Dev Mode returns to its home. */
export function stopOperatorSpeech() {
    generation += 1;
    pending = false;
    stopSpeech();
    return { ok: true, stopped: true };
}

export function operatorSpeechState() {
    if (pending) return 'preparing';
    if (!playing) return 'idle';
    return playing.paused ? 'paused' : 'playing';
}

/**
 * Read one message. A second call stops the one that is playing.
 * Returns { ok:false } for anyone who is not an allowlisted operator.
 */
export async function speakOperatorCopy(value, options = {}) {
    if (!isAdminAuthed()) return { ok: false, hidden: true };
    let text = plainSpeech(value);
    if (text.length < 2) return { ok: false, message: 'Nothing to read.' };
    if (text.length > SPEAK_MAX) {
        text = text.slice(0, SPEAK_MAX);
        if (typeof window.showToast === 'function') window.showToast('Reading the first 24,000 characters.', 'info');
    }
    if ((playing || pending) && !options.fresh) {
        generation += 1;
        pending = false;
        stopSpeech();
        return { ok: true, stopped: true };
    }
    if (playing || pending) {
        generation += 1;
        pending = false;
        stopSpeech();
    }
    const gen = generation + 1;
    generation = gen;
    pending = true;
    setSpeechStatus('Preparing voice');
    const key = await clipKey(text, options.preview);
    const cached = clipCache.get(key);
    if (cached) {
        if (gen !== generation) {
            pending = false;
            return { ok: true, stopped: true };
        }
        if (options.archive) {
            const base = String(REPLY_WORKER_URL || '').replace(/\/$/, '');
            if (base) {
                operatorToken().then((token) => {
                    if (!token) return null;
                    return fetch(`${base}/speak`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ text, archive: true, source: String(value || '').slice(0, SPEAK_MAX), ...(options.preview ? { preview: options.preview } : {}) }),
                    });
                }).then((res) => {
                    if (res?.headers?.get('X-Readaloud-Id')) window.dispatchEvent(new CustomEvent('nt-readaloud-saved'));
                }).catch(() => {});
            }
        }
        const played = await startClip(cached, gen);
        return played.ok ? { ...played, cached: true } : played;
    }
    if (typeof window.showToast === 'function') window.showToast('Preparing voice', 'info');
    const token = await operatorToken();
    if (!token || gen !== generation) {
        pending = false;
        if (gen === generation) hideSpeechBar();
        return token ? { ok: true, stopped: true } : { ok: false, message: 'Sign in again to play this.' };
    }
    const base = String(REPLY_WORKER_URL || '').replace(/\/$/, '');
    if (!base) {
        pending = false;
        hideSpeechBar();
        return { ok: false, message: 'Voice is not configured.' };
    }
    let res;
    try {
        res = await fetch(`${base}/speak`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                text,
                ...(options.archive ? { archive: true, source: String(value || '').slice(0, SPEAK_MAX) } : {}),
                ...(options.preview ? { preview: options.preview } : {}),
            }),
        });
    } catch {
        pending = false;
        hideSpeechBar();
        return { ok: false, message: 'Could not reach voice.' };
    }
    if (gen !== generation) {
        pending = false;
        return { ok: true, stopped: true };
    }
    if (!res.ok) {
        pending = false;
        hideSpeechBar();
        const data = await res.json().catch(() => ({}));
        return { ok: false, message: data.error || 'Could not play that.' };
    }
    const blob = await res.blob();
    if (options.archive && res.headers.get('X-Readaloud-Saved') === '0' && typeof window.showToast === 'function') {
        window.showToast('Played. Archive storage is not on the voice worker yet.', 'info');
    } else if (options.archive && res.headers.get('X-Readaloud-Id')) {
        window.dispatchEvent(new CustomEvent('nt-readaloud-saved'));
    }
    if (gen !== generation) {
        pending = false;
        return { ok: true, stopped: true };
    }
    if (!blob.size) {
        pending = false;
        hideSpeechBar();
        return { ok: false, message: 'Could not play that.' };
    }
    const url = rememberClip(key, blob);
    return startClip(url, gen);
}

export async function playOperatorBlob(blob) {
    if (!isAdminAuthed()) return { ok: false, hidden: true };
    if (!blob?.size) return { ok: false, message: 'Could not play that.' };
    generation += 1;
    pending = false;
    stopSpeech();
    const gen = generation;
    return startClip(URL.createObjectURL(blob), gen);
}

async function readAloudFetch(path, init = {}) {
    const token = await operatorToken();
    const base = String(REPLY_WORKER_URL || '').replace(/\/$/, '');
    if (!token || !base) return null;
    const res = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
    return res;
}

export async function listReadAloudArchive() {
    if (!isAdminAuthed()) return { ok: false, hidden: true, items: [] };
    const res = await readAloudFetch('/speak/archive');
    if (!res) return { ok: false, message: 'Sign in again to open the archive.', items: [] };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || 'Could not open the archive.', items: [] };
    return { ok: true, items: Array.isArray(data.items) ? data.items : [] };
}

export async function openReadAloudArchive(id) {
    if (!isAdminAuthed()) return { ok: false, hidden: true };
    const safe = String(id || '');
    if (!/^[a-f0-9]{16}$/.test(safe)) return { ok: false, message: 'That reading is gone.' };
    const [textRes, audioRes] = await Promise.all([
        readAloudFetch(`/speak/archive/${safe}`),
        readAloudFetch(`/speak/archive/${safe}/audio`),
    ]);
    if (!textRes || !audioRes) return { ok: false, message: 'Sign in again to play this.' };
    const data = await textRes.json().catch(() => ({}));
    if (!textRes.ok) return { ok: false, message: data.error || 'Could not open that reading.' };
    if (!audioRes.ok) {
        const err = await audioRes.json().catch(() => ({}));
        return { ok: false, message: err.error || 'Could not play that.' };
    }
    const box = document.getElementById('alert-speech-text');
    if (box) box.value = String(data.text || '');
    const blob = await audioRes.blob();
    return playOperatorBlob(blob);
}

export async function deleteReadAloudArchive(id) {
    if (!isAdminAuthed()) return { ok: false, hidden: true };
    const safe = String(id || '');
    if (!/^[a-f0-9]{16}$/.test(safe)) return { ok: false, message: 'That reading is gone.' };
    const res = await readAloudFetch(`/speak/archive/${safe}`, { method: 'DELETE' });
    if (!res) return { ok: false, message: 'Sign in again to remove this.' };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || 'Could not remove that reading.' };
    return { ok: true };
}

if (typeof window !== 'undefined') {
    window.ntSpeakOperatorCopy = speakOperatorCopy;
    window.ntStopOperatorSpeech = stopOperatorSpeech;
    window.ntPauseOperatorSpeech = pauseOperatorSpeech;
    window.ntResumeOperatorSpeech = resumeOperatorSpeech;
    window.ntRestartOperatorSpeech = restartOperatorSpeech;
    window.ntSeekOperatorSpeech = seekOperatorSpeech;
    window.ntOperatorSpeechState = operatorSpeechState;
    window.ntListReadAloudArchive = listReadAloudArchive;
    window.ntOpenReadAloudArchive = openReadAloudArchive;
    window.ntDeleteReadAloudArchive = deleteReadAloudArchive;
}
