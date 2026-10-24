/**
 * Full-screen PRASA-style network map preview on SEO landings.
 * Same maximize / pinch / desktop zoom idea as in-app #map-modal.
 */
import { pinchGestureMove, pinchGestureStart, zoomAboutPoint } from './pinch-math.js';

const STEP = 1.35;

function els() {
    const overlay = document.getElementById('seo-map-lightbox');
    const stage = document.getElementById('seo-map-lightbox-stage');
    const img = document.getElementById('seo-map-lightbox-img');
    const title = document.getElementById('seo-map-lightbox-title');
    return { overlay, stage, img, title };
}

let scale = 1;
let pointX = 0;
let pointY = 0;
let panning = false;
let startX = 0;
let startY = 0;
let pinchGesture = null;
let lastTap = 0;
let bound = false;
let open = false;

function state() {
    return { scale, x: pointX, y: pointY };
}

function paint(animate) {
    const { img, stage } = els();
    if (!img) return;
    img.style.transition = animate ? 'transform 160ms ease' : 'none';
    img.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    stage?.classList.toggle('is-zoomed', scale > 1.01);
    if (animate) window.setTimeout(() => { if (img) img.style.transition = ''; }, 180);
}

function apply(next, animate) {
    scale = next.scale;
    pointX = next.x;
    pointY = next.y;
    paint(animate);
}

function reset() {
    apply({ scale: 1, x: 0, y: 0 }, false);
}

function zoomAt(clientX, clientY, nextScale, animate) {
    const { img, stage } = els();
    if (!img || !stage) return;
    const rect = img.getBoundingClientRect();
    apply(zoomAboutPoint(
        state(),
        clientX,
        clientY,
        rect,
        nextScale,
        stage.clientWidth,
        stage.clientHeight,
    ), animate);
}

function lockScroll() {
    document.body.classList.add('modal-active');
}

function unlockScroll() {
    if (document.getElementById('alerts-channel')?.classList.contains('hidden') === false) return;
    if (window._isLightboxMode) return;
    document.body.classList.remove('modal-active');
}

export function closeSeoMapLightbox(fromPopState = false) {
    if (!open) return;
    if (!fromPopState && location.hash === '#seo-map') {
        try { history.back(); return; } catch { /* fall through */ }
    }
    const { overlay } = els();
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        overlay.setAttribute('aria-hidden', 'true');
    }
    open = false;
    reset();
    unlockScroll();
}

export function openSeoMapLightbox({ src, alt, title } = {}) {
    const { overlay, img, title: titleEl } = els();
    if (!overlay || !img || !src) return;
    bindSeoMapLightbox();
    reset();
    if (titleEl) titleEl.textContent = title || 'Network Map';
    img.alt = alt || 'Metrorail network map';
    img.src = src;
    open = true;
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    overlay.setAttribute('aria-hidden', 'false');
    lockScroll();
    if (location.hash !== '#seo-map') {
        try { history.pushState({ modal: 'seo-map' }, '', '#seo-map'); } catch { /* ignore */ }
    }
}

function bindSeoMapLightbox() {
    if (bound || typeof document === 'undefined') return;
    const { overlay, stage, img } = els();
    if (!overlay || !stage || !img) return;
    bound = true;

    stage.style.touchAction = 'none';

    const zoomCenter = () => {
        const rect = stage.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    stage.querySelector('[data-nt-zoom="in"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const c = zoomCenter();
        zoomAt(c.x, c.y, Math.min(5, scale * STEP), true);
    });
    stage.querySelector('[data-nt-zoom="out"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const c = zoomCenter();
        zoomAt(c.x, c.y, scale / STEP, true);
    });

    stage.addEventListener('mousedown', (e) => {
        if (e.target?.closest?.('[data-nt-zoom-controls]')) return;
        e.preventDefault();
        if (scale <= 1) return;
        startX = e.clientX - pointX;
        startY = e.clientY - pointY;
        panning = true;
    });
    stage.addEventListener('mouseup', () => { panning = false; });
    stage.addEventListener('mouseleave', () => { panning = false; });
    stage.addEventListener('mousemove', (e) => {
        if (!panning) return;
        e.preventDefault();
        if (scale <= 1) { apply({ scale: 1, x: 0, y: 0 }, false); return; }
        let nextX = e.clientX - startX;
        let nextY = e.clientY - startY;
        const limitX = Math.max(0, (stage.clientWidth * scale - stage.clientWidth) / 2);
        const limitY = Math.max(0, (stage.clientHeight * scale - stage.clientHeight) / 2);
        if (nextX > limitX) nextX = limitX;
        if (nextX < -limitX) nextX = -limitX;
        if (nextY > limitY) nextY = limitY;
        if (nextY < -limitY) nextY = -limitY;
        pointX = nextX;
        pointY = nextY;
        paint(false);
    });

    stage.addEventListener('dblclick', (e) => {
        if (e.target?.closest?.('[data-nt-zoom-controls]')) return;
        e.preventDefault();
        if (scale > 1.05) apply({ scale: 1, x: 0, y: 0 }, true);
        else zoomAt(e.clientX, e.clientY, 2.5, true);
    });

    stage.addEventListener('wheel', (e) => {
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        e.preventDefault();
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        zoomAt(e.clientX, e.clientY, scale * Math.exp(-delta * 0.0016), false);
    }, { passive: false });

    stage.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            panning = false;
            const rect = img.getBoundingClientRect();
            pinchGesture = pinchGestureStart(state(), rect, e.touches[0], e.touches[1]);
            img.style.transition = 'none';
            return;
        }
        if (e.touches.length === 1) {
            const now = Date.now();
            const gap = now - lastTap;
            if (gap < 300 && gap > 0) {
                e.preventDefault();
                if (scale > 1) apply({ scale: 1, x: 0, y: 0 }, true);
                else zoomAt(e.touches[0].clientX, e.touches[0].clientY, 2.5, true);
                lastTap = 0;
                return;
            }
            lastTap = now;
            startX = e.touches[0].clientX - pointX;
            startY = e.touches[0].clientY - pointY;
            panning = true;
        }
    }, { passive: false });

    stage.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && pinchGesture) {
            e.preventDefault();
            const next = pinchGestureMove(
                pinchGesture,
                e.touches[0],
                e.touches[1],
                stage.clientWidth,
                stage.clientHeight,
            );
            scale = next.scale;
            pointX = next.x;
            pointY = next.y;
            img.style.transition = 'none';
            paint(false);
            return;
        }
        if (!panning || e.touches.length !== 1) return;
        if (scale <= 1) { apply({ scale: 1, x: 0, y: 0 }, false); return; }
        e.preventDefault();
        let nextX = e.touches[0].clientX - startX;
        let nextY = e.touches[0].clientY - startY;
        const limitX = Math.max(0, (stage.clientWidth * scale - stage.clientWidth) / 2);
        const limitY = Math.max(0, (stage.clientHeight * scale - stage.clientHeight) / 2);
        if (nextX > limitX) nextX = limitX;
        if (nextX < -limitX) nextX = -limitX;
        if (nextY > limitY) nextY = limitY;
        if (nextY < -limitY) nextY = -limitY;
        pointX = nextX;
        pointY = nextY;
        paint(false);
    }, { passive: false });

    stage.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) pinchGesture = null;
        if (e.touches.length === 1) {
            startX = e.touches[0].clientX - pointX;
            startY = e.touches[0].clientY - pointY;
            panning = true;
        }
        if (e.touches.length === 0) panning = false;
    });

    overlay.querySelectorAll('[data-seo-map-close]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            closeSeoMapLightbox();
        });
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeSeoMapLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (!open || e.key !== 'Escape') return;
        e.preventDefault();
        closeSeoMapLightbox();
    });
    window.addEventListener('popstate', () => {
        if (open && location.hash !== '#seo-map') closeSeoMapLightbox(true);
    });
}

export function bindSeoNetworkMapTriggers(root) {
    if (typeof document === 'undefined') return;
    bindSeoMapLightbox();
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-seo-map-open]').forEach((el) => {
        if (el.dataset.seoMapBound === '1') return;
        el.dataset.seoMapBound = '1';
        el.addEventListener('click', (e) => {
            if (e.target?.closest?.('[data-nt-zoom-controls]')) return;
            // Inline desktop zoom owns the frame while magnified; open maximize only at 1×.
            if (el.classList.contains('is-zoomed')) return;
            e.preventDefault();
            const src = el.getAttribute('data-seo-map-src')
                || el.querySelector?.('img')?.currentSrc
                || el.querySelector?.('img')?.getAttribute?.('src')
                || '';
            const alt = el.getAttribute('data-seo-map-alt')
                || el.querySelector?.('img')?.getAttribute?.('alt')
                || 'Metrorail network map';
            const title = el.getAttribute('data-seo-map-title') || 'Network Map';
            openSeoMapLightbox({ src, alt, title });
        });
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target?.closest?.('[data-nt-zoom-controls]')) return;
            e.preventDefault();
            el.click();
        });
    });
}
