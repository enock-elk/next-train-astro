/**
 * Network map + alert image pinch/pan/zoom viewer (ported from SPA map-viewer.js).
 */
import { openSmoothModal, closeSmoothModal, lockBackgroundScroll } from './ui.js';
import { trackAnalyticsEvent } from './analytics.js';
import { pinchGestureMove, pinchGestureStart, zoomAboutPoint } from './pinch-math.js';

let mapModal, closeMapBtn, closeMapBtn2, viewMapBtn;
let mapContainer, mapImage, mapZoomIn, mapZoomOut;

let scale = 1;
let pointX = 0;
let pointY = 0;
let panning = false;
let startX = 0;
let startY = 0;
let pinchGesture = null;
let lastTap = 0;
let _bound = false;

export function resetMap() {
    scale = 1;
    pointX = 0;
    pointY = 0;
    if (mapImage) {
        mapImage.style.transform = 'translate(0px, 0px) scale(1)';
    }
}

function mapState() {
    return { scale, x: pointX, y: pointY };
}

function applyMapState(next, animate) {
    scale = next.scale;
    pointX = next.x;
    pointY = next.y;
    if (mapImage) {
        mapImage.style.transition = animate ? 'transform 160ms ease' : 'none';
        if (animate) {
            window.setTimeout(() => {
                if (mapImage) mapImage.style.transition = '';
            }, 180);
        }
    }
    updateTransform();
}

function updateTransform() {
    if (mapImage) {
        mapImage.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    }
    mapContainer?.classList.toggle('is-zoomed', scale > 1.01);
}

function zoomMapAt(clientX, clientY, nextScale, animate) {
    if (!mapContainer) return;
    const rect = (mapImage || mapContainer).getBoundingClientRect();
    applyMapState(zoomAboutPoint(
        mapState(),
        clientX,
        clientY,
        rect,
        nextScale,
        mapContainer.offsetWidth,
        mapContainer.offsetHeight,
    ), animate);
}

function openMap() {
    if (!mapModal) return;
    resetMap();
    if (typeof window.ensureMapImageLoaded === 'function') {
        try { window.ensureMapImageLoaded(); } catch { /* ignore */ }
    }
    if (typeof window.closeAppHub === 'function') {
        try { window.closeAppHub(true); } catch { /* ignore */ }
    } else {
        const sidenav = document.getElementById('sidenav');
        const sidenavOverlay = document.getElementById('sidenav-overlay');
        if (sidenav) {
            sidenav.classList.remove('open', 'translate-x-0', '-translate-x-full');
            sidenav.classList.add('translate-x-full');
            if (sidenavOverlay) {
                sidenavOverlay.classList.remove('open');
                sidenavOverlay.classList.add('hidden', 'opacity-0');
            }
            document.body.classList.remove('sidenav-open');
        }
    }
    if (typeof openSmoothModal === 'function') openSmoothModal('map-modal');
    else {
        mapModal.classList.remove('hidden', 'opacity-0');
        lockBackgroundScroll();
    }
    trackAnalyticsEvent('click_static_map', { location: 'sidenav' });
}

function closeMap() {
    const closeBtn2 = document.getElementById('close-map-btn-2');
    if (closeBtn2?.dataset.plannerReturnLabel) {
        closeBtn2.textContent = closeBtn2.dataset.plannerReturnLabel;
        delete closeBtn2.dataset.plannerReturnLabel;
    }
    try { sessionStorage.removeItem('nt_map_from_planner'); } catch { /* ignore */ }
    if (location.hash === '#prasa-map') {
        try { history.back(); return; } catch { /* fall through */ }
    }
    if (typeof closeSmoothModal === 'function') closeSmoothModal('map-modal');
    else if (mapModal) mapModal.classList.add('hidden');
    resetMap();
}

export function setupMapLogic() {
    if (typeof document === 'undefined') return;

    mapModal = document.getElementById('map-modal');
    closeMapBtn = document.getElementById('close-map-btn');
    closeMapBtn2 = document.getElementById('close-map-btn-2');
    viewMapBtn = document.getElementById('view-map-btn');
    mapContainer = document.getElementById('map-container');
    mapImage = document.getElementById('map-image');
    mapZoomIn = mapContainer?.querySelector('[data-nt-zoom="in"]') || null;
    mapZoomOut = mapContainer?.querySelector('[data-nt-zoom="out"]') || null;

    if (!mapModal) return;

    // Always keep close/zoom bindings fresh (lightbox may hijack close handlers)
    if (viewMapBtn) viewMapBtn.onclick = (e) => {
        e?.preventDefault?.();
        openMap();
    };
    if (closeMapBtn) closeMapBtn.onclick = (e) => {
        e?.preventDefault?.();
        if (window._isLightboxMode && typeof window.closeLightbox === 'function') {
            window.closeLightbox();
            return;
        }
        closeMap();
    };
    if (closeMapBtn2) closeMapBtn2.onclick = (e) => {
        e?.preventDefault?.();
        if (window._isLightboxMode && typeof window.closeLightbox === 'function') {
            window.closeLightbox();
            return;
        }
        closeMap();
    };

    const zoomCenter = () => {
        const rect = mapContainer.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    if (mapZoomIn) {
        mapZoomIn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const c = zoomCenter();
            zoomMapAt(c.x, c.y, Math.min(5, scale * 1.35), true);
        };
    }
    if (mapZoomOut) {
        mapZoomOut.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const c = zoomCenter();
            zoomMapAt(c.x, c.y, scale / 1.35, true);
        };
    }
    if (_bound || !mapContainer) {
        window.resetMap = resetMap;
        return;
    }
    _bound = true;

    mapContainer.style.touchAction = 'none';

    mapContainer.addEventListener('mousedown', (e) => {
        if (e.target?.closest?.('[data-nt-zoom-controls]')) return;
        e.preventDefault();
        if (scale <= 1) return;
        startX = e.clientX - pointX;
        startY = e.clientY - pointY;
        panning = true;
    });
    mapContainer.addEventListener('mouseup', () => { panning = false; });
    mapContainer.addEventListener('mouseleave', () => { panning = false; });
    mapContainer.addEventListener('mousemove', (e) => {
        if (!panning) return;
        e.preventDefault();
        if (scale <= 1) { pointX = 0; pointY = 0; updateTransform(); return; }
        let nextX = e.clientX - startX;
        let nextY = e.clientY - startY;
        const limitX = (mapContainer.offsetWidth * scale - mapContainer.offsetWidth) / 2;
        const limitY = (mapContainer.offsetHeight * scale - mapContainer.offsetHeight) / 2;
        const safeLimitX = Math.max(0, limitX);
        const safeLimitY = Math.max(0, limitY);
        if (nextX > safeLimitX) nextX = safeLimitX;
        if (nextX < -safeLimitX) nextX = -safeLimitX;
        if (nextY > safeLimitY) nextY = safeLimitY;
        if (nextY < -safeLimitY) nextY = -safeLimitY;
        pointX = nextX;
        pointY = nextY;
        updateTransform();
    });

    mapContainer.addEventListener('dblclick', (e) => {
        if (e.target?.closest?.('[data-nt-zoom-controls]')) return;
        e.preventDefault();
        if (scale > 1.05) applyMapState({ scale: 1, x: 0, y: 0 }, true);
        else zoomMapAt(e.clientX, e.clientY, 2.5, true);
    });

    mapContainer.addEventListener('wheel', (e) => {
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        e.preventDefault();
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        zoomMapAt(e.clientX, e.clientY, scale * Math.exp(-delta * 0.0016), false);
    }, { passive: false });

    mapContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            panning = false;
            const rect = (mapImage || mapContainer).getBoundingClientRect();
            pinchGesture = pinchGestureStart(mapState(), rect, e.touches[0], e.touches[1]);
            if (mapImage) mapImage.style.transition = 'none';
            return;
        }
        if (e.touches.length === 1) {
            const currentTime = Date.now();
            const tapLength = currentTime - lastTap;
            if (tapLength < 300 && tapLength > 0) {
                e.preventDefault();
                if (scale > 1) applyMapState({ scale: 1, x: 0, y: 0 }, true);
                else zoomMapAt(e.touches[0].clientX, e.touches[0].clientY, 2.5, true);
                lastTap = 0;
                return;
            }
            lastTap = currentTime;
            startX = e.touches[0].clientX - pointX;
            startY = e.touches[0].clientY - pointY;
            panning = true;
        }
    }, { passive: false });

    mapContainer.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && pinchGesture) {
            e.preventDefault();
            const next = pinchGestureMove(
                pinchGesture,
                e.touches[0],
                e.touches[1],
                mapContainer.offsetWidth,
                mapContainer.offsetHeight,
            );
            scale = next.scale;
            pointX = next.x;
            pointY = next.y;
            if (mapImage) mapImage.style.transition = 'none';
            updateTransform();
            return;
        }
        if (!panning || e.touches.length !== 1) return;
        if (scale <= 1) { pointX = 0; pointY = 0; updateTransform(); return; }
        e.preventDefault();
        let nextX = e.touches[0].clientX - startX;
        let nextY = e.touches[0].clientY - startY;
        const limitX = (mapContainer.offsetWidth * scale - mapContainer.offsetWidth) / 2;
        const limitY = (mapContainer.offsetHeight * scale - mapContainer.offsetHeight) / 2;
        const safeLimitX = Math.max(0, limitX);
        const safeLimitY = Math.max(0, limitY);
        if (nextX > safeLimitX) nextX = safeLimitX;
        if (nextX < -safeLimitX) nextX = -safeLimitX;
        if (nextY > safeLimitY) nextY = safeLimitY;
        if (nextY < -safeLimitY) nextY = -safeLimitY;
        pointX = nextX;
        pointY = nextY;
        updateTransform();
    }, { passive: false });

    mapContainer.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            const wasPinch = !!pinchGesture;
            pinchGesture = null;
            if (wasPinch && scale < 1.02) {
                applyMapState({ scale: 1, x: 0, y: 0 }, true);
                panning = false;
                return;
            }
            if (wasPinch && scale > 5) {
                applyMapState(zoomAboutPoint(
                    mapState(),
                    mapContainer.getBoundingClientRect().left + mapContainer.offsetWidth / 2,
                    mapContainer.getBoundingClientRect().top + mapContainer.offsetHeight / 2,
                    (mapImage || mapContainer).getBoundingClientRect(),
                    5,
                    mapContainer.offsetWidth,
                    mapContainer.offsetHeight,
                ), true);
            }
        }
        if (e.touches.length === 1) {
            startX = e.touches[0].clientX - pointX;
            startY = e.touches[0].clientY - pointY;
            panning = true;
        }
        if (e.touches.length === 0) panning = false;
    });

    mapModal.addEventListener('click', (e) => {
        if (e.target === mapModal) {
            if (window._isLightboxMode && typeof window.closeLightbox === 'function') window.closeLightbox();
            else closeMap();
        }
    });

    window.resetMap = resetMap;
    window.setupMapLogic = setupMapLogic;
}
