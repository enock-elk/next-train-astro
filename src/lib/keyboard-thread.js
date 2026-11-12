/**
 * Community and Feedback Hub keep the wallpaper on the full shell while the
 * keyboard is open. The browser otherwise pans the page to chase the field,
 * which slides the wallpaper and leaves a blank under the tab. The message
 * list is the only thing that moves, so the latest rows sit above the keys.
 */

let bound = false;
let lifted = false;

function rememberWallpaper() {
    if (document.documentElement.classList.contains('nt-keyboard')) return;
    const nodes = document.querySelectorAll('#view-community .community-pane > .nt-pack-wallpaper, #messages-thread-modal .nt-pack-wallpaper');
    nodes.forEach((el) => {
        const h = el.getBoundingClientRect().height;
        if (h > 80) el.style.setProperty('--nt-wallpaper-lock', `${Math.round(h)}px`);
    });
}

function pinChatScroll() {
    const root = document.scrollingElement || document.documentElement;
    if (root && root.scrollTop) root.scrollTop = 0;
    document.body.scrollTop = 0;
    const app = document.getElementById('app-scroll');
    if (app && app.scrollTop) app.scrollTop = 0;
    try { window.scrollTo(0, 0); } catch { /* ignore */ }
}

function chatFieldFocused() {
    const el = document.activeElement;
    return !!el?.closest?.('#community-composer, #messages-thread-input');
}

function activeThread() {
    const el = document.activeElement;
    if (el?.closest?.('#messages-thread-form')) {
        return {
            list: document.getElementById('messages-thread-list'),
            dock: document.getElementById('messages-thread-form'),
            dockVar: '--nt-hub-dock-h',
        };
    }
    if (el?.closest?.('#community-composer-dock')) {
        return {
            list: document.querySelector('#view-community .community-feed-scroll'),
            dock: document.getElementById('community-composer-dock'),
            dockVar: '--nt-community-dock-h',
        };
    }
    return null;
}

function liftList(list, extra) {
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 140;
    if (nearBottom) {
        list.scrollTop = list.scrollHeight;
        return;
    }
    list.scrollTop += extra;
}

export function liftThreadForKeyboard() {
    const root = document.documentElement;
    const keyboard = root.classList.contains('nt-keyboard');
    const thread = keyboard && chatFieldFocused() ? activeThread() : null;
    if (!thread?.list) {
        if (lifted) {
            lifted = false;
            root.style.removeProperty('--nt-hub-dock-h');
            root.style.removeProperty('--nt-community-dock-h');
        }
        return;
    }
    pinChatScroll();
    const dockH = thread.dock ? Math.ceil(thread.dock.getBoundingClientRect().height) : 0;
    if (dockH) root.style.setProperty(thread.dockVar, `${dockH}px`);
    if (lifted) return;
    lifted = true;
    const kb = parseFloat(getComputedStyle(root).getPropertyValue('--nt-kb-h')) || 0;
    let extra = kb + dockH;
    if (thread.dockVar === '--nt-community-dock-h') {
        const view = document.getElementById('view-community');
        const pad = view ? (parseFloat(getComputedStyle(view).paddingBottom) || 0) : 0;
        extra = Math.max(0, extra - pad);
    }
    requestAnimationFrame(() => liftList(thread.list, extra));
}

export function bindKeyboardThread() {
    if (bound || typeof window === 'undefined') return;
    bound = true;
    const run = () => {
        rememberWallpaper();
        liftThreadForKeyboard();
    };
    rememberWallpaper();
    window.visualViewport?.addEventListener('resize', run, { passive: true });
    window.visualViewport?.addEventListener('scroll', run, { passive: true });
    document.addEventListener('focusin', (event) => {
        if (!event.target?.closest?.('#community-composer, #messages-thread-input')) return;
        const feed = document.querySelector('#view-community .community-feed-scroll');
        if (feed && !document.documentElement.classList.contains('nt-keyboard')) {
            const locked = Math.round(feed.clientWidth * 2 / 3);
            if (locked > 80) document.documentElement.style.setProperty('--nt-bubble-lock', `${locked}px`);
        }
        rememberWallpaper();
        [0, 60, 180, 400].forEach((ms) => setTimeout(run, ms));
    });
    document.addEventListener('focusout', () => {
        [40, 200, 500].forEach((ms) => setTimeout(run, ms));
        setTimeout(() => {
            if (!document.documentElement.classList.contains('nt-keyboard')) {
                document.documentElement.style.removeProperty('--nt-bubble-lock');
            }
        }, 520);
    });
}
