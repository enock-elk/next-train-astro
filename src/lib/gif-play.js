/**
 * A GIF plays a few times, then rests on the frame it reached.
 * Replay starts that same run again. JPEG and PNG are left alone.
 */

export const GIF_PLAY_LOOPS = 3;

const restMsByUrl = new Map();
const timers = new WeakMap();

export function isGifUrl(url) {
    const clean = String(url || '').split('#')[0].split('?')[0].trim();
    return /\.gif$/i.test(clean);
}

/** One loop, in milliseconds. A zero delay is the 100ms browsers use. */
export function gifLoopMs(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (b.length < 13) return 0;
    const sig = String.fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5]);
    if (sig !== 'GIF87a' && sig !== 'GIF89a') return 0;
    let i = 13;
    if (b[10] & 0x80) i += 3 * (2 ** ((b[10] & 0x07) + 1));
    let delayCs = 0;
    let frames = 0;
    while (i < b.length) {
        const code = b[i];
        if (code === 0x3b) break;
        if (code === 0x21) {
            const label = b[i + 1];
            i += 2;
            if (label === 0xf9 && b[i] >= 4 && i + 3 < b.length) {
                const raw = b[i + 2] | (b[i + 3] << 8);
                delayCs += raw === 0 ? 10 : raw;
                frames += 1;
            }
            while (i < b.length) {
                const n = b[i];
                i += 1;
                if (!n) break;
                i += n;
            }
            continue;
        }
        if (code === 0x2c) {
            if (i + 10 > b.length) break;
            const localPacked = b[i + 9];
            i += 10;
            if (localPacked & 0x80) i += 3 * (2 ** ((localPacked & 0x07) + 1));
            i += 1;
            while (i < b.length) {
                const n = b[i];
                i += 1;
                if (!n) break;
                i += n;
            }
            continue;
        }
        break;
    }
    if (!frames) return 0;
    return delayCs * 10;
}

export function gifRestAfterMs(loopMs) {
    const one = Number(loopMs) > 0 ? Number(loopMs) : 2400;
    return Math.min(20000, Math.max(1800, one * GIF_PLAY_LOOPS));
}

function gifSource(img) {
    return img?.dataset?.ntGifPlay || img?.dataset?.ntGifSrc || img?.currentSrc || img?.getAttribute?.('src') || '';
}

async function restDelay(img) {
    const source = gifSource(img);
    if (!source) return gifRestAfterMs(0);
    if (restMsByUrl.has(source)) return restMsByUrl.get(source);
    const job = fetch(source)
        .then((res) => (res.ok ? res.arrayBuffer() : null))
        .then((buf) => gifRestAfterMs(buf ? gifLoopMs(buf) : 0))
        .catch(() => gifRestAfterMs(0));
    restMsByUrl.set(source, job);
    const ms = await job;
    restMsByUrl.set(source, ms);
    return ms;
}

function clearRestTimer(img) {
    const id = timers.get(img);
    if (id) clearTimeout(id);
    timers.delete(img);
}

function restGif(img) {
    const wrap = img.closest?.('.nt-gif');
    if (!wrap || !img.isConnected) return;
    const canvas = wrap.querySelector('canvas');
    if (canvas && img.naturalWidth > 0 && img.naturalHeight > 0) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(img, 0, 0);
    }
    const playing = img.currentSrc || img.getAttribute('src') || '';
    if (playing) img.dataset.ntGifPlay = playing;
    wrap.classList.add('is-resting');
    img.removeAttribute('src');
}

function scheduleRest(img) {
    clearRestTimer(img);
    restDelay(img).then((ms) => {
        if (!img.isConnected || img.closest?.('.nt-gif')?.classList.contains('is-resting')) return;
        clearRestTimer(img);
        const id = setTimeout(() => restGif(img), ms);
        timers.set(img, id);
    }).catch(() => {});
}

function replayGif(img) {
    const wrap = img.closest?.('.nt-gif');
    if (!wrap) return;
    wrap.classList.remove('is-resting');
    const next = img.dataset.ntGifPlay || img.dataset.ntGifSrc || '';
    if (next) img.src = next;
    if (img.complete && img.naturalWidth > 0) scheduleRest(img);
    else img.addEventListener('load', () => scheduleRest(img), { once: true });
}

function startGifPlayer(img) {
    if (!img || img.dataset.ntGifArmed === '1') return;
    const marked = img.dataset.ntGifSrc || '';
    const current = img.getAttribute('src') || '';
    if (!isGifUrl(marked) && !isGifUrl(current)) return;
    img.dataset.ntGifArmed = '1';
    if (!marked && isGifUrl(current)) img.dataset.ntGifSrc = current;
    const parent = img.parentNode;
    if (!parent) return;
    let wrap = img.closest('.nt-gif');
    if (!wrap) {
        wrap = document.createElement('span');
        wrap.className = 'nt-gif';
        const pos = window.getComputedStyle(img).position;
        if (pos === 'absolute' || pos === 'fixed') wrap.classList.add('is-fill');
        parent.insertBefore(wrap, img);
        wrap.appendChild(img);
        const canvas = document.createElement('canvas');
        canvas.className = 'nt-gif-still';
        canvas.setAttribute('aria-hidden', 'true');
        const fit = img.classList.contains('object-cover') ? 'cover' : 'contain';
        canvas.style.objectFit = fit;
        wrap.appendChild(canvas);
        const replay = document.createElement('span');
        replay.className = 'nt-gif-replay';
        replay.dataset.ntGifReplay = '1';
        replay.setAttribute('role', 'button');
        replay.tabIndex = 0;
        replay.setAttribute('aria-label', 'Replay');
        replay.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.16-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"/></svg>';
        const onReplay = (event) => {
            event.preventDefault();
            event.stopPropagation();
            replayGif(img);
        };
        replay.addEventListener('click', onReplay);
        replay.addEventListener('pointerdown', (event) => event.stopPropagation());
        replay.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true });
        replay.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            onReplay(event);
        });
        wrap.appendChild(replay);
    }
    const begin = () => {
        if (!img.isConnected || wrap.classList.contains('is-resting')) return;
        const playing = img.currentSrc || img.getAttribute('src') || '';
        if (playing) img.dataset.ntGifPlay = playing;
        scheduleRest(img);
    };
    if (img.complete && img.naturalWidth > 0) begin();
    else img.addEventListener('load', begin, { once: true });
}

export function armGifPlayers(root) {
    const scope = root && root.querySelectorAll ? root : (typeof document !== 'undefined' ? document : null);
    if (!scope?.querySelectorAll) return;
    const imgs = [];
    if (scope.tagName === 'IMG') imgs.push(scope);
    scope.querySelectorAll('img').forEach((img) => imgs.push(img));
    imgs.forEach(startGifPlayer);
}

if (typeof window !== 'undefined') {
    window.armGifPlayers = armGifPlayers;
    window.isGifUrl = isGifUrl;
}
