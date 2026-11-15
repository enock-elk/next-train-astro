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
    if (playing) {
        try { playing.pause(); } catch { /* already stopped */ }
        playing = null;
    }
    if (playingUrl) {
        try { URL.revokeObjectURL(playingUrl); } catch { /* ignore */ }
        playingUrl = '';
    }
}

/**
 * Read one message. A second call stops the one that is playing.
 * Returns { ok:false } for anyone who is not an allowlisted operator.
 */
export async function speakOperatorCopy(value) {
    if (!isAdminAuthed()) return { ok: false, hidden: true };
    const text = plainSpeech(value);
    if (text.length < 2) return { ok: false, message: 'Nothing to read.' };
    if (playing || pending) {
        generation += 1;
        pending = false;
        stopSpeech();
        return { ok: true, stopped: true };
    }
    const gen = generation + 1;
    generation = gen;
    pending = true;
    const token = await operatorToken();
    if (!token || gen !== generation) {
        pending = false;
        return token ? { ok: true, stopped: true } : { ok: false, message: 'Sign in again to play this.' };
    }
    const base = String(REPLY_WORKER_URL || '').replace(/\/$/, '');
    if (!base) {
        pending = false;
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
            body: JSON.stringify({ text }),
        });
    } catch {
        pending = false;
        return { ok: false, message: 'Could not reach voice.' };
    }
    if (gen !== generation) {
        pending = false;
        return { ok: true, stopped: true };
    }
    if (!res.ok) {
        pending = false;
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
        return { ok: false, message: 'Could not play that.' };
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    pending = false;
    playing = audio;
    playingUrl = url;
    audio.addEventListener('ended', stopSpeech, { once: true });
    try {
        await audio.play();
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
}
