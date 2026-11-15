/**
 * Operator-only read-aloud. The phone sends the words to the reply worker.
 * The worker checks the allowlisted sign-in, then calls Chirp 3 HD.
 * The Cloud key never reaches the page.
 */
import { REPLY_WORKER_URL } from './config.js';
import { isAdminAuthed } from './admin-chrome.js';
import { bootFirebase } from './firebase-boot.js';

const SPEAK_MAX = 900;
let playing = null;
let playingUrl = '';
let pending = false;
let generation = 0;
let clockTimer = 0;

function clock(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

function speechBar() {
    let bar = document.getElementById('nt-operator-speech');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'nt-operator-speech';
    bar.className = 'hidden fixed z-[180] left-1/2 -translate-x-1/2 bottom-[5.5rem] flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1.5 shadow-2xl dark:border-gray-600 dark:bg-gray-900';
    bar.innerHTML = `
        <button type="button" data-speech="pause" class="h-9 w-9 rounded-full text-gray-800 dark:text-gray-100 focus:outline-none" aria-label="Pause"><svg class="mx-auto h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg></button>
        <button type="button" data-speech="play" class="h-9 w-9 rounded-full text-gray-800 dark:text-gray-100 focus:outline-none" aria-label="Play"><svg class="mx-auto h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
        <button type="button" data-speech="restart" class="h-9 w-9 rounded-full text-gray-800 dark:text-gray-100 focus:outline-none" aria-label="Restart"><svg class="mx-auto h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12a9 9 0 109-9"/><path d="M3 4v5h5"/></svg></button>
        <span data-speech-status class="min-w-[7.5rem] px-1 text-xs font-semibold text-gray-700 dark:text-gray-200">Preparing voice</span>
        <button type="button" data-speech="close" class="h-9 w-9 rounded-full text-gray-500 focus:outline-none" aria-label="Close"><svg class="mx-auto h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    bar.addEventListener('click', (event) => {
        const act = event.target.closest?.('[data-speech]')?.getAttribute('data-speech');
        if (act === 'pause') pauseOperatorSpeech();
        if (act === 'play') resumeOperatorSpeech();
        if (act === 'restart') restartOperatorSpeech();
        if (act === 'close') stopOperatorSpeech();
    });
    document.body.appendChild(bar);
    return bar;
}

function setSpeechStatus(text) {
    const bar = speechBar();
    bar.classList.remove('hidden');
    const label = bar.querySelector('[data-speech-status]');
    if (label) label.textContent = text;
}

function hideSpeechBar() {
    document.getElementById('nt-operator-speech')?.classList.add('hidden');
}

function paintClock() {
    if (!playing) return;
    const total = Number.isFinite(playing.duration) ? playing.duration : 0;
    const now = playing.currentTime || 0;
    setSpeechStatus(playing.paused ? `Paused ${clock(now)}` : (total ? `${clock(now)} / ${clock(total)}` : `Playing ${clock(now)}`));
}

function plainSpeech(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(?:#x[0-9a-f]+|#\d+|[a-z]+);/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, SPEAK_MAX);
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

function stopSpeech() {
    if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = 0;
    }
    if (playing) {
        try { playing.pause(); } catch { /* already stopped */ }
        playing = null;
    }
    if (playingUrl) {
        try { URL.revokeObjectURL(playingUrl); } catch { /* ignore */ }
        playingUrl = '';
    }
    hideSpeechBar();
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

/**
 * Read one message. A second call stops the one that is playing.
 * Returns { ok:false } for anyone who is not an allowlisted operator.
 */
export async function speakOperatorCopy(value, options = {}) {
    if (!isAdminAuthed()) return { ok: false, hidden: true };
    const text = plainSpeech(value);
    if (text.length < 2) return { ok: false, message: 'Nothing to read.' };
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
            body: JSON.stringify(options.preview ? { text, preview: options.preview } : { text }),
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
    if (gen !== generation) {
        pending = false;
        return { ok: true, stopped: true };
    }
    if (!blob.size) {
        pending = false;
        hideSpeechBar();
        return { ok: false, message: 'Could not play that.' };
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    pending = false;
    playing = audio;
    playingUrl = url;
    audio.addEventListener('ended', () => {
        if (playing === audio) stopSpeech();
    }, { once: true });
    audio.addEventListener('timeupdate', paintClock);
    clockTimer = window.setInterval(paintClock, 500);
    try {
        await audio.play();
        paintClock();
        if (typeof window.showToast === 'function') window.showToast('Playing', 'success');
    } catch {
        stopSpeech();
        return { ok: false, message: 'Could not play that.' };
    } finally {
        if (gen === generation) pending = false;
    }
    return { ok: true };
}

if (typeof window !== 'undefined') {
    window.ntSpeakOperatorCopy = speakOperatorCopy;
    window.ntStopOperatorSpeech = stopOperatorSpeech;
}
