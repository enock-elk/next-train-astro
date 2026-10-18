/**
 * Photo-viewer pinch. translate(x, y) scale(s), origin at the element center.
 * The point under the fingers stays under the fingers while the span changes,
 * and a two-finger slide pans in the same gesture.
 */

export const PINCH_MIN = 1;
export const PINCH_MAX = 5;

export function layoutCenter(rect, x, y) {
    return {
        x: (rect.left + rect.right) / 2 - x,
        y: (rect.top + rect.bottom) / 2 - y,
    };
}

export function contentPoint(clientX, clientY, originX, originY, x, y, scale) {
    const s = scale || 1;
    return {
        x: (clientX - originX - x) / s,
        y: (clientY - originY - y) / s,
    };
}

export function placeAt(clientX, clientY, originX, originY, contentX, contentY, scale) {
    return {
        x: clientX - originX - contentX * scale,
        y: clientY - originY - contentY * scale,
    };
}

/** Soft stop past the ends so a pinch does not slam into the limit. */
export function pinchScale(startScale, startDist, dist, min = PINCH_MIN, max = PINCH_MAX) {
    if (!(startDist > 0) || !Number.isFinite(dist)) return startScale;
    const raw = startScale * (dist / startDist);
    if (raw < min) return Math.max(min * 0.82, min - (min - raw) * 0.35);
    if (raw > max) return Math.min(max * 1.06, max + (raw - max) * 0.12);
    return raw;
}

export function clampPan(x, y, scale, width, height) {
    if (!(scale > 1) || !(width > 0) || !(height > 0)) return { x: 0, y: 0 };
    const limitX = Math.max(0, (width * (scale - 1)) / 2);
    const limitY = Math.max(0, (height * (scale - 1)) / 2);
    return {
        x: Math.min(limitX, Math.max(-limitX, x)),
        y: Math.min(limitY, Math.max(-limitY, y)),
    };
}

export function zoomAboutPoint(state, clientX, clientY, rect, nextScale, width, height, min = PINCH_MIN, max = PINCH_MAX) {
    const origin = layoutCenter(rect, state.x, state.y);
    const content = contentPoint(clientX, clientY, origin.x, origin.y, state.x, state.y, state.scale);
    const scale = Math.min(max, Math.max(min, nextScale));
    if (scale <= min) return { scale: min, x: 0, y: 0 };
    const placed = placeAt(clientX, clientY, origin.x, origin.y, content.x, content.y, scale);
    const pan = clampPan(placed.x, placed.y, scale, width, height);
    return { scale, x: pan.x, y: pan.y };
}

export function pinchGestureStart(state, rect, touchA, touchB) {
    const dist = Math.hypot(touchB.clientX - touchA.clientX, touchB.clientY - touchA.clientY);
    const midX = (touchA.clientX + touchB.clientX) / 2;
    const midY = (touchA.clientY + touchB.clientY) / 2;
    const origin = layoutCenter(rect, state.x, state.y);
    const content = contentPoint(midX, midY, origin.x, origin.y, state.x, state.y, state.scale);
    return {
        startScale: state.scale,
        startDist: dist,
        originX: origin.x,
        originY: origin.y,
        contentX: content.x,
        contentY: content.y,
    };
}

export function pinchGestureMove(gesture, touchA, touchB, width, height) {
    const dist = Math.hypot(touchB.clientX - touchA.clientX, touchB.clientY - touchA.clientY);
    const midX = (touchA.clientX + touchB.clientX) / 2;
    const midY = (touchA.clientY + touchB.clientY) / 2;
    const scale = pinchScale(gesture.startScale, gesture.startDist, dist);
    const placed = placeAt(midX, midY, gesture.originX, gesture.originY, gesture.contentX, gesture.contentY, scale);
    if (scale < PINCH_MIN) return { scale, x: placed.x, y: placed.y };
    const pan = clampPan(placed.x, placed.y, scale, width, height);
    return { scale, x: pan.x, y: pan.y };
}
