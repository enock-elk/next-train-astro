/**
 * Bottom ad slot helpers — keep the host from reserving height or stealing
 * taps when no creative is actually on screen.
 */

export const AD_LOADER_ID = 'CleverCoreLoader103008';

function nodeHeight(el) {
    if (!el) return 0;
    if (typeof el.getBoundingClientRect === 'function') {
        try {
            return el.getBoundingClientRect().height || 0;
        } catch { /* ignore */ }
    }
    return Number(el.offsetHeight) || 0;
}

function isIgnorableAdChild(el) {
    const tag = String(el?.tagName || '').toUpperCase();
    const id = String(el?.id || '');
    return tag === 'SCRIPT' || id === AD_LOADER_ID;
}

/** True only when a real creative (iframe / non-script child) has height. */
export function isAdSlotFilled(adContainer) {
    if (!adContainer) return false;
    const iframe = typeof adContainer.querySelector === 'function'
        ? adContainer.querySelector('iframe')
        : null;
    if (iframe) return nodeHeight(iframe) > 20;

    const kids = Array.from(adContainer.children || []).filter((el) => !isIgnorableAdChild(el));
    if (kids.length === 0) return false;
    return kids.some((el) => nodeHeight(el) > 20);
}
