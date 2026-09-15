export function topLevelAdNodes(nodes) {
    const unique = [...new Set(nodes.filter(Boolean))];
    return unique.filter((node) => !unique.some((parent) => (
        parent !== node && typeof parent.contains === 'function' && parent.contains(node)
    )));
}

export function createIframeLoadGate(onLoad) {
    const loaded = new WeakSet();
    const observed = new WeakSet();

    const markLoaded = (frame) => {
        const declaredSrc = String(frame?.getAttribute?.('src') || '').trim();
        if (!declaredSrc || /^about:(blank|srcdoc)$/i.test(declaredSrc)) return;
        try {
            const loadedUrl = String(frame.contentWindow?.location?.href || '');
            if (/^about:blank(?:#|$)/i.test(loadedUrl)) return;
        } catch { /* a cross-origin URL reached its load event */ }
        loaded.add(frame);
        onLoad(frame);
    };

    const observe = (frame) => {
        if (!frame || observed.has(frame)) return;
        observed.add(frame);
        frame.addEventListener('load', () => markLoaded(frame));
    };

    return {
        observe,
        invalidate(frame) {
            loaded.delete(frame);
        },
        isLoaded(frame) {
            return loaded.has(frame);
        },
    };
}
