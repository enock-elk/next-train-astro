/**
 * Desktop zoom for a still image (SEO network maps).
 * Touch screens keep the picture still. Pinch lives on the app map and lightbox.
 */
import { clampPan, zoomAboutPoint } from './pinch-math.js';

const STEP = 1.35;

function isDesktop() {
    return typeof window !== 'undefined'
        && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function bindFrame(frame) {
    if (!frame || frame.dataset.ntZoomBound === '1') return;
    const img = frame.querySelector('[data-nt-zoom-target]') || frame.querySelector('img');
    if (!img) return;
    frame.dataset.ntZoomBound = '1';
    if (!isDesktop()) return;

    let scale = 1;
    let x = 0;
    let y = 0;
    let panning = false;
    let startX = 0;
    let startY = 0;

    const paint = () => {
        img.style.transformOrigin = 'center center';
        img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        frame.classList.toggle('is-zoomed', scale > 1.01);
        frame.style.cursor = scale > 1.01 ? 'grab' : 'zoom-in';
    };

    const apply = (next, animate) => {
        scale = next.scale;
        x = next.x;
        y = next.y;
        img.style.transition = animate ? 'transform 160ms ease' : 'none';
        paint();
        if (animate) window.setTimeout(() => { img.style.transition = ''; }, 180);
    };

    const zoomAt = (clientX, clientY, nextScale, animate) => {
        const rect = img.getBoundingClientRect();
        apply(zoomAboutPoint(
            { scale, x, y },
            clientX,
            clientY,
            rect,
            nextScale,
            frame.clientWidth,
            frame.clientHeight,
        ), animate);
    };

    const center = () => {
        const rect = frame.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    frame.querySelector('[data-nt-zoom="in"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const c = center();
        zoomAt(c.x, c.y, Math.min(5, scale * STEP), true);
    });
    frame.querySelector('[data-nt-zoom="out"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const c = center();
        zoomAt(c.x, c.y, scale / STEP, true);
    });
    frame.querySelector('[data-nt-zoom-controls]')?.addEventListener('mousedown', (e) => e.stopPropagation());

    frame.addEventListener('dblclick', (e) => {
        if (e.target?.closest?.('[data-nt-zoom-controls]')) return;
        e.preventDefault();
        if (scale > 1.05) apply({ scale: 1, x: 0, y: 0 }, true);
        else zoomAt(e.clientX, e.clientY, 2.5, true);
    });

    frame.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        const factor = Math.exp(-delta * 0.0016);
        zoomAt(e.clientX, e.clientY, scale * factor, false);
    }, { passive: false });

    frame.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || scale <= 1 || e.target?.closest?.('[data-nt-zoom-controls]')) return;
        e.preventDefault();
        panning = true;
        startX = e.clientX - x;
        startY = e.clientY - y;
        frame.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => {
        if (!panning) return;
        panning = false;
        paint();
    });
    window.addEventListener('mousemove', (e) => {
        if (!panning) return;
        const pan = clampPan(e.clientX - startX, e.clientY - startY, scale, frame.clientWidth, frame.clientHeight);
        x = pan.x;
        y = pan.y;
        img.style.transition = 'none';
        paint();
    });

    paint();
}

export function bindDesktopZoomFrames(root) {
    if (typeof document === 'undefined') return;
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-nt-zoom-frame]').forEach(bindFrame);
}
