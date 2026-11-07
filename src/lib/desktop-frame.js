/**
 * Desktop window vs the phone column.
 * A wide screen with a mouse starts in the desktop window.
 * Phone preview keeps that column on the same machine so a desktop
 * can still show the layout commuters see.
 */
const STORAGE_KEY = 'ntFrame';
const DESKTOP_MQ = '(min-width: 1024px) and (any-hover: hover) and (any-pointer: fine), (min-width: 1024px) and (hover: hover) and (pointer: fine)';

function wideDesktop() {
    try {
        return window.matchMedia(DESKTOP_MQ).matches;
    } catch {
        return false;
    }
}

function savedFrame() {
    try {
        const v = localStorage.getItem(STORAGE_KEY) || '';
        return v === 'phone' || v === 'desktop' ? v : '';
    } catch {
        return '';
    }
}

export function resolveDesktopFrame() {
    if (!wideDesktop()) return 'phone';
    if (savedFrame() === 'phone') return 'phone';
    return 'desktop';
}

function paintFrameControl() {
    const root = document.documentElement;
    const frame = root.getAttribute('data-nt-frame') === 'desktop' ? 'desktop' : 'phone';
    const can = wideDesktop();
    if (can) root.setAttribute('data-nt-can-desktop', '1');
    else root.removeAttribute('data-nt-can-desktop');
    const btn = document.getElementById('nt-frame-toggle');
    if (btn) {
        btn.hidden = !can;
        btn.textContent = frame === 'phone' ? 'Desktop layout' : 'Phone preview';
        btn.setAttribute('aria-pressed', frame === 'phone' ? 'true' : 'false');
    }
    const row = document.getElementById('settings-frame-row');
    if (row) {
        const show = can;
        row.hidden = !show;
        row.classList.toggle('hidden', !show);
        row.setAttribute('aria-hidden', show ? 'false' : 'true');
    }
    document.querySelectorAll('[data-nt-frame-choice]').forEach((el) => {
        const on = el.getAttribute('data-nt-frame-choice') === frame;
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
        el.classList.toggle('is-on', on);
    });
}

export function setDesktopFrame(next) {
    try {
        if (next === 'phone' || next === 'desktop') localStorage.setItem(STORAGE_KEY, next);
        else localStorage.removeItem(STORAGE_KEY);
    } catch { /* private mode */ }
    document.documentElement.setAttribute('data-nt-frame', resolveDesktopFrame());
    paintFrameControl();
}

export function initDesktopFrame() {
    if (typeof document === 'undefined' || document.documentElement.dataset.ntFrameBound === '1') return;
    document.documentElement.dataset.ntFrameBound = '1';
    document.documentElement.setAttribute('data-nt-frame', resolveDesktopFrame());
    paintFrameControl();
    document.getElementById('nt-frame-toggle')?.addEventListener('click', () => {
        const now = document.documentElement.getAttribute('data-nt-frame');
        setDesktopFrame(now === 'desktop' ? 'phone' : 'desktop');
    });
    document.querySelectorAll('[data-nt-frame-choice]').forEach((el) => {
        el.addEventListener('click', () => {
            const choice = el.getAttribute('data-nt-frame-choice');
            if (choice === 'phone' || choice === 'desktop') setDesktopFrame(choice);
        });
    });
    try {
        window.matchMedia(DESKTOP_MQ).addEventListener('change', () => {
            document.documentElement.setAttribute('data-nt-frame', resolveDesktopFrame());
            paintFrameControl();
        });
    } catch { /* ignore */ }
    if (typeof window !== 'undefined') window.ntSetDesktopFrame = setDesktopFrame;
}
