/**
 * Network map + alert image pinch/pan/zoom viewer (ported from SPA map-viewer.js).
 */
import { openSmoothModal, closeSmoothModal, lockBackgroundScroll } from './ui.js';

let mapModal, closeMapBtn, closeMapBtn2, viewMapBtn;
let mapContainer, mapImage, mapZoomIn, mapZoomOut;

let scale = 1;
let pointX = 0;
let pointY = 0;
let panning = false;
let startX = 0;
let startY = 0;
let initialPinchDistance = null;
let initialScale = 1;
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

function updateTransform() {
    if (mapImage) {
        mapImage.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    }
}

function openMap() {
    if (!mapModal) return;
    resetMap();
    if (typeof window.closeAppHub === 'function') {
        try { window.closeAppHub(true); } catch { /* ignore */ }
    } else {
        const sidenav = document.getElementById('sidenav');
        const sidenavOverlay = document.getElementById('sidenav-overlay');
        if (sidenav) {
            sidenav.classList.remove('open', 'translate-x-0');
            sidenav.classList.add('-translate-x-full');
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
}

function closeMap() {
    if (location.hash === '#map') {
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
    mapZoomIn = document.getElementById('map-zoom-in');
    mapZoomOut = document.getElementById('map-zoom-out');

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

    if (mapZoomIn) {
        mapZoomIn.onclick = (e) => {
            e.stopPropagation();
            scale += 0.5;
            if (scale > 5) scale = 5;
            updateTransform();
        };
    }
    if (mapZoomOut) {
        mapZoomOut.onclick = (e) => {
            e.stopPropagation();
            if (scale > 1) {
                scale -= 0.5;
                if (scale < 1) scale = 1;
                if (scale === 1) { pointX = 0; pointY = 0; }
                updateTransform();
            }
        };
    }

    if (_bound || !mapContainer) {
        window.resetMap = resetMap;
        return;
    }
    _bound = true;

    mapContainer.style.touchAction = 'none';

    mapContainer.addEventListener('mousedown', (e) => {
        e.preventDefault();
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

    mapContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            panning = false;
            initialPinchDistance = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            initialScale = scale;
            return;
        }
        if (e.touches.length === 1) {
            const currentTime = Date.now();
            const tapLength = currentTime - lastTap;
            if (tapLength < 300 && tapLength > 0) {
                e.preventDefault();
                if (scale > 1) {
                    resetMap();
                } else {
                    scale = 2.5;
                    const rect = mapContainer.getBoundingClientRect();
                    const tapX = e.touches[0].clientX - rect.left;
                    const tapY = e.touches[0].clientY - rect.top;
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    pointX = -(tapX - centerX) * (scale - 1);
                    pointY = -(tapY - centerY) * (scale - 1);
                    const limitX = (mapContainer.offsetWidth * scale - mapContainer.offsetWidth) / 2;
                    const limitY = (mapContainer.offsetHeight * scale - mapContainer.offsetHeight) / 2;
                    const safeLimitX = Math.max(0, limitX);
                    const safeLimitY = Math.max(0, limitY);
                    if (pointX > safeLimitX) pointX = safeLimitX;
                    if (pointX < -safeLimitX) pointX = -safeLimitX;
                    if (pointY > safeLimitY) pointY = safeLimitY;
                    if (pointY < -safeLimitY) pointY = -safeLimitY;
                    updateTransform();
                }
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
        if (e.touches.length === 2 && initialPinchDistance) {
            e.preventDefault();
            const currentDistance = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            let newScale = initialScale * (currentDistance / initialPinchDistance);
            if (newScale < 1) newScale = 1;
            if (newScale > 5) newScale = 5;
            scale = newScale;
            if (scale === 1) { pointX = 0; pointY = 0; }
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
        if (e.touches.length < 2) initialPinchDistance = null;
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
