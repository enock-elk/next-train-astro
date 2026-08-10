/**
 * METRORAIL NEXT TRAIN - ADMIN TOOLS (V8_08.08)
 * -----------------------------------------------------------------------------
 *
 * ## ADMIN ISLAND ROADMAP (for future AI / ops)
 * Current stage: SHORT-TERM isolation via src/lib/admin-bridge.js
 *   - admin.js is NOT loaded on commuter boot; 5-tap title unlock lazy-fetches it.
 *   - Excluded from the service-worker precache (astro globIgnores for admin.js).
 *   - window.__ntAdminSessionActive lets global crash reporting skip admin noise.
 *   - Admin init failures must never take down the trip planner / live board.
 *
 * MEDIUM-TERM (next):
 *   - Dedicated noindex AdminDashboard page (e.g. /admin.html), robots Disallow,
 *     not in sitemap; main app has zero admin DOM/modals beyond a tiny unlock stub.
 *   - Stronger quarantine: run admin UI in a separate tab/window so a hung admin
 *     panel cannot freeze schedule UI.
 *
 * LONG-TERM (ideal OPSEC):
 *   - Auth-gated delivery of this bundle (Cloudflare Worker / Firebase Hosting
 *     rewrite) so guessing /js/admin.js without an admin JWT returns 404/401.
 *   - Until then: Firebase Security Rules + Worker JWT remain the real lock;
 *     lazy-load only reduces blueprint exposure and payload bloat.
 *
 * Do NOT re-add a global <script src="/js/admin.js"> or initAdminBridge() that
 * eagerly fetches this file - that undoes Zero-Bloat and schema OPSEC.
 * -----------------------------------------------------------------------------
 * This module handles Developer Mode features:
 * 1. Service Alerts Manager (God-Mode Regional Sync + Rich Text Formatting + Live Preview)
 * 2. Transit Incident Manager (Tiered Graph/Timeline Disruptions)
 * 3. Maintenance Mode Toggle
 * 4. Enterprise Login Logic & Token Mgmt (Phase 9)
 * 5. Simulation Controls (Disarmed on Entry, Triggered on Apply)
 * 6. Exceptions Manager (God-Mode + Banned/Special Types + EXPIRY + Grid Notice Engine)
 * 7. Special Event Route Manager
 * 8. System Health / Diagnostics Scanner
 *    (includes Zone Distance Audit accordion for fare-zone / km review)
 * 8b. Schedule Data QA (timetable content - standalone from diagnostics)
 * 9. Nuclear Cache Wipe (Killswitch)
 * 10. Live Telemetry Bridge & Snapshot Export
 * 11. User Feedback Manager (Inbox & Archive Protocol Tabs)
 * 12. Growth & Promo Manager (QR Codes)
 *
 * CHRONOLOGICAL CHANGE LOG:
 * * GUARDIAN PHASE 5 [22 Dec 2025]: Injected basic simulation control wiring and first-pass Service Alerts/Incident layouts.
 * * GUARDIAN PHASE 6 [02 Jan 2026]: Built out initial Exceptions Manager (train cancellations and specials) and designed a modular Special Event corridor scheduler.
 * * GUARDIAN PHASE 7 [15 Jan 2026]: Injected the first-pass diagnostics system checks and completed basic local telemetry data extraction.
 * * GUARDIAN PHASE 8 [04 Feb 2026]: Developed the basic in-house Feedback System with separate inbox/archive memory state tab controllers.
 * * GUARDIAN PHASE 9 [04 Mar 2026]: Deployed Enterprise Admin Authentication with Firebase Custom Token security and modular, multi-turn drill-down views.
 * * GUARDIAN PHASE 10 [12 Mar 2026]: Patched a critical DOM duplication bug on re-initialization by locking rendering hooks behind unique Singleton instance flags.
 * * GUARDIAN PHASE 11 [10 Apr 2026]: Converted the modal to a full-screen app-like panel, added live diagnostic trackers, and enabled contextual admin reply fields.
 * * GUARDIAN PHASE 12 [24 Apr 2026]: Synced unread status badges with Firebase to coordinate cross-device active notifications; fixed active-tab memory leaks.
 * * GROWTH SPRINT PHASE 5 [12 May 2026]: Restructured the admin modules into an elegant Grid / Drill-Down navigation board and added the silent Dead-Ends failure scanner.
 * * GROWTH SPRINT PHASE 6 [17 Jun 2026]: Upgraded old bar chart mockups to high-res SVG Line Graphs with interactive points, and built the PNG Snapshot Export engine.
 * * GROWTH SPRINT PHASE 7 [24 Jun 2026]: Deployed the Safe Mode Crash Analytics Dashboard supporting dedicated database clears and archive pagination.
 * * GROWTH SPRINT PHASE 8 [29 Jun 2026]: Built the Commuter Reply Inbox Protocol, allowing administrators to push threaded instant messages directly to individual commuter instances.
 * * GROWTH SPRINT PHASE 9 [02 Jul 2026]: Integrated landscape-mode SVG CSS graph armor, absolute-positioned tooltips, and unified telemetry range selectors (DAU/WAU/MAU).
 * * GROWTH SPRINT PHASE 10 [05 Jul 2026]: Swapped telemetry, crash, and routing failure endpoints from '/metrics/' to '/sys_logs/' to secure tracking channels against active client adblockers.
 * * GUARDIAN PHASE 13 [09 Jul 2026]: Built the Action Required active state monitor to scan, list, and instantly resolve expiring/live incidents across the entire system.
 * * GUARDIAN PHASE 14 [09 Jul 2026]: Resolved a malformed URL typo inside 'viewContextAlert' that threw unhandled exceptions during the disruption graveyard sweep.
 * * GUARDIAN PHASE 15 [10 Jul 2026]: Appended standard route-status cues directly to the drop-down selectors by cross-referencing live Firebase payloads.
*/
const Admin = {
    
    // GUARDIAN PHASE 2: Dropdown Breadcrumbs State
    _routeFlags: {},
    getRouteCues: (routeId) => {
        if (!Admin._routeFlags || !Admin._routeFlags[routeId]) return '';
        const flags = Admin._routeFlags[routeId];
        let cues = [];
        if (flags.hasNotice) cues.push('[Notice]');
        if (flags.hasExclusion) cues.push('[Bans]');
        if (flags.hasDisruption) cues.push('[Incident]');
        if (flags.hasAlert) cues.push('[Alert]');
        return cues.length ? ` ${cues.join(' ')}` : '';
    },

    /** Repair UTF-8-as-Latin1 mojibake (delegates to app helper when available). */
    repairMojibake: (str) => {
        if (typeof window.repairMojibake === 'function' && window.repairMojibake !== Admin.repairMojibake) {
            try { return window.repairMojibake(str); } catch { /* fall through */ }
        }
        if (str == null) return '';
        let s = String(str);
        // Prefer escapes so scanners cannot rewrite the lookup keys
        const pairs = [
            ['\u00E2\u20AC\u201D', '\u2014'], // mojibake em dash
            ['\u00E2\u0080\u0094', '\u2014'],
            ['\u00E2\u20AC\u00A2', '\u2022'],
            ['\u00E2\u02DC\u00A2\uFE0F', '\u26A0\uFE0F'], // warning emoji
            ['\u00E2\u0098\u00A2\uFE0F', '\u26A0\uFE0F'], // warning emoji
        ];
        for (const [bad, good] of pairs) {
            if (s.includes(bad)) s = s.split(bad).join(good);
        }
        return s;
    },

    /** SVG bidirectional arrow for route labels (matches app formatRouteLabelHtml). */
    routeArrowSvg: (className = 'inline-block w-3.5 h-3.5 mx-0.5 align-middle text-current shrink-0') =>
        `<svg class="${className}" viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M5 6h14M8 3L5 6l3 3M16 3l3 3-3 3" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    /** Lucide-style stroke icons for admin grid tiles and in-panel chrome. */
    icon: (name, className = 'w-7 h-7') => {
        const paths = {
            flame: '<path d="M12 3c1.5 3 4 4.2 4 8a4 4 0 01-8 0c0-2.2 1.2-3.8 2.2-5.2.4 1.8 1.6 2.8 1.8 2.8"/><path d="M9.5 15.5A3.5 3.5 0 0012 19a3.5 3.5 0 002.5-3.5"/>',
            rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-9.5c4 0 7.5 3.5 7.5 7.5a22 22 0 01-9.5 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
            ban: '<circle cx="12" cy="12" r="9"/><path d="M5.5 5.5l13 13"/>',
            message: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
            alert: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
            shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
            user: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
            megaphone: '<path d="M3 11l18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/>',
            construction: '<rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M17 3v3"/><path d="M7 3v3"/><path d="M10 14l4-4"/><path d="M6 10l4 4"/><path d="M14 10l4 4"/>',
            stop: '<path d="M12 2l9 4.5v6.7c0 5.4-3.7 10.1-9 11.3-5.3-1.2-9-5.9-9-11.3V6.5L12 2z"/><path d="M9 12h6"/>',
            star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
            activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
            wrench: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>',
            map: '<path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
            ruler: '<path d="M21.3 15.3a2.4 2.4 0 010 3.4l-2.6 2.6a2.4 2.4 0 01-3.4 0L2.7 8.7a2.41 2.41 0 010-3.4l2.6-2.6a2.41 2.41 0 013.4 0z"/><path d="M14.5 12.5l2-2"/><path d="M11.5 9.5l2-2"/><path d="M8.5 6.5l2-2"/><path d="M17.5 15.5l2-2"/>',
            chart: '<path d="M3 3v18h18"/><path d="M7 14v4"/><path d="M12 10v8"/><path d="M17 6v12"/>',
            trending: '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
            plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
            check: '<path d="M20 6L9 17l-5-5"/>',
            x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
            checks: '<path d="M18 6L7 17l-5-5"/><path d="M22 10l-11 11-3-3"/>',
            calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
            note: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
            globe: '<circle cx="12" cy="12" r="9"/><path d="M2 12h20"/><path d="M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10 15 15 0 014-10z"/>',
            camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
            siren: '<path d="M12 2v2"/><path d="M6 6l-1.5-1.5"/><path d="M18 6l1.5-1.5"/><path d="M5 14a7 7 0 0114 0"/><path d="M4 20h16"/><path d="M9 20v-2a3 3 0 016 0v2"/>',
            refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
            download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
            search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
            mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/>',
            phone: '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>',
            paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>',
            bug: '<path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 116 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a6 6 0 0112 0v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9M6.53 9C4.6 9.9 3 11.6 3 14M17.47 9c1.93.9 3.53 2.6 3.53 5M3 13h2M19 13h2M4 18h2M18 18h2"/>',
            lightbulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/>',
            clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
            hourglass: '<path d="M5 2h14M5 22h14M5 2v4l5.5 6L5 18v4M19 2v4l-5.5 6L19 18v4"/>',
            pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16h14v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 00-1-1H10a1 1 0 00-1 1v3.76z"/>',
            copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
            reply: '<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 00-4-4H4"/>',
            file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
            more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
            circle: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
        };
        const body = paths[name];
        if (!body) return '';
        return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    },


    /** WhatsApp-style read receipts (crisp at ~12-14px). */
    receiptTicks: (variant = 'double', className = 'w-3.5 h-3.5') => {
        // variant: 'single' | 'double'
        if (variant === 'single') {
            return `<svg class="${className}" viewBox="0 0 12 11" width="12" height="11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M1.75 5.75L4.6 8.5 10.25 2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        }
        return `<svg class="${className}" viewBox="0 0 16 11" width="16" height="11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M1.2 6.1L3.85 8.7 8.9 2.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.35 6.1L9 8.7 14.05 2.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    },

    tileIcon: (name, colorClass = 'text-blue-600 dark:text-blue-400') =>
        `<span class="admin-tile-icon mb-2 inline-flex items-center justify-center ${colorClass}">${Admin.icon(name, 'w-7 h-7')}</span>`,

    _severityLabelHtml: (severity) => {
        if (severity === 'warning') {
            return `<span class="inline-flex items-center gap-1.5"><span class="inline-flex text-amber-500">${Admin.icon('alert', 'w-3 h-3')}</span> Warning (Delays)</span>`;
        }
        if (severity === 'critical') {
            return `<span class="inline-flex items-center gap-1.5"><span class="inline-flex text-red-500">${Admin.icon('siren', 'w-3 h-3')}</span> Critical (Suspended)</span>`;
        }
        return `<span class="inline-flex items-center gap-1.5"><span class="inline-flex text-blue-500">${Admin.icon('circle', 'w-3 h-3')}</span> Info (General)</span>`;
    },

    formatRouteLabelHtml: (raw) => {
        if (typeof raw !== 'string' || !raw) return '';
        const esc = (typeof escapeHTML === 'function')
            ? escapeHTML
            : (t) => String(t).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
        const parts = raw.split(/\s*<->\s*|\s*\u2194\s*/);
        if (parts.length < 2) return esc(raw.trim());
        return parts.map((p) => esc(p.trim())).filter(Boolean).join(Admin.routeArrowSvg());
    },

    formatRouteLabelPlain: (raw) => {
        if (typeof raw !== 'string' || !raw) return '';
        return raw.replace(/\s*<->\s*/g, ' \u2194 ').replace(/\s*\u2194\s*/g, ' \u2194 ').trim();
    },

    // --- 0.1 GLOBAL AUTH KEY HELPER (GUARDIAN PHASE 9) ---
    getAuthKey: async () => {
        if (window.firebaseAuth && window.firebaseAuth.currentUser) {
            try {
                // Prefer cached token; force-refresh only if Firebase says it's near expiry.
                // Forcing refresh on every admin fetch thrashed onIdTokenChanged on iOS and raced 401s.
                return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, false);
            } catch(e) {
                try {
                    return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true);
                } catch (e2) {
                    console.warn("Guardian: Failed to securely fetch ID Token", e2);
                    return null;
                }
            }
        }
        return null;
    },

    /** Safe escalate payload for data-escalate attrs (avoids onclick SyntaxError ? app reload). */
    encodeEscalatePayload: (payload) => encodeURIComponent(JSON.stringify(payload || {})),

    isBlackBoxCrash: (crash) => {
        if (!crash) return false;
        return crash.kind === 'blackbox_export'
            || crash.kind === 'blackbox_full'
            || String(crash.error || '').startsWith('BLACK_BOX_EXPORT');
    },

    /** Build a short preview from a fat legacy blackbox crash (or summary object). */
    blackBoxPreviewFromCrash: (crash) => {
        if (!crash) return '';
        if (typeof crash.preview === 'string' && crash.preview.trim()) return crash.preview.slice(0, 3500);
        if (crash.summary && typeof crash.summary === 'object') {
            const c = crash.summary.counts || {};
            const signal = Array.isArray(crash.summary.recentSignal) ? crash.summary.recentSignal : [];
            const lines = [
                `Black Box · ${crash.summary.lineCount || '?'} lines · ${c.ERROR || 0}E/${c.WARN || 0}W`,
                ...signal.slice(-30).map((l) => `${l.type || '?'}: ${String(l.msg || '').slice(0, 200)}`),
            ];
            return lines.join('\n').slice(0, 3500);
        }
        let raw = '';
        try {
            if (crash.stack && crash.stack !== 'N/A') raw = String(crash.stack);
            else if (crash.raw) raw = typeof crash.raw === 'string' ? crash.raw : JSON.stringify(crash.raw, null, 2);
            else if (crash.logs) raw = JSON.stringify(crash.logs, null, 2);
        } catch (_) { raw = String(crash.error || ''); }
        if (raw.trim().startsWith('[') || raw.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    const errs = parsed.filter((l) => {
                        const t = String(l?.type || '').toUpperCase();
                        return t === 'ERROR' || t === 'WARN';
                    }).slice(-40);
                    const head = [`Legacy black box · ${parsed.length} lines (preview)`, ''];
                    const body = (errs.length ? errs : parsed.slice(-20)).map((l) =>
                        `${l?.type || '?'}: ${String(l?.msg || '').slice(0, 200)}`
                    );
                    return [...head, ...body].join('\n').slice(0, 3500);
                }
            } catch (_) { /* fall through */ }
        }
        return String(raw || crash.error || '').slice(0, 3500);
    },

    /** Drop megabyte stack/raw/logs from in-memory crash cache so the list can render. */
    slimCachedCrashBodies: () => {
        if (!Array.isArray(Admin.cachedCrashData)) return;
        Admin.cachedCrashData.forEach((c) => {
            if (!Admin.isBlackBoxCrash(c)) return;
            if (!c.preview) c.preview = Admin.blackBoxPreviewFromCrash(c);
            delete c.stack;
            delete c.raw;
            delete c.logs;
        });
    },

    /** Resolve full black-box text (blob path, or re-fetch legacy crash node). */
    fetchCrashFullLogText: async (crashId) => {
        const cached = (Admin._crashRawById && Admin._crashRawById[crashId]) || '';
        if (cached) return cached;
        const crash = (Admin.cachedCrashData || []).find((c) => c.id === crashId);
        const secret = await Admin.getAuthKey();
        if (!secret) return crash?.preview || '';
        const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
        try {
            if (crash?.blobPath) {
                const res = await window.guardianFetch(`${dynamicEndpoint}${crash.blobPath}.json?auth=${secret}`, {}, 20000);
                if (!res.ok) throw new Error('blob ' + res.status);
                const data = await res.json();
                const text = JSON.stringify(data, null, 2);
                if (!Admin._crashRawById) Admin._crashRawById = {};
                Admin._crashRawById[crashId] = text;
                return text;
            }
            // Legacy blackbox_full: body was stripped from cache — reload this node only
            const res = await window.guardianFetch(`${dynamicEndpoint}sys_logs/crashes/${crashId}.json?auth=${secret}`, {}, 20000);
            if (!res.ok) throw new Error('crash ' + res.status);
            const data = await res.json();
            let text = '';
            if (data?.stack && data.stack !== 'N/A') text = String(data.stack);
            else if (data?.raw) text = typeof data.raw === 'string' ? data.raw : JSON.stringify(data.raw, null, 2);
            else if (data?.logs) text = JSON.stringify(data.logs, null, 2);
            else text = JSON.stringify(data, null, 2);
            if (!Admin._crashRawById) Admin._crashRawById = {};
            Admin._crashRawById[crashId] = text;
            return text;
        } catch (e) {
            console.error('fetchCrashFullLogText', e);
            return crash?.preview || '';
        }
    },

    copyCrashLog: async (crashId) => {
        if (typeof showToast === 'function') showToast('Preparing log…', 'info', 1200);
        let text = await Admin.fetchCrashFullLogText(crashId);
        if (!text) {
            if (typeof showToast === 'function') showToast('No log text for this entry', 'warning');
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            if (typeof showToast === 'function') showToast('Full log copied', 'success');
        } catch {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                if (typeof showToast === 'function') showToast('Full log copied', 'success');
            } catch {
                if (typeof showToast === 'function') showToast('Copy failed', 'error');
            }
        }
    },
    openDiagnosticErrorsModal: async () => {
        const SENTRY_SAMPLE = 0.3;
        let modal = document.getElementById('admin-diag-errors-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'admin-diag-errors-modal';
            modal.className = 'fixed inset-0 bg-black/80 z-[220] hidden flex items-center justify-center p-4 backdrop-blur-sm';
            document.body.appendChild(modal);
        }
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col border border-gray-200 dark:border-gray-700">
                <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center shrink-0">
                    <div>
                        <h3 class="text-base font-black text-gray-900 dark:text-white">System Errors 24H</h3>
                        <p id="diag-errors-meta" class="text-[10px] text-gray-500 mt-0.5">Loading...</p>
                    </div>
                    <button type="button" id="diag-errors-close" class="p-2 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300" aria-label="Close">${Admin.icon('x', 'w-4 h-4')}</button>
                </div>
                <div id="diag-errors-list" class="p-3 overflow-y-auto flex-grow space-y-2 custom-scrollbar text-sm">Loading...</div>
            </div>`;
        modal.classList.remove('hidden');
        document.getElementById('diag-errors-close').onclick = () => modal.classList.add('hidden');

        const list = document.getElementById('diag-errors-list');
        const meta = document.getElementById('diag-errors-meta');
        try {
            const secret = await Admin.getAuthKey();
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            const res = await window.guardianFetch(`${dynamicEndpoint}sys_logs/crashes.json?auth=${secret}`, {}, 10000);
            const data = res.ok ? await res.json() : null;
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            const all = data
                ? Object.keys(data).map((id) => ({ id, ...data[id] })).filter((c) => (c.timestamp || 0) >= cutoff)
                : [];
            const isDistress = (c) => c.kind === 'distress' || String(c.error || '').startsWith('DISTRESS:');
            const distressCount = all.filter(isDistress).length;
            // Distress / help belongs in Crash Analytics - keep this modal for JS/black-box noise only
            const items = all.filter((c) => !isDistress(c));
            items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            const n = items.length;
            const est = Math.round(n / SENTRY_SAMPLE);
            meta.textContent = `${n} JS/crash captures (~${est} est. @ sample ${SENTRY_SAMPLE}). Distress: use Crash Analytics.`;
            if (!n) {
                list.innerHTML = `
                    <p class="text-xs text-gray-500 text-center py-4">No JS / black-box diagnostic entries in the last 24h.</p>
                    ${distressCount ? `<button type="button" id="diag-open-distress" class="w-full mt-2 text-xs font-bold py-2.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">${distressCount} distress / help report(s) - open Crash Analytics</button>` : ''}
                `;
                document.getElementById('diag-open-distress')?.addEventListener('click', () => {
                    modal.classList.add('hidden');
                    Admin.openCrashDistressPanel();
                });
                return;
            }
            list.innerHTML = items.map((c) => {
                const when = c.timestamp ? new Date(c.timestamp).toLocaleString() : '-';
                const err = String(c.error || 'Unknown').replace(/</g, '&lt;').slice(0, 180);
                return `<div class="p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                    <div class="flex justify-between text-[9px] text-gray-400 font-mono mb-1"><span>${when}</span><span>${(c.routeId || 'global').toString().replace(/</g, '&lt;')}</span></div>
                    <div class="text-xs font-mono text-gray-800 dark:text-gray-200 break-words">${err}</div>
                </div>`;
            }).join('') + (distressCount
                ? `<button type="button" id="diag-open-distress" class="w-full mt-2 text-xs font-bold py-2.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">${distressCount} distress / help report(s) - open Crash Analytics</button>`
                : '');
            document.getElementById('diag-open-distress')?.addEventListener('click', () => {
                modal.classList.add('hidden');
                Admin.openCrashDistressPanel();
            });
        } catch (e) {
            list.innerHTML = `<p class="text-xs text-red-500 text-center py-6">Failed to load: ${e.message || e}</p>`;
        }
    },

    openCrashDistressPanel: () => {
        Admin.currentCrashTab = 'distress';
        Admin.deepLinkToPanel('crashes-panel');
        setTimeout(() => {
            document.getElementById('crash-tab-distress')?.click();
            if (typeof Admin.renderCrashList === 'function') Admin.renderCrashList();
        }, 200);
    },
    escalateFromEl: (el) => {
        try {
            const raw = el?.getAttribute?.('data-escalate');
            if (!raw) throw new Error('Missing escalate payload');
            const data = JSON.parse(decodeURIComponent(raw));
            if (typeof Admin.escalateToRoadmap === 'function') Admin.escalateToRoadmap(data);
            else if (typeof Admin.openTicketModal === 'function') Admin.openTicketModal(null, data);
            else throw new Error('Roadmap UI not ready');
        } catch (e) {
            console.error('Escalate failed', e);
            if (typeof showToast === 'function') showToast('Could not open ticket form', 'error');
        }
    },
    escalateToRoadmap: (prefillData) => {
        try {
            if (typeof Admin.openTicketModal === 'function') Admin.openTicketModal(null, prefillData);
            else if (typeof showToast === 'function') showToast('Roadmap not ready yet', 'warning');
        } catch (e) {
            console.error(e);
            if (typeof showToast === 'function') showToast('Could not open ticket form', 'error');
        }
    },

    /**
     * Force a file download (avoids navigating to blob: URLs in the PWA shell).
     * @param {string} filename
     * @param {string|Blob} content
     * @param {string} [mime]
     */
    downloadFile: function(filename, content, mime = 'text/plain;charset=utf-8') {
        try {
            const isString = typeof content === 'string';
            const blob = content instanceof Blob
                ? content
                : new Blob([content], { type: mime });

            const trigger = (href, revoke) => {
                const a = document.createElement('a');
                a.href = href;
                a.setAttribute('download', filename);
                a.rel = 'noopener';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    a.remove();
                    if (typeof revoke === 'function') revoke();
                }, 400);
            };

            // Data URLs download more reliably than blob: in installed PWAs / WebViews
            if (isString && content.length < 1_800_000) {
                trigger(`data:${mime},${encodeURIComponent(content)}`);
            } else {
                const url = URL.createObjectURL(blob);
                trigger(url, () => URL.revokeObjectURL(url));
            }
            return true;
        } catch (e) {
            console.warn('Admin.downloadFile failed', e);
            if (typeof showToast === 'function') showToast('Download failed', 'error');
            return false;
        }
    },

    /**
     * Pick one of several actions (e.g. export format). Returns choice id or null if cancelled.
     * @param {string} title
     * @param {string} message
     * @param {{ id: string, label: string, primary?: boolean }[]} choices
     */
    secureChoice: function(title, message, choices = []) {
        return new Promise((resolve) => {
            const modalId = 'admin-secure-choice';
            let modal = document.getElementById(modalId);
            if (!modal) {
                modal = document.createElement('div');
                modal.id = modalId;
                modal.className = 'fixed inset-0 bg-black/80 z-[200] hidden flex items-center justify-center p-4 backdrop-blur-sm';
                document.body.appendChild(modal);
            }

            const buttons = (choices || []).map((c, i) => `
                <button type="button" data-choice-id="${String(c.id).replace(/"/g, '')}"
                    class="w-full font-bold py-3 px-4 rounded-xl transition-colors focus:outline-none text-sm ${c.primary || i === 0
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
                        : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'}">
                    ${c.label}
                </button>
            `).join('');

            modal.innerHTML = `
                <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-gray-200 dark:border-gray-700">
                    <div class="text-center">
                        <h3 class="text-lg font-black text-gray-900 dark:text-white mb-2 tracking-tight">${title}</h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">${message}</p>
                        <div class="flex flex-col gap-2">${buttons}</div>
                        <button type="button" id="ach-cancel" class="mt-4 w-full text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-2 focus:outline-none">Cancel</button>
                    </div>
                </div>
            `;

            modal.classList.remove('hidden');
            const done = (val) => {
                modal.classList.add('hidden');
                resolve(val);
            };
            modal.querySelectorAll('[data-choice-id]').forEach((btn) => {
                btn.onclick = () => done(btn.getAttribute('data-choice-id'));
            });
            document.getElementById('ach-cancel').onclick = () => done(null);
            modal.onclick = (e) => { if (e.target === modal) done(null); };
        });
    },

    // --- 0.15 SECURE ASYNC CONFIRMATION MODAL (PWA SANDBOX SAFE) ---
    secureConfirm: function(title, message, requirePromptText = null) {
        return new Promise((resolve) => {
            const modalId = 'admin-secure-confirm';
            let modal = document.getElementById(modalId);
            
            if (!modal) {
                modal = document.createElement('div');
                modal.id = modalId;
                modal.className = 'fixed inset-0 bg-black/80 z-[200] hidden flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
                document.body.appendChild(modal);
            }
            
            const promptHtml = requirePromptText ? `
                <input type="text" id="admin-prompt-input" class="w-full h-10 px-3 mt-4 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white outline-none font-mono" placeholder="Type '${requirePromptText}' to confirm">
            ` : '';

            modal.innerHTML = `
                <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 transform transition-all scale-95 border border-gray-200 dark:border-gray-700">
                    <div class="text-center">
                        <div class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 mb-4 shadow-inner">
                            <svg class="h-6 w-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        </div>
                        <h3 class="text-lg font-black text-gray-900 dark:text-white mb-2 tracking-tight">${title}</h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400 mb-2 leading-relaxed">${message}</p>
                        ${promptHtml}
                        <div class="flex space-x-3 mt-6">
                            <button id="asc-cancel" class="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-bold py-3 px-4 rounded-xl transition-colors focus:outline-none text-sm">Cancel</button>
                            <button id="asc-confirm" class="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-colors focus:outline-none text-sm">Confirm</button>
                        </div>
                    </div>
                </div>
            `;

            modal.classList.remove('hidden');
            void modal.offsetWidth; // force reflow
            modal.firstElementChild.classList.remove('scale-95');
            modal.firstElementChild.classList.add('scale-100');

            const btnCancel = document.getElementById('asc-cancel');
            const btnConfirm = document.getElementById('asc-confirm');
            const inputPrompt = document.getElementById('admin-prompt-input');

            if (inputPrompt) inputPrompt.focus();

            const cleanup = (result) => {
                modal.classList.add('hidden');
                modal.firstElementChild.classList.remove('scale-100');
                modal.firstElementChild.classList.add('scale-95');
                resolve(result);
            };

            btnCancel.onclick = () => cleanup(false);
            btnConfirm.onclick = () => {
                if (requirePromptText) {
                    if (inputPrompt && inputPrompt.value === requirePromptText) {
                        cleanup(true);
                    } else {
                        if (typeof showToast === 'function') showToast(`Must type exactly '${requirePromptText}'`, 'error');
                    }
                } else {
                    cleanup(true);
                }
            };
        });
    },

    // --- 0.16 IMAGE LIGHTBOX MODAL ---
    openLightbox: function(url) {
        window._adminLightboxOpen = true;
        history.pushState({ modal: 'admin-lightbox' }, '', '#admin-lightbox');
        if (typeof lockBackgroundScroll === 'function') lockBackgroundScroll();
        let modal = document.getElementById('admin-lightbox-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'admin-lightbox-modal';
            modal.className = 'fixed inset-0 bg-black/95 z-[300] hidden flex items-center justify-center p-2 sm:p-4 backdrop-blur-md transition-opacity duration-300';
            modal.onclick = (e) => {
                if (e.target === modal || e.target.id === 'lightbox-close-btn' || e.target.closest('#lightbox-close-btn')) {
                    Admin.closeLightbox();
                }
            };
            modal.innerHTML = `
                <button id="lightbox-close-btn" class="absolute top-4 right-4 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors focus:outline-none z-10 backdrop-blur-sm">
                    <svg class="w-6 h-6 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
                <img id="admin-lightbox-img" src="" class="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl transform transition-transform scale-95 duration-300" alt="Full screen preview">
            `;
            document.body.appendChild(modal);
        }
        
        const img = document.getElementById('admin-lightbox-img');
        if (img) img.src = url;
        
        modal.classList.remove('hidden');
        void modal.offsetWidth; // Force Reflow
        if (img) {
            img.classList.remove('scale-95');
            img.classList.add('scale-100');
        }
    },

    closeLightbox: function() {
        window._adminLightboxOpen = false;
        if (location.hash === '#admin-lightbox') history.back();
        if (typeof unlockBackgroundScroll === 'function') unlockBackgroundScroll();
        const modal = document.getElementById('admin-lightbox-modal');
        if (!modal) return;
        const img = document.getElementById('admin-lightbox-img');
        if (img) {
            img.classList.remove('scale-100');
            img.classList.add('scale-95');
        }
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('opacity-0');
            if (img) img.src = '';
        }, 300);
    },

    currentUser: null,
    telemetryInterval: null, 
    telemetryWeeksAgo: 0, 
    telemetryRange: 'DAU', // GROWTH SPRINT: Default to Daily Active Users Trend
    isComparing: false, // GROWTH SPRINT PHASE 9: Dual-Draw Overlay State
    // [GUARDIAN] Phase 3 cleanup: removed dead `clockInterval` state. The admin live-clock DOM
    // injection was already purged; this vestigial property had no remaining references.
    
    isGridMode: true,
    gridCols: 3,
    _modulesRendered: false,

    /**
     * Leave a drilled admin panel and restore the Dev Mode grid.
     * Uses replaceState(#dev) — never history.back() — so popstate cannot close Dev Mode / jump home.
     */
    exitDrillToGrid: (opts = {}) => {
        const fromPopState = !!opts.fromPopState;
        if (window._adminLightboxOpen && typeof Admin.closeLightbox === 'function') {
            Admin.closeLightbox();
            return true;
        }
        if (Admin.isGridMode) return false;

        const container = document.getElementById('admin-modules-container');
        const devHeaderRow = document.querySelector('#dev-modal .border-b.border-gray-200.pb-4.mb-6')
            || document.querySelector('#dev-modal .border-b.border-gray-200.pb-2.mb-3')
            || document.querySelector('#dev-panel-temp .border-b.border-gray-200.pb-4.mb-6')
            || document.querySelector('#dev-panel-temp .border-b.border-gray-200.pb-2.mb-3');
        const titleH3 = devHeaderRow?.querySelector('h3');
        const toggleBtn = document.getElementById('grid-view-toggle');
        const signoutContainer = document.getElementById('admin-signout-container');

        window._adminDrillBackLock = true;
        Admin.isGridMode = true;

        if (container) {
            container.classList.add('admin-grid-view');
            container.style.gridTemplateColumns = `repeat(${Admin.gridCols || 3}, minmax(0, 1fr))`;
            Array.from(container.children).forEach((child) => {
                child.style.display = '';
                if (child.dataset.originalClasses) {
                    child.className = child.dataset.originalClasses;
                }
                const b = child.querySelector('[id$="-body"]');
                if (b) b.classList.add('hidden');
                const h = child.querySelector('[id$="-header-btn"]');
                if (h) h.style.removeProperty('display');
            });
        }

        if (titleH3 && devHeaderRow?.dataset.originalHtml) {
            titleH3.innerHTML = devHeaderRow.dataset.originalHtml;
        }
        if (devHeaderRow) {
            devHeaderRow.classList.add('pb-4', 'mb-6');
            devHeaderRow.classList.remove('pb-2', 'mb-3');
        }
        if (toggleBtn) toggleBtn.style.display = '';
        if (signoutContainer) signoutContainer.style.display = '';

        if (window._actionRequiredWasOpen) {
            const actionBody = document.getElementById('action-body');
            const actionChevron = document.getElementById('action-chevron');
            if (actionBody) actionBody.classList.remove('hidden');
            if (actionChevron) actionChevron.classList.remove('-rotate-90');
            window._actionRequiredWasOpen = false;
        }

        // Keep Dev Mode on #dev without popping history (avoids closing the modal / home jump)
        const hashNow = location.hash || '';
        if (!(fromPopState && hashNow === '#dev')) {
            try { history.replaceState({ modal: 'dev' }, '', '#dev'); } catch (_) {}
        }

        if (typeof Admin.syncAllBadges === 'function') Admin.syncAllBadges();
        if (typeof Admin.syncGridToggleIcon === 'function') Admin.syncGridToggleIcon(toggleBtn);

        setTimeout(() => { window._adminDrillBackLock = false; }, 200);
        return true;
    },

    /** Re-sync grid mode after Dev Mode re-open (fixes tiles that look active but ignore taps). */
    ensureGridViewEngaged: () => {
        const container = document.getElementById('admin-modules-container');
        const devModal = document.getElementById('dev-modal');
        if (!container || !devModal || devModal.classList.contains('hidden')) return;

        const hash = location.hash || '';
        const drilled = hash.startsWith('#dev-') && hash !== '#dev';
        if (drilled && Admin.isGridMode === false) return;

        Admin.isGridMode = true;
        container.classList.add('admin-grid-view');
        container.style.gridTemplateColumns = `repeat(${Admin.gridCols || 3}, minmax(0, 1fr))`;

        Array.from(container.children).forEach((child) => {
            child.style.display = '';
            if (child.dataset.originalClasses) {
                child.className = child.dataset.originalClasses;
            }
            const body = child.querySelector('[id$="-body"]');
            if (body) body.classList.add('hidden');
            const header = child.querySelector('[id$="-header-btn"]');
            if (header) header.style.removeProperty('display');
        });

        const devHeaderRow = document.querySelector('#dev-modal .border-b.border-gray-200.pb-4.mb-6')
            || document.querySelector('#dev-modal .border-b.border-gray-200.pb-2.mb-3');
        const titleH3 = devHeaderRow?.querySelector('h3');
        if (titleH3 && devHeaderRow?.dataset.originalHtml) {
            titleH3.innerHTML = devHeaderRow.dataset.originalHtml;
        }
        const toggleBtn = document.getElementById('grid-view-toggle');
        if (toggleBtn) toggleBtn.style.display = '';
        const signoutContainer = document.getElementById('admin-signout-container');
        if (signoutContainer) signoutContainer.style.display = '';
    },

    /** Close Developer Mode reliably (no history.back() race that can no-op the X button). */
    closeDevModal: (opts = {}) => {
        const force = !!opts.force;
        // Grid X / forced exit: close Dev Mode. Drilled X (no force): step back to grid only.
        if (!force && !Admin.isGridMode && typeof Admin.exitDrillToGrid === 'function') {
            Admin.exitDrillToGrid();
            return;
        }
        // Never arm _adminDrillBackLock BEFORE closeSmoothModal — that guard
        // early-returns and leaves #dev-modal open (X turns grey, modal stays).
        window._adminDrillBackLock = false;
        if (force) Admin.isGridMode = true;
        if (typeof closeSmoothModal === 'function') closeSmoothModal('dev-modal', true);
        else document.getElementById('dev-modal')?.classList.add('hidden');
        try { history.replaceState({ view: 'home' }, '', '#home'); } catch (_) {}
        // Arm lock AFTER close so a late popstate cannot re-enter close during normalize
        window._adminDrillBackLock = true;
        setTimeout(() => { window._adminDrillBackLock = false; }, 200);
    },

    /** Compact unread count for tile badges (number only). */
    formatBadgeCount: (n) => {
        const c = Number(n) || 0;
        if (c <= 0) return '';
        return c > 99 ? '99+' : String(c);
    },

    /** Keep the column-cycle button icon in sync with Admin.gridCols. */
    syncGridToggleIcon: (btn = document.getElementById('grid-view-toggle')) => {
        if (!btn) return;
        if (Admin.gridCols === 1) {
            btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>`;
            btn.title = 'List view - tap for 2 columns';
        } else if (Admin.gridCols === 2) {
            btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>`;
            btn.title = '2 columns - tap for 3 columns';
        } else {
            btn.innerHTML = `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h4v14H4zM10 5h4v14h-4zM16 5h4v14h-4z"></path></svg>`;
            btn.title = '3 columns - tap for list view';
        }
    },

    // --- UNIVERSAL NUMBER FORMATTER ---
    formatNumber: (val) => {
        if (val === null || val === undefined || isNaN(val) || val === '--' || val === 'ERR') return val;
        return Number(val).toLocaleString('en-US');
    },

    // --- UNIVERSAL DATE FORMATTER ---
    formatDate: (ts) => {
        if (!ts) return "Unknown";
        const d = new Date(ts);
        const day = d.getDate();
        const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
        const year = d.getFullYear();
        let hours = d.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
    },

    // --- GUARDIAN PHASE 11 & 12: MASTER NOTIFICATION ENGINE (SEEN PROTOCOL) ---
    syncAllBadges: async () => {
        const secret = await Admin.getAuthKey();
        if (!secret) return;
        const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
        let totalUnread = 0; // GUARDIAN PHASE 11: Accumulator for PWA Badge

        try {
            // Fetch Universal Cross-Device Admin State
            let adminState = { fb_last_checked: 0, crash_last_checked: 0, de_last_checked: 0 };
            try {
                const stateRes = await fetch(`${dynamicEndpoint}admin_state/${Admin.currentUser.uid}.json?auth=${secret}`);
                if (stateRes.ok) adminState = (await stateRes.json()) || adminState;
            } catch(e){}

            // 1. Fetch Feedback
            const fbRes = await window.guardianFetch(`${dynamicEndpoint}feedback.json?auth=${secret}`, {}, 6000);
            if (fbRes.ok) {
                const fbData = await fbRes.json();
                let fbUnread = 0;
                // GUARDIAN PHASE 12: Sync local offline state with Firebase cross-device state (Whichever is newest wins)
                const localFbChecked = parseInt(typeof safeStorage !== 'undefined' ? (safeStorage.getItem('fb_last_checked') || '0') : '0');
                const lastChecked = Math.max(localFbChecked, parseInt(adminState.fb_last_checked || '0'));
                
                if (fbData && typeof fbData === 'object') {
                    Object.values(fbData).forEach(i => { if (i.timestamp > lastChecked) fbUnread++; });
                }
                
                totalUnread += fbUnread;
                const fbBadge = document.getElementById('fb-unread-badge');
                if (fbBadge) {
                    fbBadge.textContent = Admin.formatBadgeCount(fbUnread);
                    fbBadge.classList.toggle('hidden', fbUnread === 0);
                }
            }

            // 2. Fetch Crashes
            const crRes = await window.guardianFetch(`${dynamicEndpoint}sys_logs/crashes.json?auth=${secret}`, {}, 6000);
            if (crRes.ok) {
                const crData = await crRes.json();
                let crUnread = 0;
                const localCrChecked = parseInt(typeof safeStorage !== 'undefined' ? (safeStorage.getItem('crash_last_checked') || '0') : '0');
                const lastChecked = Math.max(localCrChecked, parseInt(adminState.crash_last_checked || '0'));
                
                if (crData && typeof crData === 'object') {
                    Object.values(crData).forEach(i => { if (i.timestamp > lastChecked) crUnread++; });
                }
                
                totalUnread += crUnread;
                const crBadge = document.getElementById('crash-unread-badge');
                if (crBadge) {
                    crBadge.textContent = Admin.formatBadgeCount(crUnread);
                    crBadge.classList.toggle('hidden', crUnread === 0);
                }
            }

            // 3. Fetch Dead Ends
            const deRes = await window.guardianFetch(`${dynamicEndpoint}sys_logs/routing_fails.json?auth=${secret}`, {}, 6000);
            if (deRes.ok) {
                const deData = await deRes.json();
                const localDeChecked = parseInt(typeof safeStorage !== 'undefined' ? (safeStorage.getItem('de_last_checked') || '0') : '0');
                const lastChecked = Math.max(localDeChecked, parseInt(adminState.de_last_checked || '0'));
                let deUnread = 0;
                
                if (deData && typeof deData === 'object') {
                    Object.values(deData).forEach(i => { if (i.timestamp > lastChecked) deUnread++; });
                }
                
                totalUnread += deUnread;
                const deBadge = document.getElementById('de-unread-badge');
                if (deBadge) {
                    deBadge.textContent = Admin.formatBadgeCount(deUnread);
                    deBadge.classList.toggle('hidden', deUnread === 0);
                }
            }

            // 4. Delay reports (Phase 5)
            const drRes = await window.guardianFetch(`${dynamicEndpoint}delay_reports.json?auth=${secret}`, {}, 6000);
            if (drRes.ok) {
                const drData = await drRes.json();
                let drUnread = 0;
                const localDrChecked = parseInt(typeof safeStorage !== 'undefined' ? (safeStorage.getItem('dr_last_checked') || '0') : '0');
                const lastChecked = Math.max(localDrChecked, parseInt(adminState.dr_last_checked || '0'));
                if (drData && typeof drData === 'object') {
                    Object.values(drData).forEach((i) => {
                        if (i && i.status !== 'closed' && (i.timestamp || 0) > lastChecked) drUnread++;
                    });
                }
                totalUnread += drUnread;
                const drBadge = document.getElementById('dr-unread-badge');
                if (drBadge) {
                    drBadge.textContent = Admin.formatBadgeCount(drUnread);
                    drBadge.classList.toggle('hidden', drUnread === 0);
                }
            }

            // 5. Moderation queue (Phase 6)
            const mqRes = await window.guardianFetch(`${dynamicEndpoint}moderation_queue.json?auth=${secret}`, {}, 6000);
            if (mqRes.ok) {
                const mqData = await mqRes.json();
                let mqUnread = 0;
                const localMqChecked = parseInt(typeof safeStorage !== 'undefined' ? (safeStorage.getItem('mq_last_checked') || '0') : '0');
                const lastChecked = Math.max(localMqChecked, parseInt(adminState.mq_last_checked || '0'));
                if (mqData && typeof mqData === 'object') {
                    Object.values(mqData).forEach((i) => {
                        if (i && i.status !== 'closed' && i.status !== 'resolved' && (i.timestamp || 0) > lastChecked) mqUnread++;
                    });
                }
                totalUnread += mqUnread;
                const mqBadge = document.getElementById('mq-unread-badge');
                if (mqBadge) {
                    mqBadge.textContent = Admin.formatBadgeCount(mqUnread);
                    mqBadge.classList.toggle('hidden', mqUnread === 0);
                }
            }
            
            // GUARDIAN 2.4.1: Native PWA App Icon Badging
            if ('setAppBadge' in navigator) {
                if (totalUnread > 0) navigator.setAppBadge(totalUnread);
                else navigator.clearAppBadge();
            }
        } catch(e) {
            console.warn("Guardian: Badge sync failed", e);
        }
    },

    // --- GROWTH SPRINT PHASE 9: UNIFIED RANGE CYCLER ---
    cycleTelemetryRange: () => {
        const ranges = ['INTRADAY', 'DAU', 'WAU', 'MAU', 'ALL'];
        Admin.telemetryRange = ranges[(ranges.indexOf(Admin.telemetryRange) + 1) % ranges.length];
        
        const cycleBtn = document.getElementById('trend-cycle-btn');
        if (cycleBtn) cycleBtn.innerHTML = `${Admin.icon('trending', 'w-3.5 h-3.5 inline-block mr-1 align-middle')} ${Admin.telemetryRange} Trend`;
        
        const modalCycleBtn = document.getElementById('modal-trend-cycle');
        if (modalCycleBtn) modalCycleBtn.innerHTML = `${Admin.icon('trending', 'w-3.5 h-3.5 inline-block mr-1 align-middle')} ${Admin.telemetryRange}`;
        
        Admin.telemetryWeeksAgo = 0; // Reset pagination context
        
        const paginationControls = document.getElementById('modal-pagination-controls');
        if (paginationControls) {
            if (Admin.telemetryRange === 'DAU' || Admin.telemetryRange === 'WAU') {
                paginationControls.classList.remove('hidden');
                paginationControls.classList.add('flex');
            } else {
                paginationControls.classList.add('hidden');
                paginationControls.classList.remove('flex');
            }
        }
        
        Admin.refreshTelemetry();
    },

    // --- 0.2 TELEMETRY REFRESH ENGINE & EXPORT ---
    setupTelemetry: () => {
        const telPanel = document.getElementById('telemetry-panel');
        if (!telPanel) return;

        const telBody = document.getElementById('telemetry-body');
        
        // GUARDIAN UX FIX: Dynamically strip "vibe coded" rainbow colors and apply sleek monochromatic corporate theme
        if (telBody && !telBody.dataset.devibed) {
            telBody.dataset.devibed = "true";
            
            const metricBoxes = telBody.querySelectorAll('.grid > div');
            metricBoxes.forEach(box => {
                box.className = "bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center shadow-sm transition-colors";
                const label = box.querySelector('span:first-child');
                const value = box.querySelector('span:last-child');
                
                // GUARDIAN: Identify the "Today" tile to make it interactive for Regional Breakdown
                if (value && value.id === 'stat-today') {
                    box.classList.add('cursor-pointer', 'hover:border-indigo-400', 'dark:hover:border-indigo-500', 'hover:shadow-md');
                    box.title = "View Regional Breakdown";
                    box.onclick = () => Admin.openRegionalModal();
                }

                if (label) label.className = "text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-1";
                // No permanent pulse on Today / WAU - only refreshTelemetry adds a short loading pulse
                if (value) value.className = "text-2xl font-black text-slate-800 dark:text-slate-200";
            });

            const errorBox = telBody.querySelector('.bg-red-50') || telBody.querySelector('#stat-errors')?.closest('div');
            if (errorBox) {
                errorBox.className = "bg-slate-50 dark:bg-slate-800/80 p-3 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between shadow-sm mt-3 transition-colors cursor-pointer hover:border-red-400 dark:hover:border-red-500 hover:shadow-md";
                errorBox.title = 'System / Sentry diagnostic errors (24h). Distress/help lives under Crash Analytics.';
                errorBox.onclick = () => Admin.openDiagnosticErrorsModal();
                const label = errorBox.querySelector('span:first-child');
                const value = errorBox.querySelector('span:last-child');
                if (label) {
                    label.className = "text-[10px] text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider flex items-center";
                    label.innerHTML = `<span class="mr-1.5 inline-flex text-amber-500">${Admin.icon('alert', 'w-4 h-4')}</span> SYSTEM ERRORS 24H`;
                }
                if (value) value.className = "text-lg font-black text-slate-800 dark:text-slate-200";
            }
            
            // GUARDIAN FIX: Removed the regex SVG-replacement block here to allow the native emoji to display.
        }

        // GUARDIAN: Inject HTML elements dynamically if they don't exist
        if (telBody && !document.getElementById('tel-export-btn')) {
            // GROWTH SPRINT PHASE 6 & 8: Fully Dynamic SVG Line Graph & Range Toggles
            const trendWrapper = document.createElement('div');
            trendWrapper.className = "mt-4 border-t border-slate-200 dark:border-slate-700 pt-3";
            trendWrapper.innerHTML = `
                <div class="flex items-center justify-between mb-2 px-1">
                    <button id="trend-cycle-btn" class="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest focus:outline-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors bg-slate-100 dark:bg-slate-800 px-2 py-1.5 rounded flex items-center shadow-sm border border-slate-200 dark:border-slate-700">
                        <svg class="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path></svg>
                        <span>${Admin.telemetryRange} Trend</span>
                    </button>
                    <div class="flex space-x-2">
                        <button id="trend-expand-btn" class="text-sm text-slate-400 hover:text-blue-500 transition-colors focus:outline-none px-1" title="Full Screen">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
                        </button>
                        <button id="trend-inline-export-btn" class="text-sm text-slate-400 hover:text-blue-500 transition-colors focus:outline-none px-1" title="Export">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        </button>
                    </div>
                </div>
                <div id="tel-trend-container" class="h-28 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex items-center justify-center cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                    <span class="text-xs text-slate-400 italic">Loading Graph...</span>
                </div>
            `;
            telBody.appendChild(trendWrapper);
            
            // GUARDIAN PHASE 11: Reordered Title Below Graph for interactive airspace
            let chartModal = document.getElementById('telemetry-chart-modal');
            if (!chartModal) {
                chartModal = document.createElement('div');
                chartModal.id = 'telemetry-chart-modal';
                chartModal.className = 'fixed inset-0 bg-black/90 z-[160] hidden flex items-center justify-center p-4 backdrop-blur-md transition-opacity duration-300';
                chartModal.innerHTML = `
                    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] landscape:h-[95vh] flex flex-col transform transition-all scale-95 border border-slate-200 dark:border-slate-700">
                        <div class="p-3 md:p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900 rounded-t-2xl shrink-0">
                            <div class="flex items-center space-x-2">
                                <button id="modal-trend-cycle" class="px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors focus:outline-none text-[10px] font-bold uppercase tracking-widest border border-slate-200 dark:border-slate-700 shadow-sm flex items-center">
                                    <svg class="w-3.5 h-3.5 mr-1.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path></svg>
                                    <span>${Admin.telemetryRange}</span>
                                </button>
                            </div>
                            <div class="flex items-center space-x-2">
                                <button id="modal-trend-compare-btn" class="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors focus:outline-none" title="Compare Previous Period">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                                </button>
                                <button id="modal-trend-export" class="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-blue-100 dark:hover:bg-slate-700 transition-colors focus:outline-none" title="Export Chart">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                </button>
                                <button onclick="closeSmoothModal('telemetry-chart-modal')" class="p-2 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors focus:outline-none">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>
                        </div>
                        
                        <div id="modal-pagination-controls" class="p-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex justify-center items-center space-x-4 shrink-0 shadow-inner">
                            <button id="modal-trend-prev" class="w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow border border-slate-200 dark:border-slate-600 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none transition-transform active:scale-95" aria-label="Previous period"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg></button>
                            <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest w-24 text-center">Navigate</span>
                            <button id="modal-trend-next" class="w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow border border-slate-200 dark:border-slate-600 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none transition-transform active:scale-95 disabled:opacity-30" aria-label="Next period"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg></button>
                        </div>
                        
                        <div class="flex-grow p-2 md:p-6 flex flex-col items-center justify-center relative bg-white dark:bg-gray-800 min-h-0">
                            <div id="modal-chart-svg-container" class="w-full flex-grow mb-4">
                                <!-- High-Res SVG Line Graph gets injected here -->
                            </div>
                            <div class="text-center shrink-0 pb-4">
                                <h3 class="text-lg md:text-xl font-black text-slate-900 dark:text-white tracking-tight leading-none" id="modal-trend-title">Loading...</h3>
                                <p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-1">Live Analytics Engine</p>
                            </div>
                        </div>
                    </div>
                `;
                document.body.appendChild(chartModal);

                // Bind Modal Pagination & Unified Toggle
                document.getElementById('modal-trend-prev').onclick = () => { Admin.telemetryWeeksAgo++; Admin.refreshTelemetry(); };
                document.getElementById('modal-trend-next').onclick = () => { if(Admin.telemetryWeeksAgo > 0) { Admin.telemetryWeeksAgo--; Admin.refreshTelemetry(); } };
                document.getElementById('modal-trend-export').onclick = () => Admin.exportTrendGraph();
                document.getElementById('modal-trend-cycle').onclick = Admin.cycleTelemetryRange;
                
                // Compare Toggle Binding
                const compareBtn = document.getElementById('modal-trend-compare-btn');
                if (compareBtn) {
                    compareBtn.onclick = () => {
                        Admin.isComparing = !Admin.isComparing;
                        if (Admin.isComparing) {
                            compareBtn.classList.replace('text-slate-400', 'text-blue-600');
                            compareBtn.classList.replace('dark:bg-slate-800', 'dark:bg-slate-700');
                        } else {
                            compareBtn.classList.replace('text-blue-600', 'text-slate-400');
                            compareBtn.classList.replace('dark:bg-slate-700', 'dark:bg-slate-800');
                        }
                        Admin.refreshTelemetry();
                    };
                }
            }

            let regionModal = document.getElementById('telemetry-region-modal');
            if (!regionModal) {
                regionModal = document.createElement('div');
                regionModal.id = 'telemetry-region-modal';
                regionModal.className = 'fixed inset-0 bg-black/90 z-[160] hidden flex items-center justify-center p-4 backdrop-blur-md transition-opacity duration-300';
                regionModal.innerHTML = `
                    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col transform transition-all scale-95 border border-slate-200 dark:border-slate-700">
                        <div class="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900 rounded-t-2xl shrink-0">
                            <h3 class="text-lg font-black text-slate-900 dark:text-white flex items-center tracking-tight">
                                <span class="mr-2 inline-flex">${Admin.icon('globe', 'w-4 h-4')}</span> Regional Breakdown
                            </h3>
                            <button onclick="closeSmoothModal('telemetry-region-modal'); if(location.hash === '#region-breakdown') history.replaceState({ adminPanel: 'telemetry-panel' }, '', '#dev-telemetry-panel');" class="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors focus:outline-none">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        <div class="p-5 flex-grow bg-white dark:bg-gray-800 rounded-b-2xl">
                            <p class="text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Unique Active Users (Today)</p>
                            <div class="grid grid-cols-2 gap-3 mb-3">
                                <div class="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800/50 flex flex-col items-center justify-center shadow-sm">
                                    <span class="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider mb-1">Gauteng</span>
                                    <span id="region-stat-gp" class="text-2xl font-black text-blue-700 dark:text-blue-300">--</span>
                                </div>
                                <div class="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-100 dark:border-green-800/50 flex flex-col items-center justify-center shadow-sm">
                                    <span class="text-[10px] text-green-600 dark:text-green-400 font-bold uppercase tracking-wider mb-1">Western Cape</span>
                                    <span id="region-stat-wc" class="text-2xl font-black text-green-700 dark:text-green-300">--</span>
                                </div>
                                <div class="bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg border border-orange-100 dark:border-orange-800/50 flex flex-col items-center justify-center shadow-sm">
                                    <span class="text-[10px] text-orange-600 dark:text-orange-400 font-bold uppercase tracking-wider mb-1">KwaZulu-Natal</span>
                                    <span id="region-stat-kzn" class="text-2xl font-black text-orange-700 dark:text-orange-300">--</span>
                                </div>
                                <div class="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg border border-purple-100 dark:border-purple-800/50 flex flex-col items-center justify-center shadow-sm">
                                    <span class="text-[10px] text-purple-600 dark:text-purple-400 font-bold uppercase tracking-wider mb-1">Eastern Cape</span>
                                    <span id="region-stat-ec" class="text-2xl font-black text-purple-700 dark:text-purple-300">--</span>
                                </div>
                            </div>
                            <div class="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between shadow-sm mt-1 mb-4">
                                <span class="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider flex items-center">Uncategorized / Global</span>
                                <span id="region-stat-other" class="text-lg font-black text-slate-700 dark:text-slate-300">--</span>
                            </div>
                            
                            <!-- GROWTH SPRINT PHASE 12: Pivot to Graph CTA -->
                            <button id="region-view-graph-btn" class="w-full bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold py-3 rounded-xl shadow-md transition-colors text-xs uppercase tracking-widest focus:outline-none flex items-center justify-center border border-slate-700 dark:border-slate-600">
                                <svg class="w-4 h-4 mr-2 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path></svg>
                                View Global Trends
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(regionModal);
                
                // Bind the Pivot action
                document.getElementById('region-view-graph-btn').onclick = () => {
                    closeSmoothModal('telemetry-region-modal');
                    // Give the modal 300ms to visually close before opening the full-screen chart
                    setTimeout(() => {
                        openSmoothModal('telemetry-chart-modal');
                    }, 300);
                };
            }

            const cycleBtn = document.getElementById('trend-cycle-btn');
            if (cycleBtn) {
                cycleBtn.onclick = Admin.cycleTelemetryRange;
            }

            const expandBtn = document.getElementById('trend-expand-btn');
            const inlineExportBtn = document.getElementById('trend-inline-export-btn');
            const inlineContainer = document.getElementById('tel-trend-container');

            if (expandBtn) expandBtn.onclick = () => openSmoothModal('telemetry-chart-modal');
            if (inlineContainer) inlineContainer.onclick = () => openSmoothModal('telemetry-chart-modal');
            if (inlineExportBtn) inlineExportBtn.onclick = () => Admin.exportTrendGraph();

            // Main Global Export Button (Raw Data Snapshot)
            const exportBtn = document.createElement('button');
            exportBtn.id = 'tel-export-btn';
            exportBtn.className = "w-full mt-4 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-bold py-2.5 rounded-lg transition-colors text-[10px] flex items-center justify-center border border-slate-200 dark:border-slate-700 focus:outline-none shadow-sm uppercase tracking-wider";
            exportBtn.innerHTML = `
                <svg class="w-4 h-4 mr-2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                Full Snapshot
            `;
            exportBtn.onclick = Admin.exportTelemetry;
            telBody.appendChild(exportBtn);
        }

        if (telPanel.dataset.adminLoaded === "true") {
            if (!Admin.telemetryInterval) {
                Admin.telemetryInterval = setInterval(Admin.refreshTelemetry, 10000);
            }
            Admin.refreshTelemetry();
            return;
        }
        telPanel.dataset.adminLoaded = "true";

        // Force header redesign for grid badges
        const telHeader = document.getElementById('telemetry-header-btn');
        if (telHeader) {
            telHeader.classList.add('relative');
        }

        Admin.refreshTelemetry();
        if (Admin.telemetryInterval) clearInterval(Admin.telemetryInterval);
        Admin.telemetryInterval = setInterval(Admin.refreshTelemetry, 10000);
    },

    /**
     * Steffen monotone cubic → SVG path through chart points.
     * Local peaks/troughs get zero tangent (crest is the data point; no overshoot).
     * Slope changes at joins — S-curve inflection sits on the shared vertex.
     */
    _smoothSvgPathD: (points) => {
        if (!points.length) return '';
        const fmt = (n) => (Math.round(n * 100) / 100);
        if (points.length === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
        if (points.length === 2) {
            return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[1].x)} ${fmt(points[1].y)}`;
        }

        const n = points.length;
        const segSlope = new Array(n - 1);
        for (let i = 0; i < n - 1; i++) {
            const dx = points[i + 1].x - points[i].x;
            const dy = points[i + 1].y - points[i].y;
            segSlope[i] = dx === 0 ? 0 : dy / dx;
        }

        const m = new Array(n);
        m[0] = segSlope[0];
        m[n - 1] = segSlope[n - 2];
        for (let i = 1; i < n - 1; i++) {
            const s0 = segSlope[i - 1];
            const s1 = segSlope[i];
            if (s0 === 0 || s1 === 0 || (s0 > 0) !== (s1 > 0)) {
                // Local extremum or flat — horizontal tangent so peak/trough is the crest
                m[i] = 0;
            } else {
                const h0 = points[i].x - points[i - 1].x;
                const h1 = points[i + 1].x - points[i].x;
                const weighted = (h0 + h1) ? Math.abs((h0 * s1 + h1 * s0) / (h0 + h1)) : 0;
                const sign = s0 > 0 ? 1 : -1;
                m[i] = sign * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * weighted);
            }
        }

        let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
        for (let i = 0; i < n - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const dx = p2.x - p1.x;
            const cp1x = p1.x + dx / 3;
            const cp1y = p1.y + (m[i] * dx) / 3;
            const cp2x = p2.x - dx / 3;
            const cp2y = p2.y - (m[i + 1] * dx) / 3;
            d += ` C ${fmt(cp1x)} ${fmt(cp1y)}, ${fmt(cp2x)} ${fmt(cp2y)}, ${fmt(p2.x)} ${fmt(p2.y)}`;
        }
        return d;
    },

    // --- DYNAMIC SVG LINE GRAPH BUILDER (GROWTH PHASE 8: SCALE AWARE) ---
    _buildLineGraphSVG: (dataArray, labelsArray, title, isTodayIdx, isMini = false, compareDataArray = null) => {
        const numPoints = Math.max(1, dataArray.length);
        
        // SVG dimensions
        const w = 600; 
        const h = isMini ? 150 : 300;
        const pl = isMini ? 15 : 50; 
        const pr = isMini ? 15 : 30; 
        const pt = isMini ? 25 : 30; 
        const pb = isMini ? 15 : 35;
        const uw = w - pl - pr;
        const uh = h - pt - pb;
        
        // Exaggerated Y-Axis scale logic to defeat "Zero-Baseline Compression"
        let allData = [...dataArray];
        if (Array.isArray(compareDataArray)) {
            allData = allData.concat(compareDataArray);
        }
        
        const validData = allData.filter(v => v !== null && v > 0);
        const maxVal = validData.length > 0 ? Math.max(...validData) : 10;
        const minVal = validData.length > 0 ? Math.min(...validData) : 0;
        
        const spread = maxVal - minVal;
        const yMax = Math.ceil(maxVal + (spread > 0 ? spread * 0.2 : maxVal * 0.2));
        let yMin = Math.max(0, Math.floor(minVal - (spread > 0 ? spread * 0.2 : minVal * 0.5)));
        
        // GUARDIAN UX FIX: Clamp Y-Axis to 0 if dataset contains 0s to stop negative baseline rendering
        if (allData.some((v) => v === 0)) {
            yMin = 0;
        }

        const yRange = yMax - yMin || 10;

        const getX = (i) => pl + (i * (uw / Math.max(1, numPoints - 1)));
        const getY = (v) => pt + uh - ((((Number(v) || 0) - yMin) / yRange) * uh);

        // Build path only across known buckets (null = future / unreported - do not draw to 0)
        const knownIdx = [];
        for (let i = 0; i < numPoints; i++) {
            if (dataArray[i] !== null && dataArray[i] !== undefined) knownIdx.push(i);
        }
        const knownPts = knownIdx.map((i) => ({ x: getX(i), y: getY(dataArray[i]) }));
        let pathD = Admin._smoothSvgPathD(knownPts);
        const firstKnown = knownIdx[0] ?? 0;
        const lastKnown = knownIdx[knownIdx.length - 1] ?? 0;
        let areaD = pathD
            ? `${pathD} L ${getX(lastKnown)} ${pt+uh} L ${getX(firstKnown)} ${pt+uh} Z`
            : '';
        
        // Colors & Theme Independence (hardcoded hex for perfect exportability)
        const lineColor = '#3b82f6';
        const todayColor = '#f97316';
        const gridColor = '#e2e8f0';
        const labelColor = '#94a3b8';

        let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="display:block; max-height:100%;">`;
        
        // Defs for gradient
        svg += `<defs><linearGradient id="lineGrad_${isMini ? 'mini' : 'full'}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${lineColor}" stop-opacity="0.3"/><stop offset="100%" stop-color="${lineColor}" stop-opacity="0.0"/></linearGradient></defs>`;
        
        // Background Grid & Y-Axis (Only in full view)
        if (!isMini) {
            [0, 0.5, 1].forEach(tick => {
                const y = pt + uh - (tick * uh);
                const val = Math.round(yMin + (yRange * tick));
                svg += `<line x1="${pl}" y1="${y}" x2="${w-pr}" y2="${y}" stroke="${gridColor}" stroke-dasharray="4" stroke-width="1.5" />`;
                svg += `<text x="${pl-12}" y="${y+4}" font-family="sans-serif" font-size="12" font-weight="800" fill="${labelColor}" text-anchor="end">${val}</text>`;
            });
        }
        
        // COMPARE OVERLAY: Draw the faded comparison line first so it sits underneath
        if (compareDataArray && numPoints > 1) {
            const cKnown = [];
            for (let i = 0; i < numPoints; i++) {
                if (compareDataArray[i] !== null && compareDataArray[i] !== undefined) cKnown.push(i);
            }
            if (cKnown.length > 0) {
                const comparePathD = Admin._smoothSvgPathD(
                    cKnown.map((i) => ({ x: getX(i), y: getY(compareDataArray[i]) }))
                );
                svg += `<path d="${comparePathD}" fill="none" stroke="#94a3b8" stroke-width="${isMini ? '2' : '3'}" stroke-dasharray="6,4" stroke-linecap="round" stroke-linejoin="round" opacity="0.6" />`;
            }
        }

        // Fill Area & Stroke Line (Hide area if only 1 point exists)
        if (knownIdx.length > 1 && pathD) {
            svg += `<path d="${areaD}" fill="url(#lineGrad_${isMini ? 'mini' : 'full'})" />`;
            svg += `<path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="${isMini ? '3' : '4'}" stroke-linecap="round" stroke-linejoin="round" />`;
        }
        
        // Points and X-Axis
        for(let i=0; i<numPoints; i++) {
            const val = dataArray[i];
            if (val === null || val === undefined) continue;
            const compareVal = compareDataArray && compareDataArray[i] !== null && compareDataArray[i] !== undefined
                ? compareDataArray[i]
                : null;
            const vx = getX(i);
            const vy = getY(val);
            const isToday = (i === isTodayIdx);
            
            const pColor = isToday ? todayColor : lineColor;
            // Adjusted radius since numPoints will naturally be 48 (under 50)
            const radius = isToday ? (isMini ? 3 : 5) : (isMini ? 2 : 4);
            
            // Marker Dot (Reconstruct exact time for 48 point INTRADAY tooltips)
            let hoverLabel = labelsArray[i] || 'Current';
            if (numPoints === 48) {
                const hh = Math.floor(i / 2).toString().padStart(2, '0');
                const mm = ((i % 2) * 30).toString().padStart(2, '0');
                hoverLabel = `${hh}:${mm}`;
            }
            
            // Worker metric is GA4 activeUsers. INTRADAY = actives in that half-hour bucket.
            const metricWord = Admin.telemetryRange === 'INTRADAY' ? 'active / 30m' : 'Active users';
            const tooltipText = compareVal !== null
                ? `${val} ${metricWord} (Prev: ${compareVal}) [${hoverLabel}]`
                : `${val} ${metricWord} (${hoverLabel})`;
            
            // GUARDIAN: Numbers hidden by default to declutter. Click dot to reveal exact stats!
            svg += `
                <circle cx="${vx}" cy="${vy}" r="${radius}" fill="#ffffff" stroke="${pColor}" stroke-width="${isMini ? '1.5' : '2'}" class="cursor-pointer hover:stroke-[3px] transition-all" onclick="if(typeof showToast === 'function') showToast('${tooltipText}', 'info')">
                    <title>${tooltipText}</title>
                </circle>
            `;

            // Draw faint compare point on top of the dashed line
            if (compareDataArray && !isMini) {
                const cvy = getY(compareVal);
                svg += `<circle cx="${vx}" cy="${cvy}" r="2" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1.5" opacity="0.8"><title>Prev: ${compareVal}</title></circle>`;
            }
            
            // X-Axis Labels (Dynamic formatting from worker)
            if (!isMini && labelsArray[i]) {
                const dayColor = isToday ? todayColor : labelColor;
                svg += `<text x="${vx}" y="${pt+uh+20}" font-family="sans-serif" font-size="11" font-weight="800" fill="${dayColor}" text-anchor="middle">${labelsArray[i]}</text>`;
                
                // GUARDIAN UX FIX: Restore data counts directly on the graph for macro reports
                if (Admin.telemetryRange !== 'INTRADAY') {
                    svg += `<text x="${vx}" y="${vy - 10}" font-family="sans-serif" font-size="11" font-weight="900" fill="${dayColor}" text-anchor="middle">${val}</text>`;
                }
            }
        }
        
        svg += `</svg>`;
        return svg;
    },

    refreshTelemetry: async () => {
        const stat5m = document.getElementById('stat-5m');
        const stat30m = document.getElementById('stat-30m');
        const statToday = document.getElementById('stat-today');
        const statWeekly = document.getElementById('stat-weekly');
        const statMonthly = document.getElementById('stat-monthly');
        const statAllTime = document.getElementById('stat-alltime');
        const statErrors = document.getElementById('stat-errors');
        const syncEl = document.getElementById('telemetry-last-sync');
        
        const devModal = document.getElementById('dev-modal');
        if (devModal && devModal.classList.contains('hidden')) {
            if (Admin.telemetryInterval) {
                clearInterval(Admin.telemetryInterval);
                Admin.telemetryInterval = null;
                console.log("Guardian: Dev Modal closed. Telemetry polling suspended.");
            }
            return;
        }

        const secret = await Admin.getAuthKey();
        if (!secret) return;

        // Soft loading pulse only while values are still placeholders
        [stat5m, stat30m, statToday, statWeekly, statMonthly, statAllTime, statErrors].forEach(el => {
            if (!el) return;
            const t = (el.textContent || '').trim();
            if (t === '--' || t === '' || t === 'Wait') el.classList.add('animate-pulse');
        });

        const CLOUDFLARE_WORKER_URL = 'https://nexttrain-telemetry.enock.workers.dev/';
        
        try {
            // GUARDIAN PHASE 4 & 8: Dynamic Range Payload for Edge Workers
            const fetchUrl = new URL(CLOUDFLARE_WORKER_URL);
            fetchUrl.searchParams.set('weeksAgo', Admin.telemetryWeeksAgo); // Acts as 'daysAgo' for INTRADAY
            fetchUrl.searchParams.set('range', Admin.telemetryRange || 'INTRADAY');

            const res = await window.guardianFetch(fetchUrl.toString(), {
                headers: { 'Authorization': `Bearer ${secret}` }
            }, 6000);
            
            if (res.ok) {
                const data = await res.json();
                
                if(stat5m) stat5m.textContent = data.active5m !== undefined ? Admin.formatNumber(data.active5m) : '--';
                if(stat30m) stat30m.textContent = data.active30m !== undefined ? Admin.formatNumber(data.active30m) : '--';
                if(statToday) statToday.textContent = data.todayUsers !== undefined ? Admin.formatNumber(data.todayUsers) : '--';
                if(statWeekly) statWeekly.textContent = data.wauUsers !== undefined ? Admin.formatNumber(data.wauUsers) : '--';
                if(statMonthly) statMonthly.textContent = data.mauUsers !== undefined ? Admin.formatNumber(data.mauUsers) : '--';
                if(statAllTime) statAllTime.textContent = data.allTimeUsers !== undefined ? Admin.formatNumber(data.allTimeUsers) : '--';
                if(statErrors) statErrors.textContent = data.todayErrors !== undefined ? Admin.formatNumber(data.todayErrors) : '--';
                
                // GUARDIAN: Store and update regional breakdown seamlessly
                if (data.regionalBreakdown) {
                    Admin.currentRegionalBreakdown = data.regionalBreakdown;
                    Admin.updateRegionalModal();
                }

                if (syncEl) {
                    syncEl.classList.remove('hidden');
                    const now = new Date();
                    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
                    syncEl.textContent = `synced: ${timeStr}`;
                }

                // GROWTH SPRINT PHASE 8: Dynamic Multi-Range Scalable SVG Line Graph Engine
                let rawCountsArray = data.chartData && data.chartData.length > 0 ? data.chartData : (data.sevenDayTrend || []);
                let rawLabelsArray = data.chartLabels || [];

                // Legacy workers emitted cumulative INTRADAY totals. Convert to per-bucket
                // velocity until the edge sets intradayMode: 'perBucket'.
                const toPerBucket = (arr) => {
                    if (!Array.isArray(arr) || arr.length === 0) return arr;
                    const out = new Array(arr.length);
                    let prev = 0;
                    for (let i = 0; i < arr.length; i++) {
                        const v = arr[i];
                        if (v === null || v === undefined) {
                            out[i] = v;
                            continue;
                        }
                        const n = Number(v) || 0;
                        out[i] = Math.max(0, n - prev);
                        prev = n;
                    }
                    return out;
                };
                if (Admin.telemetryRange === 'INTRADAY' && data.intradayMode !== 'perBucket') {
                    if (rawCountsArray.length > 48) {
                        rawCountsArray = [
                            ...toPerBucket(rawCountsArray.slice(0, 48)),
                            ...toPerBucket(rawCountsArray.slice(48)),
                        ];
                    } else {
                        rawCountsArray = toPerBucket(rawCountsArray);
                    }
                }
                
                // GUARDIAN PHASE 2: RAM Array Slicer Engine
                // INTRADAY worker packs [yesterday 0..47 | today 48..cutoff]. Never take
                // "last 48" for Today - that straddles midnight and draws a fake cliff.
                let pointsPerView = Admin.telemetryRange === 'INTRADAY' ? 48 : 7;
                let offset = Admin.telemetryWeeksAgo;
                
                let masterLen = rawCountsArray.length;
                let endIndex, startIndex;
                if (Admin.telemetryRange === 'INTRADAY') {
                    const todayStart = masterLen > 48 ? 48 : 0;
                    if (offset === 0) {
                        startIndex = todayStart;
                        endIndex = masterLen;
                    } else if (offset === 1 && masterLen > 48) {
                        startIndex = 0;
                        endIndex = 48;
                    } else {
                        startIndex = 0;
                        endIndex = 0;
                    }
                } else {
                    endIndex = masterLen - (offset * pointsPerView);
                    startIndex = endIndex - pointsPerView;
                    if (startIndex < 0) startIndex = 0;
                    if (endIndex < 0) endIndex = 0;
                }
                
                let activeCountsArray = rawCountsArray.slice(startIndex, endIndex);
                let labelsArray = rawLabelsArray.slice(startIndex, endIndex);
                
                // Keep chart consistently scaled even if data runs out early
                if (Admin.telemetryRange === 'INTRADAY') {
                    // Pad FUTURE buckets (end), not the morning - zeros at the start fake a dawn climb.
                    if (activeCountsArray.length < 48) {
                        const padLen = 48 - activeCountsArray.length;
                        activeCountsArray = [...activeCountsArray, ...Array(padLen).fill(null)];
                        labelsArray = [...labelsArray, ...Array(padLen).fill('')];
                    } else if (activeCountsArray.length > 48) {
                        activeCountsArray = activeCountsArray.slice(0, 48);
                        labelsArray = labelsArray.slice(0, 48);
                    }
                } else if (activeCountsArray.length < pointsPerView && masterLen > 0) {
                    const padLen = pointsPerView - activeCountsArray.length;
                    activeCountsArray = [...Array(padLen).fill(0), ...activeCountsArray];
                    labelsArray = [...Array(padLen).fill(''), ...labelsArray];
                }

                // GUARDIAN PHASE 3: Comparison Array Slicer
                let compareCountsArray = null;
                if (Admin.isComparing) {
                    if (Admin.telemetryRange === 'INTRADAY' && offset === 0 && masterLen > 48) {
                        compareCountsArray = rawCountsArray.slice(0, 48);
                        if (compareCountsArray.length < 48) {
                            compareCountsArray = [...compareCountsArray, ...Array(48 - compareCountsArray.length).fill(null)];
                        }
                    } else {
                        let compareOffset = offset + 1;
                        let compEndIndex = masterLen - (compareOffset * pointsPerView);
                        let compStartIndex = compEndIndex - pointsPerView;
                        
                        if (compStartIndex < 0) compStartIndex = 0;
                        if (compEndIndex < 0) compEndIndex = 0;
                        
                        if (compEndIndex > compStartIndex) {
                            compareCountsArray = rawCountsArray.slice(compStartIndex, compEndIndex);
                            if (compareCountsArray.length < pointsPerView) {
                                const padLen = pointsPerView - compareCountsArray.length;
                                compareCountsArray = [...Array(padLen).fill(0), ...compareCountsArray];
                            }
                        } else {
                            compareCountsArray = Array(pointsPerView).fill(0);
                        }
                    }
                }
                
                let displayLabels = [];
                if (Admin.telemetryRange === 'INTRADAY') {
                    // Generate exact 3-hour labels at buckets 0, 6, 12, 18, 24, 30, 36, 42
                    displayLabels = activeCountsArray.map((_, idx) => {
                        if (idx % 6 === 0) { 
                            const hour = Math.floor(idx / 2);
                            if (hour === 0) return '12AM';
                            if (hour === 12) return '12PM';
                            return hour < 12 ? `${hour}AM` : `${hour - 12}PM`;
                        }
                        return ''; 
                    });
                } else if (Admin.telemetryRange === 'DAU' || !Admin.telemetryRange) {
                    displayLabels = labelsArray.map(lbl => {
                        if (lbl && lbl.length === 8) {
                            const d = new Date(lbl.substring(0,4), parseInt(lbl.substring(4,6))-1, lbl.substring(6,8));
                            return ['S','M','T','W','T','F','S'][d.getDay()];
                        }
                        return lbl;
                    });
                } else if (Admin.telemetryRange === 'WAU') {
                    // GROWTH SPRINT PHASE 9: Date conversion helper for WAU (e.g. "W15" -> "08 Apr")
                    displayLabels = labelsArray.map(lbl => {
                        if (lbl && lbl.length === 6) {
                            const y = parseInt(lbl.substring(0,4));
                            const w = parseInt(lbl.substring(4,6));
                            const d = new Date(y, 0, 1 + (w - 1) * 7);
                            d.setDate(d.getDate() + (1 - d.getDay())); 
                            return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`;
                        }
                        return lbl ? 'W' + lbl.substring(4) : '';
                    });
                } else {
                    displayLabels = labelsArray.map(lbl => {
                        if (lbl && lbl.length === 6) {
                            return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parseInt(lbl.substring(4,6))-1];
                        }
                        return lbl;
                    });
                }
                
                // Absolute structural fallback to prevent zero-array SVG generation crashes
                if (activeCountsArray.length === 0) {
                    activeCountsArray = [0];
                    displayLabels = ['-'];
                }

                let titleStr = "";
                
                // GUARDIAN PHASE 4: Dynamic Title Extractor based on raw data labels
                let firstValidRaw = null;
                let lastValidRaw = null;
                
                for (let i = 0; i < labelsArray.length; i++) {
                    if (labelsArray[i] && labelsArray[i].trim() !== '') {
                        firstValidRaw = labelsArray[i];
                        break;
                    }
                }
                
                for (let i = labelsArray.length - 1; i >= 0; i--) {
                    if (labelsArray[i] && labelsArray[i].trim() !== '') {
                        lastValidRaw = labelsArray[i];
                        break;
                    }
                }

                const formatDateLabel = (raw) => {
                    if (!raw) return '';
                    if (raw.length === 8) { // YYYYMMDD
                        const d = new Date(raw.substring(0,4), parseInt(raw.substring(4,6))-1, raw.substring(6,8));
                        return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`;
                    } else if (raw.length === 6 && Admin.telemetryRange === 'WAU') { // YYYYWW
                        const y = parseInt(raw.substring(0,4));
                        const w = parseInt(raw.substring(4,6));
                        const d = new Date(y, 0, 1 + (w - 1) * 7);
                        d.setDate(d.getDate() + (1 - d.getDay()));
                        return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`;
                    } else if (raw.length === 6 && Admin.telemetryRange === 'MAU') { // YYYYMM
                        return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(raw.substring(4,6))-1]} ${raw.substring(0,4)}`;
                    }
                    return raw;
                };

                const titleStart = formatDateLabel(firstValidRaw);
                const titleEnd = formatDateLabel(lastValidRaw);
                const rangeStr = (titleStart && titleEnd && titleStart !== titleEnd) ? ` (${titleStart} - ${titleEnd})` : (titleStart ? ` (${titleStart})` : '');

                if (Admin.telemetryRange === 'INTRADAY') {
                    if (Admin.telemetryWeeksAgo === 0) {
                        titleStr = "Intraday activity / 30 min (Today)";
                    } else if (Admin.telemetryWeeksAgo === 1) {
                        titleStr = "Intraday activity / 30 min (Yesterday)";
                    } else {
                        const d = new Date();
                        d.setDate(d.getDate() - Admin.telemetryWeeksAgo);
                        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                        titleStr = `Intraday activity / 30 min (${d.getDate()} ${monthNames[d.getMonth()]})`;
                    }
                } else if (Admin.telemetryRange === 'DAU' || !Admin.telemetryRange) {
                    titleStr = `Daily Active Users${rangeStr}`;
                } else if (Admin.telemetryRange === 'WAU') {
                    titleStr = `Weekly Active Users${rangeStr}`;
                } else if (Admin.telemetryRange === 'MAU') {
                    titleStr = `Monthly Active Users${rangeStr}`;
                } else {
                    titleStr = `All-Time Active Users`;
                }
                
                const modalTitleEl = document.getElementById('modal-trend-title');
                if (modalTitleEl) modalTitleEl.textContent = titleStr;
                
                const nextBtn = document.getElementById('modal-trend-next');
                const inlineNextBtn = document.getElementById('trend-next-btn');
                const prevBtn = document.getElementById('modal-trend-prev');
                
                // Forward-in-time guard (Next)
                [nextBtn, inlineNextBtn].forEach(btn => {
                    if (btn) {
                        if (Admin.telemetryWeeksAgo === 0) {
                            btn.classList.add('opacity-30', 'cursor-not-allowed');
                            btn.disabled = true;
                        } else {
                            btn.classList.remove('opacity-30', 'cursor-not-allowed');
                            btn.disabled = false;
                        }
                    }
                });
                
                // Backward-in-time guard (Prev)
                if (prevBtn) {
                    let canGoPrev = false;
                    if (Admin.telemetryRange === 'INTRADAY') {
                        canGoPrev = Admin.telemetryWeeksAgo === 0 && masterLen > 48;
                    } else {
                        canGoPrev = masterLen > 0 && (masterLen - ((Admin.telemetryWeeksAgo + 1) * pointsPerView)) > 0;
                    }
                    if (!canGoPrev) {
                        prevBtn.classList.add('opacity-30', 'cursor-not-allowed');
                        prevBtn.disabled = true;
                    } else {
                        prevBtn.classList.remove('opacity-30', 'cursor-not-allowed');
                        prevBtn.disabled = false;
                    }
                }

                // Orange marker = last known INTRADAY bucket (worker clips ~3h of lag)
                let isTodayIdx = -1;
                if (Admin.telemetryRange === 'INTRADAY' && Admin.telemetryWeeksAgo === 0) {
                    for (let i = activeCountsArray.length - 1; i >= 0; i--) {
                        if (activeCountsArray[i] !== null && activeCountsArray[i] !== undefined) {
                            isTodayIdx = i;
                            break;
                        }
                    }
                } else if (Admin.telemetryRange !== 'INTRADAY' && (Admin.telemetryWeeksAgo === 0 || Admin.telemetryRange === 'MAU' || Admin.telemetryRange === 'ALL')) {
                    isTodayIdx = activeCountsArray.length - 1;
                }
                
                // Render Inline Miniature SVG
                const inlineContainer = document.getElementById('tel-trend-container');
                if (inlineContainer) inlineContainer.innerHTML = Admin._buildLineGraphSVG(activeCountsArray, displayLabels, titleStr, isTodayIdx, true, compareCountsArray);
                
                // Render Full-Screen Modal SVG
                const modalSvgContainer = document.getElementById('modal-chart-svg-container');
                if (modalSvgContainer) modalSvgContainer.innerHTML = Admin._buildLineGraphSVG(activeCountsArray, displayLabels, titleStr, isTodayIdx, false, compareCountsArray);

                [stat5m, stat30m, statToday, statWeekly, statMonthly, statAllTime, statErrors].forEach(el => {
                    if (el) el.classList.remove('animate-pulse');
                });
            } else {
                throw new Error("Worker returned status: " + res.status);
            }
        } catch(e) {
            console.warn("Telemetry Fetch Failed:", e.message);
            
            if(stat5m && stat5m.textContent === '--') stat5m.textContent = "Wait";
            if(stat30m && stat30m.textContent === '--') stat30m.textContent = "Wait";
            if(statToday && statToday.textContent === '--') statToday.textContent = "Wait";
            if(statWeekly && statWeekly.textContent === '--') statWeekly.textContent = "Wait";
            if(statMonthly && statMonthly.textContent === '--') statMonthly.textContent = "Wait";
            if(statAllTime && statAllTime.textContent === '--') statAllTime.textContent = "Wait";
            if(statErrors && statErrors.textContent === '--') statErrors.textContent = "Wait";

            [stat5m, stat30m, statToday, statWeekly, statMonthly, statAllTime, statErrors].forEach(el => {
                if(el) el.classList.remove('animate-pulse');
            });
        }
    },

    exportTelemetry: async () => {
        if (typeof showToast === 'function') showToast("Generating Snapshot...", "info", 2000);
        
        if (typeof html2canvas === 'undefined') {
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            } catch(e) {
                if (typeof showToast === 'function') showToast("Failed to load snapshot engine.", "error");
                return;
            }
        }

        // Identify the exporting Admin dynamically
        const adminEmail = Admin.currentUser?.email || '';
        const adminName = adminEmail.includes('enock') ? 'Enock' : (adminEmail.includes('thandeka') ? 'Thandeka' : 'System Admin');

        // Grab current stats from the DOM (already formatted with commas by the live engine)
        const stat5m = document.getElementById('stat-5m')?.textContent || '--';
        const stat30m = document.getElementById('stat-30m')?.textContent || '--';
        const statToday = document.getElementById('stat-today')?.textContent || '--';
        const statWeekly = document.getElementById('stat-weekly')?.textContent || '--';
        const statMonthly = document.getElementById('stat-monthly')?.textContent || '--';
        const statAllTime = document.getElementById('stat-alltime')?.textContent || '--';
        
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
        const fullDateTimeStr = `${dateStr} | ${timeStr}`;

        const exportContainer = document.createElement('div');
        exportContainer.style.position = 'fixed';
        exportContainer.style.left = '-9999px';
        exportContainer.style.top = '0';
        exportContainer.style.width = '600px';
        exportContainer.style.backgroundColor = '#ffffff'; 
        exportContainer.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        exportContainer.style.padding = '30px';
        exportContainer.style.color = '#0f172a'; // slate-900
        exportContainer.style.borderRadius = '16px';
        
        exportContainer.innerHTML = `
            <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                    <h1 style="font-size: 24px; font-weight: 900; margin: 0; color: #0f172a; text-transform: uppercase; letter-spacing: -0.5px;">Live Telemetry Snapshot</h1>
                    <p style="font-size: 11px; font-weight: 700; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px;">Metrorail Next Train</p>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 25px;">
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 25px 10px; border-radius: 12px; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                    <div style="font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Active (Last 5 Mins)</div>
                    <div style="font-size: 36px; font-weight: 900; color: #0f172a; line-height: 1;">${stat5m}</div>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 25px 10px; border-radius: 12px; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                    <div style="font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Active (Last 30 Mins)</div>
                    <div style="font-size: 36px; font-weight: 900; color: #0f172a; line-height: 1;">${stat30m}</div>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 25px 10px; border-radius: 12px; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                    <div style="font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Unique Users Today</div>
                    <div style="font-size: 36px; font-weight: 900; color: #0f172a; line-height: 1;">${statToday}</div>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 25px 10px; border-radius: 12px; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                    <div style="font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">7 Days (WAU)</div>
                    <div style="font-size: 36px; font-weight: 900; color: #0f172a; line-height: 1;">${statWeekly}</div>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 25px 10px; border-radius: 12px; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                    <div style="font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">30 Days (MAU)</div>
                    <div style="font-size: 36px; font-weight: 900; color: #0f172a; line-height: 1;">${statMonthly}</div>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 25px 10px; border-radius: 12px; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                    <div style="font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">All-Time Users</div>
                    <div style="font-size: 36px; font-weight: 900; color: #0f172a; line-height: 1;">${statAllTime}</div>
                </div>
            </div>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px 20px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-size: 12px; font-weight: 800; color: #334155; margin-bottom: 2px;">Exported by ${adminName}</div>
                    <div style="font-size: 10px; font-weight: 600; color: #64748b;">${fullDateTimeStr}</div>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <div style="display: flex; align-items: center; background: #ffffff; padding: 6px 12px; border-radius: 20px; border: 1px solid #e2e8f0; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                        <svg style="width: 14px; height: 14px; margin-right: 6px;" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2V7h2v10z" fill="#E37400"/></svg>
                        <span style="font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Verified by Google Analytics</span>
                    </div>
                    <div style="font-size: 10px; font-weight: 600; color: #64748b; margin-top: 6px; padding-right: 4px;">nexttrain.co.za</div>
                </div>
            </div>
        `;

        document.body.appendChild(exportContainer);

        try {
            await new Promise(r => setTimeout(r, 150)); 

            const canvas = await html2canvas(exportContainer, {
                scale: 2,
                backgroundColor: '#ffffff',
                logging: false
            });

            canvas.toBlob(async (blob) => {
                const timestampStr = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 12); 
                const fileName = `NextTrain_Telemetry_${timestampStr}.png`;
                const file = new File([blob], fileName, { type: "image/png" });
                const blobUrl = URL.createObjectURL(blob);
                
                const link = document.createElement('a');
                link.download = fileName;
                link.href = blobUrl;
                link.click();
                
                if (typeof showToast === 'function') showToast("Snapshot saved to device!", "success", 4000);
                
                document.body.removeChild(exportContainer);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 60000); 
            });
        } catch (e) {
            console.error(e);
            if (typeof showToast === 'function') showToast("Snapshot failed.", "error");
            if(document.body.contains(exportContainer)) document.body.removeChild(exportContainer);
        }
    },

    // --- GROWTH SPRINT: REGIONAL BREAKDOWN MODAL LOGIC ---
    openRegionalModal: () => {
        if (typeof triggerHaptic === 'function') triggerHaptic();
        history.pushState({ modal: 'telemetry-region-modal' }, '', '#region-breakdown');
        openSmoothModal('telemetry-region-modal');
        Admin.updateRegionalModal();
    },

    updateRegionalModal: () => {
        const data = Admin.currentRegionalBreakdown;
        if (!data) return;
        
        const gpEl = document.getElementById('region-stat-gp');
        const wcEl = document.getElementById('region-stat-wc');
        const kznEl = document.getElementById('region-stat-kzn');
        const ecEl = document.getElementById('region-stat-ec');
        const otherEl = document.getElementById('region-stat-other');
        
        if (gpEl) gpEl.textContent = data.GP !== undefined ? Admin.formatNumber(data.GP) : '--';
        if (wcEl) wcEl.textContent = data.WC !== undefined ? Admin.formatNumber(data.WC) : '--';
        if (kznEl) kznEl.textContent = data.KZN !== undefined ? Admin.formatNumber(data.KZN) : '--';
        if (ecEl) ecEl.textContent = data.EC !== undefined ? Admin.formatNumber(data.EC) : '--';
        if (otherEl) otherEl.textContent = data.OTHER !== undefined ? Admin.formatNumber(data.OTHER) : '--';
    },

    // GROWTH SPRINT PHASE 6: Dynamic 7-Day Chart Snapshot Engine (SVG Clone Method)
    exportTrendGraph: async () => {
        if (typeof showToast === 'function') showToast("Generating Chart Snapshot...", "info", 2000);
        
        if (typeof html2canvas === 'undefined') {
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            } catch(e) {
                if (typeof showToast === 'function') showToast("Failed to load snapshot engine.", "error");
                return;
            }
        }

        const titleText = document.getElementById('modal-trend-title')?.textContent || '7-Day DAU Trend';
        const rawSvgNode = document.querySelector('#modal-chart-svg-container svg');
        if (!rawSvgNode) return;

        const exportContainer = document.createElement('div');
        exportContainer.style.position = 'fixed';
        exportContainer.style.left = '-9999px';
        exportContainer.style.top = '0';
        exportContainer.style.width = '700px';
        exportContainer.style.backgroundColor = '#ffffff'; 
        exportContainer.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        exportContainer.style.padding = '40px';
        exportContainer.style.borderRadius = '16px';
        
        exportContainer.innerHTML = `
            <div style="border-bottom: 3px solid #3b82f6; padding-bottom: 15px; margin-bottom: 30px;">
                <h1 style="font-size: 26px; font-weight: 900; margin: 0; color: #1e3a8a; letter-spacing: -0.5px;">${titleText}</h1>
                <p style="font-size: 12px; font-weight: 800; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px;">Metrorail Next Train Telemetry</p>
            </div>
            <div id="export-svg-slot" style="height: 350px; margin-bottom: 20px;"></div>
            <div style="text-align: right; font-size: 11px; font-weight: 800; color: #94a3b8;">Data via Google Analytics 4 | Snapshot generated: ${new Date().toLocaleString('en-ZA')}</div>
        `;
        
        // Deep clone the SVG into the export container to preserve all exact vector points
        exportContainer.querySelector('#export-svg-slot').appendChild(rawSvgNode.cloneNode(true));
        document.body.appendChild(exportContainer);

        try {
            await new Promise(r => setTimeout(r, 150)); 
            const canvas = await html2canvas(exportContainer, { scale: 2, backgroundColor: '#ffffff', logging: false });
            
            canvas.toBlob(async (blob) => {
                const timestampStr = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 12); 
                const fileName = `NextTrain_LineChart_${timestampStr}.png`;
                const file = new File([blob], fileName, { type: "image/png" });
                const blobUrl = URL.createObjectURL(blob);
                
                const link = document.createElement('a');
                link.download = fileName;
                link.href = blobUrl;
                link.click();
                
                if (typeof showToast === 'function') showToast("Chart saved to device!", "success", 4000);
                document.body.removeChild(exportContainer);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 60000); 
            });
        } catch (e) {
            if (typeof showToast === 'function') showToast("Chart snapshot failed.", "error");
            if(document.body.contains(exportContainer)) document.body.removeChild(exportContainer);
        }
    },

    // --- 1. INITIALIZATION ---
    init: () => {
        // GUARDIAN FIX: Uncouple UI bindings from Firebase to survive offline/cached race conditions
        if (!Admin._coreEventsBound) {
            Admin.setupLoginAccess();
            Admin._coreEventsBound = true;
        }

        // Firebase Auth strictly handles Auth listeners securely
        window.addEventListener('firebase-auth-ready', () => {
            if (!Admin._authListenerBound) {
                Admin.setupAuthListener();
                Admin._authListenerBound = true;
            }
        });
        
        if (window.firebaseAuth && !Admin._authListenerBound) {
            Admin.setupAuthListener();
            Admin._authListenerBound = true;
        }
    },

    // --- 2. AUTH LISTENER (PHASE 9) ---
    setupAuthListener: () => {
        // GUARDIAN PHASE 4: Upgrade to onIdTokenChanged to survive token refreshes and prevent random drops
        const authListenerFn = typeof window.firebaseOnIdTokenChanged === 'function' ? window.firebaseOnIdTokenChanged : window.firebaseOnAuthStateChanged;
        
        if (typeof authListenerFn !== 'function') {
            console.warn("Guardian: Firebase Auth not loaded. Skipping auth listener.");
            return;
        }

        authListenerFn(window.firebaseAuth, (user) => {
            const signoutContainer = document.getElementById('admin-signout-container');
            const nextUid = user?.uid || null;
            const prevUid = Admin.currentUser?.uid || null;
            // onIdTokenChanged fires on every token refresh — only treat real sign-in/out as session changes
            const sessionChanged = nextUid !== prevUid;

            if (user) {
                Admin.currentUser = user;
                try { localStorage.setItem('analytics_ignore', 'true'); } catch(e){}
                try { safeStorage.setItem('dev_session_active', 'true'); } catch(e){}

                if (sessionChanged) {
                    console.log("Guardian: Admin Authenticated. Analytics blocked.");

                    let displayName = user.email;
                    if (user.email && user.email.includes('@')) {
                        const prefix = user.email.split('@')[0];
                        displayName = prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
                    }

                    if (signoutContainer) {
                        signoutContainer.innerHTML = `
                            <div class="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                                <p class="text-xs text-gray-500 mb-2 text-center">Logged in as: <span class="font-bold text-gray-700 dark:text-gray-300">${displayName}</span></p>
                                <button id="admin-signout-btn" class="w-full bg-gray-200 dark:bg-gray-700 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 font-bold py-3 rounded-lg shadow-sm transition-colors text-sm focus:outline-none">
                                    Secure Sign Out
                                </button>
                            </div>
                        `;
                        const signOutBtn = document.getElementById('admin-signout-btn');
                        if (signOutBtn) {
                            signOutBtn.addEventListener('click', () => {
                                window.firebaseSignOut(window.firebaseAuth).then(() => {
                                    if (typeof showToast === 'function') showToast("Signed out successfully.", "success");
                                    if (location.hash === '#dev') history.back();
                                    else if (typeof closeSmoothModal === 'function') closeSmoothModal('dev-modal');
                                });
                            });
                        }
                    }

                    Admin.syncAllBadges();
                }

            } else if (sessionChanged) {
                console.log("Guardian: Admin Logged Out. Analytics restored.");
                try { localStorage.removeItem('analytics_ignore'); } catch(e){}
                try { safeStorage.removeItem('dev_session_active'); } catch(e){}
                Admin.currentUser = null;
                if (signoutContainer) signoutContainer.innerHTML = '';
            }
        });
    },

    // --- 2.5 ENTERPRISE LOGIN ACCESS ---
    setupLoginAccess: () => {
        const appTitle = document.getElementById('app-title');
        const loginModal = document.getElementById('login-modal');
        const emailInput = document.getElementById('admin-email');
        const passInput = document.getElementById('admin-password');
        const loginBtn = document.getElementById('admin-login-btn');
        const cancelBtn = document.getElementById('admin-cancel-btn');
        const spinner = document.getElementById('admin-login-spinner');
        const devModal = document.getElementById('dev-modal');

        if (!appTitle) return;

        let clickCount = 0;
        let clickTimer = null;

        appTitle.style.cursor = 'pointer'; 
        appTitle.title = "Metrorail Next Train";

        appTitle.addEventListener('click', (e) => {
            e.preventDefault(); 
            clickCount++;
            
            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(() => { clickCount = 0; }, 2000); 
            
            if (clickCount >= 5) {
                clickCount = 0;
                
                if (Admin.currentUser || window.isSimMode) {
                    if (devModal) {
                        // GUARDIAN FIX: Route-aware modal opening prevents router bleed on back-button
                        if (location.hash !== '#dev') history.pushState({ modal: 'dev' }, '', '#dev');
                        if (typeof openSmoothModal === 'function') openSmoothModal('dev-modal');
                        else devModal.classList.remove('hidden');
                        
                        Admin.renderAdminModules(); 
                        Admin.initAutoSim(); 
                    }
                    if (typeof showToast === 'function') showToast("Developer Session Active", "info");
                } else {
                    if (loginModal) {
                        // Set hash first; openSmoothModal skips a second push when already on #login
                        try {
                            if (location.hash !== '#login') history.pushState({ modal: 'login' }, '', '#login');
                        } catch (e) { /* ignore */ }
                        if (typeof openSmoothModal === 'function') openSmoothModal('login-modal');
                        else loginModal.classList.remove('hidden');

                        if (loginBtn) {
                            loginBtn.disabled = false;
                            loginBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                        }
                        if (spinner) spinner.classList.add('hidden');
                        
                        if(emailInput) setTimeout(() => emailInput.focus(), 150);
                    }
                }
            }
        });

        // GUARDIAN FIX: Smooth exit via Router/Back Button
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => { 
                if (location.hash === '#login') history.back();
                else if (typeof closeSmoothModal === 'function') closeSmoothModal('login-modal');
                else loginModal.classList.add('hidden');
            });
        }
        
        if (passInput) {
            passInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && loginBtn) loginBtn.click();
            });
        }

        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                const email = emailInput.value.trim();
                const password = passInput.value;

                if (!email || !password) {
                    if (typeof showToast === 'function') showToast("Enter email and password", "error");
                    return;
                }

                // GUARDIAN PHASE 1: Network-request-failed crash immunity
                if (!navigator.onLine || window.isLieFi) {
                    if (typeof showToast === 'function') showToast("Network disconnected. Cannot authenticate.", "error");
                    return;
                }

                if (spinner) spinner.classList.remove('hidden');
                loginBtn.disabled = true;

                if (typeof window.firebaseSignIn !== 'function' || !window.firebaseAuth) {
                    if (typeof showToast === 'function') showToast("Authentication Failed", "error");
                    if (spinner) spinner.classList.add('hidden');
                    loginBtn.disabled = false;
                    return;
                }

                window.firebaseSignIn(window.firebaseAuth, email, password)
                    .then((userCredential) => {
                        // Close login WITHOUT history.back() - that raced popstate and closed admin
                        if (typeof closeSmoothModal === 'function') closeSmoothModal('login-modal', true);
                        else loginModal.classList.add('hidden');
                        try {
                            history.replaceState({ modal: 'dev' }, '', '#dev');
                        } catch (e) { /* ignore */ }

                        passInput.value = ''; 
                        if (devModal) {
                            if (typeof openSmoothModal === 'function') openSmoothModal('dev-modal');
                            else devModal.classList.remove('hidden');
                            
                            Admin.renderAdminModules();
                            Admin.initAutoSim(); 
                        }
                        if (typeof showToast === 'function') showToast(`Welcome back!`, "success");
                    })
                    .catch((error) => {
                        const code = error?.code || 'unknown';
                        if (typeof showToast === 'function') showToast(`Authentication Failed (${code})`, "error");
                        console.error("Guardian Login Error:", error);
                    })
                    .finally(() => {
                        if (spinner) spinner.classList.add('hidden');
                        loginBtn.disabled = false;
                    });
            });
        }
    },

    // --- 2.8 AUTO-SIM PREPARATION (GUARDIAN UPGRADE) ---
    initAutoSim: () => {
        const simEnabledCheckbox = document.getElementById('sim-enabled');
        const simTimeInput = document.getElementById('sim-time');
        const dayDropdown = document.getElementById('sim-day');
        const dateContainer = document.getElementById('sim-date-container');
        const dateInput = document.getElementById('sim-date');

        const now = new Date();
        
        // 1. Prepare Checkbox (Leave disabled unless they explicitly applied it before)
        if (simEnabledCheckbox) simEnabledCheckbox.checked = !!window.isSimMode;
        
        // 2. Prepare Time Input (Only overwrite if not already simulating)
        if (!window.isSimMode) {
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            if (simTimeInput) simTimeInput.value = `${h}:${m}:${s}`;
            
            if (dayDropdown) {
                dayDropdown.value = 'specific';
                if (dateContainer) dateContainer.classList.remove('hidden');
            }
            
            if (dateInput) {
                const yyyy = now.getFullYear();
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const dd = String(now.getDate()).padStart(2, '0');
                dateInput.value = `${yyyy}-${mm}-${dd}`;
            }
        }
    },

    // --- HELPER: RENDER ALL DYNAMIC MODULES ---
    renderAdminModules: () => {
        // GUARDIAN UX FIX: Singleton rendering lock absolutely eradicates the module duplication bug
        if (Admin._modulesRendered) {
            // Rebuild any empty/broken shells left by a prior failed setup (grid otherwise shows blank cards)
            try {
                const alertPanel = document.getElementById('alert-panel');
                const alertBroken = alertPanel && (
                    !(alertPanel.innerHTML || '').trim()
                    || !(alertPanel.querySelector('#alert-header-btn')?.textContent || '').trim()
                );
                if (alertBroken) {
                    delete alertPanel.dataset.adminLoaded;
                    alertPanel.dataset.adminShell = 'empty';
                    alertPanel.classList.add('hidden');
                    Admin.setupServiceAlertsManager();
                }
            } catch (e) { console.error('[Admin] alert rebuild failed:', e); }
            Admin.ensureGlobalStateMonitorTile();
            Admin.initGridView(); // Ensure grid is bound if re-opened
            Admin.fetchActionRequired();
            return;
        }
        Admin._modulesRendered = true;

        // GUARDIAN PHASE 11 (UX FIX): Convert Modal to Native Full-Screen App Architecture
        const devModalCard = document.querySelector('#dev-modal > div');
        if (devModalCard) {
            devModalCard.className = "bg-gray-50 dark:bg-gray-900 w-full min-h-screen max-w-5xl mx-auto p-4 sm:p-6 flex flex-col relative transition-all duration-300";
        }
        const devModalContainer = document.getElementById('dev-modal');
        if (devModalContainer) {
            devModalContainer.classList.remove('p-4', 'items-center');
            devModalContainer.classList.add('p-0', 'items-start', 'overflow-y-auto');
        }

        // --- AFTER ---
        // GUARDIAN UX FIX: Removed the top "Secure Sign Out" button to prevent accidental 6th-tap clicks. 
        // Admin will rely purely on the bottom Sign Out button.
        const devHeaderRow = document.querySelector('#dev-modal .border-b.border-gray-200.pb-4.mb-6');

        // Setup Execution Order (isolated so one panel failure cannot blank the rest of the grid)
        const runAdminSetup = (label, fn) => {
            try { fn(); }
            catch (err) {
                console.error(`[Admin] ${label} failed:`, err);
            }
        };
        runAdminSetup('telemetry', () => Admin.setupTelemetry());
        runAdminSetup('feedback', () => Admin.setupFeedbackManager());
        runAdminSetup('delayReports', () => Admin.setupDelayReportsManager());
        runAdminSetup('moderation', () => Admin.setupModerationQueueManager());
        runAdminSetup('userTrust', () => Admin.setupUserTrustManager());
        runAdminSetup('deadEnds', () => Admin.setupDeadEndsManager());
        runAdminSetup('crashes', () => Admin.setupCrashReportsManager());
        runAdminSetup('serviceAlerts', () => Admin.setupServiceAlertsManager());
        runAdminSetup('disruptions', () => Admin.setupDisruptionsManager());
        runAdminSetup('exclusions', () => Admin.setupExclusionManager());
        runAdminSetup('holidayApprovals', () => Admin.setupHolidayApprovalsManager());
        runAdminSetup('maintenance', () => Admin.setupMaintenanceManager());
        runAdminSetup('specialEvent', () => Admin.setupSpecialEventManager());
        runAdminSetup('diagnostics', () => Admin.setupDiagnosticsManager());
        runAdminSetup('scheduleQa', () => Admin.setupScheduleQaManager());
        runAdminSetup('roadmap', () => Admin.setupRoadmapManager());

        // Stub Global State Monitor before grid packs tiles (fetch fills body async)
        Admin.ensureGlobalStateMonitorTile();

        // GROWTH SPRINT PHASE 5: Transform Dev Hub into native Grid / Drill-Down Dashboard
        Admin.initGridView();
        
        // Final Universal Sync
        Admin.syncAllBadges();

        // GUARDIAN PHASE 14: Action Required Expiry Dashboard
        Admin.fetchActionRequired();
        
        // GUARDIAN PHASE 6.3: Post-Render Initialization for Transplanted UI Components
        // Because the HTML for these elements was moved OUT of the monolithic UI.js string 
        // and IN to the dynamic setup functions, we must manually trigger their setup logic here
        // so they attach to the newly generated DOM elements on first load.
        Admin.initSimulationUI();
    },
    
    initSimulationUI: () => {
        const simApplyBtn = document.getElementById('sim-apply-btn');
        if (simApplyBtn && !document.getElementById('sim-pipeline-override')) {
            const pipelineHtml = `
                <div class="mt-4 pt-4 pb-4 border-t border-gray-200 dark:border-gray-700 w-full">
                    <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Data Pipeline Override (Local)</label>
                    <select id="sim-pipeline-override" class="w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 outline-none">
                        <option value="AUTO">AUTO (Default Waterfall)</option>
                        <option value="CLOUDFLARE">Force Edge Cache (Cloudflare)</option>
                        <option value="GITHUB">Force CDN (GitHub)</option>
                        <option value="FIREBASE">Force Direct (Firebase)</option>
                    </select>
                </div>
            `;
            simApplyBtn.parentElement.insertAdjacentHTML('beforebegin', pipelineHtml);
        }
    },


    ensureGlobalStateMonitorTile: () => {
        const adminContainer = document.getElementById('admin-modules-container');
        if (!adminContainer) return null;
        let actionBanner = document.getElementById('action-required-panel');
        if (!actionBanner) {
            actionBanner = document.createElement('div');
            actionBanner.id = 'action-required-panel';
            adminContainer.insertBefore(actionBanner, adminContainer.firstChild);
        }
        // Match other tiles: visible overflow so grid titles/icons are never clipped
        actionBanner.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-visible transition-all duration-300";
        actionBanner.classList.remove('hidden');
        const hadHeader = !!actionBanner.querySelector('#action-header-btn');
        const headerEmpty = hadHeader && !(actionBanner.querySelector('#action-header-btn')?.textContent || '').trim();
        if (!hadHeader || headerEmpty) {
            actionBanner.innerHTML = `
                <button id="action-header-btn" type="button" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                    <span class="flex flex-col items-center">
                        ${Admin.tileIcon('activity', 'text-blue-600 dark:text-blue-400')}
                        <span class="text-blue-600 dark:text-blue-400">Global State Monitor</span>
                    </span>
                    <svg id="action-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                <div id="action-body" class="hidden mt-4 space-y-2">
                    <div class="animate-pulse text-xs text-center text-gray-500 py-3">Scanning for expiring entities...</div>
                </div>
            `;
        }
        if (adminContainer.firstElementChild !== actionBanner) {
            adminContainer.insertBefore(actionBanner, adminContainer.firstChild);
        }
        return actionBanner;
    },

    fetchActionRequired: async () => {
        const actionBanner = Admin.ensureGlobalStateMonitorTile();
        if (!actionBanner) return;

        const secret = await Admin.getAuthKey();
        if (!secret) {
            const body = document.getElementById('action-body');
            if (body) {
                body.innerHTML = `<div class="text-xs text-center text-amber-600 dark:text-amber-400 py-4 px-2 leading-relaxed">Sign in required to scan active network state.</div>`;
            }
            return;
        }

        const adminContainer = document.getElementById('admin-modules-container');
        // Refresh chrome while scanning (preserve tile presence — never leave an empty card)
        actionBanner.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-visible transition-all duration-300";
        actionBanner.classList.remove('hidden');
        const gsmHeaderHtml = `
            <button id="action-header-btn" type="button" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('activity', 'text-blue-600 dark:text-blue-400')}
                    <span class="text-blue-600 dark:text-blue-400">Global State Monitor</span>
                </span>
                <svg id="action-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>`;
        // Prefer updating body only so grid title never blanks mid-fetch
        let actionBody = document.getElementById('action-body');
        if (!document.getElementById('action-header-btn') || !actionBody) {
            actionBanner.innerHTML = `${gsmHeaderHtml}
                <div id="action-body" class="hidden mt-4 space-y-2">
                    <div class="animate-pulse text-xs text-center text-gray-500 py-3">Scanning for expiring entities...</div>
                </div>`;
            actionBody = document.getElementById('action-body');
        } else if (actionBody) {
            actionBody.innerHTML = `<div class="animate-pulse text-xs text-center text-gray-500 py-3">Scanning for expiring entities...</div>`;
        }
        if (adminContainer && adminContainer.firstElementChild !== actionBanner) {
            adminContainer.insertBefore(actionBanner, adminContainer.firstChild);
        }

        try {
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            const [noticesRes, disrRes, exclRes, maintRes] = await Promise.all([
                fetch(`${dynamicEndpoint}notices.json?auth=${secret}`).catch(() => null),
                fetch(`${dynamicEndpoint}disruptions.json?auth=${secret}`).catch(() => null),
                fetch(`${dynamicEndpoint}exclusions.json?auth=${secret}`).catch(() => null),
                fetch(`${dynamicEndpoint}config/maintenance.json?auth=${secret}`).catch(() => null)
            ]);

            const now = Date.now();
            const activeItems = [];

            // 1. Scan Notices (Alerts)
            if (noticesRes && noticesRes.ok) {
                const noticesData = await noticesRes.json();
                if (noticesData) {
                    Object.keys(noticesData).forEach(target => {
                        const targetNotices = noticesData[target];
                        if (targetNotices && typeof targetNotices === 'object') {
                            if (targetNotices.id) {
                                if (!targetNotices.expiresAt || targetNotices.expiresAt > now) {
                                    activeItems.push({ type: 'Alert', label: targetNotices.severity === 'critical' ? 'Critical Advisory Active' : 'General Advisory Active', expiresAt: targetNotices.expiresAt, id: targetNotices.id, panelId: 'alert-panel', routeId: target });
                                }
                            } else {
                                Object.values(targetNotices).forEach(item => {
                                    if (!item.expiresAt || item.expiresAt > now) {
                                        activeItems.push({ type: 'Alert', label: item.severity === 'critical' ? 'Critical Advisory Active' : 'General Advisory Active', expiresAt: item.expiresAt, id: item.id, panelId: 'alert-panel', routeId: target });
                                    }
                                });
                            }
                        }
                    });
                }
            }

            // 2. Scan Disruptions
            if (disrRes && disrRes.ok) {
                const disrData = await disrRes.json();
                if (disrData) {
                    Object.keys(disrData).forEach(rId => {
                        Object.values(disrData[rId]).forEach(item => {
                            if (!item.expiresAt || item.expiresAt > now) {
                                const targetStr = item.stations ? item.stations.join(' - ').replace(/ STATION/g, '') : 'Route-Wide';
                                const prefix = item.tier === 'CRITICAL' ? 'Critical Incident' : 'Warning';
                                activeItems.push({ type: 'Disruption', label: `${prefix}: ${targetStr}`, expiresAt: item.expiresAt, id: item.id, panelId: 'disruption-panel', routeId: rId });
                            }
                        });
                    });
                }
            }

            // 3. Scan Exclusions (Bans/Specials) & Grid Notices
            if (exclRes && exclRes.ok) {
                const exclData = await exclRes.json();
                if (exclData) {
                    Object.keys(exclData).forEach(rId => {
                        Object.keys(exclData[rId]).forEach(tNum => {
                            const item = exclData[rId][tNum];
                            
                            // GUARDIAN PHASE 1: Capture Grid Notices
                            if (tNum === '_grid_notice') {
                                if (!item.expiresAt || item.expiresAt > now) {
                                    activeItems.push({ type: 'Grid Notice', label: `Grid Notice Active`, expiresAt: item.expiresAt, id: '_grid_notice', panelId: 'exclusion-panel', routeId: rId });
                                }
                                return;
                            }
                            
                            // Standard Exclusions
                            if (!item.expiresAt || item.expiresAt > now) {
                                const typeStr = item.type === 'special' ? 'Marked Special' : 'Banned';
                                activeItems.push({ type: 'Exception', label: `Train #${tNum} ${typeStr}`, expiresAt: item.expiresAt, id: tNum, panelId: 'exclusion-panel', routeId: rId });
                            }
                        });
                    });
                }
            }

            // 4. Scan Maintenance banners
            if (maintRes && maintRes.ok) {
                try {
                    const maintData = await maintRes.json();
                    const rootOn = maintData === true || (maintData && typeof maintData === 'object' && maintData.active !== false);
                    if (rootOn) {
                        let items = [];
                        if (typeof window.listMaintenanceItems === 'function') {
                            items = window.listMaintenanceItems(maintData === true ? true : maintData);
                        } else if (maintData === true) {
                            items = [{ id: '_legacy', active: true, message: 'MAINTENANCE IN PROGRESS', regions: [], routes: [] }];
                        } else if (maintData?.items && typeof maintData.items === 'object') {
                            items = Object.keys(maintData.items).map((k) => ({ id: k, ...maintData.items[k] }));
                        } else if (maintData && typeof maintData === 'object') {
                            items = [{
                                id: '_legacy',
                                active: !!maintData.active,
                                message: maintData.message || 'MAINTENANCE IN PROGRESS',
                                regions: maintData.regions || [],
                                routes: maintData.routes || [],
                                expiresAt: maintData.expiresAt || null,
                            }];
                        }
                        items.forEach((it) => {
                            if (it.active === false) return;
                            if (it.expiresAt && Number(it.expiresAt) <= now) return;
                            const scopeLabel = it.routes?.length
                                ? `${it.routes.length} route(s)`
                                : (it.regions?.length ? it.regions.join('+') : 'Network');
                            const routeId = it.routes?.[0]
                                || (it.regions?.[0] ? `all_${it.regions[0]}` : 'all');
                            const msg = String(it.message || 'Maintenance').slice(0, 80);
                            activeItems.push({
                                type: 'Maintenance',
                                label: `${msg}${msg.length >= 80 ? '…' : ''} (${scopeLabel})`,
                                expiresAt: it.expiresAt || null,
                                id: it.id,
                                panelId: 'maint-panel',
                                routeId,
                            });
                        });
                    }
                } catch (me) { /* optional */ }
            }

            Admin._routeFlags = {};
            if (activeItems.length === 0) {
                if (typeof Admin.populateAlertTargets === 'function') Admin.populateAlertTargets(true);
                if (typeof Admin.populateDisruptionRoutes === 'function') Admin.populateDisruptionRoutes();
                if (typeof Admin.populateExclusionRoutes === 'function') Admin.populateExclusionRoutes();

                actionBanner.classList.remove('hidden');
                actionBanner.innerHTML = `
                    <button id="action-header-btn" type="button" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                        <span class="flex flex-col items-center">
                            ${Admin.tileIcon('activity', 'text-blue-600 dark:text-blue-400')}
                            <span class="text-blue-600 dark:text-blue-400">Global State Monitor (0)</span>
                        </span>
                        <svg id="action-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="action-body" class="hidden mt-4 space-y-2">
                        <div class="text-xs text-center text-slate-500 dark:text-slate-400 py-4 px-2 leading-relaxed">
                            All clear - no active alerts, incidents, grid notices, schedule exceptions, or maintenance banners.
                        </div>
                    </div>
                `;
                if (adminContainer.firstElementChild !== actionBanner) {
                    adminContainer.insertBefore(actionBanner, adminContainer.firstChild);
                }
                return;
            }

            actionBanner.classList.remove('hidden');
            activeItems.sort((a, b) => {
                if (!a.expiresAt && !b.expiresAt) return 0;
                if (!a.expiresAt) return 1; // Push permanent items to the bottom
                if (!b.expiresAt) return -1;
                return a.expiresAt - b.expiresAt;
            });

            // GUARDIAN PHASE 2: Cross-reference active states for Dropdown Breadcrumbs
            Admin._routeFlags = {};
            activeItems.forEach(item => {
                if (!item.routeId || item.routeId === 'all' || item.routeId.startsWith('all_')) return;
                if (!Admin._routeFlags[item.routeId]) {
                    Admin._routeFlags[item.routeId] = { hasAlert: false, hasDisruption: false, hasNotice: false, hasExclusion: false };
                }
                if (item.type === 'Alert') Admin._routeFlags[item.routeId].hasAlert = true;
                if (item.type === 'Disruption') Admin._routeFlags[item.routeId].hasDisruption = true;
                if (item.type === 'Grid Notice') Admin._routeFlags[item.routeId].hasNotice = true;
                if (item.type === 'Exception') Admin._routeFlags[item.routeId].hasExclusion = true;
            });

            if (typeof Admin.populateAlertTargets === 'function') Admin.populateAlertTargets(true);
            if (typeof Admin.populateDisruptionRoutes === 'function') Admin.populateDisruptionRoutes();
            if (typeof Admin.populateExclusionRoutes === 'function') Admin.populateExclusionRoutes();

            // GUARDIAN UX REDESIGN: Action Required 3-Row Layout with Route Stripping
            const getRegionBadge = (rId) => {
                if (!rId) return '';
                const badgeClass = "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-black uppercase tracking-wider text-[9px] mr-1.5";
                const textClass = "text-xs font-bold text-gray-700 dark:text-gray-300";
                
                if (rId.includes('_GP')) return `<span class="${badgeClass}">GP</span> <span class="${textClass}">Global Network</span>`;
                if (rId.includes('_WC')) return `<span class="${badgeClass}">WC</span> <span class="${textClass}">Global Network</span>`;
                if (rId.includes('_KZN')) return `<span class="${badgeClass}">KZN</span> <span class="${textClass}">Global Network</span>`;
                if (rId.includes('_EC')) return `<span class="${badgeClass}">EC</span> <span class="${textClass}">Global Network</span>`;
                if (rId === 'all') return `<span class="bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded font-black uppercase tracking-wider text-[9px] mr-1.5">ALL</span> <span class="${textClass}">Entire Network</span>`;
                if (typeof ROUTES !== 'undefined' && ROUTES[rId]) return `<span class="${badgeClass}">${ROUTES[rId].region}</span> <span class="${textClass} inline-flex items-center flex-wrap">${Admin.formatRouteLabelHtml(ROUTES[rId].name)}</span>`;
                return '';
            };

            let listHtml = '';
            activeItems.forEach(item => {
                const isPermanent = !item.expiresAt;
                const hrsLeft = isPermanent ? null : Math.max(0, Math.floor((item.expiresAt - now) / (1000 * 60 * 60)));
                
                const timeBadge = isPermanent ? 'Permanent' : `Expires: in ${hrsLeft} hrs`;
                
                // Disable +24h button if permanent
                const extendBtnHtml = isPermanent 
                    ? `<button disabled class="flex-1 bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-600 text-xs font-bold py-1.5 rounded-lg border border-transparent shadow-sm flex items-center justify-center cursor-not-allowed"><svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> +24 Hrs</button>`
                    : `<button onclick="event.stopPropagation(); Admin.extendActionRequired('${item.type}', '${item.id}', '${item.routeId}')" class="flex-1 bg-white dark:bg-gray-800 hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-700 dark:text-slate-300 text-xs font-bold py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 shadow-sm transition-colors focus:outline-none flex items-center justify-center"><svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> +24 Hrs</button>`;

                listHtml += `
                    <div class="flex flex-col bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mt-2 transition-colors hover:border-blue-300 dark:hover:border-blue-500 cursor-pointer relative" onclick="Admin.deepLinkToPanel('${item.panelId}', '${item.routeId}')">
                        
                        <!-- Row 1: region + type/expiry -->
                        <div class="flex items-center justify-between gap-2 mb-1.5 w-full min-w-0">
                            <div class="min-w-0 shrink">${getRegionBadge(item.routeId)}</div>
                            <div class="flex items-center text-[10px] font-bold text-gray-500 dark:text-gray-400 shrink-0">
                                <span class="uppercase tracking-widest text-slate-500">${item.type}</span>
                                <span class="mx-1.5 text-gray-300 dark:text-gray-600">|</span>
                                <span class="${isPermanent ? 'text-blue-500' : (hrsLeft < 4 ? 'text-red-500' : 'text-orange-500')} uppercase tracking-widest">${timeBadge}</span>
                            </div>
                        </div>

                        <!-- Row 2: Bold Payload -->
                        <span class="text-sm font-black text-slate-900 dark:text-white leading-tight break-words w-full mb-2">
                            ${item.label}
                        </span>

                        <!-- Row 3: Actions -->
                        <div class="flex gap-2 pt-2.5 border-t border-gray-100 dark:border-gray-700 mt-auto w-full">
                            <button onclick="event.stopPropagation(); Admin.resolveActionRequired('${item.type}', '${item.id}', '${item.routeId}')" class="flex-1 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 border border-slate-200 dark:border-slate-600 text-xs font-bold py-1.5 rounded-lg shadow-sm transition-colors focus:outline-none flex items-center justify-center">
                                <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Resolve
                            </button>
                            ${extendBtnHtml}
                            <button onclick="event.stopPropagation(); window._actionRequiredWasOpen = true; Admin.deepLinkToPanel('${item.panelId}', '${item.routeId}')" class="flex-1 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold py-1.5 rounded-lg shadow-sm transition-colors focus:outline-none flex items-center justify-center">
                                Review &rarr;
                            </button>
                        </div>
                    </div>
                `;
            });

            actionBanner.innerHTML = `
                <button id="action-header-btn" type="button" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                    <span class="flex flex-col items-center">
                        ${Admin.tileIcon('activity', 'text-blue-600 dark:text-blue-400')}
                        <span class="text-blue-600 dark:text-blue-400">Global State Monitor (${activeItems.length})</span>
                    </span>
                    <span class="admin-unread-badge ${activeItems.length ? '' : 'hidden'}" aria-label="Active items">${activeItems.length || ''}</span>
                    <svg id="action-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                <div id="action-body" class="hidden mt-4 space-y-2">
                    ${listHtml}
                </div>
            `;
            if (adminContainer.firstElementChild !== actionBanner) {
                adminContainer.insertBefore(actionBanner, adminContainer.firstChild);
            }

        } catch(e) {
            // Stay visible - never delete the tile on fetch failure
            actionBanner.classList.remove('hidden');
            actionBanner.innerHTML = `
                <button id="action-header-btn" type="button" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                    <span class="flex flex-col items-center">
                        ${Admin.tileIcon('activity', 'text-blue-600 dark:text-blue-400')}
                        <span class="text-blue-600 dark:text-blue-400">Global State Monitor</span>
                    </span>
                </button>
                <div id="action-body" class="hidden mt-4 space-y-2">
                    <div class="text-xs text-center text-red-500 py-4">Could not refresh active entities. Tap Refresh from another panel or reopen Dev Mode.</div>
                </div>
            `;
            if (adminContainer?.firstElementChild !== actionBanner) {
                adminContainer?.insertBefore(actionBanner, adminContainer.firstChild);
            }
        }
    },

    extendActionRequired: async (type, id, routeId) => {
        if (typeof triggerHaptic === 'function') triggerHaptic();
        const secret = await Admin.getAuthKey();
        if (!secret) return;

        try {
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            let url = '';

            if (type === 'Maintenance') {
                const maintUrl = `${dynamicEndpoint}config/maintenance.json?auth=${secret}`;
                const fetchRes = await fetch(maintUrl);
                if (!fetchRes.ok) throw new Error('Fetch failed');
                const maintData = await fetchRes.json();
                if (!maintData || typeof maintData !== 'object') {
                    if (typeof showToast === 'function') showToast('No maintenance config.', 'warning');
                    return;
                }
                // Flat legacy (no items map yet)
                if (!maintData.items || typeof maintData.items !== 'object') {
                    if (!maintData.expiresAt) {
                        if (typeof showToast === 'function') showToast('Item has no expiry to extend.', 'warning');
                        return;
                    }
                    const newExpiry = Number(maintData.expiresAt) + 86400000;
                    await fetch(maintUrl, {
                        method: 'PATCH',
                        body: JSON.stringify({ expiresAt: newExpiry, updatedAt: Date.now() }),
                    });
                    if (typeof showToast === 'function') showToast('Extended by +24 Hours!', 'success');
                    Admin.fetchActionRequired();
                    return;
                }
                const item = maintData.items[id];
                if (!item || !item.expiresAt) {
                    if (typeof showToast === 'function') showToast('Item has no expiry to extend.', 'warning');
                    return;
                }
                const newExpiry = Number(item.expiresAt) + 86400000;
                await fetch(`${dynamicEndpoint}config/maintenance/items/${encodeURIComponent(id)}.json?auth=${secret}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ expiresAt: newExpiry, updatedAt: Date.now() }),
                });
                // Keep root shim expiresAt in sync when this is the primary
                if (maintData.expiresAt && Number(maintData.expiresAt) === Number(item.expiresAt)) {
                    await fetch(maintUrl, {
                        method: 'PATCH',
                        body: JSON.stringify({ expiresAt: newExpiry, updatedAt: Date.now() }),
                    });
                }
                if (typeof showToast === 'function') showToast('Extended by +24 Hours!', 'success');
                Admin.fetchActionRequired();
                return;
            }

            if (type === 'Disruption') url = `${dynamicEndpoint}disruptions/${routeId}/${id}.json?auth=${secret}`;
            else if (type === 'Exception') url = `${dynamicEndpoint}exclusions/${routeId}/${id}.json?auth=${secret}`;
            else if (type === 'Grid Notice') url = `${dynamicEndpoint}exclusions/${routeId}/_grid_notice.json?auth=${secret}`;
            else if (type === 'Alert') {
                url = `${dynamicEndpoint}notices/${routeId}.json?auth=${secret}`;
            }

            if (!url) return;

            const fetchRes = await fetch(url);
            if (!fetchRes.ok) throw new Error("Fetch failed");
            const data = await fetchRes.json();
            
            if (type === 'Alert' && data && !data.id && data[id]) {
                url = `${dynamicEndpoint}notices/${routeId}/${id}.json?auth=${secret}`;
                const nestedData = data[id];
                if (nestedData.expiresAt) {
                    const newExpiry = nestedData.expiresAt + 86400000;
                    await fetch(url, { method: 'PATCH', body: JSON.stringify({ expiresAt: newExpiry }) });
                }
            } else if (data && data.expiresAt) {
                const newExpiry = data.expiresAt + 86400000;
                await fetch(url, { method: 'PATCH', body: JSON.stringify({ expiresAt: newExpiry }) });
            } else {
                if (typeof showToast === 'function') showToast("Item has no expiry to extend.", "warning");
                return;
            }

            if (typeof showToast === 'function') showToast("Extended by +24 Hours!", "success");
            Admin.fetchActionRequired(); 
        } catch (e) {
            if (typeof showToast === 'function') showToast("Failed to extend time.", "error");
        }
    },

    /** Sync a premium dropdown's visible label to match the hidden <select> value. */
    _syncAdminSelectDisplay: (selectId, routeId) => {
        const selectEl = document.getElementById(selectId);
        if (!selectEl) return;
        const opt = selectEl.querySelector(`option[value="${CSS.escape ? CSS.escape(routeId) : routeId}"]`)
            || Array.from(selectEl.options).find((o) => o.value === routeId);
        if (!opt) return;

        const displayId = selectId === 'alert-target' ? 'alert-target-display'
            : selectId === 'disr-route' ? 'disr-route-display'
            : selectId === 'excl-route' ? 'excl-route-display'
            : null;
        const listId = selectId === 'alert-target' ? 'alert-target-list'
            : selectId === 'disr-route' ? 'disr-route-list'
            : selectId === 'excl-route' ? 'excl-route-list'
            : null;
        const display = displayId ? document.getElementById(displayId) : null;
        const list = listId ? document.getElementById(listId) : null;
        if (!display) return;

        // Prefer the matching custom-list row HTML (badges / route arrows)
        if (list) {
            const matchLi = Array.from(list.querySelectorAll('li.cursor-pointer, li[class*="cursor-pointer"]'))
                .find((li) => typeof li.onclick === 'function' && (
                    (li.getAttribute('data-value') === routeId)
                    || (opt.textContent && li.textContent.includes(String(opt.textContent).split(' [')[0].trim()))
                ));
            if (matchLi) {
                display.innerHTML = matchLi.innerHTML;
                return;
            }
        }

        if (typeof ROUTES !== 'undefined' && ROUTES[routeId]) {
            const cues = typeof Admin.getRouteCues === 'function' ? Admin.getRouteCues(routeId) : '';
            let badgeHtml = '';
            if (cues?.includes('Notice')) badgeHtml += '<span class="ml-1.5 px-1 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 text-[8px] rounded uppercase flex-shrink-0">Note</span>';
            if (cues?.includes('Alert')) badgeHtml += '<span class="ml-1 px-1 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400 text-[8px] rounded uppercase flex-shrink-0">Alert</span>';
            display.innerHTML = `<span class="truncate mr-1 inline-flex items-center">${Admin.formatRouteLabelHtml(ROUTES[routeId].name)}</span>${badgeHtml}`;
        } else {
            display.textContent = opt.textContent || routeId;
        }
    },

    /** Apply GSM / Review route to admin selects without touching the live board. */
    applyPendingAdminRoute: (panelId) => {
        const routeId = Admin._pendingAdminRoute;
        if (!routeId) return;

        // Review always lands on New Alert (not leftover Schedule / Archive tab)
        if (panelId === 'alert-panel' && typeof Admin.setAlertManagerTab === 'function') {
            Admin.setAlertManagerTab('compose');
        }

        let selectId = '';
        if (panelId === 'alert-panel') selectId = 'alert-target';
        else if (panelId === 'disruption-panel') selectId = 'disr-route';
        else if (panelId === 'exclusion-panel') selectId = 'excl-route';
        if (!selectId) return;
        const selectEl = document.getElementById(selectId);
        if (!selectEl) return;
        const opt = selectEl.querySelector(`option[value="${CSS.escape ? CSS.escape(routeId) : routeId}"]`)
            || Array.from(selectEl.options).find((o) => o.value === routeId);
        if (!opt) return;

        const changed = selectEl.value !== routeId;
        if (changed) selectEl.value = routeId;
        Admin._syncAdminSelectDisplay(selectId, routeId);
        if (changed) selectEl.dispatchEvent(new Event('change'));

        if (selectId === 'excl-route') {
            const banner = document.getElementById('excl-review-banner');
            if (banner && typeof ROUTES !== 'undefined' && ROUTES[routeId]) {
                banner.classList.remove('hidden');
                banner.innerHTML = `<span class="font-black text-blue-700 dark:text-blue-300">Reviewing</span> <span class="inline-flex items-center">${Admin.formatRouteLabelHtml(ROUTES[routeId].name)}</span> <span class="text-slate-500 dark:text-slate-400 font-medium">- live board route unchanged</span>`;
            }
        }
    },

    deepLinkToPanel: (panelId, routeId) => {
        const targetPanel = document.getElementById(panelId);
        if (!targetPanel) return;

        const container = document.getElementById('admin-modules-container');
        if (!container) return;

        // Pin admin route selection (never mutate live-board currentRouteId)
        if (routeId) {
            Admin._pendingAdminRoute = routeId;
            Admin._adminRouteDeepLinkActive = true;
        }

        // If we are currently in Grid Mode, we can just click it naturally
        if (Admin.isGridMode) {
            targetPanel.click();
        } else {
            // We are already drilled down into another panel (Action Required)
            // Seamlessly swap the panels without triggering history.back() race conditions

            // Hide all children
            Array.from(container.children).forEach(child => {
                child.style.display = 'none'; 
            });

            // Show target panel and its body
            targetPanel.style.display = '';
            const body = targetPanel.querySelector('[id$="-body"]');
            if (body) body.classList.remove('hidden');
            const chev = targetPanel.querySelector('[id$="-chevron"]');
            if (chev) chev.classList.remove('-rotate-90');

            // GUARDIAN UX FIX: Hide redundant internal accordion header during full-screen drill-down
            const internalHeader = targetPanel.querySelector('[id$="-header-btn"]');
            if (internalHeader) internalHeader.style.setProperty('display', 'none', 'important');

            // Update Header Title
            const devHeaderRow = document.querySelector('#dev-modal .border-b.border-gray-200.pb-4.mb-6') || document.querySelector('#dev-modal .border-b.border-gray-200.pb-2.mb-3');
            if (devHeaderRow) {
                devHeaderRow.classList.remove('pb-4', 'mb-6');
                devHeaderRow.classList.add('pb-2', 'mb-3'); // GUARDIAN UX: Slim header padding

                const titleH3 = devHeaderRow.querySelector('h3');
                if (titleH3) {
                    let titleClone = targetPanel.querySelector('[id$="-header-btn"] > span').cloneNode(true);
                    titleClone.querySelectorAll('span[id$="-last-sync"], span[id$="-unread-badge"]').forEach(el => el.remove());
                    const cardTitle = (titleClone.textContent || '').replace(/\s+/g, ' ').trim();

                    titleH3.innerHTML = `
                        <button id="drill-back-btn" class="mr-3 p-1.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors focus:outline-none shadow-sm shrink-0">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                        </button>
                        <span class="truncate flex-grow text-lg min-w-0" style="font-family: 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif"></span>
                    `;
                    const titleSpan = titleH3.querySelector('span.truncate');
                    if (titleSpan) titleSpan.textContent = cardTitle;

                    // Rebind the drill-back button to the master logic
                    const newDrillBack = document.getElementById('drill-back-btn');
                    if (newDrillBack) {
                        newDrillBack.onclick = (evt) => {
                            evt.stopPropagation();
                            Admin.exitDrillToGrid();
                        };
                    }
                }
            }

            // Replace Router State safely
            history.replaceState({ adminPanel: targetPanel.id }, '', `#dev-${targetPanel.id}`);

            // Auto-Fetch data upon drill-down
            if (targetPanel.id === 'feedback-panel') Admin.fetchFeedback();
            if (targetPanel.id === 'delay-reports-panel') Admin.fetchDelayReports();
            if (targetPanel.id === 'moderation-queue-panel') Admin.fetchModerationQueue();
            if (targetPanel.id === 'user-trust-panel' && typeof Admin.fetchActiveBans === 'function') Admin.fetchActiveBans();
            if (targetPanel.id === 'deadends-panel') Admin.fetchDeadEnds();
            if (targetPanel.id === 'crashes-panel') Admin.fetchCrashes();
        }

        // Review → Service Alerts must open Compose (not sticky Schedule/Archive)
        if (panelId === 'alert-panel' && typeof Admin.setAlertManagerTab === 'function') {
            Admin.setAlertManagerTab('compose');
        }

        if (panelId === 'maint-panel') {
            setTimeout(() => {
                if (typeof Admin.openMaintenanceAccordion === 'function') Admin.openMaintenanceAccordion();
            }, 100);
        }

        if (routeId) {
            // Re-apply after panel mount + async populate*Routes (live board must not win)
            setTimeout(() => Admin.applyPendingAdminRoute(panelId), 80);
            setTimeout(() => Admin.applyPendingAdminRoute(panelId), 280);
            setTimeout(() => Admin.applyPendingAdminRoute(panelId), 700);
        }
    },

    resolveActionRequired: async (type, id, routeId) => {
        const confirmed = await Admin.secureConfirm("Resolve Item", `Are you sure you want to dismiss/resolve this ${type}?`);
        if (!confirmed) return;

        const secret = await Admin.getAuthKey();
        if (!secret) return;

        try {
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            
            if (type === 'Disruption') {
                await Admin.deleteDisruption(routeId, id, true);
            } else if (type === 'Exception') {
                await Admin.deleteExclusion(routeId, id, true);
            } else if (type === 'Grid Notice') {
                await fetch(`${dynamicEndpoint}exclusions/${routeId}/_grid_notice.json?auth=${secret}`, { method: 'DELETE' });
                if (typeof showToast === 'function') showToast("Grid Notice resolved & removed.", "success");
            } else if (type === 'Alert') {
                try {
                    const archived = await Admin.archiveActiveNotice(routeId, secret);
                    if (!archived) {
                        await fetch(`${dynamicEndpoint}notices/${routeId}.json?auth=${secret}`, { method: 'DELETE' });
                    }
                    try {
                        await fetch('https://nexttrain-telemetry.enock.workers.dev/admin/purge', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${secret}` }
                        });
                    } catch (pe) { console.warn("Purge failed", pe); }
                    if (typeof showToast === 'function') showToast("Alert cleared & archived.", "success");
                } catch (ae) {
                    if (typeof showToast === 'function') showToast("Failed to clear alert.", "error");
                }
            } else if (type === 'Maintenance') {
                const res = await fetch(`${dynamicEndpoint}config/maintenance.json?auth=${secret}`);
                const maintData = res.ok ? await res.json() : null;
                if (maintData && typeof maintData === 'object' && (!maintData.items || typeof maintData.items !== 'object')) {
                    // Flat legacy — turn off
                    await fetch(`${dynamicEndpoint}config/maintenance.json?auth=${secret}`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            active: false,
                            message: '',
                            updatedAt: Date.now(),
                            updatedBy: Admin.currentUser?.email || 'Admin',
                        }),
                    });
                } else {
                    await fetch(`${dynamicEndpoint}config/maintenance/items/${encodeURIComponent(id)}.json?auth=${secret}`, { method: 'DELETE' });
                    // Rebuild root shim so legacy clients don't keep a stale banner
                    try {
                        const res2 = await fetch(`${dynamicEndpoint}config/maintenance.json?auth=${secret}`);
                        const md = res2.ok ? await res2.json() : null;
                        if (md && typeof md === 'object') {
                            const items = md.items && typeof md.items === 'object' ? { ...md.items } : {};
                            delete items[id];
                            const nowTs = Date.now();
                            const live = Object.values(items).filter((it) => {
                                if (!it || it.active === false) return false;
                                if (it.expiresAt && Number(it.expiresAt) <= nowTs) return false;
                                return true;
                            });
                            live.sort((a, b) => {
                                const sa = (a.routes?.length ? 2 : a.regions?.length ? 1 : 0);
                                const sb = (b.routes?.length ? 2 : b.regions?.length ? 1 : 0);
                                return sb - sa;
                            });
                            const primary = live[0];
                            const payload = {
                                active: !!(md.active !== false && primary),
                                items,
                                message: primary ? (primary.message || 'MAINTENANCE IN PROGRESS') : '',
                                updatedAt: nowTs,
                                updatedBy: Admin.currentUser?.email || 'Admin',
                            };
                            if (primary?.regions?.length) payload.regions = primary.regions;
                            else payload.regions = null;
                            if (primary?.routes?.length) payload.routes = primary.routes;
                            else payload.routes = null;
                            if (primary?.expiresAt) payload.expiresAt = primary.expiresAt;
                            else payload.expiresAt = null;
                            await fetch(`${dynamicEndpoint}config/maintenance.json?auth=${secret}`, {
                                method: 'PUT',
                                body: JSON.stringify(payload),
                            });
                        }
                    } catch (re) { /* best-effort shim */ }
                }
                if (typeof showToast === 'function') showToast('Maintenance banner resolved.', 'success');
            }
            Admin.fetchActionRequired();
        } catch(e) {
            if (typeof showToast === 'function') showToast("Failed to resolve item.", "error");
        }
    },

    // --- GROWTH SPRINT PHASE 7: CRASH REPORTS DASHBOARD ---
    setupCrashReportsManager: () => {
        const adminContainer = document.getElementById('admin-modules-container');
        if (!adminContainer) return;

        let crashPanel = document.getElementById('crashes-panel');
        if (!crashPanel) {
            crashPanel = document.createElement('div');
            crashPanel.id = 'crashes-panel';
            adminContainer.appendChild(crashPanel); 
        }

        if (crashPanel.dataset.adminLoaded === "true") return;
        crashPanel.dataset.adminLoaded = "true";
        
        Admin.cachedCrashData = [];
        Admin.currentCrashTab = 'inbox';

        crashPanel.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300";

        crashPanel.innerHTML = `
                <button id="crash-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                    <span class="flex flex-col items-center">
                        ${Admin.tileIcon('flame', 'text-orange-500 dark:text-orange-400')}
                        <span>Crash Analytics</span>
                    </span>
                    <span id="crash-unread-badge" class="admin-unread-badge hidden" aria-label="Unread crashes"></span>
                    <svg id="crash-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                <div id="crash-body" class="hidden mt-3 space-y-2">
                    <div class="flex border-b border-gray-200 dark:border-gray-700 mb-2">
                        <button id="crash-tab-inbox" class="flex-1 py-2 text-[10px] uppercase font-black border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 transition-colors focus:outline-none tracking-wider">Inbox (<span id="crash-inbox-count">0</span>)</button>
                        <button id="crash-tab-distress" class="flex-1 py-2 text-[10px] uppercase font-black border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition-colors focus:outline-none tracking-wider">Distress (<span id="crash-distress-count">0</span>)</button>
                        <button id="crash-tab-archive" class="flex-1 py-2 text-[10px] uppercase font-black border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition-colors focus:outline-none tracking-wider">Archive</button>
                    </div>
                    <div class="flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-2 rounded-lg border border-gray-100 dark:border-gray-700 shadow-inner gap-2">
                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider pl-1 shrink-0" id="crash-status-display">Syncing...</span>
                        <div class="flex flex-wrap gap-2 justify-end">
                            <button id="crash-refresh-btn" class="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 rounded px-2 py-1 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">Refresh</button>
                            <button id="crash-export-btn" class="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 rounded px-2 py-1 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">Export</button>
                            <button id="crash-purge-bb-btn" title="Delete Black Box dumps only (keeps real crashes)" class="bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 hover:bg-amber-200 rounded px-2 py-1 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">Purge BB</button>
                            <button id="crash-clear-btn" class="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 rounded px-2 py-1 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">Clear DB</button>
                        </div>
                    </div>
                    <div id="crash-list" class="space-y-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar"></div>
                </div>
            `;
        
        const header = document.getElementById('crash-header-btn');
        const body = document.getElementById('crash-body');
        const chevron = document.getElementById('crash-chevron');
        const refreshBtn = document.getElementById('crash-refresh-btn');
        const exportBtn = document.getElementById('crash-export-btn');
        const purgeBbBtn = document.getElementById('crash-purge-bb-btn');
        const clearBtn = document.getElementById('crash-clear-btn');
        const listDiv = document.getElementById('crash-list');
        const tabInbox = document.getElementById('crash-tab-inbox');
        const tabDistress = document.getElementById('crash-tab-distress');
        const tabArchive = document.getElementById('crash-tab-archive');
        const isDistressCrash = (c) => c?.kind === 'distress' || String(c?.error || '').startsWith('DISTRESS:');

        header.onclick = () => {
            if (Admin.isGridMode) return;
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
                Admin.fetchCrashes();
            }
        };

        refreshBtn.onclick = () => Admin.fetchCrashes();

        Admin.exportCrashesTxt = () => {
            const tab = Admin.currentCrashTab || 'inbox';
            const rows = (Admin.cachedCrashData || []).filter((c) => {
                if (tab === 'distress') return isDistressCrash(c);
                if (tab === 'inbox') return c.status !== 'resolved' && !isDistressCrash(c);
                return c.status === 'resolved';
            });
            if (!rows.length) {
                if (typeof showToast === 'function') showToast('No crashes to export', 'info');
                return;
            }
            const tabLabel = tab === 'distress' ? 'Distress' : (tab === 'inbox' ? 'Inbox' : 'Archive');
            let txt = `NEXT TRAIN - CRASH ANALYTICS\nTab: ${tabLabel}\nExported: ${Admin.formatDate(Date.now())}\nRows: ${rows.length}\n${'='.repeat(48)}\n\n`;
            rows.forEach((c, i) => {
                txt += `#${i + 1}  ${Admin.formatDate(c.timestamp)}\n`;
                txt += `  ID: ${c.id || '-'}\n`;
                txt += `  Device: ${c.deviceId || c.device_id || '-'}\n`;
                txt += `  Route: ${c.routeId || 'Global'} - Region: ${c.region || '-'} - Version: ${c.appVersion || '-'}\n`;
                txt += `  Status: ${c.status || 'open'}\n`;
                if (c.contact) txt += `  Contact: ${c.contact}\n`;
                if (c.reason) txt += `  Reason: ${c.reason}\n`;
                if (c.note) txt += `  Note: ${c.note}\n`;
                const msg = String(c.message || c.error || c.stack || '').replace(/\r/g, '');
                if (msg) txt += `  Message:\n${msg.split('\n').map((l) => `    ${l}`).join('\n')}\n`;
                txt += `\n`;
            });
            const dateStr = new Date().toISOString().slice(0, 10);
            const ok = Admin.downloadFile(`crashes_${tab}_${dateStr}.txt`, txt);
            if (ok && typeof showToast === 'function') showToast(`Downloaded ${rows.length} item(s)`, 'success');
        };
        if (exportBtn) exportBtn.onclick = () => Admin.exportCrashesTxt();

        const styleCrashTab = (el, on) => {
            if (!el) return;
            if (on) {
                el.classList.add('border-blue-500', 'text-blue-600', 'dark:text-blue-400');
                el.classList.remove('border-transparent', 'text-gray-400');
            } else {
                el.classList.add('border-transparent', 'text-gray-400');
                el.classList.remove('border-blue-500', 'text-blue-600', 'dark:text-blue-400');
            }
        };

        const switchTab = (tab) => {
            Admin.currentCrashTab = tab;
            styleCrashTab(tabInbox, tab === 'inbox');
            styleCrashTab(tabDistress, tab === 'distress');
            styleCrashTab(tabArchive, tab === 'archive');
            Admin.renderCrashList();
        };

        tabInbox.onclick = () => switchTab('inbox');
        tabDistress?.addEventListener('click', () => switchTab('distress'));
        tabArchive.onclick = () => switchTab('archive');

        // GUARDIAN UX: Native Swipe Navigation for Crash Tabs
        let crashTouchStartX = 0;
        let crashTouchStartY = 0;
        const crashTabOrder = ['inbox', 'distress', 'archive'];
        if (body) {
            body.addEventListener('touchstart', (e) => {
                crashTouchStartX = e.changedTouches[0].screenX;
                crashTouchStartY = e.changedTouches[0].screenY;
            }, {passive: true});
            body.addEventListener('touchend', (e) => {
                const diffX = e.changedTouches[0].screenX - crashTouchStartX;
                const diffY = e.changedTouches[0].screenY - crashTouchStartY;
                if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                    const idx = crashTabOrder.indexOf(Admin.currentCrashTab || 'inbox');
                    if (diffX > 0 && idx > 0) switchTab(crashTabOrder[idx - 1]);
                    else if (diffX < 0 && idx < crashTabOrder.length - 1) switchTab(crashTabOrder[idx + 1]);
                }
            }, {passive: true});
        }

        Admin.renderCrashList = () => {
            try {
            listDiv.innerHTML = '';
            const tab = Admin.currentCrashTab || 'inbox';
            // Inbox + Distress use active actions; Archive uses delete/copy only
            const isInbox = tab !== 'archive';
            const all = Array.isArray(Admin.cachedCrashData) ? Admin.cachedCrashData : [];
            const targetData = all.filter((c) => {
                if (tab === 'distress') return isDistressCrash(c);
                if (tab === 'inbox') return c.status !== 'resolved' && !isDistressCrash(c);
                return c.status === 'resolved';
            });
            const distressN = all.filter(isDistressCrash).length;
            const distressCountEl = document.getElementById('crash-distress-count');
            if (distressCountEl) distressCountEl.textContent = String(distressN);
            const statusEl = document.getElementById('crash-status-display');
            if (statusEl) {
                statusEl.textContent =
                    tab === 'distress' ? `Distress / Help: ${targetData.length}`
                    : (tab === 'inbox' ? `Active Crashes: ${targetData.length}` : `Archived Crashes: ${targetData.length}`);
            }
            
            if (targetData.length === 0) {
                listDiv.innerHTML = `<div class="text-xs text-gray-500 italic text-center py-6">${tab === 'distress' ? 'No distress / help reports.' : (tab === 'inbox' ? 'No new crashes.' : 'Archive empty.')}</div>`;
                return;
            }

            // GUARDIAN PHASE 1: Sanitization Armor (XSS Protection)
            const secureEscape = (str) => {
                if (!str) return '';
                if (typeof escapeHTML === 'function') return escapeHTML(str);
                return String(str).replace(/[&<>"']/g, function(m) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
                });
            };

            // Group by deviceId
            const groups = {};
            targetData.forEach(crash => {
                const did = crash.deviceId || crash.device_id || 'Anonymous / Legacy';
                if (!groups[did]) groups[did] = [];
                groups[did].push(crash);
            });

            Object.keys(groups).forEach(rawDid => {
                const groupCrashes = groups[rawDid];
                const groupCard = document.createElement('div');
                groupCard.className = "bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden mb-3";
                
                const latestDate = Admin.formatDate(groupCrashes[0].timestamp);
                
                // Fortify Device IDs before DOM / onclick injection
                const did = secureEscape(rawDid);
                const safeJsDid = rawDid.replace(/'/g, "\\'");
                
                // GUARDIAN PHASE 1: Bulk Resolve Button & HTML Fix (button inside button is invalid, changed outer to div)
                const resolveAllHtml = isInbox 
                    ? `<button onclick="event.stopPropagation(); Admin.resolveAllDeviceCrashes('${safeJsDid}')" class="mr-3 bg-green-100 dark:bg-green-900/50 hover:bg-green-200 dark:hover:bg-green-800 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700 px-2 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-colors shadow-sm focus:outline-none flex items-center shrink-0"><span class="mr-1 inline-flex">${Admin.icon('check', 'w-3 h-3')}</span> Resolve All (${groupCrashes.length})</button>` 
                    : '';

                let groupHTML = `
                    <div class="w-full flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer border-b border-transparent" onclick="this.nextElementSibling.classList.toggle('hidden'); this.classList.toggle('border-gray-200'); this.classList.toggle('dark:border-gray-700'); this.querySelector('.chevron-icon').classList.toggle('rotate-180')">
                        <div class="flex flex-col items-start min-w-0 pr-2">
                            <span class="text-xs font-bold text-gray-900 dark:text-white truncate w-full">Device: <span class="text-blue-600">${did.substring(0,15)}${did.length>15?'...':''}</span></span>
                            <span class="text-[9px] text-gray-500 font-mono mt-0.5 truncate w-full">${groupCrashes.length} Crash${groupCrashes.length > 1 ? 'es' : ''} | Last: ${latestDate}</span>
                        </div>
                        <div class="flex items-center shrink-0">
                            ${resolveAllHtml}
                            <svg class="chevron-icon w-4 h-4 text-gray-400 transform transition-transform shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                    </div>
                    <div class="hidden divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
                `;
                
                groupCrashes.forEach(crash => {
                  try {
                    const dateStr = Admin.formatDate(crash.timestamp);
                    const safeErr = secureEscape(crash.error);
                    const safeRoute = secureEscape(crash.routeId || "Global");
                    const safeOS = secureEscape(crash.userAgent || "Unknown OS");
                    const safeAppVersion = secureEscape(String(crash.appVersion || 'Unknown'));
                    const safeJsCrashId = String(crash.id || '').replace(/'/g, "\\'");
                    const safeLine = secureEscape(crash.line == null ? '' : String(crash.line));
                    const safeUrl = secureEscape(crash.url || '');

                    const isBlackBox = typeof Admin.isBlackBoxCrash === 'function'
                        ? Admin.isBlackBoxCrash(crash)
                        : (crash.kind === 'blackbox_full' || crash.kind === 'blackbox_export' || String(crash.error || '').startsWith('BLACK_BOX_EXPORT'));
                    const isDistress = crash.kind === 'distress' || String(crash.error || '').startsWith('DISTRESS:');

                    // Black box: show compact preview only (full dump lives in blob / lazy fetch)
                    let rawDetail = '';
                    if (isBlackBox) {
                        rawDetail = (typeof Admin.blackBoxPreviewFromCrash === 'function')
                            ? Admin.blackBoxPreviewFromCrash(crash)
                            : String(crash.preview || crash.error || '');
                        if (crash.blobPath) {
                            rawDetail += `\n\n[Full log at ${crash.blobPath} - use Copy Log]`;
                        } else if (crash.kind === 'blackbox_full') {
                            rawDetail += '\n\n[Legacy full dump - Copy Log re-fetches this node]';
                        }
                    } else if (crash.stack && crash.stack !== 'N/A') {
                        rawDetail = String(crash.stack);
                    } else if (crash.raw) {
                        rawDetail = typeof crash.raw === 'string' ? crash.raw : JSON.stringify(crash.raw, null, 2);
                    } else if (crash.logs) {
                        rawDetail = JSON.stringify(crash.logs, null, 2);
                    } else {
                        try {
                            const clone = { ...crash };
                            delete clone.id;
                            rawDetail = JSON.stringify(clone, null, 2);
                        } catch (_) {
                            rawDetail = String(crash.error || '');
                        }
                    }
                    if (!isBlackBox && rawDetail && (rawDetail.trim().startsWith('[') || rawDetail.trim().startsWith('{'))) {
                        try { rawDetail = JSON.stringify(JSON.parse(rawDetail), null, 2); } catch (_) {}
                    }
                    // Hard cap DOM size so one fat entry cannot blank the whole panel
                    const DISPLAY_CAP = isBlackBox ? 4000 : 2500;
                    const displayRaw = rawDetail.length > DISPLAY_CAP
                        ? (rawDetail.slice(0, DISPLAY_CAP) + '\n... [truncated - Copy Log for full]')
                        : rawDetail;
                    const safeRaw = secureEscape(displayRaw);

                    const lineHint = crash.summary?.lineCount
                        || (Array.isArray(crash.logs) ? crash.logs.length : null)
                        || 'export';
                    const ticketDesc = isBlackBox
                        ? String(crash.preview || rawDetail || crash.error || '').slice(0, 900)
                        : String(crash.error || '').slice(0, 240);
                    const escalateAttr = Admin.encodeEscalatePayload({
                        type: isDistress ? 'general' : 'bug',
                        severity: isBlackBox ? 'medium' : (isDistress ? 'medium' : 'high'),
                        title: isDistress
                            ? `Distress - ${crash.contact || crash.deviceId || 'user'} - ${crash.reason || 'help'}`
                            : isBlackBox
                            ? `Black Box (${lineHint} lines) - ${crash.deviceId || crash.routeId || 'device'}`
                            : `Crash on ${crash.routeId || 'Global'}`,
                        description: ticketDesc,
                        source: crash.blobPath
                            ? `Crash ${crash.id || ''} · blob ${crash.blobPath}`
                            : `Crash ${crash.id || ''}`
                    });
                    // Preview only in memory — Copy Log lazy-loads full text
                    if (!Admin._crashRawById) Admin._crashRawById = {};
                    if (!isBlackBox) Admin._crashRawById[crash.id] = String(rawDetail || '').slice(0, 20000);

                    const actionHtml = isInbox 
                        ? `<div class="flex flex-wrap gap-2 w-full mt-2">
                             <button class="flex-1 min-w-[4.5rem] text-slate-700 dark:text-slate-200 hover:text-white hover:bg-slate-700 text-[10px] font-bold bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded transition-colors focus:outline-none uppercase tracking-wide shadow-sm" onclick="Admin.copyCrashLog('${safeJsCrashId}')">Copy Log</button>
                             ${rawDid !== 'Anonymous / Legacy' ? `<button class="flex-1 min-w-[4.5rem] text-blue-600 dark:text-blue-400 hover:text-white hover:bg-blue-600 text-[10px] font-bold bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-2.5 py-1.5 rounded transition-colors focus:outline-none uppercase tracking-wide shadow-sm" onclick="Admin.openReplyModal('${safeJsCrashId}', '${safeJsDid}')">Reply</button>` : ''}
                             <button class="flex-1 min-w-[4.5rem] text-orange-600 dark:text-orange-400 hover:text-white hover:bg-orange-600 text-[10px] font-bold bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 px-2.5 py-1.5 rounded transition-colors focus:outline-none uppercase tracking-wide shadow-sm" onclick="Admin.escalateFromEl(this)" data-escalate="${escalateAttr}">Escalate</button>
                             <button class="flex-1 min-w-[4.5rem] text-green-600 dark:text-green-400 hover:text-white hover:bg-green-600 text-[10px] font-bold bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-2.5 py-1.5 rounded transition-colors focus:outline-none uppercase tracking-wide shadow-sm" onclick="Admin.resolveCrash('${safeJsCrashId}')">Resolve</button>
                           </div>`
                        : `<div class="flex justify-between items-center w-full mt-2 gap-2">
                             <span class="text-[9px] font-bold text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded uppercase tracking-wider">Archived</span>
                             <button class="text-slate-600 hover:text-white hover:bg-slate-700 text-[10px] font-bold px-2.5 py-1 rounded transition-colors focus:outline-none uppercase tracking-wide border border-slate-200 shadow-sm" onclick="Admin.copyCrashLog('${safeJsCrashId}')">Copy Log</button>
                             <button class="text-red-600 hover:text-white hover:bg-red-600 text-[10px] font-bold px-2.5 py-1 rounded transition-colors focus:outline-none uppercase tracking-wide border border-red-200 shadow-sm" onclick="Admin.deleteCrash('${safeJsCrashId}')">Delete</button>
                           </div>`;

                    const kindLabel = isDistress ? 'DISTRESS / HELP' : (isBlackBox ? 'BLACK BOX LOG' : 'FATAL DUMP');
                    const kindBadgeClass = isDistress
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
                    const safeContact = secureEscape(crash.contact || '');
                    const safeReason = secureEscape(crash.reason || '');
                    const safeNote = secureEscape(crash.note || '');
                    let distressBlock = '';
                    if (isDistress && (safeContact || safeNote || safeReason)) {
                        const rawContact = String(crash.contact || '').trim();
                        const contactHref = rawContact.includes('@')
                            ? ('mailto:' + rawContact)
                            : ('https://wa.me/' + rawContact.replace(/\D/g, ''));
                        const safeContactHref = secureEscape(contactHref);
                        distressBlock =
                            '<div class="text-[11px] text-gray-900 dark:text-gray-100 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-2 mb-2 leading-snug">' +
                            (safeContact
                                ? '<div class="font-bold">Contact: <a class="text-blue-600 dark:text-blue-400 underline break-all" href="' +
                                  safeContactHref +
                                  '" target="_blank" rel="noopener">' +
                                  safeContact +
                                  '</a></div>'
                                : '') +
                            (safeReason
                                ? '<div class="text-[10px] text-amber-800 dark:text-amber-300 mt-0.5 uppercase tracking-wide font-bold">' +
                                  safeReason +
                                  '</div>'
                                : '') +
                            (safeNote
                                ? '<div class="mt-1 text-[10px] text-gray-700 dark:text-gray-300">' +
                                  safeNote +
                                  '</div>'
                                : '') +
                            '</div>';
                    }

                    const appLabel = String(safeAppVersion || '').split(' - ')[0];
                    groupHTML += `
                        <div class="p-2.5 flex flex-col">
                            <div class="flex justify-between items-start mb-1.5">
                                <span class="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${kindBadgeClass}">${kindLabel}</span>
                                <span class="text-[9px] text-gray-400 font-mono">${dateStr}</span>
                            </div>
                            ${distressBlock}
                            <div class="text-[10px] font-mono text-gray-800 dark:text-gray-200 break-words bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-100 dark:border-gray-700 leading-snug mb-2">
                                ${safeErr}
                            </div>
                            <details class="mb-2 group/raw">
                                <summary class="cursor-pointer text-[9px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-1 select-none">${isBlackBox ? 'Black box summary' : 'Raw crash details'}</summary>
                                <pre class="text-[9px] font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words bg-black/5 dark:bg-black/40 p-2 rounded border border-gray-200 dark:border-gray-700 max-h-64 overflow-y-auto custom-scrollbar leading-snug">${safeRaw}</pre>
                            </details>
                            <div class="flex flex-col space-y-1 bg-gray-50 dark:bg-gray-800/50 p-2 rounded border border-gray-100 dark:border-gray-700">
                                <span class="text-[9px] text-gray-600 dark:text-gray-400 font-bold uppercase tracking-wider">Route: <span class="text-blue-500">${safeRoute}</span></span>
                                <span class="text-[9px] text-gray-600 dark:text-gray-400 font-bold uppercase tracking-wider">App: <span class="text-gray-800 dark:text-gray-200">${appLabel}</span></span>
                                ${safeLine ? `<span class="text-[9px] text-gray-600 dark:text-gray-400 font-bold uppercase tracking-wider">Line: <span class="text-gray-800 dark:text-gray-200">${safeLine}</span></span>` : ''}
                                ${safeUrl ? `<span class="text-[9px] text-gray-600 dark:text-gray-400 font-bold uppercase tracking-wider leading-tight">URL: <span class="text-gray-800 dark:text-gray-200 whitespace-normal break-words">${safeUrl}</span></span>` : ''}
                                <span class="text-[9px] text-gray-600 dark:text-gray-400 font-bold uppercase tracking-wider leading-tight">OS: <span class="text-gray-800 dark:text-gray-200 whitespace-normal break-words">${safeOS}</span></span>
                            </div>
                            ${actionHtml}
                        </div>
                    `;
                  } catch (rowErr) {
                    console.error('Crash row render failed', crash?.id, rowErr);
                    groupHTML += `<div class="p-2.5 text-[10px] text-red-500">Failed to render crash ${secureEscape(crash?.id || '?')}</div>`;
                  }
                });
                groupHTML += `</div>`;
                groupCard.innerHTML = groupHTML;
                listDiv.appendChild(groupCard);
            });
            } catch (renderErr) {
                console.error('renderCrashList failed', renderErr);
                listDiv.innerHTML = `<div class="text-xs text-red-500 text-center py-4">Failed to render crash list.<br><span class="text-[9px] text-gray-500 font-mono">${String(renderErr?.message || renderErr).replace(/</g, '&lt;').slice(0, 180)}</span></div>`;
            }
        };

        Admin.fetchCrashes = async () => {
            const secret = await Admin.getAuthKey();
            if (!secret) return;
            
            // GUARDIAN PHASE 11 & 12: Mark as seen instantly in Firebase (Cross-Device Sync) AND Local Storage
            try { 
                safeStorage.setItem('crash_last_checked', Date.now().toString()); 
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                fetch(`${dynamicEndpoint}admin_state/${Admin.currentUser.uid}/crash_last_checked.json?auth=${secret}`, { method: 'PUT', body: JSON.stringify(Date.now()) });
            } catch(e){}
            const badge = document.getElementById('crash-unread-badge');
            if (badge) badge.classList.add('hidden');

            listDiv.innerHTML = '<div class="text-xs text-gray-500 italic text-center py-4">Fetching crash logs...</div>';
            
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                // Longer timeout: legacy blackbox_full triples can make crashes.json slow
                const res = await window.guardianFetch(`${dynamicEndpoint}sys_logs/crashes.json?auth=${secret}`, {}, 30000);
                
                if (!res.ok) throw new Error("Fetch HTTP Error: " + res.status);
                const data = await res.json();

                // Slim WHILE mapping so fat stack/raw/logs never linger on Admin.cachedCrashData
                Admin.cachedCrashData = (data && typeof data === 'object')
                    ? Object.keys(data).map((key) => {
                        const entry = { id: key, ...(data[key] || {}) };
                        const isBb = typeof Admin.isBlackBoxCrash === 'function'
                            ? Admin.isBlackBoxCrash(entry)
                            : (entry.kind === 'blackbox_full' || entry.kind === 'blackbox_export'
                                || String(entry.error || '').startsWith('BLACK_BOX'));
                        if (isBb) {
                            if (!entry.preview && typeof Admin.blackBoxPreviewFromCrash === 'function') {
                                entry.preview = Admin.blackBoxPreviewFromCrash(entry);
                            }
                            delete entry.stack;
                            delete entry.raw;
                            delete entry.logs;
                        } else {
                            if (typeof entry.stack === 'string' && entry.stack.length > 4000) {
                                entry.stack = entry.stack.slice(0, 4000) + '\n...[truncated]';
                            }
                            if (typeof entry.raw === 'string' && entry.raw.length > 4000) {
                                entry.raw = entry.raw.slice(0, 4000) + '\n...[truncated]';
                            }
                        }
                        return entry;
                    })
                    : [];
                Admin.cachedCrashData.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                
                const activeCount = Admin.cachedCrashData.filter(c => c.status !== 'resolved').length;
                const crInboxCountSpan = document.getElementById('crash-inbox-count');
                if (crInboxCountSpan) crInboxCountSpan.textContent = activeCount;

                Admin.renderCrashList();
            } catch(e) {
                console.error("Crash logs fetch error:", e);
                const msg = String(e?.message || e || 'unknown').replace(/</g, '&lt;').slice(0, 200);
                listDiv.innerHTML = `<div class="text-xs text-red-500 text-center py-4">Failed to load crash logs.<br><span class="text-[9px] text-gray-500 font-mono">${msg}</span><br><span class="text-[9px] text-amber-600 dark:text-amber-400">Tip: tap <b>Purge BB</b> to remove heavy Black Box dumps, then Refresh.</span></div>`;
            }
        };

        Admin.purgeBlackBoxCrashes = async () => {
            const confirmed = await Admin.secureConfirm(
                'Purge Black Box dumps',
                "Delete all BLACK_BOX / blackbox_* crash entries (and companion blobs)? Real JS crashes stay."
            );
            if (!confirmed) return;
            const secret = await Admin.getAuthKey();
            if (!secret) return;
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            try {
                // Ensure we have ids (even if list render failed)
                if (!Array.isArray(Admin.cachedCrashData) || !Admin.cachedCrashData.length) {
                    const res = await window.guardianFetch(`${dynamicEndpoint}sys_logs/crashes.json?shallow=true&auth=${secret}`, {}, 15000);
                    if (!res.ok) throw new Error('shallow ' + res.status);
                    const keys = await res.json();
                    Admin.cachedCrashData = keys && typeof keys === 'object'
                        ? Object.keys(keys).map((id) => ({ id, error: id.startsWith('bb_') ? 'BLACK_BOX_EXPORT' : '', kind: id.startsWith('bb_') ? 'blackbox_full' : '' }))
                        : [];
                }
                const targets = Admin.cachedCrashData.filter((c) =>
                    (typeof Admin.isBlackBoxCrash === 'function' && Admin.isBlackBoxCrash(c))
                    || String(c.id || '').startsWith('bb_')
                );
                if (!targets.length) {
                    if (typeof showToast === 'function') showToast('No Black Box entries found', 'info');
                    return;
                }
                if (typeof showToast === 'function') showToast(`Purging ${targets.length} Black Box dump(s)…`, 'info');
                await Promise.all(targets.map(async (c) => {
                    await fetch(`${dynamicEndpoint}sys_logs/crashes/${c.id}.json?auth=${secret}`, { method: 'DELETE' });
                    const blobPath = c.blobPath || `sys_logs/blackbox/${c.id}`;
                    try {
                        await fetch(`${dynamicEndpoint}${blobPath}.json?auth=${secret}`, { method: 'DELETE' });
                    } catch (_) { /* ignore */ }
                }));
                if (typeof showToast === 'function') showToast(`Purged ${targets.length} Black Box dump(s)`, 'success');
                Admin.fetchCrashes();
            } catch (e) {
                console.error(e);
                if (typeof showToast === 'function') showToast('Purge failed: ' + (e.message || e), 'error');
            }
        };

        Admin.resolveCrash = async (id) => {
            const secret = await Admin.getAuthKey();
            if (!secret) return;
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                await fetch(`${dynamicEndpoint}sys_logs/crashes/${id}.json?auth=${secret}`, {
                    method: 'PATCH', body: JSON.stringify({ status: 'resolved', resolvedAt: Date.now() })
                });
                if (typeof showToast === 'function') showToast("Crash archived!", "success");
                Admin.fetchCrashes();
            } catch (e) {
                if (typeof showToast === 'function') showToast("Error resolving crash.", "error");
            }
        };

        // GUARDIAN PHASE 1: Bulk Resolve Engine
        Admin.resolveAllDeviceCrashes = async (deviceId) => {
            const confirmed = await Admin.secureConfirm("Resolve All Crashes", `Mark all active crashes for device ${deviceId.substring(0,10)}... as resolved?`);
            if (!confirmed) return;

            const secret = await Admin.getAuthKey();
            if (!secret) return;

            try {
                const targetCrashes = Admin.cachedCrashData.filter(c => 
                    c.status !== 'resolved' && 
                    (c.deviceId === deviceId || c.device_id === deviceId || (deviceId === 'Anonymous / Legacy' && !c.deviceId && !c.device_id))
                );
                
                if (targetCrashes.length === 0) return;

                if (typeof showToast === 'function') showToast(`Resolving ${targetCrashes.length} crashes...`, "info");

                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const payload = { status: 'resolved', resolvedAt: Date.now() };

                // Execute all PATCH requests concurrently
                const promises = targetCrashes.map(crash => 
                    fetch(`${dynamicEndpoint}sys_logs/crashes/${crash.id}.json?auth=${secret}`, {
                        method: 'PATCH', body: JSON.stringify(payload)
                    })
                );

                await Promise.all(promises);

                if (typeof showToast === 'function') showToast("All device crashes archived!", "success");
                Admin.fetchCrashes();
            } catch (e) {
                if (typeof showToast === 'function') showToast("Error resolving crashes.", "error");
            }
        };

        Admin.deleteCrash = async (id) => {
            const confirmed = await Admin.secureConfirm("Delete Crash", "Permanently delete this crash log?");
            if (!confirmed) return;
            const secret = await Admin.getAuthKey();
            if (!secret) return;
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const crash = (Admin.cachedCrashData || []).find((c) => c.id === id);
                await fetch(`${dynamicEndpoint}sys_logs/crashes/${id}.json?auth=${secret}`, { method: 'DELETE' });
                // Also remove companion black-box blob when present
                if (crash?.blobPath) {
                    try {
                        await fetch(`${dynamicEndpoint}${crash.blobPath}.json?auth=${secret}`, { method: 'DELETE' });
                    } catch (_) { /* ignore blob cleanup failures */ }
                } else if (typeof Admin.isBlackBoxCrash === 'function' && Admin.isBlackBoxCrash(crash)) {
                    try {
                        await fetch(`${dynamicEndpoint}sys_logs/blackbox/${id}.json?auth=${secret}`, { method: 'DELETE' });
                    } catch (_) { /* ignore */ }
                }
                if (Admin._crashRawById) delete Admin._crashRawById[id];
                if (typeof showToast === 'function') showToast("Crash deleted.", "success");
                Admin.fetchCrashes();
            } catch (e) {
                if (typeof showToast === 'function') showToast("Error deleting crash.", "error");
            }
        };

        Admin.clearCrashes = async () => {
            const confirmed = await Admin.secureConfirm("Clear Crash DB", "Type 'CLEAR' to permanently delete all crash reports from the server:", "CLEAR");
            if (!confirmed) return;
            
            const secret = await Admin.getAuthKey();
            if (!secret) return;
            
            clearBtn.disabled = true;
            clearBtn.textContent = "Clearing...";

            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                await window.guardianFetch(`${dynamicEndpoint}sys_logs/crashes.json?auth=${secret}`, { method: 'DELETE' }, 10000);
                try {
                    await window.guardianFetch(`${dynamicEndpoint}sys_logs/blackbox.json?auth=${secret}`, { method: 'DELETE' }, 10000);
                } catch (_) { /* older DBs may lack blackbox node */ }
                Admin._crashRawById = {};
                if (typeof showToast === 'function') showToast("Crash logs wiped clean.", "success");
                Admin.fetchCrashes();
            } catch (e) {
                if (typeof showToast === 'function') showToast("Failed to clear logs", "error");
            } finally {
                clearBtn.disabled = false;
                clearBtn.textContent = "Clear DB";
            }
        };
        
        clearBtn.onclick = () => Admin.clearCrashes();
        if (purgeBbBtn) purgeBbBtn.onclick = () => Admin.purgeBlackBoxCrashes();
    },

    // --- 2.8 GROWTH SPRINT PHASE 5: THE DRILL-DOWN DASHBOARD ENGINE ---
    initGridView: () => {
        const container = document.getElementById('admin-modules-container');
        if (!container) return;

        // Ensure Telemetry is neatly packed inside the wrapper so it grids perfectly
        const telPanel = document.getElementById('telemetry-panel');
        if (telPanel && telPanel.parentNode !== container) {
            container.insertBefore(telPanel, container.firstElementChild);
        }

        // Re-open path: grid toggle already exists — still re-engage so tiles stay tappable.
        Admin.ensureGridViewEngaged();

        const devHeaderRow = document.querySelector('#dev-modal .border-b.border-gray-200.pb-4.mb-6');
        if (devHeaderRow && !document.getElementById('grid-view-toggle')) {
            
            // Inject Grid Toggle Button
            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'grid-view-toggle';
            toggleBtn.type = 'button';
            toggleBtn.className = "ml-auto mr-3 p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-blue-500 transition-colors focus:outline-none shadow-sm flex items-center";
            Admin.syncGridToggleIcon(toggleBtn);
            
            const closeBtn = devHeaderRow.querySelector('button[aria-label="Close Dev Modal"]');
            if (closeBtn) {
                devHeaderRow.insertBefore(toggleBtn, closeBtn);
            } else {
                devHeaderRow.appendChild(toggleBtn);
            }

            // Inject Custom Layout CSS
            let gridStyleEl = document.getElementById('admin-grid-styles');
            if (!gridStyleEl) {
                gridStyleEl = document.createElement('style');
                gridStyleEl.id = 'admin-grid-styles';
                gridStyleEl.innerHTML = `
                    .admin-grid-view { display: grid; gap: 12px; align-items: start; padding-bottom: 20px; transition: grid-template-columns 0.3s ease; }
                    /* Hide empty HubModals shells — .hidden loses to this rule's display:flex otherwise */
                    .admin-grid-view > div.hidden,
                    .admin-grid-view > div:empty,
                    .admin-grid-view > div[data-admin-shell="empty"] { display: none !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; overflow: hidden !important; pointer-events: none !important; }
                    .admin-grid-view > div:not(.hidden):not(:empty):not([data-admin-shell="empty"]) { margin-bottom: 0 !important; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; height: 110px; display: flex; flex-direction: column; justify-content: center; position: relative; overflow: visible !important; }
                    .admin-grid-view > div:not(.hidden):not(:empty):not([data-admin-shell="empty"]):hover { transform: scale(1.02); box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); border-color: #3b82f6; }
                    .admin-grid-view > div [id$="-body"] { display: none !important; }
                    .admin-grid-view > div [id$="-header-btn"] { flex-direction: column; justify-content: center; height: 100%; align-items: center; text-align: center; margin-bottom: 0 !important; position: relative; overflow: visible; }
                    .admin-grid-view > div [id$="-header-btn"] > span:not(.admin-unread-badge) { flex-direction: column; align-items: center; width: 100%; display: flex; }
                    .admin-grid-view > div [id$="-header-btn"] > span > span.admin-tile-icon,
                    .admin-grid-view > div [id$="-header-btn"] > span > span:first-child {
                      margin-right: 0 !important;
                      margin-bottom: 8px;
                      line-height: 1;
                      display: inline-flex;
                      align-items: center;
                      justify-content: center;
                    }
                    .admin-grid-view > div [id$="-header-btn"] .admin-tile-icon svg {
                      width: 1.75rem;
                      height: 1.75rem;
                    }
                    .admin-grid-view > div [id$="-header-btn"] svg[id$="-chevron"] { display: none !important; }
                    .admin-grid-view > div [id$="-header-btn"] span[id$="-last-sync"] { display: none !important; }
                    .admin-grid-view .grid-hidden-actions { display: none !important; }

                    /* Compact corner unread pills - never stretch across the tile */
                    .admin-unread-badge {
                      position: absolute;
                      top: 6px;
                      right: 6px;
                      z-index: 5;
                      min-width: 1.35rem;
                      height: 1.35rem;
                      padding: 0 5px;
                      display: none;
                      align-items: center;
                      justify-content: center;
                      border-radius: 9999px;
                      font-size: 10px;
                      font-weight: 800;
                      letter-spacing: -0.02em;
                      line-height: 1;
                      color: #fff;
                      background: #ef4444;
                      box-shadow: 0 0 0 2px #ffffff, 0 1px 2px rgba(0,0,0,0.18);
                      pointer-events: none;
                      white-space: nowrap;
                      flex: none !important;
                      width: auto !important;
                      max-width: none !important;
                    }
                    .dark .admin-unread-badge {
                      box-shadow: 0 0 0 2px #1f2937, 0 1px 2px rgba(0,0,0,0.45);
                    }
                    .admin-unread-badge.admin-unread-badge--amber {
                      background: #f59e0b;
                    }
                    .admin-unread-badge:not(.hidden) {
                      display: inline-flex !important;
                    }
                    /* Ensure tile titles stay readable in dark grid cards */
                    .admin-grid-view > div [id$="-header-btn"] {
                      color: #64748b;
                    }
                    .dark .admin-grid-view > div [id$="-header-btn"] {
                      color: #94a3b8;
                    }
                    .admin-grid-view > div [id$="-header-btn"] > span > span:not(.admin-tile-icon):not(.admin-unread-badge) {
                      opacity: 1 !important;
                      color: inherit !important;
                      max-width: 100%;
                      padding: 0 4px;
                      line-height: 1.15;
                      font-size: 10px;
                      font-weight: 800;
                      letter-spacing: 0.04em;
                      text-transform: uppercase;
                    }
                `;
                document.head.appendChild(gridStyleEl);
            } else {
                if (!gridStyleEl.textContent.includes('text-transform: uppercase')) {
                    gridStyleEl.textContent += `
                    .admin-grid-view > div [id$="-header-btn"] > span > span:not(.admin-tile-icon):not(.admin-unread-badge) {
                      opacity: 1 !important; max-width: 100%; padding: 0 4px; line-height: 1.15;
                      font-size: 10px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
                    }`;
                }
                // Patch live sessions that still force display:flex onto empty/hidden shells
                if (!gridStyleEl.textContent.includes('data-admin-shell')) {
                    gridStyleEl.textContent += `
                    .admin-grid-view > div.hidden,
                    .admin-grid-view > div:empty,
                    .admin-grid-view > div[data-admin-shell="empty"] { display: none !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; overflow: hidden !important; pointer-events: none !important; }`;
                }
                if (!gridStyleEl.textContent.includes('color: #64748b')) {
                    gridStyleEl.textContent += `
                    .admin-grid-view > div [id$="-header-btn"] { color: #64748b; }
                    .dark .admin-grid-view > div [id$="-header-btn"] { color: #94a3b8; }
                    .admin-grid-view > div [id$="-header-btn"] > span > span:not(.admin-tile-icon):not(.admin-unread-badge) { color: inherit !important; }`;
                }
            }

            // Drill-Down "X": inside a panel → grid only; on grid → close Dev Mode (no history.back race)
            if (closeBtn) {
                closeBtn.removeAttribute('onclick');
                closeBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    Admin.closeDevModal();
                };
            }

            // Bind Toggle Action (GUARDIAN Phase 4: Dynamic Column Cycling 1, 2, 3)
            toggleBtn.onclick = () => {
                if (!Admin.isGridMode) return; 
                
                Admin.gridCols = Admin.gridCols === 1 ? 2 : (Admin.gridCols === 2 ? 3 : 1);
                container.style.gridTemplateColumns = `repeat(${Admin.gridCols}, minmax(0, 1fr))`;
                Admin.syncGridToggleIcon(toggleBtn);
            };

            // Global Interceptor: The Drill-Down Engine
            container.addEventListener('click', (e) => {
                if (!Admin.isGridMode) {
                    // Stale drill flag while grid chrome is still visible — recover taps.
                    if (container.classList.contains('admin-grid-view')) Admin.isGridMode = true;
                    else return;
                }
                
                const card = e.target.closest('.admin-grid-view > div');
                if (!card) return;
                
                // Trigger Drill Down
                Admin.isGridMode = false;
                container.classList.remove('admin-grid-view');
                container.style.gridTemplateColumns = ''; // Clear inline styles
                
                // GUARDIAN UX FIX: Edge-to-Edge Expansion
                // Strip padding, borders, and margins so the module touches the exact edge of the screen
                card.dataset.originalClasses = card.className;
                card.classList.remove('rounded-xl', 'border', 'shadow-md', 'p-4', 'mb-4', 'border-gray-200', 'dark:border-gray-700', 'bg-white', 'dark:bg-gray-800');
                card.classList.add('!border-none', '!shadow-none', '!rounded-none', '!p-0', '!mb-0', 'bg-transparent');
                
                // GUARDIAN UX FIX: Hide Sign Out container to maximize panel airspace
                const signoutContainer = document.getElementById('admin-signout-container');
                if (signoutContainer) signoutContainer.style.display = 'none';
                
                // GUARDIAN PHASE 11: Admin Router Bug Fix
                history.pushState({ adminPanel: card.id }, '', `#dev-${card.id}`);
                
                // Hide sibling cards
                Array.from(container.children).forEach(child => {
                    if (child !== card) {
                        child.style.display = 'none';
                    }
                });
                
                // Expand targeted body
                const body = card.querySelector('[id$="-body"]');
                if (body) body.classList.remove('hidden');
                const chev = card.querySelector('[id$="-chevron"]');
                if (chev) chev.classList.remove('-rotate-90');

                // GUARDIAN UX FIX: Force hide the inner header to prevent duplicates
                const innerHeader = card.querySelector('[id$="-header-btn"]');
                if (innerHeader) innerHeader.style.setProperty('display', 'none', 'important');
                
                // Morph Modal Header
                const titleH3 = devHeaderRow.querySelector('h3');
                devHeaderRow.dataset.originalHtml = titleH3.innerHTML;
                
                // Keep native emoji in drill title (stop stripping - was causing broken headers)
                let titleClone = card.querySelector('[id$="-header-btn"] > span').cloneNode(true);
                titleClone.querySelectorAll('span[id$="-last-sync"], span[id$="-unread-badge"]').forEach(el => el.remove());
                const cardTitle = (titleClone.textContent || '').replace(/\s+/g, ' ').trim();
                
                titleH3.innerHTML = `
                    <button id="drill-back-btn" class="mr-3 p-1.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors focus:outline-none shadow-sm shrink-0">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                    </button>
                    <span class="truncate flex-grow text-lg min-w-0" style="font-family: 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif"></span>
                `;
                const titleSpan = titleH3.querySelector('span.truncate');
                if (titleSpan) titleSpan.textContent = cardTitle;
                
                toggleBtn.style.display = 'none';
                
                // Bind the Drill Back Action (replaceState — no history.back race)
                document.getElementById('drill-back-btn').onclick = (evt) => {
                    evt.stopPropagation();
                    Admin.exitDrillToGrid();
                };
                
                // Auto-Fetch data upon drill-down
                if (card.id === 'feedback-panel') Admin.fetchFeedback();
                if (card.id === 'delay-reports-panel') Admin.fetchDelayReports();
                if (card.id === 'moderation-queue-panel') Admin.fetchModerationQueue();
                if (card.id === 'user-trust-panel' && typeof Admin.fetchActiveBans === 'function') Admin.fetchActiveBans();
                if (card.id === 'deadends-panel') {
                    Admin._deSortMode = 'count';
                    const sortBtn = document.getElementById('de-sort-btn');
                    if (sortBtn) sortBtn.textContent = 'Sort: Count';
                    Admin.fetchDeadEnds();
                }
                if (card.id === 'crashes-panel') Admin.fetchCrashes(); // GUARDIAN PHASE 7
                if (card.id === 'roadmap-panel') Admin.fetchRoadmap(); // GUARDIAN PHASE 14
                if (card.id === 'holiday-approvals-panel' && typeof Admin.fetchHolidayApprovals === 'function') Admin.fetchHolidayApprovals();
                if (card.id === 'alert-panel') {
                    if (typeof Admin.setAlertManagerTab === 'function' && Admin._pendingAdminRoute) {
                        Admin.setAlertManagerTab('compose');
                    }
                    Admin.applyPendingAdminRoute('alert-panel');
                    const targetEl = document.getElementById('alert-target');
                    if (targetEl && !Admin._pendingAdminRoute) targetEl.dispatchEvent(new Event('change'));
                }
            });

            // Engage
            if (Admin.isGridMode) {
                container.classList.add('admin-grid-view');
                container.style.gridTemplateColumns = `repeat(${Admin.gridCols}, minmax(0, 1fr))`;
            }
        }

        // Always (re)bind X — HubModals inline onclick can race with history.back()
        const alwaysCloseBtn = document.querySelector('#dev-modal button[aria-label="Close Dev Modal"]');
        if (alwaysCloseBtn) {
            alwaysCloseBtn.removeAttribute('onclick');
            alwaysCloseBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                Admin.closeDevModal();
            };
        }
    },

    // --- 2.9 GROWTH & PROMO MANAGER (QR CODE) ---
    setupGrowthManager: () => {
        const adminContainer = document.getElementById('admin-modules-container');
        if (!adminContainer) return;

        let growthPanel = document.getElementById('growth-panel');
        if (!growthPanel) {
            growthPanel = document.createElement('div');
            growthPanel.id = 'growth-panel';
            adminContainer.appendChild(growthPanel);
        }

        if (growthPanel.dataset.adminLoaded === "true") return;
        growthPanel.dataset.adminLoaded = "true";

        growthPanel.className = "bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl shadow-md border border-blue-200 dark:border-indigo-800 p-4 mb-4 relative overflow-hidden transition-all duration-300";

        growthPanel.innerHTML = `
            <button id="growth-header-btn" class="w-full text-left text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">${Admin.tileIcon('rocket', 'text-violet-500 dark:text-violet-400')} <span>Growth & Promo</span></span>
                <svg id="growth-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            
            <div id="growth-body" class="hidden mt-4">
                <p class="text-[10px] text-indigo-800 dark:text-indigo-300 font-medium leading-snug mb-4 text-center px-2">Let commuters scan this to instantly open and install the app without typing the URL.</p>
                <div class="flex flex-col items-center justify-center bg-white p-3 rounded-2xl shadow-sm border border-indigo-100 dark:border-gray-800 w-max mx-auto">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=https://nexttrain.co.za&color=1e3a8a&bgcolor=ffffff" alt="Next Train QR Code" class="w-40 h-40 object-contain rounded-lg">
                </div>
                <div class="text-center mt-4 mb-1">
                    <span class="text-xs font-bold text-indigo-900 dark:text-indigo-100 bg-white/60 dark:bg-black/20 px-4 py-1.5 rounded-full border border-indigo-200 dark:border-indigo-800 shadow-sm">nexttrain.co.za</span>
                </div>
            </div>
        `;

        const header = document.getElementById('growth-header-btn');
        const body = document.getElementById('growth-body');
        const chevron = document.getElementById('growth-chevron');

        header.onclick = () => {
            if (Admin.isGridMode) return; // Prevent accordion action when in grid
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
            }
        };
    },

    // --- GROWTH SPRINT PHASE 5: SILENT ROUTING FAILURES TRACKER (DEAD ENDS) ---
    setupDeadEndsManager: () => {
        const adminContainer = document.getElementById('admin-modules-container');
        if (!adminContainer) return;

        let dePanel = document.getElementById('deadends-panel');
        if (!dePanel) {
            dePanel = document.createElement('div');
            dePanel.id = 'deadends-panel';
            adminContainer.appendChild(dePanel);
        }

        if (dePanel.dataset.adminLoaded === "true") return;
        dePanel.dataset.adminLoaded = "true";

        dePanel.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300";
        
        dePanel.innerHTML = `
            <button id="de-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('ban', 'text-red-500 dark:text-red-400')}
                    <span>Planner Telemetry</span>
                </span>
                <span id="de-unread-badge" class="admin-unread-badge hidden" aria-label="Unread planner telemetry"></span>
                <svg id="de-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            <div id="de-body" class="hidden mt-4 space-y-3">
                <div class="bg-gray-50 dark:bg-gray-900 p-2.5 rounded-lg border border-gray-100 dark:border-gray-700 shadow-inner space-y-2">
                    <span class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider pl-0.5">Silent Routing Telemetry</span>
                    <div class="flex flex-wrap gap-2">
                        <button id="de-sort-btn" class="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">
                            Sort: Recent
                        </button>
                        <button id="de-count-mode-btn" class="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 border border-indigo-200 dark:border-indigo-800 rounded px-2 py-1 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">
                            Users
                        </button>
                        <button id="de-refresh-btn" class="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 border border-blue-200 dark:border-blue-800 rounded px-2 py-1 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">
                            Refresh
                        </button>
                        <button id="de-export-btn" class="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-800 border border-emerald-200 dark:border-emerald-800 rounded px-2 py-1 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">
                            Export
                        </button>
                        <button id="de-clear-btn" class="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800 border border-red-200 dark:border-red-800 rounded px-2 py-1 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">
                            Clear DB
                        </button>
                    </div>
                </div>
                <div id="de-tabs-swipe" class="flex gap-1 p-0.5 bg-gray-100 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 touch-pan-y">
                    <button type="button" id="de-tab-fails" class="flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm">Fails</button>
                    <button type="button" id="de-tab-trips" class="flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-md text-gray-500 dark:text-gray-400">Trip Plans</button>
                </div>
                <div id="de-trip-filters" class="hidden space-y-2">
                    <button type="button" id="de-filters-toggle" class="w-full flex items-center justify-between px-2.5 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-[10px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 focus:outline-none">
                        <span>Filters</span>
                        <svg id="de-filters-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="de-filters-body" class="hidden grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                            <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Region</label>
                            <select id="de-filter-region" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white outline-none">
                                <option value="">All regions</option>
                                <option value="GP">Gauteng</option>
                                <option value="WC">Western Cape</option>
                                <option value="KZN">KwaZulu-Natal</option>
                                <option value="EC">Eastern Cape</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Day type</label>
                            <select id="de-filter-day" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white outline-none">
                                <option value="">All days</option>
                                <option value="weekday">Weekday</option>
                                <option value="saturday">Saturday</option>
                                <option value="public_holiday">Public Holiday</option>
                                <option value="sunday">Sunday</option>
                            </select>
                        </div>
                        <div class="relative" id="de-filter-userid-container">
                            <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">User ID</label>
                            <select id="de-filter-userid" class="hidden">
                                <option value="">All users</option>
                            </select>
                            <div id="de-filter-userid-trigger" class="w-full h-9 px-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-900 dark:text-white transition-colors shadow-sm hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between cursor-pointer select-none">
                                <span id="de-filter-userid-display" class="truncate font-mono text-[11px]">All users</span>
                                <svg id="de-filter-userid-chevron" class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                            <ul id="de-filter-userid-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl hidden mt-1 flex-col overflow-y-auto max-h-48 custom-scrollbar text-left"></ul>
                        </div>
                    </div>
                </div>
                <div id="de-list" class="space-y-2 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar"></div>
            </div>
        `;
        
        const header = document.getElementById('de-header-btn');
        const body = document.getElementById('de-body');
        const chevron = document.getElementById('de-chevron');
        const refreshBtn = document.getElementById('de-refresh-btn');
        const clearBtn = document.getElementById('de-clear-btn');
        const exportBtn = document.getElementById('de-export-btn');
        const sortBtn = document.getElementById('de-sort-btn');
        const countModeBtn = document.getElementById('de-count-mode-btn');
        const listDiv = document.getElementById('de-list');
        Admin._deActiveTab = 'fails';
        Admin._deTripFilters = { region: '', dayType: '', userId: '' };
        Admin._deCountMode = Admin._deCountMode || 'users'; // users | hits

        const syncDeFiltersVisibility = () => {
            const wrap = document.getElementById('de-trip-filters');
            if (!wrap) return;
            if (Admin._deActiveTab === 'trips') wrap.classList.remove('hidden');
            else wrap.classList.add('hidden');
        };

        const setDeTab = (tab) => {
            Admin._deActiveTab = tab === 'trips' ? 'trips' : 'fails';
            const failsBtn = document.getElementById('de-tab-fails');
            const tripsBtn = document.getElementById('de-tab-trips');
            const active = 'flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm';
            const idle = 'flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-md text-gray-500 dark:text-gray-400';
            if (failsBtn) failsBtn.className = Admin._deActiveTab === 'fails' ? active : idle;
            if (tripsBtn) tripsBtn.className = Admin._deActiveTab === 'trips' ? active : idle;
            syncDeFiltersVisibility();
            Admin.fetchDeadEnds();
        };
        document.getElementById('de-tab-fails')?.addEventListener('click', () => setDeTab('fails'));
        document.getElementById('de-tab-trips')?.addEventListener('click', () => setDeTab('trips'));
        syncDeFiltersVisibility();

        document.getElementById('de-filters-toggle')?.addEventListener('click', () => {
            const bodyEl = document.getElementById('de-filters-body');
            const chev = document.getElementById('de-filters-chevron');
            if (!bodyEl) return;
            const open = bodyEl.classList.toggle('hidden') === false;
            chev?.classList.toggle('-rotate-90', !open);
        });

        // Swipe between Fails ? Trip Plans (tabs + list surface)
        const bindDeSwipe = (el) => {
            if (!el || el.dataset.deSwipeBound === '1') return;
            el.dataset.deSwipeBound = '1';
            let touchStartX = 0;
            el.addEventListener('touchstart', (e) => {
                touchStartX = e.changedTouches?.[0]?.screenX || 0;
            }, { passive: true });
            el.addEventListener('touchend', (e) => {
                const endX = e.changedTouches?.[0]?.screenX || 0;
                const diffX = endX - touchStartX;
                if (Math.abs(diffX) < 48) return;
                if (diffX > 0 && Admin._deActiveTab === 'trips') setDeTab('fails');
                else if (diffX < 0 && Admin._deActiveTab === 'fails') setDeTab('trips');
            }, { passive: true });
        };
        bindDeSwipe(document.getElementById('de-tabs-swipe'));
        bindDeSwipe(listDiv);

        const bindTripFilter = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            const apply = () => {
                Admin._deTripFilters[key] = (el.value || '').trim();
                if (Admin._deActiveTab === 'trips') Admin.renderTripPlanBatches(listDiv, null, true);
            };
            el.addEventListener('change', apply);
            el.addEventListener('input', apply);
        };
        bindTripFilter('de-filter-region', 'region');
        bindTripFilter('de-filter-day', 'dayType');
        bindTripFilter('de-filter-userid', 'userId');

        // Premium custom dropdown for User ID (matches excl-route pattern)
        const uidTrigger = document.getElementById('de-filter-userid-trigger');
        const uidList = document.getElementById('de-filter-userid-list');
        const uidChevron = document.getElementById('de-filter-userid-chevron');
        if (uidTrigger && uidList && uidTrigger.dataset.bound !== '1') {
            uidTrigger.dataset.bound = '1';
            uidTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                uidList.classList.toggle('hidden');
                uidChevron?.classList.toggle('rotate-180');
            });
            document.addEventListener('click', (e) => {
                const wrap = document.getElementById('de-filter-userid-container');
                if (wrap && !wrap.contains(e.target)) {
                    uidList.classList.add('hidden');
                    uidChevron?.classList.remove('rotate-180');
                }
            });
        }

        if (exportBtn) {
            exportBtn.onclick = () => Admin.exportPlannerTelemetryTab();
        }

        // Default: sort corridors by volume (count), not most recent.
        Admin._deSortMode = 'count';

        if (sortBtn) {
            sortBtn.textContent = Admin._deSortMode === 'count' ? 'Sort: Count' : 'Sort: Recent';
            sortBtn.onclick = () => {
                Admin._deSortMode = Admin._deSortMode === 'count' ? 'recent' : 'count';
                sortBtn.textContent = Admin._deSortMode === 'count' ? 'Sort: Count' : 'Sort: Recent';
                if (listDiv.innerHTML !== '') Admin.fetchDeadEnds();
            };
        }

        if (countModeBtn) {
            countModeBtn.textContent = Admin._deCountMode === 'hits' ? 'Hits' : 'Users';
            countModeBtn.onclick = () => {
                Admin._deCountMode = Admin._deCountMode === 'hits' ? 'users' : 'hits';
                countModeBtn.textContent = Admin._deCountMode === 'hits' ? 'Hits' : 'Users';
                if (listDiv.innerHTML !== '') Admin.fetchDeadEnds();
            };
        }

        header.onclick = () => {
            if (Admin.isGridMode) return;
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
                Admin.fetchDeadEnds();
            }
        };

        refreshBtn.onclick = () => Admin.fetchDeadEnds();

        Admin.fetchDeadEnds = async () => {
            const secret = await Admin.getAuthKey();
            if (!secret) return;
            
            // GUARDIAN PHASE 11 & 12: Mark as seen instantly in Firebase (Cross-Device Sync) AND Local Storage
            try { 
                safeStorage.setItem('de_last_checked', Date.now().toString()); 
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                fetch(`${dynamicEndpoint}admin_state/${Admin.currentUser.uid}/de_last_checked.json?auth=${secret}`, { method: 'PUT', body: JSON.stringify(Date.now()) });
            } catch(e){}
            const badge = document.getElementById('de-unread-badge');
            if (badge) badge.classList.add('hidden');
            
            listDiv.innerHTML = '<div class="text-xs text-gray-500 italic text-center py-4">Scanning telemetry...</div>';
            
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';

                if (Admin._deActiveTab === 'trips') {
                    await Admin.renderTripPlanBatches(listDiv, secret);
                    return;
                }

                const res = await window.guardianFetch(`${dynamicEndpoint}sys_logs/routing_fails.json?auth=${secret}`, {}, 10000);
                
                if (!res.ok) throw new Error("HTTP " + res.status);
                const data = await res.json();
                
                if (!data) {
                    listDiv.innerHTML = '<div class="text-xs text-gray-500 italic text-center py-4">No routing failures recorded.</div>';
                    return;
                }
                
                Admin._cachedRoutingFails = data;

                // Aggregate by Origin|Dest|Reason|DayType - track hits + unique users
                const heatMap = {};
                Object.values(data).forEach(entry => {
                    if (!entry.origin || !entry.destination) return;
                    const dayType = entry.dayType || 'unknown';
                    const key = `${entry.origin}|${entry.destination}|${entry.reason || 'UNKNOWN'}|${dayType}`;
                    if (!heatMap[key]) {
                        heatMap[key] = {
                            origin: entry.origin,
                            dest: entry.destination,
                            reason: entry.reason,
                            dayType,
                            timeOfDay: entry.timeOfDay || null,
                            hitCount: 0,
                            userIds: new Set(),
                            lastSeen: 0,
                        };
                    }
                    heatMap[key].hitCount++;
                    const uid = entry.userId || entry.deviceId || entry.authUid || '';
                    if (uid) heatMap[key].userIds.add(uid);
                    if (entry.timestamp > heatMap[key].lastSeen) {
                        heatMap[key].lastSeen = entry.timestamp;
                        if (entry.timeOfDay) heatMap[key].timeOfDay = entry.timeOfDay;
                    }
                });

                const countMode = Admin._deCountMode === 'hits' ? 'hits' : 'users';
                const sorted = Object.values(heatMap).map((item) => ({
                    ...item,
                    userCount: item.userIds.size,
                    displayCount: countMode === 'hits' ? item.hitCount : item.userIds.size,
                })).sort((a, b) => {
                    if (Admin._deSortMode === 'recent') return b.lastSeen - a.lastSeen;
                    return b.displayCount - a.displayCount;
                });
                
                listDiv.innerHTML = '';
                
                const secureEscape = (str) => {
                    if (!str) return '';
                    if (typeof escapeHTML === 'function') return escapeHTML(str);
                    return String(str).replace(/[&<>"']/g, function(m) {
                        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
                    });
                };

                sorted.forEach(item => {
                    const dateStr = Admin.formatDate(item.lastSeen);
                    const card = document.createElement('div');
                    card.className = "bg-white dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-between transition-colors hover:border-blue-300";
                    
                    let reasonBadge = "bg-gray-100 text-gray-600";
                    let reasonText = "Unknown";
                    if (item.reason === 'SAME_STATION') { reasonBadge = "bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300"; reasonText = "Same Station"; }
                    else if (item.reason === 'ERR_TIMETABLE_MISMATCH') { reasonBadge = "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400"; reasonText = "Sparse Schedule"; }
                    else if (item.reason === 'ERR_DISCONNECTED_GRAPH') { reasonBadge = "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400"; reasonText = "No Physical Link"; }
                    else if (item.reason === 'ERR_CROSS_REGION') { reasonBadge = "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400"; reasonText = "Cross Region"; }
                    else if (item.reason === 'ERR_ACTIVE_SUSPENSION') { reasonBadge = "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400"; reasonText = "Line Severed"; }
                    else if (item.reason === 'ERR_NO_SERVICE_TODAY') { reasonBadge = "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"; reasonText = "No Service"; }

                    const safeOrigin = secureEscape(item.origin);
                    const safeDest = secureEscape(item.dest);
                    const dayLabel = secureEscape(item.dayType || 'unknown');
                    const timeLabel = secureEscape(item.timeOfDay || '-');
                    const countLabel = countMode === 'hits' ? 'Hits' : 'Users';
                    
                    const escalateAttr = Admin.encodeEscalatePayload({
                        type: 'route',
                        severity: 'medium',
                        title: `Routing Fail: ${item.origin} to ${item.dest}`,
                        description: `Failed with reason: ${item.reason || 'UNKNOWN'} (${item.dayType || 'day?'}, ~${item.timeOfDay || 'time?'}). ${item.hitCount} hits / ${item.userCount} users.`,
                        source: 'Telemetry Data'
                    });

                    card.innerHTML = `
                        <div class="min-w-0 flex-1 pr-2">
                            <div class="text-xs font-bold text-gray-900 dark:text-white whitespace-normal break-words leading-snug">${safeOrigin} ${Admin.routeArrowSvg('inline-block w-3.5 h-3.5 mx-1 align-middle text-gray-400 shrink-0')} ${safeDest}</div>
                            <div class="flex flex-wrap items-center mt-1.5 gap-1.5">
                                <span class="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${reasonBadge}">${reasonText}</span>
                                <span class="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">${dayLabel}</span>
                                <span class="text-[9px] text-gray-400 font-mono">${timeLabel}</span>
                                <span class="text-[9px] text-gray-400 font-mono">Last: ${dateStr}</span>
                            </div>
                        </div>
                        <div class="flex flex-col items-end shrink-0 gap-1.5 ml-2">
                            <div class="flex items-center justify-center bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg px-2.5 py-1.5 shadow-sm min-w-[4.5rem]">
                                <span class="text-[9px] text-gray-400 uppercase font-bold mr-1.5">${countLabel}</span>
                                <span class="text-sm font-black text-gray-700 dark:text-gray-300 leading-none">${item.displayCount}</span>
                            </div>
                            <button class="text-orange-600 dark:text-orange-400 hover:text-white hover:bg-orange-600 text-[9px] font-bold bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 px-3 py-1.5 rounded transition-colors focus:outline-none uppercase tracking-widest shadow-sm w-full text-center" onclick="Admin.escalateFromEl(this)" data-escalate="${escalateAttr}">Ticket</button>
                        </div>
                    `;
                    listDiv.appendChild(card);
                });
            } catch(e) {
                console.error("Dead Ends fetch error:", e);
                listDiv.innerHTML = `<div class="text-xs text-red-500 text-center py-4">Failed to load telemetry.<br><span class="text-[9px] text-gray-500">Check Firebase rules or data.</span></div>`;
            }
        };

        /** Flatten cached trip_plans batches into filterable rows. */
        Admin.flattenTripPlanRows = (data = Admin._cachedTripPlans) => {
            const rows = [];
            if (!data || typeof data !== 'object') return rows;
            Object.entries(data).forEach(([batchId, batch]) => {
                if (!batch || typeof batch !== 'object') return;
                const trips = Array.isArray(batch.trips) ? batch.trips : [];
                const batchTs = Number(batch.flushedAt || 0);
                trips.forEach((entry) => {
                    if (!entry?.origin || !entry?.destination) return;
                    rows.push({
                        batchId,
                        origin: entry.origin,
                        destination: entry.destination,
                        dayType: entry.dayType || 'unknown',
                        region: entry.region || batch.region || '',
                        userId: entry.userId || entry.deviceId || batch.userId || batch.deviceId || '',
                        authUid: entry.authUid || batch.authUid || '',
                        depTime: entry.depTime || '',
                        arrTime: entry.arrTime || '',
                        transfers: entry.transfers ?? '',
                        appVersion: entry.appVersion || batch.appVersion || '',
                        timestamp: Number(entry.timestamp || batchTs || 0),
                    });
                });
            });
            return rows;
        };

        Admin.getFilteredTripPlanRows = () => {
            const f = Admin._deTripFilters || {};
            const region = (f.region || '').toUpperCase();
            const dayType = (f.dayType || '').toLowerCase();
            const userId = (f.userId || '').toLowerCase();
            return Admin.flattenTripPlanRows().filter((r) => {
                if (region && String(r.region || '').toUpperCase() !== region) return false;
                if (dayType && String(r.dayType || '').toLowerCase() !== dayType) return false;
                if (userId) {
                    const hay = `${r.userId || ''} ${r.authUid || ''}`.toLowerCase();
                    if (!hay.includes(userId)) return false;
                }
                return true;
            });
        };

        Admin.renderTripPlanBatches = async (listDiv, secret, useCacheOnly = false) => {
            if (!useCacheOnly) {
                listDiv.innerHTML = '<div class="text-xs text-gray-500 italic text-center py-4">Loading trip plans...</div>';
            }
            try {
                if (!useCacheOnly) {
                    const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                    const res = await window.guardianFetch(`${dynamicEndpoint}sys_logs/trip_plans.json?auth=${secret}`, {}, 10000);
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    Admin._cachedTripPlans = await res.json();
                }
                const data = Admin._cachedTripPlans;
                if (!data) {
                    listDiv.innerHTML = '<div class="text-xs text-gray-500 italic text-center py-4">No batched trip plans yet.<br><span class="text-[9px]">Clients flush every 10 successful plans.</span></div>';
                    return;
                }

                const allRows = Admin.flattenTripPlanRows();
                // Populate premium user dropdown from full (unfiltered) set
                const userSel = document.getElementById('de-filter-userid');
                const uidList = document.getElementById('de-filter-userid-list');
                const uidDisplay = document.getElementById('de-filter-userid-display');
                if (userSel) {
                    const prev = Admin._deTripFilters?.userId || userSel.value || '';
                    const users = [...new Set(allRows.map((r) => r.userId).filter(Boolean))].sort();
                    userSel.innerHTML = `<option value="">All users</option>` + users.map((u) =>
                        `<option value="${String(u).replace(/"/g, '&quot;')}">${String(u).replace(/</g, '&lt;')}</option>`
                    ).join('');
                    if (prev && users.includes(prev)) userSel.value = prev;
                    else {
                        userSel.value = '';
                        Admin._deTripFilters.userId = '';
                    }
                    if (uidList) {
                        const esc = (s) => String(s).replace(/</g, '&lt;');
                        uidList.innerHTML = '';
                        const addLi = (value, label) => {
                            const li = document.createElement('li');
                            li.className = 'px-3 py-2.5 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 cursor-pointer font-mono';
                            li.textContent = label;
                            li.onclick = () => {
                                userSel.value = value;
                                if (uidDisplay) uidDisplay.textContent = label;
                                uidList.classList.add('hidden');
                                document.getElementById('de-filter-userid-chevron')?.classList.remove('rotate-180');
                                userSel.dispatchEvent(new Event('change'));
                            };
                            uidList.appendChild(li);
                        };
                        addLi('', 'All users');
                        users.forEach((u) => addLi(u, esc(u)));
                    }
                    if (uidDisplay) {
                        uidDisplay.textContent = userSel.value || 'All users';
                    }
                }

                const filtered = Admin.getFilteredTripPlanRows();
                // Group by trip corridor - uniqueUsers = unique userId/batchId (same user, new batch counts again)
                const heatMap = {};
                filtered.forEach((entry) => {
                    const key = `${entry.origin}|${entry.destination}|${entry.dayType}|${entry.region}`;
                    if (!heatMap[key]) {
                        heatMap[key] = {
                            origin: entry.origin,
                            dest: entry.destination,
                            dayType: entry.dayType,
                            region: entry.region,
                            userId: entry.userId,
                            uniqueKeys: new Set(),
                            count: 0,
                            lastSeen: 0,
                            depSample: entry.depTime || null,
                            hits: [],
                        };
                    }
                    const uniq = `${entry.userId || 'anon'}::${entry.batchId || entry.timestamp || 0}`;
                    heatMap[key].uniqueKeys.add(uniq);
                    heatMap[key].count = heatMap[key].uniqueKeys.size;
                    heatMap[key].hits.push(entry);
                    if (entry.timestamp > heatMap[key].lastSeen) {
                        heatMap[key].lastSeen = entry.timestamp;
                        heatMap[key].userId = entry.userId;
                        if (entry.depTime) heatMap[key].depSample = entry.depTime;
                    }
                });

                const countMode = Admin._deCountMode === 'hits' ? 'hits' : 'users';
                const sorted = Object.values(heatMap).map((item) => ({
                    ...item,
                    hitCount: (item.hits || []).length,
                    displayCount: countMode === 'hits' ? (item.hits || []).length : item.count,
                })).sort((a, b) => {
                    if (Admin._deSortMode === 'recent') return b.lastSeen - a.lastSeen;
                    return b.displayCount - a.displayCount;
                });

                const totalRows = allRows.length;
                const userCount = new Set(filtered.map((r) => `${r.userId || ''}::${r.batchId || ''}`).filter(Boolean)).size;
                if (!sorted.length) {
                    listDiv.innerHTML = `<div class="text-xs text-gray-500 italic text-center py-4">${totalRows ? 'No trip plans match these filters.' : 'Batches present but no trip rows to merge.'}</div>`;
                    return;
                }

                const secureEscape = (str) => {
                    if (!str) return '';
                    if (typeof escapeHTML === 'function') return escapeHTML(str);
                    return String(str).replace(/[&<>"']/g, (m) => ({
                        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
                    }[m]));
                };

                listDiv.innerHTML = `
                    <div class="text-[9px] text-gray-400 px-1 mb-1">
                        Showing ${filtered.length} logged trips / ${sorted.length} unique corridors / ${userCount} unique user-batches (export uses current filters)
                    </div>
                `;

                sorted.forEach((item, idx) => {
                    const dateStr = Admin.formatDate(item.lastSeen);
                    const card = document.createElement('div');
                    card.className = 'bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden transition-colors hover:border-emerald-300';
                    const safeOrigin = secureEscape(item.origin);
                    const safeDest = secureEscape(item.dest);
                    const dayLabel = secureEscape(item.dayType || 'unknown');
                    const depLabel = secureEscape(item.depSample || '-');
                    const regionLabel = secureEscape(item.region || '-');
                    const uidLabel = secureEscape(item.userId || '-');
                    const countLabel = countMode === 'hits' ? 'Hits' : 'Users';
                    const hitsSorted = [...(item.hits || [])].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    const hitsHtml = hitsSorted.map((h) => `
                        <div class="flex justify-between gap-2 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0 text-[10px]">
                            <span class="font-mono text-gray-500 truncate">${secureEscape(Admin.formatDate(h.timestamp))} / ${secureEscape((h.userId || '').slice(0, 14))}</span>
                            <span class="font-mono text-gray-600 dark:text-gray-300 shrink-0">dep ${secureEscape(h.depTime || '-')}</span>
                        </div>
                    `).join('');
                    card.innerHTML = `
                        <button type="button" class="de-trip-card-btn w-full text-left p-3 flex items-center justify-between focus:outline-none" data-trip-idx="${idx}" aria-expanded="false">
                            <div class="min-w-0 flex-1 pr-2">
                                <div class="text-xs font-bold text-gray-900 dark:text-white whitespace-normal break-words leading-snug">${safeOrigin} ${Admin.routeArrowSvg('inline-block w-3.5 h-3.5 mx-1 align-middle text-gray-400 shrink-0')} ${safeDest}</div>
                                <div class="flex flex-wrap items-center mt-1.5 gap-1.5">
                                    <span class="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Trip</span>
                                    <span class="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">${dayLabel}</span>
                                    <span class="text-[9px] font-bold text-slate-600 dark:text-slate-300 uppercase">${regionLabel}</span>
                                    <span class="text-[9px] text-gray-500 dark:text-gray-400 font-mono">dep ${depLabel}</span>
                                </div>
                                <div class="mt-1.5 text-[10px] font-mono text-gray-500 dark:text-gray-400 truncate" title="${uidLabel}">Latest user: ${uidLabel}</div>
                                <div class="text-[9px] text-gray-400 font-mono mt-0.5">Last: ${dateStr}</div>
                            </div>
                            <div class="flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg px-2.5 py-1.5 shadow-sm shrink-0">
                                <span class="text-[9px] text-gray-400 uppercase font-bold">${countLabel}</span>
                                <span class="text-sm font-black text-gray-700 dark:text-gray-300 leading-none">${item.displayCount}</span>
                            </div>
                        </button>
                        <div class="de-trip-hits hidden px-3 pb-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/40">
                            <p class="text-[9px] font-black uppercase tracking-wider text-gray-400 pt-2 mb-1">Hit history</p>
                            ${hitsHtml || '<p class="text-[10px] text-gray-400 italic">No hit details.</p>'}
                        </div>
                    `;
                    card.querySelector('.de-trip-card-btn')?.addEventListener('click', () => {
                        const panel = card.querySelector('.de-trip-hits');
                        const btn = card.querySelector('.de-trip-card-btn');
                        if (!panel || !btn) return;
                        const open = panel.classList.toggle('hidden') === false;
                        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
                    });
                    listDiv.appendChild(card);
                });
            } catch (e) {
                listDiv.innerHTML = `<div class="text-xs text-red-500 text-center py-4">Failed to load trip plans.</div>`;
            }
        };

        /** Export only the active tab; ask txt vs Excel (.csv); download file. */
        Admin.exportPlannerTelemetryTab = async () => {
            const format = await Admin.secureChoice(
                'Download export',
                Admin._deActiveTab === 'trips'
                    ? 'Export the Trip Plans tab (respects current filters).'
                    : 'Export the Fails tab.',
                [
                    { id: 'txt', label: 'Text (.txt)', primary: true },
                    { id: 'csv', label: 'Excel (.csv)' },
                ]
            );
            if (!format) return;

            const dateStr = new Date().toISOString().slice(0, 10);
            if (Admin._deActiveTab === 'trips') {
                const rows = Admin.getFilteredTripPlanRows();
                if (!rows.length) {
                    if (typeof showToast === 'function') showToast('No trip plans to export', 'info');
                    return;
                }
                rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                const headers = ['timestamp', 'region', 'userId', 'authUid', 'dayType', 'origin', 'destination', 'depTime', 'arrTime', 'transfers', 'appVersion', 'batchId'];
                if (format === 'csv') {
                    const esc = (v) => {
                        const s = String(v ?? '');
                        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                    };
                    const lines = [headers.join(',')];
                    rows.forEach((r) => {
                        lines.push(headers.map((h) => esc(h === 'timestamp' ? Admin.formatDate(r.timestamp) : r[h])).join(','));
                    });
                    Admin.downloadFile(`trip_plans_${dateStr}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
                } else {
                    let txt = `NEXT TRAIN - TRIP PLANS EXPORT\nExported: ${Admin.formatDate(Date.now())}\nRows: ${rows.length}\n${'='.repeat(48)}\n\n`;
                    rows.forEach((r, i) => {
                        txt += `#${i + 1}  ${Admin.formatDate(r.timestamp)}\n`;
                        txt += `  ${r.origin} -> ${r.destination}\n`;
                        txt += `  Region: ${r.region || '-'} - Day: ${r.dayType || '-'} - User: ${r.userId || '-'}\n`;
                        if (r.authUid) txt += `  Auth UID: ${r.authUid}\n`;
                        txt += `  Dep: ${r.depTime || '-'} - Arr: ${r.arrTime || '-'} - Transfers: ${r.transfers ?? '-'}\n\n`;
                    });
                    Admin.downloadFile(`trip_plans_${dateStr}.txt`, txt);
                }
                if (typeof showToast === 'function') showToast(`Downloaded ${rows.length} trip plan(s)`, 'success');
                return;
            }

            // Fails tab
            const fails = Admin._cachedRoutingFails || {};
            const entries = Object.entries(fails).map(([id, v]) => ({ id, ...(v || {}) }));
            if (!entries.length) {
                if (typeof showToast === 'function') showToast('No fails to export', 'info');
                return;
            }
            entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            const headers = ['timestamp', 'region', 'userId', 'deviceId', 'dayType', 'origin', 'destination', 'reason', 'timeOfDay', 'appVersion', 'id'];
            if (format === 'csv') {
                const esc = (v) => {
                    const s = String(v ?? '');
                    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                };
                const lines = [headers.join(',')];
                entries.forEach((r) => {
                    lines.push(headers.map((h) => {
                        if (h === 'timestamp') return esc(Admin.formatDate(r.timestamp));
                        if (h === 'userId') return esc(r.userId || r.deviceId || '');
                        if (h === 'destination') return esc(r.destination || r.dest || '');
                        return esc(r[h]);
                    }).join(','));
                });
                Admin.downloadFile(`routing_fails_${dateStr}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
            } else {
                let txt = `NEXT TRAIN - ROUTING FAILS EXPORT\nExported: ${Admin.formatDate(Date.now())}\nRows: ${entries.length}\n${'='.repeat(48)}\n\n`;
                entries.forEach((r, i) => {
                    txt += `#${i + 1}  ${Admin.formatDate(r.timestamp)}\n`;
                    txt += `  ${(r.origin || '-')} -> ${(r.destination || r.dest || '-')}\n`;
                    txt += `  Reason: ${r.reason || 'UNKNOWN'} - Day: ${r.dayType || '-'} - Region: ${r.region || '-'}\n`;
                    txt += `  User: ${r.userId || r.deviceId || '-'} - Time: ${r.timeOfDay || '-'}\n\n`;
                });
                Admin.downloadFile(`routing_fails_${dateStr}.txt`, txt);
            }
            if (typeof showToast === 'function') showToast(`Downloaded ${entries.length} fail(s)`, 'success');
        };

        clearBtn.onclick = async () => {
            const path = Admin._deActiveTab === 'trips' ? 'sys_logs/trip_plans' : 'sys_logs/routing_fails';
            const label = Admin._deActiveTab === 'trips' ? 'trip plan batches' : 'routing fail logs';
            const confirmed = await Admin.secureConfirm('Clear Telemetry DB', `Type 'CLEAR' to permanently delete all ${label} from the server:`, 'CLEAR');
            if (!confirmed) return;
            const secret = await Admin.getAuthKey();
            if (!secret) return;
            
            clearBtn.disabled = true;
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                await window.guardianFetch(`${dynamicEndpoint}${path}.json?auth=${secret}`, { method: 'DELETE' }, 10000);
                if (typeof showToast === 'function') showToast(`${label} wiped.`, 'success');
                Admin.fetchDeadEnds();
            } catch (e) {
                if (typeof showToast === 'function') showToast('Failed to clear logs', 'error');
            } finally {
                clearBtn.disabled = false;
            }
        };
    },

// --- 3.5 FEEDBACK MANAGER (GUARDIAN INBOX & ARCHIVE PROTOCOL) ---
    setupFeedbackManager: () => {
        const alertPanel = document.getElementById('alert-panel');
        if (!alertPanel || !alertPanel.parentNode) return;

        let fbPanel = document.getElementById('feedback-panel');
        if (!fbPanel) {
            fbPanel = document.createElement('div');
            fbPanel.id = 'feedback-panel';
            alertPanel.parentNode.insertBefore(fbPanel, alertPanel);
        }

        if (fbPanel.dataset.adminLoaded === "true") return;
        fbPanel.dataset.adminLoaded = "true";

        // Local state config
        Admin.currentFeedbackTab = 'inbox';
        Admin.cachedFeedbackData = [];

        fbPanel.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300";

        fbPanel.innerHTML = `
            <div id="fb-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative cursor-pointer">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('message', 'text-sky-500 dark:text-sky-400')}
                    <span>Commuter Feedback</span>
                </span>
                <span id="fb-unread-badge" class="admin-unread-badge hidden" aria-label="Unread feedback"></span>
                <svg id="fb-chevron" class="absolute right-3 w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            
            <div id="fb-body" class="hidden mt-4 flex flex-col">
                <!-- GUARDIAN UX FIX: Next Train Style Tabs -->
                <div class="flex border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 z-30 pt-1 mb-3">
                    <button id="fb-tab-inbox" class="flex-1 py-3 text-sm font-bold text-center border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 transition-colors focus:outline-none">
                        Inbox
                    </button>
                    <button id="fb-tab-archive" class="flex-1 py-3 text-sm font-bold text-center border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors focus:outline-none">
                        Archive
                    </button>
                </div>

                <!-- GUARDIAN UX FIX: Search Bar -->
                <div class="mb-3 relative px-1">
                    <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                        ${Admin.icon('search', 'w-3.5 h-3.5')}
                    </div>
                    <input type="text" id="fb-search-input" class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block pl-10 p-3 shadow-inner outline-none transition-colors" placeholder="Search aliases, IDs, or messages...">
                </div>

                <!-- GUARDIAN UX FIX: Relocated Action Buttons -->
                <div class="grid-hidden-actions flex space-x-2 mb-3 px-1">
                    <button id="fb-export-global-btn" onclick="event.stopPropagation()" class="flex-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-800 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors shadow-sm focus:outline-none flex items-center justify-center gap-1.5">
                        ${Admin.icon('download', 'w-3.5 h-3.5')} Export All
                    </button>
                    <button id="fb-refresh-btn" onclick="event.stopPropagation()" class="flex-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors shadow-sm focus:outline-none flex items-center justify-center gap-1.5">
                        ${Admin.icon('refresh', 'w-3.5 h-3.5')} Refresh
                    </button>
                </div>
                
                <div id="fb-list" class="space-y-3 pr-1"></div>
            </div>
        `;

        const header = document.getElementById('fb-header-btn');
        const body = document.getElementById('fb-body');
        const chevron = document.getElementById('fb-chevron');
        const refreshBtn = document.getElementById('fb-refresh-btn');
        const exportGlobalBtn = document.getElementById('fb-export-global-btn');
        const listContainer = document.getElementById('fb-list');
        const tabInbox = document.getElementById('fb-tab-inbox');
        const tabArchive = document.getElementById('fb-tab-archive');
        const searchInput = document.getElementById('fb-search-input');

        if (searchInput) {
            searchInput.addEventListener('input', () => Admin.renderFeedbackList());
        }

        header.onclick = () => {
            if (Admin.isGridMode) return; // Prevent accordion action when in grid
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
                Admin.fetchFeedback(); // Auto-fetch on open
            }
        };

        refreshBtn.onclick = () => Admin.fetchFeedback();
        if (exportGlobalBtn) exportGlobalBtn.onclick = () => Admin.exportGlobalThreadsForAI();

        // Dual-Tab Switcher Logic
        const switchTab = (tab) => {
            Admin.currentFeedbackTab = tab;
            if (tab === 'inbox') {
                tabInbox.classList.replace('border-transparent', 'border-blue-600');
                tabInbox.classList.replace('text-gray-500', 'text-blue-600');
                tabInbox.classList.replace('dark:text-gray-400', 'dark:text-blue-400');
                
                tabArchive.classList.replace('border-blue-600', 'border-transparent');
                tabArchive.classList.replace('text-blue-600', 'text-gray-500');
                tabArchive.classList.replace('dark:text-blue-400', 'dark:text-gray-400');
            } else {
                tabArchive.classList.replace('border-transparent', 'border-blue-600');
                tabArchive.classList.replace('text-gray-500', 'text-blue-600');
                tabArchive.classList.replace('dark:text-gray-400', 'dark:text-blue-400');
                
                tabInbox.classList.replace('border-blue-600', 'border-transparent');
                tabInbox.classList.replace('text-blue-600', 'text-gray-500');
                tabInbox.classList.replace('dark:text-blue-400', 'dark:text-gray-400');
            }
            Admin.renderFeedbackList();
        };

        tabInbox.onclick = () => switchTab('inbox');
        tabArchive.onclick = () => switchTab('archive');

        // GUARDIAN UX: Native Swipe Navigation for Feedback Tabs
        let fbTouchStartX = 0;
        let fbTouchStartY = 0;
        if (body) {
            body.addEventListener('touchstart', (e) => {
                fbTouchStartX = e.changedTouches[0].screenX;
                fbTouchStartY = e.changedTouches[0].screenY;
            }, {passive: true});
            body.addEventListener('touchend', (e) => {
                const diffX = e.changedTouches[0].screenX - fbTouchStartX;
                const diffY = e.changedTouches[0].screenY - fbTouchStartY;
                if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                    if (diffX > 0 && Admin.currentFeedbackTab === 'archive') switchTab('inbox'); // Swipe Right
                    else if (diffX < 0 && Admin.currentFeedbackTab === 'inbox') switchTab('archive'); // Swipe Left
                }
            }, {passive: true});
        }

        // Render purely from RAM state based on Active Tab (WhatsApp Thread Protocol)
        Admin.renderFeedbackList = () => {
            listContainer.innerHTML = '';
            const isInbox = Admin.currentFeedbackTab === 'inbox';
            
            // 1. Group ALL data globally by deviceId FIRST
            const groups = {};
            Admin.cachedFeedbackData.forEach(item => {
                const did = item.device_id || item.deviceId || 'Anonymous / Legacy';
                if (!groups[did]) groups[did] = [];
                groups[did].push(item);
            });

            // GUARDIAN UX FIX: Dynamic Tab Counters
            let totalInbox = 0;
            let totalArchive = 0;
            Object.keys(groups).forEach(did => {
                if (groups[did].some(i => !i.isFromAdmin && i.status !== 'resolved')) totalInbox++;
                else totalArchive++;
            });
            if (tabInbox) tabInbox.innerHTML = `Inbox (${totalInbox})`;
            if (tabArchive) tabArchive.innerHTML = `Archive (${totalArchive})`;

            // 2. Filter groups based on Tab and Search String
            const displayGroups = [];
            const searchInputEl = document.getElementById('fb-search-input');
            const searchQuery = searchInputEl ? searchInputEl.value.toLowerCase().trim() : "";

            Object.keys(groups).forEach(did => {
                const groupItems = groups[did];
                // Sort chronologically (oldest top, newest bottom) for the chat flow
                groupItems.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                
                // A thread is "Active" (Inbox) if ANY commuter message is unresolved
                const isThreadActive = groupItems.some(i => !i.isFromAdmin && i.status !== 'resolved');
                
                let matchesSearch = true;
                if (searchQuery) {
                    const alias = (Admin.cachedAliases && Admin.cachedAliases[did]) ? Admin.cachedAliases[did].toLowerCase() : "";
                    const didLower = did.toLowerCase();
                    const hasMatchingMsg = groupItems.some(i => i.text && i.text.toLowerCase().includes(searchQuery) || (i.email && i.email.toLowerCase().includes(searchQuery)));
                    matchesSearch = alias.includes(searchQuery) || didLower.includes(searchQuery) || hasMatchingMsg;
                }

                if (matchesSearch) {
                    if (isInbox && isThreadActive) displayGroups.push({ did, items: groupItems });
                    if (!isInbox && !isThreadActive) displayGroups.push({ did, items: groupItems });
                }
            });

            if (displayGroups.length === 0) {
                listContainer.innerHTML = `<div class="text-xs text-gray-500 italic text-center py-6">${isInbox ? 'Inbox is completely clean.' : 'No archived threads yet.'}</div>`;
                return;
            }

            // 3. Sort threads by the timestamp of their latest message (newest threads on top)
            displayGroups.sort((a, b) => {
                const lastA = a.items[a.items.length - 1].timestamp || 0;
                const lastB = b.items[b.items.length - 1].timestamp || 0;
                return lastB - lastA;
            });

            const secureEscape = (str) => {
                if (!str) return '';
                if (typeof escapeHTML === 'function') return escapeHTML(str);
                return String(str).replace(/[&<>"']/g, function(m) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
                });
            };
            
            // GUARDIAN UX FIX: Universal CRM Date Formatter
            const formatNiceDateTime = (ts) => {
                const d = new Date(ts);
                const day = d.getDate();
                const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
                const year = d.getFullYear();
                let hours = d.getHours();
                const ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12 || 12;
                const minutes = String(d.getMinutes()).padStart(2, '0');
                return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
            };

            displayGroups.forEach(group => {
                const did = group.did;
                const groupItems = group.items;
                
                // For thread actions, we target the latest commuter message
                const commuterMsgs = groupItems.filter(i => !i.isFromAdmin);
                const latestCommuterMsg = commuterMsgs.length > 0 ? commuterMsgs[commuterMsgs.length - 1] : groupItems[0];
                const feedbackId = latestCommuterMsg.id;
                const unresolvedIds = commuterMsgs.filter(i => i.status !== 'resolved').map(i => i.id).join(',');

                const groupCard = document.createElement('div');
                groupCard.className = "bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden mb-3 transition-colors hover:border-blue-300 dark:hover:border-blue-500";
                
                const latestDate = formatNiceDateTime(groupItems[groupItems.length - 1].timestamp);
                
                const alias = Admin.cachedAliases && Admin.cachedAliases[did] ? Admin.cachedAliases[did] : null;
                const displayDid = did;
                const safeDidAttr = String(did).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const safeAliasAttr = String(alias || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                // Always show full Next Train ID (copyable) + optional alias rename
                const commuterTitle = did !== 'Anonymous / Legacy'
                    ? `<div class="min-w-0 w-full space-y-1">
                        ${alias ? `<button type="button" onclick="event.stopPropagation(); Admin.setCommuterAlias('${safeDidAttr}', '${safeAliasAttr}')" class="text-blue-600 dark:text-blue-400 hover:underline font-bold text-sm text-left focus:outline-none" title="Rename alias">${alias.replace(/</g, '&lt;')}</button>` : `<button type="button" onclick="event.stopPropagation(); Admin.setCommuterAlias('${safeDidAttr}', '')" class="text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-blue-500 focus:outline-none">Set alias</button>`}
                        <button type="button" onclick="event.stopPropagation(); navigator.clipboard.writeText('${safeDidAttr}').then(()=>{ if(typeof showToast==='function') showToast('User ID copied','success'); }).catch(()=>{});" class="inline-block w-fit max-w-full text-left font-mono text-[11px] leading-snug break-all whitespace-normal text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none cursor-pointer py-0 px-0" title="Click to copy Next Train user ID">${displayDid.replace(/</g, '&lt;')}</button>
                      </div>`
                    : `<span class="text-blue-600 dark:text-blue-400 font-mono break-all">${displayDid}</span>`;

                const hasAttachments = groupItems.some(i => i.attachmentUrl || (i.attachmentUrls && i.attachmentUrls.length > 0));

                // GUARDIAN PHASE 2: The "Rolodex" Contact Aggregator
                const allEmails = new Set();
                const allPhones = new Set();
                
                groupItems.forEach(msg => {
                    if (msg.email && msg.email.trim()) {
                        const em = msg.email.trim();
                        if (em.includes('@')) {
                            allEmails.add(em);
                        } else {
                            const digitCount = (em.match(/\d/g) || []).length;
                            if (digitCount >= 9) {
                                let cleanNum = em.replace(/\D/g, '');
                                if (cleanNum.startsWith('0')) cleanNum = '27' + cleanNum.substring(1);
                                else if (!cleanNum.startsWith('27') && cleanNum.length === 9) cleanNum = '27' + cleanNum;
                                allPhones.add(cleanNum);
                            } else {
                                allPhones.add(em); // Ambiguous/Plain text
                            }
                        }
                    }
                });

                // Scan chips outside the open thread (email / phone / both)
                let contactScanHtml = '';
                if (allEmails.size > 0) {
                    contactScanHtml += `<span class="inline-flex text-blue-500 dark:text-blue-400" title="${allEmails.size} email${allEmails.size > 1 ? 's' : ''}">${Admin.icon('mail', 'w-3 h-3')}</span>`;
                }
                if (allPhones.size > 0) {
                    contactScanHtml += `<span class="inline-flex text-emerald-600 dark:text-emerald-400" title="${allPhones.size} phone${allPhones.size > 1 ? 's' : ''}">${Admin.icon('phone', 'w-3 h-3')}</span>`;
                }
                if (hasAttachments) {
                    contactScanHtml += `<span class="inline-flex text-purple-500 dark:text-purple-400" title="Has attachments">${Admin.icon('paperclip', 'w-3 h-3')}</span>`;
                }
                const contactScanBlock = contactScanHtml
                    ? `<span class="inline-flex items-center gap-1 mx-1 align-middle">${contactScanHtml}</span>`
                    : '';

                const ticketType = latestCommuterMsg.type === 'bug' ? 'bug' : 'feature';
                const escalateAttr = Admin.encodeEscalatePayload({
                    type: ticketType,
                    severity: 'medium',
                    title: `Feedback from ${String(did).substring(0, 8)}`,
                    description: String(latestCommuterMsg.text || 'No description').slice(0, 400),
                    source: `Feedback ${feedbackId}`
                });

                let contactHtml = '';
                if (allEmails.size > 0 || allPhones.size > 0) {
                    contactHtml = '<div class="flex flex-wrap gap-1.5">';
                    allEmails.forEach(em => {
                        contactHtml += `
                            <div class="flex items-center bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5 max-w-[220px] sm:max-w-[300px]">
                                <a href="mailto:${em}" onclick="event.stopPropagation()" class="text-[10px] text-blue-500 hover:underline font-mono tracking-tight lowercase truncate inline-flex items-center gap-1">${Admin.icon('mail', 'w-3 h-3 shrink-0')} ${em}</a>
                                <button onclick="event.stopPropagation(); navigator.clipboard.writeText('${em}'); if(typeof showToast === 'function') showToast('Copied!', 'success', 1000);" class="ml-1.5 text-gray-400 hover:text-blue-500 transition-colors focus:outline-none inline-flex" title="Copy">${Admin.icon('copy', 'w-3 h-3')}</button>
                            </div>`;
                    });
                    allPhones.forEach(ph => {
                        const isNum = /^\d+$/.test(ph);
                        const link = isNum ? `https://wa.me/${ph}` : '#';
                        const target = isNum ? `target="_blank"` : '';
                        const aClass = isNum ? 'text-emerald-700 dark:text-emerald-300 hover:underline' : 'text-gray-500 dark:text-gray-400';
                        
                        contactHtml += `
                            <div class="flex items-center bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded px-2 py-1 max-w-[220px] sm:max-w-[300px] shadow-sm">
                                <a href="${link}" ${target} onclick="event.stopPropagation()" class="text-[10px] ${aClass} font-mono tracking-tight truncate inline-flex items-center gap-1">${Admin.icon(isNum ? 'message' : 'phone', 'w-3 h-3 shrink-0')} ${ph}</a>
                                <button onclick="event.stopPropagation(); navigator.clipboard.writeText('${ph}'); if(typeof showToast === 'function') showToast('Copied!', 'success', 1000);" class="ml-1.5 text-gray-400 hover:text-emerald-500 transition-colors focus:outline-none inline-flex" title="Copy">${Admin.icon('copy', 'w-3 h-3')}</button>
                            </div>`;
                    });
                    contactHtml += '</div>';
                }

                // GUARDIAN UX FIX: Removed wrapping <button> to prevent invalid nested buttons
                let groupHTML = `
                    <div class="feedback-group-header scroll-mt-[110px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 w-full flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 border-b border-transparent transition-colors">
                        <div class="flex-grow flex flex-col items-start min-w-0 pr-2">
                            <div class="text-xs font-bold text-gray-900 dark:text-white w-full min-w-0">${commuterTitle}</div>
                            <span class="text-[9px] text-gray-500 font-mono mt-1 inline-flex items-center flex-wrap gap-y-0.5">${groupItems.length} Message${groupItems.length > 1 ? 's' : ''}${contactScanBlock} <span class="opacity-40 mx-0.5">|</span> Last: ${latestDate}</span>
                        </div>
                        <div class="flex items-center justify-end shrink-0 self-center">
                            <button class="pointer-events-none focus:outline-none p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors border border-transparent">
                                <svg class="chevron-icon w-4 h-4 text-gray-400 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </button>
                        </div>
                    </div>
                    <div class="feedback-thread-body hidden bg-white dark:bg-gray-900 p-2 sm:p-3">
                        <div class="flex flex-wrap items-center justify-between gap-2 mb-3 bg-gray-50 dark:bg-gray-800/50 p-2 rounded-lg border border-gray-100 dark:border-gray-700">
                            <div class="flex-grow min-w-0">
                                ${contactHtml || '<span class="text-[10px] text-gray-400 italic font-medium px-1">No contact info provided</span>'}
                            </div>
                            <div class="relative shrink-0" data-fb-more-wrap>
                                <button type="button" data-fb-more-toggle class="flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg transition-colors focus:outline-none shadow-sm text-[10px] font-bold uppercase tracking-wider" title="More options">
                                    ${Admin.icon('more', 'w-3.5 h-3.5')} More Options
                                    <svg class="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </button>
                                <div data-fb-more-menu class="hidden absolute right-0 top-full mt-1 z-[40] w-44 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl py-1 text-left">
                                    <button type="button" onclick="event.stopPropagation(); Admin.exportThreadForAI('${safeDidAttr}')" class="w-full px-3 py-2 text-left text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 focus:outline-none flex items-center gap-2">${Admin.icon('download', 'w-3.5 h-3.5')} Export</button>
                                    <button type="button" data-escalate="${escalateAttr}" onclick="event.stopPropagation(); Admin.escalateFromEl(this)" class="w-full px-3 py-2 text-left text-[11px] font-bold text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 focus:outline-none flex items-center gap-2">${Admin.icon('alert', 'w-3.5 h-3.5')} Escalate</button>
                                    ${did !== 'Anonymous / Legacy' ? `<button type="button" onclick="event.stopPropagation(); Admin.applyShadowBan('${safeDidAttr}', { deviceId: '${safeDidAttr}' })" class="w-full px-3 py-2 text-left text-[11px] font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 focus:outline-none flex items-center gap-2">${Admin.icon('ban', 'w-3.5 h-3.5')} Ban</button>` : ''}
                                </div>
                            </div>
                        </div>
                        <div class="space-y-3 mb-2 h-auto min-h-[50px] flex flex-col">
                `;

                let lastRenderedDate = "";

                groupItems.forEach(item => {
                    const date = new Date(item.timestamp || Date.now());
                    const dateStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    
                    // DATE GROUPING LOGIC (WhatsApp Style)
                    const msgDateString = date.toDateString();
                    if (lastRenderedDate !== msgDateString) {
                        const today = new Date();
                        const yesterday = new Date();
                        yesterday.setDate(yesterday.getDate() - 1);
                        
                        let dateDividerText = msgDateString;
                        if (msgDateString === today.toDateString()) {
                            dateDividerText = "Today";
                        } else if (msgDateString === yesterday.toDateString()) {
                            dateDividerText = "Yesterday";
                        } else {
                            dateDividerText = date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
                        }
                        
                        groupHTML += `
                            <div class="flex justify-center w-full my-3">
                                <span class="text-[9px] font-bold text-gray-500 dark:text-gray-400 bg-gray-200/50 dark:bg-gray-800/50 px-3 py-1 rounded-full uppercase tracking-widest shadow-sm border border-gray-200 dark:border-gray-700">
                                    ${dateDividerText}
                                </span>
                            </div>
                        `;
                        lastRenderedDate = msgDateString;
                    }
                    
                    if (item.isFromAdmin) {
                        // ADMIN BUBBLE (Right)
                        // GUARDIAN PHASE 4: Polished Read Receipts & Acknowledged State
                        let receiptHtml = `<span class="inline-flex items-center text-gray-400 ml-1 shrink-0" title="Sent">${Admin.receiptTicks('single', 'w-3 h-2.5')}</span>`;
                        if (item.acknowledged) {
                            receiptHtml = `<span class="inline-flex items-center text-sky-400 ml-1 shrink-0" title="Read">${Admin.receiptTicks('double', 'w-3.5 h-2.5')}</span><span class="text-[9px] font-black bg-green-500 text-white rounded-sm px-1 ml-1.5 leading-none py-[1px]" title="Acknowledged by Commuter">R</span>`;
                        } else if (item.read) {
                            receiptHtml = `<span class="inline-flex items-center text-sky-400 ml-1 shrink-0" title="Read">${Admin.receiptTicks('double', 'w-3.5 h-2.5')}</span>`;
                        } else if (item.delivered) {
                            receiptHtml = `<span class="inline-flex items-center text-gray-400 ml-1 shrink-0" title="Delivered">${Admin.receiptTicks('double', 'w-3.5 h-2.5')}</span>`;
                        }

                        // REGEX: Extract Admin Signoff Name ("- Enock")
                        let parsedAdminText = item.text || "";
                        let adminName = "Admin";
                        parsedAdminText = Admin.repairMojibake(parsedAdminText);
                        // Match em dash and legacy UTF-8 mojibake of "-"
                        const signoffRegex = /(?:<br>|\n)*<span[^>]*>(?:\u2014|\u00E2\u20AC\u201D|\u00E2\u0080\u0094|&mdash;)\s*(.*?)<\/span>$/i;
                        const fallbackRegex = /(?:<br>|\n)*(?:\u2014|\u00E2\u20AC\u201D|\u00E2\u0080\u0094|&mdash;)\s*([a-zA-Z]+)$/i;
                        
                        let match = parsedAdminText.match(signoffRegex) || parsedAdminText.match(fallbackRegex);
                        if (match) {
                            adminName = match[1].trim();
                            parsedAdminText = parsedAdminText.replace(signoffRegex, '').replace(fallbackRegex, '').trim();
                        }

                        parsedAdminText = parsedAdminText.replace(/^(?:<br>|\s)+/, '');

                        // GROWTH SPRINT PHASE 1: Retroactive Lightbox Wrapper for legacy admin inline images
                        parsedAdminText = parsedAdminText.replace(/(<button[^>]*>)?\s*(<img[^>]+src=["']([^"']+)["'][^>]*>)\s*(<\/button>)?/gi, (match, btnStart, imgTag, srcUrl, btnEnd) => {
                            if (btnStart || btnEnd) return match; // Already wrapped in a button
                            return `<button type="button" onclick="event.stopPropagation(); window.openLightbox('${srcUrl}')" class="relative block w-full focus:outline-none my-2 cursor-zoom-in rounded-lg overflow-hidden border border-slate-600 dark:border-slate-700 shadow-sm active:scale-[0.98] transition-transform">${imgTag}<span class="nt-zoom-plus absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-xs font-bold leading-none flex items-center justify-center border border-white/20 pointer-events-none select-none shadow-sm" aria-hidden="true">+</span></button>`;
                        });

                        // GUARDIAN UX FIX: Professional, high-contrast Admin message bubble
                        // id/data use raw inbox key (same as [REPLY TO ADMIN: key]) for quote jump
                        const rawMsgKey = String(item.id || item.key || '').trim();
                        const msgAnchor = secureEscape(rawMsgKey);
                        groupHTML += `
                            <div class="flex flex-col items-end mb-1.5 pl-2 sm:pl-4" id="fb-msg-${msgAnchor}" data-fb-msg-id="${msgAnchor}" data-fb-admin-plain="${secureEscape((item.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280))}">
                                <div class="flex flex-col bg-slate-700 dark:bg-slate-800 text-white pt-1.5 pb-2 px-3 rounded-2xl rounded-tr-sm shadow-md border border-slate-600 dark:border-slate-700 text-sm leading-relaxed text-left w-fit max-w-[95%] sm:max-w-[90%] relative">
                                    <div class="mb-0.5 text-[10px] font-black text-slate-300 uppercase tracking-wider">${adminName}</div>
                                    <div>${parsedAdminText}</div>
                                    <div class="flex items-center justify-end mt-1 self-end ml-3">
                                        <span class="text-[9px] font-mono text-slate-300 opacity-90">${dateStr}</span>
                                        ${receiptHtml}
                                    </div>
                                </div>
                            </div>
                        `;
                    } else {
                        // COMMUTER BUBBLE (Left) — WhatsApp-style quote chip + reply body
                        let plainBody = item.text ? String(item.text).trim() : '';
                        let quoteBlockHtml = '';
                        let isReply = false;

                        const stripOuterQuotes = (s) => String(s || '').replace(/^["'\u201c\u201d\s]+|["'\u201c\u201d\s]+$/g, '').trim();
                        const toQuotePlain = (raw) => {
                            let s = String(raw ?? '');
                            try {
                                const d = document.createElement('div');
                                d.innerHTML = s;
                                s = d.textContent || d.innerText || '';
                            } catch {
                                s = s.replace(/<[^>]*>/g, '');
                            }
                            s = s
                                .replace(/\u00a0/g, ' ')
                                .replace(/&nbsp;/gi, ' ')
                                .replace(/&amp;/gi, '&')
                                .replace(/&lt;/gi, '<')
                                .replace(/&gt;/gi, '>')
                                .replace(/&quot;/gi, '"')
                                .replace(/&#39;/gi, "'");
                            s = stripOuterQuotes(s);
                            const wrapped = s.match(/^\[\s*([\s\S]*)\s*\]$/);
                            if (wrapped) s = stripOuterQuotes(wrapped[1]);
                            // Drop leftover wrapper crumbs: "] Bathong…" / "Bathong…"]" from broken legacy wraps
                            s = s.replace(/^[\[\]"'“”\s]+/, '').replace(/[\[\]"'“”]+$/g, '');
                            return s.replace(/\s+/g, ' ').trim();
                        };
                        const isJunkQuoteLine = (line) => {
                            const t = String(line || '').trim();
                            if (!t) return true;
                            // Stray bracket / quote crumbs from broken legacy wrappers
                            if (/^[\[\]"'“”.…\s]+$/.test(t)) return true;
                            if (t.length <= 2 && /[\[\]]/.test(t)) return true;
                            return false;
                        };
                        const stripDupQuoteFromBody = (body, snippet) => {
                            let rest = String(body || '').replace(/^\s+/, '');
                            const snip = toQuotePlain(snippet);
                            // Drop junk / duplicate quote lines that leaked below the header
                            const lines = rest.split(/\r?\n/);
                            while (lines.length) {
                                const head = lines[0];
                                const plainHead = toQuotePlain(head);
                                if (isJunkQuoteLine(head)) { lines.shift(); continue; }
                                if (snip && plainHead && (plainHead === snip || snip.startsWith(plainHead) || plainHead.startsWith(snip))) {
                                    lines.shift();
                                    continue;
                                }
                                // One-line `[quoted text]` / `"quoted text"` duplicate
                                if (snip && (/^\s*\[/.test(head) || /^\s*["“]/.test(head)) && plainHead && (plainHead === snip || snip.includes(plainHead))) {
                                    lines.shift();
                                    continue;
                                }
                                break;
                            }
                            return lines.join('\n').replace(/^\s+/, '');
                        };
                        // data-* only — never embed snippet in onclick (breaks on quotes/apostrophes)
                        const waQuoteChip = ({ author, snippet, replyKey = '', alertId = '', alertFallback = '', accent = 'blue' }) => {
                            const bar = accent === 'blue'
                                ? 'border-blue-500 dark:border-blue-400'
                                : 'border-gray-400 dark:border-gray-500';
                            const nameCls = accent === 'blue'
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-gray-600 dark:text-gray-300';
                            const cleanAuthor = toQuotePlain(author) || 'Enock';
                            const cleanSnippet = toQuotePlain(snippet) || 'Message';
                            const attrs = [
                                'type="button"',
                                'data-fb-quote-jump="1"',
                                `data-reply-key="${secureEscape(replyKey || '')}"`,
                                `data-reply-snippet="${secureEscape(cleanSnippet)}"`,
                                `data-alert-id="${secureEscape(alertId || '')}"`,
                                `data-alert-fallback="${secureEscape(alertFallback || '')}"`,
                                `class="text-left -mx-1 mb-1.5 mt-1 w-full rounded-r-md bg-black/5 dark:bg-white/10 border-l-4 ${bar} py-1.5 px-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors focus:outline-none shadow-sm cursor-pointer"`,
                            ].join(' ');
                            return `<button ${attrs}>
                                    <div class="text-[10px] font-bold ${nameCls} not-italic leading-tight">${secureEscape(cleanAuthor)}</div>
                                    <div class="text-[11px] text-gray-800 dark:text-gray-100 not-italic leading-snug line-clamp-3 mt-0.5">${secureEscape(cleanSnippet)}</div>
                                </button>`;
                        };

                        // 1) Modern: [REPLY TO ADMIN: key | snippet]\nbody  (hub.js) — snippet cannot contain ]
                        const replyWithPipe = plainBody.match(/^\[REPLY TO ADMIN:\s*([^|\]]+?)\s*\|\s*([^\]]*)\]\s*([\s\S]*)$/i);
                        // 2) Legacy header only: [REPLY TO ADMIN: key]\n(optional snippet lines)\nbody
                        const replyHeaderOnly = !replyWithPipe
                            ? plainBody.match(/^\[REPLY TO ADMIN:\s*([^\]]+)\]\s*([\s\S]*)$/i)
                            : null;

                        if (replyWithPipe || replyHeaderOnly) {
                            isReply = true;
                            const replyKey = String((replyWithPipe || replyHeaderOnly)[1] || '').trim();
                            let snippet = '';
                            let bodyRest = '';
                            if (replyWithPipe) {
                                snippet = toQuotePlain(replyWithPipe[2] || '');
                                bodyRest = String(replyWithPipe[3] || '');
                            } else {
                                bodyRest = String(replyHeaderOnly[2] || '');
                                // Prefer a dedicated quote line; never treat a lone "[" as the quote
                                const lines = bodyRest.split(/\r?\n/);
                                let i = 0;
                                while (i < lines.length && isJunkQuoteLine(lines[i])) i++;
                                if (i < lines.length) {
                                    const candidate = toQuotePlain(lines[i]);
                                    const after = lines.slice(i + 1).join('\n').replace(/^\s+/, '');
                                    // First real line is the quote only when a reply body remains after it
                                    if (candidate && after) {
                                        snippet = candidate;
                                        bodyRest = after;
                                    }
                                    // else: single remaining line is the commuter reply (no separate quote line)
                                }
                            }
                            bodyRest = stripDupQuoteFromBody(bodyRest, snippet);
                            snippet = (snippet || 'Admin message').slice(0, 240);
                            quoteBlockHtml = waQuoteChip({
                                author: 'Enock',
                                snippet,
                                replyKey,
                                accent: 'blue',
                            });
                            plainBody = bodyRest;
                        } else if (plainBody.startsWith('[')) {
                            // 3) Legacy bracket quote: find matching ] for the opening [ (not first ] only)
                            let depth = 0;
                            let end = -1;
                            for (let i = 0; i < plainBody.length; i++) {
                                const ch = plainBody[i];
                                if (ch === '[') depth++;
                                else if (ch === ']') {
                                    depth--;
                                    if (depth === 0) { end = i; break; }
                                }
                            }
                            if (end > 0) {
                                const rawQuoteContent = plainBody.slice(1, end);
                                let bodyRest = plainBody.slice(end + 1).replace(/^\s+/, '');
                                // Require a separator or end — avoid eating normal sentences
                                if (bodyRest || rawQuoteContent) {
                                    isReply = true;
                                    let quoteAuthor = 'Enock';
                                    let quoteSnippet = toQuotePlain(
                                        rawQuoteContent
                                            .replace(/REPLY TO ADMIN:\s*[^\]|]*/i, '')
                                            .replace(/Replying to:\s*/i, '')
                                            .replace(/Failed Route Attempt:\s*/i, 'Failed Route: ')
                                    );
                                    const named = quoteSnippet.match(/^([A-Za-z][\w.\s]{0,40}?):\s*([\s\S]+)$/);
                                    if (named) {
                                        quoteAuthor = toQuotePlain(named[1]) || quoteAuthor;
                                        quoteSnippet = toQuotePlain(named[2]);
                                    }
                                    quoteSnippet = (quoteSnippet || 'Quoted message').slice(0, 240);
                                    bodyRest = stripDupQuoteFromBody(bodyRest, quoteSnippet);
                                    const alertIdMatch = rawQuoteContent.match(/Alert ID:\s*(\d+)/i);
                                    const isAlertQuote = !!(alertIdMatch || /Advisory|Line Severed|Expect Delays/i.test(rawQuoteContent));
                                    quoteBlockHtml = waQuoteChip({
                                        author: quoteAuthor,
                                        snippet: quoteSnippet,
                                        replyKey: '',
                                        alertId: isAlertQuote ? (alertIdMatch ? alertIdMatch[1] : '') : '',
                                        alertFallback: isAlertQuote ? `${quoteAuthor}: ${quoteSnippet}` : '',
                                        accent: 'blue',
                                    });
                                    plainBody = bodyRest;
                                }
                            }
                        }

                        plainBody = String(plainBody || '')
                            .replace(/&nbsp;/gi, ' ')
                            .replace(/\u00a0/g, ' ')
                            .replace(/&amp;/gi, '&')
                            .replace(/&lt;/gi, '<')
                            .replace(/&gt;/gi, '>')
                            .replace(/&quot;/gi, '"')
                            .replace(/&#39;/gi, "'")
                            .trim();

                        let rawText = plainBody ? secureEscape(plainBody) : (quoteBlockHtml ? '' : 'No content');

                        // GUARDIAN PHASE 6: SMART REGEX (Emails & WhatsApp Auto-Linking)
                        rawText = rawText.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi, '<a href="mailto:$1" class="text-blue-600 dark:text-blue-400 underline font-bold" onclick="event.stopPropagation()">$1</a>');

                        // Captures SA formats: 082 123 4567, +27 82 123 4567, 27821234567
                        rawText = rawText.replace(/(?:^|\s|\()(?:\+?27|0)[\s-]*([6-8]\d)[\s-]*(\d{3})[\s-]*(\d{4})(?=\s|$|[.,!?\)])/g, (match, p1, p2, p3) => {
                            const fullNum = `27${p1}${p2}${p3}`;
                            const displayNum = `0${p1} ${p2} ${p3}`;
                            const prefix = match.charAt(0).match(/\s|\(/) ? match.charAt(0) : '';
                            return `${prefix}<a href="https://wa.me/${fullNum}" target="_blank" class="text-green-600 dark:text-green-400 font-bold underline inline-flex items-center gap-1" onclick="event.stopPropagation()">${Admin.icon('message', 'w-3 h-3')} ${displayNum}</a>`;
                        });

                        rawText = rawText.replace(/\n/g, '<br>');

                        const safeAppVersion = secureEscape(item.appVersion || 'Unknown');
                        const safeRouteId = secureEscape(item.routeId || 'None');
                        const safeAttachUrl = item.attachmentUrl ? secureEscape(item.attachmentUrl) : null;
                        const safeAttachUrls = item.attachmentUrls && Array.isArray(item.attachmentUrls)
                            ? item.attachmentUrls.map(url => secureEscape(url))
                            : (safeAttachUrl ? [safeAttachUrl] : []);

                        // Safeguard rawText in case the replace cleared it completely
                        if (typeof rawText !== 'string') rawText = '';
                        rawText = rawText.replace(/^(?:<br>|\s)+/, '');


                        // GUARDIAN PHASE 3: Dynamic Visual Attachment Previewer (Multi-File Grid & Lightbox)
                        let attachmentHtml = '';
                        if (safeAttachUrls.length > 0) {
                            const gridCols = safeAttachUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1';
                            attachmentHtml = `<div class="mt-2 grid ${gridCols} gap-2 w-full">`;
                            safeAttachUrls.forEach((url, idx) => {
                                const isImageExt = url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i);
                                if (isImageExt) {
                                    attachmentHtml += `<button type="button" onclick="event.stopPropagation(); Admin.openLightbox('${url}')" class="block focus:outline-none w-full text-left"><img src="${url}" class="w-full h-24 object-cover rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:opacity-90 transition-opacity cursor-zoom-in" alt="Attachment ${idx + 1}"></button>`;
                                } else {
                                    attachmentHtml += `<a href="${url}" target="_blank" onclick="event.stopPropagation();" class="flex items-center justify-center gap-1 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-1.5 rounded border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-800/50 transition-colors text-xs font-bold w-full h-24">${Admin.icon('file', 'w-4 h-4')} View Doc ${idx + 1}</a>`;
                                }
                            });
                            attachmentHtml += `</div>`;
                        }

                        // METADATA: Integrated Bubble Header
                        let typeLabel = "General";
                        let typeIconName = "message";
                        if (item.type === 'schedule_error') { typeLabel = "Schedule Error"; typeIconName = "clock"; }
                        else if (item.type === 'bug') { typeLabel = "App Bug"; typeIconName = "bug"; }
                        else if (item.type === 'suggestion') { typeLabel = "Suggestion"; typeIconName = "lightbulb"; }

                        // GUARDIAN UX FIX: Shortened "Commuter Reply" to "Reply:" to fit on 1 row
                        const headerLabelText = isReply
                            ? `${Admin.icon('reply', 'w-3 h-3')} Reply:`
                            : `${Admin.icon(typeIconName, 'w-3 h-3')} ${typeLabel}`;
                        let headerColorClass = isReply ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400";

                        const integratedHeaderHtml = `
                            <div class="text-[9px] font-black ${headerColorClass} uppercase tracking-widest mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-1 flex justify-between items-center w-full">
                                <span class="whitespace-nowrap inline-flex items-center gap-1">${headerLabelText}</span>
                                <span class="font-mono font-medium opacity-60 ml-2 truncate">${safeAppVersion.split(' - ')[0]} · ${safeRouteId}</span>
                            </div>
                        `;

                        // GUARDIAN UX FIX: Removed extreme padding (pr-12 -> pr-2) and expanded bubble width (max-w-[85%] -> max-w-[95%]) to fix squeezed text.
                        groupHTML += `
                            <div class="flex flex-col items-start mb-1.5 pr-2 sm:pr-4">
                                <div class="flex flex-col bg-gray-100 dark:bg-gray-800/80 text-gray-900 dark:text-gray-100 pt-1.5 pb-2 px-3 rounded-2xl rounded-tl-sm shadow-sm border border-gray-200 dark:border-gray-700 text-sm leading-relaxed text-left w-fit max-w-[95%] sm:max-w-[90%] relative">
                                    ${integratedHeaderHtml}
                                    ${quoteBlockHtml}
                                    <div>${rawText}</div>
                                    ${attachmentHtml}
                                    <div class="text-[9px] text-gray-500 font-mono mt-1 opacity-80 self-end ml-3">
                                        ${dateStr}
                                    </div>
                                </div>
                            </div>
                        `;
                } });
                // Bottom Action Bar — Resolve // Reply only (Escalate/Ban/Export live in More Options)
                const actionHtml = isInbox 
                    ? `<div class="flex space-x-2 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
                         <button class="flex-1 text-green-600 dark:text-green-400 hover:text-white hover:bg-green-600 text-[10px] font-bold bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-2 rounded-lg transition-colors focus:outline-none uppercase tracking-wide shadow-sm" onclick="Admin.resolveFeedback('${unresolvedIds}')">Resolve</button>
                         ${did !== 'Anonymous / Legacy' ? `<button class="flex-1 text-blue-600 dark:text-blue-400 hover:text-white hover:bg-blue-600 text-[10px] font-bold bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 rounded-lg transition-colors focus:outline-none uppercase tracking-wide shadow-sm" onclick="Admin.openReplyModal('${feedbackId}', '${did}')">Reply</button>` : ''}
                       </div>`
                    : `<div class="flex justify-between items-center w-full mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
                         <span class="text-[9px] font-bold text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded uppercase tracking-wider">Archived Thread</span>
                         <div class="flex space-x-2">
                             <button class="text-blue-600 hover:text-white hover:bg-blue-600 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors focus:outline-none uppercase tracking-wide border border-blue-200 shadow-sm" onclick="Admin.restoreFeedback('${feedbackId}')">Restore</button>
                             <button class="text-red-600 hover:text-white hover:bg-red-600 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors focus:outline-none uppercase tracking-wide border border-red-200 shadow-sm" onclick="Admin.deleteFeedback('${feedbackId}', '${did}')">Delete</button>
                         </div>
                       </div>`;

                groupHTML += `
                        </div>
                        ${actionHtml}
                    </div>
                `;
                groupCard.innerHTML = groupHTML;
                listContainer.appendChild(groupCard);
            });

            // GUARDIAN PHASE 1: The Auto-Collapse "Accordion Rule" & Delegated Listener
            listContainer.onclick = (e) => {
                // More Options dropdown
                const moreToggle = e.target.closest('[data-fb-more-toggle]');
                if (moreToggle && listContainer.contains(moreToggle)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const wrap = moreToggle.closest('[data-fb-more-wrap]');
                    const menu = wrap?.querySelector('[data-fb-more-menu]');
                    listContainer.querySelectorAll('[data-fb-more-menu]').forEach((m) => {
                        if (m !== menu) m.classList.add('hidden');
                    });
                    menu?.classList.toggle('hidden');
                    return;
                }
                if (e.target.closest('[data-fb-more-menu]')) {
                    // Close after choosing an action (Export / Escalate / Ban)
                    e.target.closest('[data-fb-more-menu]')?.classList.add('hidden');
                } else if (!e.target.closest('[data-fb-more-wrap]')) {
                    listContainer.querySelectorAll('[data-fb-more-menu]').forEach((m) => m.classList.add('hidden'));
                }

                // WhatsApp quote chip — data-* attrs (no fragile inline onclick)
                const quoteBtn = e.target.closest('[data-fb-quote-jump]');
                if (quoteBtn && listContainer.contains(quoteBtn)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const alertId = quoteBtn.getAttribute('data-alert-id') || '';
                    const alertFallback = quoteBtn.getAttribute('data-alert-fallback') || '';
                    if (alertId || alertFallback) {
                        Admin.viewContextAlert(alertId || null, alertFallback);
                    } else {
                        const threadBody = quoteBtn.closest('.feedback-thread-body');
                        Admin.jumpToQuotedFeedback(
                            quoteBtn.getAttribute('data-reply-key') || null,
                            quoteBtn.getAttribute('data-reply-snippet') || '',
                            threadBody || listContainer
                        );
                    }
                    return;
                }

                const header = e.target.closest('.feedback-group-header');
                if (!header) return;

                // Protect inline actions (like Export AI Thread or Edit Alias)
                if (e.target.closest('button') && !e.target.closest('button').classList.contains('pointer-events-none')) {
                    return;
                }

                const body = header.nextElementSibling;
                if (!body || !body.classList.contains('feedback-thread-body')) return;

                const isOpening = body.classList.contains('hidden');
                
                // Close all other open threads
                const allHeaders = listContainer.querySelectorAll('.feedback-group-header');
                const allBodies = listContainer.querySelectorAll('.feedback-thread-body');

                allBodies.forEach((b, idx) => {
                    const h = allHeaders[idx];
                    if (b !== body) {
                        b.classList.add('hidden');
                        h.classList.remove('border-gray-200', 'dark:border-gray-700');
                        h.classList.add('border-transparent');
                        const chevron = h.querySelector('.chevron-icon');
                        if (chevron) chevron.classList.remove('rotate-180');
                    }
                });

                // Toggle the selected thread
                if (isOpening) {
                    body.classList.remove('hidden');
                    header.classList.add('border-gray-200', 'dark:border-gray-700');
                    header.classList.remove('border-transparent');
                    const chevron = header.querySelector('.chevron-icon');
                    if (chevron) chevron.classList.add('rotate-180');
                    
                    // Smoothly scroll the opened thread into view to reduce manual scrolling
                    setTimeout(() => { header.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
                } else {
                    body.classList.add('hidden');
                    header.classList.remove('border-gray-200', 'dark:border-gray-700');
                    header.classList.add('border-transparent');
                    const chevron = header.querySelector('.chevron-icon');
                    if (chevron) chevron.classList.remove('rotate-180');
                }
            };
        };

        Admin.fetchFeedback = async () => {
            const secret = await Admin.getAuthKey();
            if (!secret) return;

            // GUARDIAN PHASE 11 & 12: Mark as seen instantly in Firebase (Cross-Device Sync) AND Local Storage
            try {
                safeStorage.setItem('fb_last_checked', Date.now().toString());
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                fetch(`${dynamicEndpoint}admin_state/${Admin.currentUser.uid}/fb_last_checked.json?auth=${secret}`, { method: 'PUT', body: JSON.stringify(Date.now()) });
            } catch(e){}
            const badge = document.getElementById('fb-unread-badge');
            if (badge) badge.classList.add('hidden');

            listContainer.innerHTML = '<div class="text-xs text-gray-500 italic text-center py-4">Synchronizing database...</div>';
            if (tabInbox) tabInbox.innerHTML = "Syncing...";
            if (tabArchive) tabArchive.innerHTML = "Syncing...";

            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                
                // Fetch Commuter Messages AND Admin Sent Messages concurrently
                const [res, inboxRes, aliasesRes] = await Promise.all([
                    window.guardianFetch(`${dynamicEndpoint}feedback.json?auth=${secret}`, {}, 10000),
                    window.guardianFetch(`${dynamicEndpoint}inbox.json?auth=${secret}`, {}, 10000),
                    window.guardianFetch(`${dynamicEndpoint}admin_state/aliases.json?auth=${secret}`, {}, 10000)
                ]);
                
                if (!res.ok) throw new Error("Failed to fetch feedback");
                const data = await res.json();
                const inboxData = inboxRes.ok ? await inboxRes.json() : {};
                Admin.cachedAliases = aliasesRes.ok ? (await aliasesRes.json()) || {} : {};

                let mergedData = (data && typeof data === 'object') ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];

                // Fold Admin Replies into the Thread Matrix
                if (inboxData && typeof inboxData === 'object') {
                    Object.keys(inboxData).forEach(deviceId => {
                        const deviceMessages = inboxData[deviceId];
                        Object.keys(deviceMessages).forEach(msgKey => {
                            const msg = deviceMessages[msgKey];
                            let parentStatus = 'unread';
                            // Inherit the archive status of the parent ticket so threads collapse together
                            if (msg.feedbackId && data && data[msg.feedbackId]) {
                                parentStatus = data[msg.feedbackId].status || 'unread';
                            }
                            mergedData.push({
                                id: msgKey,
                                device_id: deviceId, // For Grouping
                                isFromAdmin: true,
                                text: msg.message,
                                timestamp: msg.timestamp,
                                status: parentStatus,
                                read: msg.read,
                                delivered: msg.delivered,
                                acknowledged: msg.acknowledged
                            });
                        });
                    });
                }

                Admin.cachedFeedbackData = mergedData;
                Admin.cachedFeedbackData.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

                Admin.renderFeedbackList();

            } catch (e) {
                console.error(e);
                listContainer.innerHTML = '<div class="text-xs text-red-500 text-center py-4">Failed to load feedback.</div>';
                if (tabInbox) tabInbox.innerHTML = "Error";
                if (tabArchive) tabArchive.innerHTML = "Error";
            }
        };

        // GUARDIAN: The Archive Protocol (Thread-Aware)
        Admin.resolveFeedback = async (ids, skipConfirm = false) => {
            if (!skipConfirm) {
                const confirmed = await Admin.secureConfirm("Resolve Thread", "Mark all active messages in this thread as resolved and sweep to the Archive?");
                if (!confirmed) return;
            }
            
            const secret = await Admin.getAuthKey();
            if (!secret) return;

            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                
                const idArray = ids.split(',').filter(Boolean);
                const payload = { status: 'resolved', resolvedAt: Date.now() };
                
                // Bulk patch all unresolved messages in the thread
                const promises = idArray.map(id => 
                    fetch(`${dynamicEndpoint}feedback/${id}.json?auth=${secret}`, {
                        method: 'PATCH',
                        body: JSON.stringify(payload)
                    })
                );

                await Promise.all(promises);

                if (!skipConfirm && typeof showToast === 'function') showToast("Thread resolved and archived!", "success");
                Admin.fetchFeedback(); 
            } catch (e) {
                if (typeof showToast === 'function') showToast("Error resolving thread.", "error");
            }
        };

        // GUARDIAN PHASE 11: Restore from Archive
        Admin.restoreFeedback = async (id) => {
            const secret = await Admin.getAuthKey();
            if (!secret) return;
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                await fetch(`${dynamicEndpoint}feedback/${id}.json?auth=${secret}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: 'unread', resolvedAt: null })
                });
                if (typeof showToast === 'function') showToast("Restored to Inbox", "success");
                Admin.fetchFeedback();
            } catch (e) {
                if (typeof showToast === 'function') showToast("Error restoring feedback.", "error");
            }
        };

        // GUARDIAN PHASE 11: Permanent Feed Deletion (Cascading Thread Wipe)
        Admin.deleteFeedback = async (feedbackId, deviceId) => {
            const confirmed = await Admin.secureConfirm("Delete Thread", "Permanently delete this entire feedback thread and all admin replies?");
            if (!confirmed) return;
            const secret = await Admin.getAuthKey();
            if (!secret) return;
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                
                const promises = [];
                // 1. Sweep and delete all commuter tickets tied to this device
                if (deviceId && deviceId !== 'Anonymous / Legacy') {
                    const related = Admin.cachedFeedbackData.filter(f => !f.isFromAdmin && (f.device_id === deviceId || f.deviceId === deviceId));
                    related.forEach(f => {
                        promises.push(fetch(`${dynamicEndpoint}feedback/${f.id}.json?auth=${secret}`, { method: 'DELETE' }));
                    });
                    // 2. Cascade delete the orphaned inbox node
                    promises.push(fetch(`${dynamicEndpoint}inbox/${deviceId}.json?auth=${secret}`, { method: 'DELETE' }));
                } else {
                    // Fallback for legacy anonymous tickets
                    promises.push(fetch(`${dynamicEndpoint}feedback/${feedbackId}.json?auth=${secret}`, { method: 'DELETE' }));
                }
                
                await Promise.all(promises);

                if (typeof showToast === 'function') showToast("Thread deleted.", "success");
                Admin.fetchFeedback();
            } catch (e) {
                if (typeof showToast === 'function') showToast("Error deleting thread.", "error");
            }
        };

        // GUARDIAN PHASE 13: Admin Address Book (Commuter Aliases)
        Admin.setCommuterAlias = async (deviceId, currentAlias) => {
            // Prefill with existing alias, else the full Next Train ID so admin can
            // copy/edit/clear it instead of starting from a blank field.
            const initial = (currentAlias && String(currentAlias).trim()) ? String(currentAlias) : String(deviceId || '');
            const newName = prompt(
                `Set a friendly alias for this commuter.\n\nThe field starts with their Next Train ID - delete it to type a name, or copy it for bans.\nLeave blank to remove any alias.`,
                initial
            );
            if (newName === null) return; // Action cancelled by user
            
            const secret = await Admin.getAuthKey();
            if (!secret) return;

            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const trimmed = newName.trim();
                // Saving the raw device ID as "alias" is pointless - treat as no alias
                if (trimmed === '' || trimmed === deviceId) {
                    await fetch(`${dynamicEndpoint}admin_state/aliases/${deviceId}.json?auth=${secret}`, { method: 'DELETE' });
                    if (Admin.cachedAliases) delete Admin.cachedAliases[deviceId];
                    if (typeof showToast === 'function') showToast(trimmed === deviceId ? "Kept ID only (no alias)." : "Alias removed.", "info");
                } else {
                    await fetch(`${dynamicEndpoint}admin_state/aliases/${deviceId}.json?auth=${secret}`, { 
                        method: 'PUT', 
                        body: JSON.stringify(trimmed) 
                    });
                    if (!Admin.cachedAliases) Admin.cachedAliases = {};
                    Admin.cachedAliases[deviceId] = trimmed;
                    if (typeof showToast === 'function') showToast("Alias saved!", "success");
                }
                
                // Re-render local RAM state instantly so the UI updates
                Admin.renderFeedbackList(); 
            } catch (e) {
                if (typeof showToast === 'function') showToast("Error saving alias.", "error");
            }
        };

        // GUARDIAN PHASE 6: AI Thread Exporter (.txt Blob Generator)
        Admin.exportThreadForAI = (did) => {
            const items = Admin.cachedFeedbackData.filter(i => (i.device_id === did || i.deviceId === did || (did === 'Anonymous / Legacy' && !i.device_id && !i.deviceId)));
            items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            
            let txt = `METRORAIL NEXT TRAIN - COMMUTER THREAD EXPORT\n`;
            txt += `Device ID: ${did}\n`;
            txt += `Alias: ${(Admin.cachedAliases && Admin.cachedAliases[did]) ? Admin.cachedAliases[did] : 'None'}\n`;
            txt += `Exported: ${Admin.formatDate(Date.now())}\n`;
            txt += `--------------------------------------------------\n\n`;
            
            items.forEach(i => {
                const dateStr = Admin.formatDate(i.timestamp || Date.now());
                const sender = i.isFromAdmin ? "ADMIN" : "COMMUTER";
                
                // Revert <br> to newline and securely strip HTML tags
                let cleanText = i.text || "No content";
                cleanText = cleanText.replace(/<br\s*\/?>/gi, '\n');
                cleanText = cleanText.replace(/<[^>]+>/g, ''); 
                // Decode HTML entities
                cleanText = cleanText.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                
                txt += `[${dateStr}] ${sender}:\n${cleanText}\n\n`;
            });
            
            const ok = Admin.downloadFile(
                `NextTrain_Thread_${did.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8)}_${Date.now()}.txt`,
                txt
            );
            if (ok && typeof showToast === 'function') showToast("Downloaded thread (.txt)", "success");
        };

        // GROWTH SPRINT PHASE 11: Global AI Thread Exporter (.txt Blob Generator)
        Admin.exportGlobalThreadsForAI = () => {
            const isInbox = Admin.currentFeedbackTab === 'inbox';
            
            // 1. Group ALL data globally by deviceId FIRST
            const groups = {};
            Admin.cachedFeedbackData.forEach(item => {
                const did = item.device_id || item.deviceId || 'Anonymous / Legacy';
                if (!groups[did]) groups[did] = [];
                groups[did].push(item);
            });

            // 2. Filter groups based on Tab and Live Search (Matching visual render state)
            const displayGroups = [];
            const searchInputEl = document.getElementById('fb-search-input');
            const searchQuery = searchInputEl ? searchInputEl.value.toLowerCase().trim() : "";

            Object.keys(groups).forEach(did => {
                const groupItems = groups[did];
                groupItems.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                const isThreadActive = groupItems.some(i => !i.isFromAdmin && i.status !== 'resolved');
                
                let matchesSearch = true;
                if (searchQuery) {
                    const alias = (Admin.cachedAliases && Admin.cachedAliases[did]) ? Admin.cachedAliases[did].toLowerCase() : "";
                    const didLower = did.toLowerCase();
                    const hasMatchingMsg = groupItems.some(i => i.text && i.text.toLowerCase().includes(searchQuery) || (i.email && i.email.toLowerCase().includes(searchQuery)));
                    matchesSearch = alias.includes(searchQuery) || didLower.includes(searchQuery) || hasMatchingMsg;
                }
                
                if (matchesSearch) {
                    if (isInbox && isThreadActive) displayGroups.push({ did, items: groupItems });
                    if (!isInbox && !isThreadActive) displayGroups.push({ did, items: groupItems });
                }
            });
            
            if (displayGroups.length === 0) {
                if (typeof showToast === 'function') showToast("No threads available to export.", "warning");
                return;
            }

            // 3. Sort threads (newest on top)
            displayGroups.sort((a, b) => {
                const lastA = a.items[a.items.length - 1].timestamp || 0;
                const lastB = b.items[b.items.length - 1].timestamp || 0;
                return lastB - lastA;
            });

            let txt = `METRORAIL NEXT TRAIN - GLOBAL THREAD EXPORT (${isInbox ? 'INBOX' : 'ARCHIVE'})\n`;
            txt += `Exported: ${Admin.formatDate(Date.now())}\n`;
            txt += `Total Threads: ${displayGroups.length}\n`;
            txt += `==================================================\n\n`;

            displayGroups.forEach((group, index) => {
                const did = group.did;
                const items = group.items;
                const alias = (Admin.cachedAliases && Admin.cachedAliases[did]) ? Admin.cachedAliases[did] : 'None';
                
                txt += `THREAD ${index + 1} OF ${displayGroups.length}\n`;
                txt += `Device ID: ${did}\n`;
                txt += `Alias: ${alias}\n`;
                txt += `--------------------------------------------------\n`;
                
                items.forEach(i => {
                    const dateStr = Admin.formatDate(i.timestamp || Date.now());
                    const sender = i.isFromAdmin ? "ADMIN" : "COMMUTER";
                    
                    let cleanText = i.text || "No content";
                    cleanText = cleanText.replace(/<br\s*\/?>/gi, '\n');
                    cleanText = cleanText.replace(/<[^>]+>/g, ''); 
                    cleanText = cleanText.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                    
                    txt += `[${dateStr}] ${sender}:\n${cleanText}\n\n`;
                });
                
                txt += `==================================================\n\n`;
            });

            const ok = Admin.downloadFile(
                `NextTrain_Global_${isInbox ? 'Inbox' : 'Archive'}_${Date.now()}.txt`,
                txt
            );
            if (ok && typeof showToast === 'function') showToast(`Downloaded ${displayGroups.length} threads`, "success");
        };
    },

    // --- PHASE 5: DELAY / ISSUE REPORTS (CRUDE OPS INBOX) ---
    setupDelayReportsManager: () => {
        const alertPanel = document.getElementById('alert-panel');
        if (!alertPanel || !alertPanel.parentNode) return;

        let drPanel = document.getElementById('delay-reports-panel');
        if (!drPanel) {
            drPanel = document.createElement('div');
            drPanel.id = 'delay-reports-panel';
            const fb = document.getElementById('feedback-panel');
            if (fb && fb.parentNode) fb.parentNode.insertBefore(drPanel, fb.nextSibling);
            else alertPanel.parentNode.insertBefore(drPanel, alertPanel);
        }
        if (drPanel.dataset.adminLoaded === 'true') return;
        drPanel.dataset.adminLoaded = 'true';

        drPanel.className = 'bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300';
        drPanel.innerHTML = `
            <div id="dr-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative cursor-pointer">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('alert', 'text-amber-500 dark:text-amber-400')}
                    <span>Delay Reports</span>
                </span>
                <span id="dr-unread-badge" class="admin-unread-badge admin-unread-badge--amber hidden" aria-label="Unread delay reports"></span>
                <svg id="dr-chevron" class="absolute right-3 w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            <div id="dr-body" class="hidden mt-4 flex flex-col">
                <div class="grid-hidden-actions flex space-x-2 mb-3 px-1">
                    <button type="button" id="dr-refresh-btn" class="flex-1 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors shadow-sm focus:outline-none">Refresh</button>
                </div>
                <div id="dr-list" class="space-y-2 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar"></div>
            </div>
        `;

        const header = document.getElementById('dr-header-btn');
        const body = document.getElementById('dr-body');
        const chevron = document.getElementById('dr-chevron');
        const refreshBtn = document.getElementById('dr-refresh-btn');

        header.onclick = () => {
            if (Admin.isGridMode) return;
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
                Admin.fetchDelayReports();
            }
        };
        refreshBtn.onclick = () => Admin.fetchDelayReports();

        Admin.fetchDelayReports = async () => {
            const list = document.getElementById('dr-list');
            if (!list) return;
            list.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Loading...</p>';
            try {
                const secret = await Admin.getAuthKey();
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const authQ = secret ? `?auth=${secret}` : '';
                const res = await window.guardianFetch(`${dynamicEndpoint}delay_reports.json${authQ}`, {}, 8000);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const items = data
                    ? Object.entries(data).map(([key, v]) => ({ ...v, _key: key })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                    : [];
                Admin.cachedDelayReports = items;

                if (typeof safeStorage !== 'undefined') {
                    safeStorage.setItem('dr_last_checked', String(Date.now()));
                }
                try {
                    const stateUrl = `${dynamicEndpoint}admin_state/${Admin.currentUser.uid}/dr_last_checked.json?auth=${secret}`;
                    await fetch(stateUrl, { method: 'PUT', body: JSON.stringify(Date.now()) });
                } catch (e) { /* optional */ }

                const badge = document.getElementById('dr-unread-badge');
                if (badge) badge.classList.add('hidden');

                if (!items.length) {
                    list.innerHTML = '<p class="text-xs text-gray-400 text-center py-6">No delay reports yet.</p>';
                    return;
                }

                const routeName = (id) => {
                    try {
                        if (typeof ROUTES !== 'undefined' && ROUTES[id]) return ROUTES[id].name || id;
                    } catch (e) {}
                    return id || 'Unknown route';
                };

                list.innerHTML = items.slice(0, 80).map((r) => {
                    const when = r.timestamp ? new Date(r.timestamp).toLocaleString() : '-';
                    const sev = (r.severity || 'moderate').toUpperCase();
                    const sevColor = r.severity === 'severe' ? 'text-red-600 dark:text-red-400' : (r.severity === 'minor' ? 'text-yellow-700 dark:text-yellow-400' : 'text-amber-700 dark:text-amber-400');
                    const status = r.status || 'open';
                    const note = r.note ? String(r.note).replace(/</g, '&lt;').replace(/>/g, '&gt;') : '<span class="italic text-gray-400">No note</span>';
                    const who = r.isGuest ? `guest - ${(r.deviceId || '').slice(0, 8)}` : `uid - ${(r.uid || '').slice(0, 10)}`;
                    const closedCls = status === 'closed' ? 'opacity-50' : '';
                    return `
                        <div class="border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-left ${closedCls}" data-report-id="${r.reportId || r._key}">
                            <div class="flex justify-between items-start gap-2 mb-1">
                                <div class="min-w-0">
                                    <p class="text-xs font-black text-gray-900 dark:text-white truncate">${routeName(r.routeId)}</p>
                                    <p class="text-[10px] font-bold ${sevColor}">${sev} - ${status} - ${r.source || 'app'}</p>
                                </div>
                                <span class="text-[9px] font-mono text-gray-400 shrink-0">${when}</span>
                            </div>
                            <p class="text-[11px] text-gray-700 dark:text-gray-300 mb-1">${note}</p>
                            <p class="text-[9px] text-gray-400 font-mono mb-2">${who}${r.station ? ` - near ${String(r.station).replace(/</g, '')}` : ''} - ${r.reportId || r._key}${r.verified ? ' - verified' : ''}</p>
                            <div class="flex flex-wrap gap-3">
                            ${status !== 'closed' ? `<button type="button" class="dr-close-btn text-[10px] font-bold text-gray-600 dark:text-gray-300 underline" data-id="${r.reportId || r._key}">Mark closed</button>` : '<span class="text-[10px] text-gray-400">Closed</span>'}
                            ${!r.verified && r.uid ? `<button type="button" class="dr-verify-btn text-[10px] font-bold text-green-700 dark:text-green-400 underline" data-id="${r.reportId || r._key}" data-uid="${r.uid}">Mark verified (+trust)</button>` : (r.verified ? '<span class="text-[10px] text-green-600">Verified</span>' : '')}
                            ${r.uid ? `<button type="button" class="dr-flag-user text-[10px] font-bold text-red-600 dark:text-red-400 underline" data-uid="${r.uid}">Flag user</button>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');

                list.querySelectorAll('.dr-close-btn').forEach((btn) => {
                    btn.onclick = async () => {
                        const id = btn.getAttribute('data-id');
                        if (!id) return;
                        btn.disabled = true;
                        try {
                            const secret2 = await Admin.getAuthKey();
                            const url = `${dynamicEndpoint}delay_reports/${id}/status.json?auth=${secret2}`;
                            const put = await fetch(url, { method: 'PUT', body: JSON.stringify('closed') });
                            if (!put.ok) throw new Error('Failed');
                            if (typeof showToast === 'function') showToast('Report marked closed', 'success');
                            Admin.fetchDelayReports();
                        } catch (e) {
                            if (typeof showToast === 'function') showToast('Could not update report', 'error');
                            btn.disabled = false;
                        }
                    };
                });

                list.querySelectorAll('.dr-verify-btn').forEach((btn) => {
                    btn.onclick = async () => {
                        const id = btn.getAttribute('data-id');
                        const uid = btn.getAttribute('data-uid');
                        if (!id || !uid) return;
                        btn.disabled = true;
                        try {
                            await Admin.verifyDelayReport(id, uid);
                            Admin.fetchDelayReports();
                        } catch (e) {
                            if (typeof showToast === 'function') showToast('Verify failed', 'error');
                            btn.disabled = false;
                        }
                    };
                });

                list.querySelectorAll('.dr-flag-user').forEach((btn) => {
                    btn.onclick = () => Admin.applyShadowBan(btn.getAttribute('data-uid'));
                });
            } catch (e) {
                list.innerHTML = `<p class="text-xs text-red-500 text-center py-4">Failed to load: ${e.message || e}</p>`;
            }
        };
    },

    // --- PHASE 6: COMMUNITY MODERATION QUEUE ---
    setupModerationQueueManager: () => {
        const alertPanel = document.getElementById('alert-panel');
        if (!alertPanel || !alertPanel.parentNode) return;

        let mqPanel = document.getElementById('moderation-queue-panel');
        if (!mqPanel) {
            mqPanel = document.createElement('div');
            mqPanel.id = 'moderation-queue-panel';
            const after = document.getElementById('delay-reports-panel') || document.getElementById('feedback-panel');
            if (after && after.parentNode) after.parentNode.insertBefore(mqPanel, after.nextSibling);
            else alertPanel.parentNode.insertBefore(mqPanel, alertPanel);
        }
        if (mqPanel.dataset.adminLoaded === 'true') return;
        mqPanel.dataset.adminLoaded = 'true';

        mqPanel.className = 'bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300';
        mqPanel.innerHTML = `
            <div id="mq-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative cursor-pointer">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('shield', 'text-emerald-500 dark:text-emerald-400')}
                    <span>Moderation Queue</span>
                </span>
                <span id="mq-unread-badge" class="admin-unread-badge hidden" aria-label="Unread moderation items"></span>
                <svg id="mq-chevron" class="absolute right-3 w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            <div id="mq-body" class="hidden mt-4 flex flex-col">
                <p class="text-[10px] text-gray-500 dark:text-gray-400 mb-3 px-1 leading-snug">Community reports (message / user). Hide posts or shadow-ban without schema rewrites.</p>
                <div class="grid-hidden-actions flex space-x-2 mb-3 px-1">
                    <button type="button" id="mq-refresh-btn" class="flex-1 bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors shadow-sm focus:outline-none">Refresh</button>
                </div>
                <div id="mq-list" class="space-y-2 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar"></div>
            </div>
        `;

        const header = document.getElementById('mq-header-btn');
        const body = document.getElementById('mq-body');
        const chevron = document.getElementById('mq-chevron');
        const refreshBtn = document.getElementById('mq-refresh-btn');

        header.onclick = () => {
            if (Admin.isGridMode) return;
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
                Admin.fetchModerationQueue();
            }
        };
        refreshBtn.onclick = () => Admin.fetchModerationQueue();

        Admin.fetchModerationQueue = async () => {
            const list = document.getElementById('mq-list');
            if (!list) return;
            list.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Loading...</p>';
            try {
                const secret = await Admin.getAuthKey();
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const authQ = secret ? `?auth=${secret}` : '';
                const res = await window.guardianFetch(`${dynamicEndpoint}moderation_queue.json${authQ}`, {}, 8000);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const items = data
                    ? Object.entries(data).map(([key, v]) => ({ ...v, _key: key })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                    : [];

                if (typeof safeStorage !== 'undefined') safeStorage.setItem('mq_last_checked', String(Date.now()));
                try {
                    await fetch(`${dynamicEndpoint}admin_state/${Admin.currentUser.uid}/mq_last_checked.json?auth=${secret}`, {
                        method: 'PUT', body: JSON.stringify(Date.now())
                    });
                } catch (e) { /* optional */ }

                const badge = document.getElementById('mq-unread-badge');
                if (badge) badge.classList.add('hidden');

                if (!items.length) {
                    list.innerHTML = '<p class="text-xs text-gray-400 text-center py-6">Queue is empty.</p>';
                    return;
                }

                list.innerHTML = items.slice(0, 100).map((r) => {
                    const when = r.timestamp ? new Date(r.timestamp).toLocaleString() : '-';
                    const type = (r.type || 'message').toUpperCase();
                    const status = r.status || 'open';
                    const snippet = r.snippet ? String(r.snippet).replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
                    const closed = status === 'closed' || status === 'resolved';
                    return `
                        <div class="border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-left ${closed ? 'opacity-50' : ''}" data-mq-id="${r.reportId || r._key}">
                            <div class="flex justify-between gap-2 mb-1">
                                <p class="text-xs font-black text-gray-900 dark:text-white">${type} - ${r.routeId || '-'}</p>
                                <span class="text-[9px] font-mono text-gray-400 shrink-0">${when}</span>
                            </div>
                            <p class="text-[10px] text-gray-500 font-mono mb-1">target uid: ${(r.targetUid || '-').toString().slice(0, 16)} - post: ${(r.targetPostId || '-').toString().slice(0, 18)}</p>
                            ${snippet ? `<p class="text-[11px] text-gray-700 dark:text-gray-300 mb-2">"${snippet}"</p>` : ''}
                            ${closed ? '<span class="text-[10px] text-gray-400">Closed</span>' : `
                            <div class="flex flex-wrap gap-2 mt-1">
                                <button type="button" class="mq-hide-post text-[10px] font-bold text-amber-700 dark:text-amber-400 underline" data-route="${r.routeId || ''}" data-post="${r.targetPostId || ''}">Hide post</button>
                                <button type="button" class="mq-shadow-ban text-[10px] font-bold text-red-600 dark:text-red-400 underline" data-uid="${r.targetUid || ''}">Shadow ban</button>
                                <button type="button" class="mq-close text-[10px] font-bold text-gray-600 dark:text-gray-300 underline" data-id="${r.reportId || r._key}">Close</button>
                            </div>`}
                        </div>`;
                }).join('');

                list.querySelectorAll('.mq-close').forEach((btn) => {
                    btn.onclick = async () => {
                        const id = btn.getAttribute('data-id');
                        if (!id) return;
                        btn.disabled = true;
                        try {
                            const s = await Admin.getAuthKey();
                            const put = await fetch(`${dynamicEndpoint}moderation_queue/${id}/status.json?auth=${s}`, {
                                method: 'PUT', body: JSON.stringify('closed')
                            });
                            if (!put.ok) throw new Error('fail');
                            if (typeof showToast === 'function') showToast('Report closed', 'success');
                            Admin.fetchModerationQueue();
                        } catch (e) {
                            if (typeof showToast === 'function') showToast('Could not close', 'error');
                            btn.disabled = false;
                        }
                    };
                });

                list.querySelectorAll('.mq-hide-post').forEach((btn) => {
                    btn.onclick = async () => {
                        const routeId = btn.getAttribute('data-route');
                        const postId = btn.getAttribute('data-post');
                        if (!routeId || !postId) {
                            if (typeof showToast === 'function') showToast('Missing route/post id', 'error');
                            return;
                        }
                        btn.disabled = true;
                        try {
                            const s = await Admin.getAuthKey();
                            const put = await fetch(`${dynamicEndpoint}route_community/${routeId}/posts/${postId}/hidden.json?auth=${s}`, {
                                method: 'PUT', body: JSON.stringify(true)
                            });
                            if (!put.ok) throw new Error('fail');
                            if (typeof showToast === 'function') showToast('Post hidden', 'success');
                        } catch (e) {
                            if (typeof showToast === 'function') showToast('Hide failed', 'error');
                            btn.disabled = false;
                        }
                    };
                });

                list.querySelectorAll('.mq-shadow-ban').forEach((btn) => {
                    btn.onclick = async () => {
                        const uid = btn.getAttribute('data-uid');
                        const mqId = btn.closest('[data-mq-id]')?.getAttribute('data-mq-id');
                        const ok = await Admin.applyShadowBan(uid);
                        if (ok && mqId) {
                            try {
                                const s = await Admin.getAuthKey();
                                await fetch(`${dynamicEndpoint}moderation_queue/${mqId}/status.json?auth=${s}`, {
                                    method: 'PUT', body: JSON.stringify('closed')
                                });
                                Admin.fetchModerationQueue();
                            } catch (e) { /* optional */ }
                        }
                    };
                });
            } catch (e) {
                list.innerHTML = `<p class="text-xs text-red-500 text-center py-4">Failed to load: ${e.message || e}</p>`;
            }
        };
    },

    /** Phase 7 - timed shadow ban with duration picker. opts.deviceId also writes devices/{id}/flags. */
    applyShadowBan: async (uid, opts = {}) => {
        if (!uid) {
            if (typeof showToast === 'function') showToast('No target uid', 'error');
            return false;
        }
        const deviceId = opts.deviceId || (/^usr_/i.test(uid) ? uid : null);
        const durations = (typeof SHADOW_BAN_DURATIONS !== 'undefined' && SHADOW_BAN_DURATIONS)
            ? SHADOW_BAN_DURATIONS
            : [
                { label: '1 hour', ms: 3600000 },
                { label: '6 hours', ms: 21600000 },
                { label: '24 hours', ms: 86400000 },
                { label: '7 days', ms: 604800000 },
                { label: '30 days', ms: 2592000000 },
                { label: 'Permanent', ms: 0 },
            ];

        const banModes = (typeof SHADOW_BAN_MODES !== 'undefined' && Array.isArray(SHADOW_BAN_MODES) && SHADOW_BAN_MODES.length)
            ? SHADOW_BAN_MODES
            : [
                { id: 'offline', label: 'Fake offline / lie-fi' },
                { id: 'freeze', label: 'Freeze / unresponsive' },
                { id: 'fouc', label: 'True FOUC (unstyled)' },
                { id: 'lost', label: '404 / End of the Line' },
            ];

        const choice = await new Promise((resolve) => {
            const modalId = 'admin-shadow-ban-modal';
            let modal = document.getElementById(modalId);
            if (!modal) {
                modal = document.createElement('div');
                modal.id = modalId;
                modal.className = 'fixed inset-0 bg-black/80 z-[210] hidden flex items-center justify-center p-4 backdrop-blur-sm';
                document.body.appendChild(modal);
            }
            modal.innerHTML = `
                <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-5 border border-gray-200 dark:border-gray-700">
                    <h3 class="text-base font-black text-gray-900 dark:text-white mb-1">Shadow ban user</h3>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400 mb-3 font-mono break-all">${uid}</p>
                    <label class="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Duration</label>
                    <select id="admin-ban-duration" class="w-full p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-sm mb-3">
                        ${durations.map((d, i) => `<option value="${i}" ${d.ms === 86400000 ? 'selected' : ''}>${d.label}</option>`).join('')}
                    </select>
                    <label class="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Ban experience</label>
                    <select id="admin-ban-mode" class="w-full p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-sm mb-2">
                        ${banModes.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}
                    </select>
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 mb-4 leading-snug">Never told they are banned. Offline = lie-fi. Freeze = no taps. FOUC = unstyled HTML. 404 = End of the Line page on every return home.</p>
                    <div class="flex gap-2">
                        <button type="button" id="admin-ban-cancel" class="flex-1 py-2.5 rounded-xl bg-gray-200 dark:bg-gray-700 text-sm font-bold">Cancel</button>
                        <button type="button" id="admin-ban-confirm" class="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold">Ban</button>
                    </div>
                </div>`;
            modal.classList.remove('hidden');
            // Prefill from System Controls default when available
            const defaultModeEl = document.getElementById('shadow-ban-default-mode');
            const banModeEl = document.getElementById('admin-ban-mode');
            if (banModeEl && defaultModeEl?.value) {
                const preferred = (typeof trustNormalizeShadowBanMode === 'function')
                    ? trustNormalizeShadowBanMode(defaultModeEl.value)
                    : defaultModeEl.value;
                if ([...banModeEl.options].some((o) => o.value === preferred)) banModeEl.value = preferred;
            }
            document.getElementById('admin-ban-cancel').onclick = () => { modal.classList.add('hidden'); resolve(null); };
            document.getElementById('admin-ban-confirm').onclick = () => {
                const idx = parseInt(document.getElementById('admin-ban-duration').value, 10) || 0;
                const modeEl = document.getElementById('admin-ban-mode');
                const mode = (typeof trustNormalizeShadowBanMode === 'function')
                    ? trustNormalizeShadowBanMode(modeEl?.value)
                    : (modeEl?.value || 'offline');
                modal.classList.add('hidden');
                const duration = durations[idx] || durations[durations.length - 1];
                resolve({ ...duration, mode });
            };
        });
        if (!choice) return false;

        const modeLabel = banModes.find((m) => m.id === choice.mode)?.label || choice.mode;
        const confirmed = await Admin.secureConfirm(
            'Confirm shadow ban',
            `Ban ${uid} for ${choice.label} with "${modeLabel}"? They won't be told they're banned.`
        );
        if (!confirmed) return false;

        try {
            const secret = await Admin.getAuthKey();
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            const until = (typeof trustComputeBanUntil === 'function')
                ? trustComputeBanUntil(choice.ms)
                : (choice.ms > 0 ? Date.now() + choice.ms : 0);
            const now = Date.now();
            const banMode = (typeof trustNormalizeShadowBanMode === 'function')
                ? trustNormalizeShadowBanMode(choice.mode)
                : (choice.mode || 'offline');
            const putFlag = async (basePath) => {
                const paths = [
                    [`${basePath}/shadowBanned.json`, true],
                    [`${basePath}/shadowBannedUntil.json`, until],
                    [`${basePath}/shadowBannedAt.json`, now],
                    [`${basePath}/shadowBanMode.json`, banMode],
                ];
                if (Admin.currentUser?.uid) {
                    paths.push([`${basePath}/shadowBannedBy.json`, Admin.currentUser.uid]);
                }
                for (const [path, body] of paths) {
                    const res = await fetch(`${dynamicEndpoint}${path}?auth=${secret}`, {
                        method: 'PUT',
                        body: JSON.stringify(body)
                    });
                    if (!res.ok) {
                        throw new Error(`Ban write failed (${res.status}) at ${path}`);
                    }
                }
            };
            // Always write users/{uid}/flags (works for Firebase uid OR device-id stub keys)
            await putFlag(`users/${encodeURIComponent(uid)}/flags`);
            // Also stamp device path so guest devices are blocked even before account link
            if (deviceId) {
                await putFlag(`devices/${encodeURIComponent(deviceId)}/flags`);
                const banAtRes = await fetch(`${dynamicEndpoint}devices/${encodeURIComponent(deviceId)}/bannedAt.json?auth=${secret}`, {
                    method: 'PUT',
                    body: JSON.stringify(now)
                });
                if (!banAtRes.ok) throw new Error(`Ban write failed (${banAtRes.status}) at devices/.../bannedAt`);
            }
            if (typeof window.trustAddToBlockList === 'function') {
                window.trustAddToBlockList(uid);
                if (deviceId) window.trustAddToBlockList(deviceId);
            } else if (window.trustLocalBlockList) {
                window.trustLocalBlockList.add(uid);
                if (deviceId) window.trustLocalBlockList.add(deviceId);
            }
            if (typeof showToast === 'function') showToast(`Shadow-banned (${choice.label}) - mode: ${modeLabel}`, 'success');
            if (typeof Admin.fetchActiveBans === 'function') Admin.fetchActiveBans();
            return true;
        } catch (e) {
            console.error('Shadow ban failed', e);
            if (typeof showToast === 'function') showToast(e?.message || 'Shadow ban failed', 'error');
            return false;
        }
    },

    liftShadowBan: async (uid, opts = {}) => {
        if (!uid) return false;
        const deviceId = opts.deviceId || (/^usr_/i.test(uid) ? uid : null);
        const confirmed = await Admin.secureConfirm('Lift shadow ban', `Restore posting for ${uid.slice(0, 12)}-?`);
        if (!confirmed) return false;
        try {
            const secret = await Admin.getAuthKey();
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            const clearFlag = async (basePath) => {
                for (const [path, body] of [
                    [`${basePath}/shadowBanned.json`, false],
                    [`${basePath}/shadowBannedUntil.json`, 0],
                    [`${basePath}/shadowBanMode.json`, 'offline'],
                ]) {
                    const res = await fetch(`${dynamicEndpoint}${path}?auth=${secret}`, {
                        method: 'PUT',
                        body: JSON.stringify(body)
                    });
                    if (!res.ok) throw new Error(`Lift ban failed (${res.status})`);
                }
            };
            await clearFlag(`users/${encodeURIComponent(uid)}/flags`);
            if (deviceId) await clearFlag(`devices/${encodeURIComponent(deviceId)}/flags`);
            if (typeof window.trustRemoveFromBlockList === 'function') {
                window.trustRemoveFromBlockList(uid);
                if (deviceId) window.trustRemoveFromBlockList(deviceId);
            }
            if (typeof showToast === 'function') showToast('Ban lifted', 'success');
            if (typeof Admin.fetchActiveBans === 'function') Admin.fetchActiveBans();
            return true;
        } catch (e) {
            if (typeof showToast === 'function') showToast('Lift failed', 'error');
            return false;
        }
    },

    verifyDelayReport: async (reportId, uid) => {
        const secret = await Admin.getAuthKey();
        const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
        const adminUid = Admin.currentUser?.uid || 'admin';
        const now = Date.now();
        await fetch(`${dynamicEndpoint}delay_reports/${reportId}/verified.json?auth=${secret}`, { method: 'PUT', body: JSON.stringify(true) });
        await fetch(`${dynamicEndpoint}delay_reports/${reportId}/verifiedBy.json?auth=${secret}`, { method: 'PUT', body: JSON.stringify(adminUid) });
        await fetch(`${dynamicEndpoint}delay_reports/${reportId}/verifiedAt.json?auth=${secret}`, { method: 'PUT', body: JSON.stringify(now) });
        let score = 0;
        try {
            const sRes = await fetch(`${dynamicEndpoint}users/${uid}/trustScore.json?auth=${secret}`);
            if (sRes.ok) {
                const v = await sRes.json();
                if (typeof v === 'number') score = v;
            }
        } catch (e) {}
        await fetch(`${dynamicEndpoint}users/${uid}/trustScore.json?auth=${secret}`, {
            method: 'PUT', body: JSON.stringify(score + 1)
        });
        if (typeof showToast === 'function') showToast(`Verified - trust score: ${score + 1}`, 'success');
    },

    // --- PHASE 7: USER TRUST / SHADOW-BAN LOOKUP ---
    setupUserTrustManager: () => {
        const alertPanel = document.getElementById('alert-panel');
        if (!alertPanel || !alertPanel.parentNode) return;

        let panel = document.getElementById('user-trust-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'user-trust-panel';
            const after = document.getElementById('moderation-queue-panel') || document.getElementById('delay-reports-panel');
            if (after && after.parentNode) after.parentNode.insertBefore(panel, after.nextSibling);
            else alertPanel.parentNode.insertBefore(panel, alertPanel);
        }
        if (panel.dataset.adminLoaded === 'true') return;
        panel.dataset.adminLoaded = 'true';

        panel.className = 'bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300';
        panel.innerHTML = `
            <div id="ut-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative cursor-pointer">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('user', 'text-indigo-500 dark:text-indigo-400')}
                    <span>User Trust &amp; Bans</span>
                </span>
                <svg id="ut-chevron" class="absolute right-3 w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            <div id="ut-body" class="hidden mt-4 flex flex-col text-left">
                <p class="text-[10px] text-gray-500 dark:text-gray-400 mb-3 px-1 leading-snug">Ban list and lookup stay separate - switch tabs below.</p>
                <div class="flex gap-1 p-1 mb-3 rounded-xl bg-gray-100 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700" role="tablist" aria-label="User trust sections">
                    <button type="button" id="ut-tab-bans" role="tab" aria-selected="true" class="ut-tab flex-1 text-[10px] font-black uppercase tracking-wider py-2 rounded-lg bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-indigo-200 dark:border-indigo-800">Active bans</button>
                    <button type="button" id="ut-tab-lookup" role="tab" aria-selected="false" class="ut-tab flex-1 text-[10px] font-black uppercase tracking-wider py-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Lookup</button>
                </div>
                <div id="ut-pane-bans" role="tabpanel" class="ut-pane">
                    <div class="flex items-center justify-between gap-2 mb-2 px-1">
                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Active shadow bans</span>
                        <button type="button" id="ut-bans-refresh" class="text-[10px] font-bold text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800">Refresh</button>
                    </div>
                    <div id="ut-bans-list" class="space-y-2 max-h-[320px] overflow-y-auto px-1 custom-scrollbar">
                        <p class="text-xs text-gray-400 text-center py-3">Open panel to load bans...</p>
                    </div>
                </div>
                <div id="ut-pane-lookup" role="tabpanel" class="ut-pane hidden">
                    <div class="flex gap-2 mb-3 px-1">
                        <input type="text" id="ut-uid-input" class="flex-1 p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-xs font-mono" placeholder="UID, device ID (usr_…), or email" />
                        <button type="button" id="ut-lookup-btn" class="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">Lookup</button>
                    </div>
                    <div id="ut-result" class="px-1 text-xs text-gray-500">Enter a UID to inspect.</div>
                </div>
            </div>
        `;

        const header = document.getElementById('ut-header-btn');
        const body = document.getElementById('ut-body');
        const chevron = document.getElementById('ut-chevron');
        const tabBans = document.getElementById('ut-tab-bans');
        const tabLookup = document.getElementById('ut-tab-lookup');
        const paneBans = document.getElementById('ut-pane-bans');
        const paneLookup = document.getElementById('ut-pane-lookup');
        const setUtTab = (which) => {
            const bans = which === 'bans';
            tabBans?.setAttribute('aria-selected', bans ? 'true' : 'false');
            tabLookup?.setAttribute('aria-selected', bans ? 'false' : 'true');
            tabBans?.classList.toggle('bg-white', bans);
            tabBans?.classList.toggle('dark:bg-gray-800', bans);
            tabBans?.classList.toggle('text-indigo-600', bans);
            tabBans?.classList.toggle('dark:text-indigo-400', bans);
            tabBans?.classList.toggle('shadow-sm', bans);
            tabBans?.classList.toggle('border', bans);
            tabBans?.classList.toggle('border-indigo-200', bans);
            tabBans?.classList.toggle('dark:border-indigo-800', bans);
            tabBans?.classList.toggle('text-gray-500', !bans);
            tabLookup?.classList.toggle('bg-white', !bans);
            tabLookup?.classList.toggle('dark:bg-gray-800', !bans);
            tabLookup?.classList.toggle('text-indigo-600', !bans);
            tabLookup?.classList.toggle('dark:text-indigo-400', !bans);
            tabLookup?.classList.toggle('shadow-sm', !bans);
            tabLookup?.classList.toggle('border', !bans);
            tabLookup?.classList.toggle('border-indigo-200', !bans);
            tabLookup?.classList.toggle('dark:border-indigo-800', !bans);
            tabLookup?.classList.toggle('text-gray-500', bans);
            paneBans?.classList.toggle('hidden', !bans);
            paneLookup?.classList.toggle('hidden', bans);
            if (bans) Admin.fetchActiveBans();
        };
        tabBans?.addEventListener('click', () => setUtTab('bans'));
        tabLookup?.addEventListener('click', () => setUtTab('lookup'));
        header.onclick = () => {
            if (Admin.isGridMode) return;
            body.classList.toggle('hidden');
            chevron.classList.toggle('-rotate-90', body.classList.contains('hidden'));
            header.classList.toggle('mb-4', !body.classList.contains('hidden'));
            if (!body.classList.contains('hidden')) setUtTab('bans');
        };

        document.getElementById('ut-lookup-btn').onclick = () => Admin.lookupUserTrust();
        document.getElementById('ut-bans-refresh')?.addEventListener('click', () => Admin.fetchActiveBans());
        document.getElementById('ut-uid-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') Admin.lookupUserTrust();
        });

        const banModeLabel = (mode) => {
            const id = (typeof trustNormalizeShadowBanMode === 'function')
                ? trustNormalizeShadowBanMode(mode)
                : (mode || 'offline');
            const modes = (typeof SHADOW_BAN_MODES !== 'undefined' && Array.isArray(SHADOW_BAN_MODES))
                ? SHADOW_BAN_MODES
                : [
                    { id: 'offline', label: 'Fake offline / lie-fi' },
                    { id: 'freeze', label: 'Freeze / unresponsive' },
                    { id: 'fouc', label: 'True FOUC (unstyled)' },
                    { id: 'lost', label: '404 / End of the Line' },
                ];
            return modes.find((m) => m.id === id)?.label || id;
        };

        Admin.fetchActiveBans = async () => {
            const list = document.getElementById('ut-bans-list');
            if (!list) return;
            list.innerHTML = '<p class="text-xs text-gray-400 text-center py-3 animate-pulse">Scanning bans...</p>';
            try {
                const secret = await Admin.getAuthKey();
                if (!secret) throw new Error('not signed in - open Admin while logged in as an admin account');
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const auth = `?auth=${encodeURIComponent(secret)}`;
                const [usersRes, devicesRes] = await Promise.all([
                    fetch(`${dynamicEndpoint}users.json${auth}`),
                    fetch(`${dynamicEndpoint}devices.json${auth}`),
                ]);
                if (!usersRes.ok) throw new Error(`users HTTP ${usersRes.status}`);
                const users = await usersRes.json() || {};
                const devices = devicesRes.ok ? (await devicesRes.json() || {}) : {};
                const now = Date.now();
                const seen = new Set();
                const bans = [];

                const pushBan = (id, record, source) => {
                    if (!id || seen.has(id)) return;
                    const flags = record?.flags || {};
                    if (flags.shadowBanned !== true) return;
                    const until = Number(flags.shadowBannedUntil || 0);
                    if (until > 0 && now > until) return; // expired
                    seen.add(id);
                    bans.push({
                        id,
                        source,
                        displayName: record.displayName || (source === 'device' ? 'Device guest' : '-'),
                        email: record.email || null,
                        until,
                        bannedAt: Number(flags.shadowBannedAt || 0),
                        mode: flags.shadowBanMode || 'offline',
                        bannedBy: flags.shadowBannedBy || null,
                        deviceId: source === 'device' ? id : null,
                    });
                };

                Object.entries(users).forEach(([uid, u]) => pushBan(uid, u, /^usr_/i.test(uid) ? 'device-stub' : 'user'));
                Object.entries(devices).forEach(([deviceId, d]) => {
                    // Prefer linked account if already listed; else show device-level ban
                    if (d?.uid && seen.has(d.uid)) return;
                    pushBan(deviceId, { flags: d?.flags || {}, displayName: d?.uid ? `Device / ${d.uid}` : 'Device' }, 'device');
                });

                bans.sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));

                if (!bans.length) {
                    list.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No active shadow bans.</p>';
                    return;
                }

                list.innerHTML = '';
                bans.forEach((b) => {
                    const untilStr = b.until > 0 ? new Date(b.until).toLocaleString() : 'Permanent';
                    const remaining = b.until > 0
                        ? (() => {
                            const ms = b.until - now;
                            if (ms <= 0) return 'expired';
                            const h = Math.floor(ms / 3600000);
                            if (h < 48) return `${h}h left`;
                            return `${Math.ceil(h / 24)}d left`;
                        })()
                        : 'no expiry';
                    const modeStr = banModeLabel(b.mode);
                    const name = String(b.displayName || '-').replace(/</g, '&lt;');
                    const email = b.email ? String(b.email).replace(/</g, '&lt;') : '';
                    const card = document.createElement('div');
                    card.className = 'border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/20 rounded-xl p-3 space-y-1';
                    card.innerHTML = `
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <p class="text-xs font-black text-gray-900 dark:text-white truncate">${name}</p>
                                <p class="font-mono text-[9px] text-gray-400 break-all">${b.id}</p>
                                ${email ? `<p class="text-[10px] text-gray-500">${email}</p>` : ''}
                            </div>
                            <button type="button" class="ut-lift-from-list shrink-0 text-[9px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800">Lift</button>
                        </div>
                        <div class="flex flex-wrap gap-1.5 pt-0.5">
                            <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">${modeStr}</span>
                            <span class="text-[9px] font-bold text-gray-600 dark:text-gray-300">${untilStr}</span>
                            <span class="text-[9px] text-gray-400">${remaining}</span>
                        </div>
                    `;
                    card.querySelector('.ut-lift-from-list').onclick = async () => {
                        const deviceId = b.deviceId || (/^usr_/i.test(b.id) ? b.id : null);
                        const ok = await Admin.liftShadowBan(b.id, { deviceId });
                        if (ok) Admin.fetchActiveBans();
                    };
                    list.appendChild(card);
                });
            } catch (e) {
                list.innerHTML = `<p class="text-xs text-red-500 text-center py-3">Failed to load bans: ${e.message || e}</p>`;
            }
        };

        Admin.resolveTrustTarget = async (query) => {
            const q = String(query || '').trim();
            if (!q) return null;
            const secret = await Admin.getAuthKey();
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            const auth = secret ? `?auth=${secret}` : '';

            const fetchJson = async (path) => {
                const res = await fetch(`${dynamicEndpoint}${path}${auth}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            };

            // 1) Direct users/{id}
            let user = await fetchJson(`users/${encodeURIComponent(q)}.json`);
            if (user) {
                return { uid: q, user, via: 'uid', deviceId: null };
            }

            // 2) Device ID ? linked Firebase uid (devices/{deviceId}.uid)
            const looksLikeDevice = /^usr_/i.test(q);
            if (looksLikeDevice) {
                const device = await fetchJson(`devices/${encodeURIComponent(q)}.json`);
                if (device?.uid) {
                    user = await fetchJson(`users/${encodeURIComponent(device.uid)}.json`);
                    if (user) {
                        return { uid: device.uid, user, via: 'device?uid', deviceId: q };
                    }
                }
                // Guest / pre-account: allow banning the device id itself
                const deviceFlags = device?.flags || null;
                return {
                    uid: q,
                    user: {
                        displayName: device?.uid ? `Device linked to ${device.uid}` : 'Device (no account yet)',
                        email: null,
                        trustScore: 0,
                        flags: deviceFlags || { shadowBanned: false, shadowBannedUntil: 0, role: 'device' },
                        deviceIds: { [q]: true },
                        _isDeviceStub: true,
                    },
                    via: 'device',
                    deviceId: q,
                };
            }

            // 3) Email lookup (for future accounts + any already-linked emails)
            if (q.includes('@')) {
                const users = await fetchJson('users.json');
                if (users && typeof users === 'object') {
                    const needle = q.toLowerCase();
                    for (const [uid, u] of Object.entries(users)) {
                        if (u && String(u.email || '').toLowerCase() === needle) {
                            return { uid, user: u, via: 'email', deviceId: null };
                        }
                    }
                }
            }

            return null;
        };

        Admin.lookupUserTrust = async () => {
            const query = (document.getElementById('ut-uid-input')?.value || '').trim();
            const out = document.getElementById('ut-result');
            if (!query || !out) return;
            out.innerHTML = '<p class="animate-pulse text-gray-400">Loading...</p>';
            try {
                const resolved = await Admin.resolveTrustTarget(query);
                if (!resolved) {
                    out.innerHTML = '<p class="text-red-500">Not found. Try a Firebase UID, device ID (<code class="font-mono">usr_…</code>), or account email.</p>';
                    return;
                }
                const { uid, user, via, deviceId } = resolved;
                const flags = user.flags || {};
                const banned = flags.shadowBanned === true;
                const until = Number(flags.shadowBannedUntil || 0);
                const expired = banned && until > 0 && Date.now() > until;
                const untilStr = until > 0 ? new Date(until).toLocaleString() : (banned ? 'permanent' : '-');
                const modeRaw = flags.shadowBanMode || 'offline';
                const modeStr = banModeLabel(modeRaw);
                const score = typeof user.trustScore === 'number' ? user.trustScore : 0;
                const name = (user.displayName || (user._isDeviceStub ? 'Device guest' : '-')).toString().replace(/</g, '&lt;');
                const email = (user.email || '-').toString().replace(/</g, '&lt;');
                const viaLabel = via === 'email' ? 'matched by email' : (via === 'device' ? 'device record' : (via === 'device?uid' ? 'device ? account' : 'user id'));
                out.innerHTML = `
                    <div class="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
                        <p class="font-black text-gray-900 dark:text-white">${name}</p>
                        <p class="font-mono text-[10px] text-gray-400 break-all">${uid}</p>
                        <p class="text-[11px]">Email: <b>${email}</b> - Found via <b>${viaLabel}</b>${deviceId && deviceId !== uid ? ` - device <span class="font-mono">${deviceId}</span>` : ''}</p>
                        <p class="text-[11px]">Role: <b>${flags.role || 'user'}</b> - Trust score: <b>${score}</b></p>
                        <p class="text-[11px]">Shadow banned: <b class="${banned && !expired ? 'text-red-600' : 'text-green-600'}">${banned ? (expired ? 'expired' : 'yes') : 'no'}</b>${banned ? ` - until ${untilStr}` : ''}</p>
                        ${banned && !expired ? `<p class="text-[11px]">Ban type: <b>${modeStr}</b></p>` : ''}
                        <div class="flex flex-wrap gap-3 pt-1">
                            <button type="button" id="ut-ban-btn" class="text-[10px] font-bold text-red-600 underline">Shadow ban</button>
                            <button type="button" id="ut-lift-btn" class="text-[10px] font-bold text-blue-600 underline">Lift ban</button>
                        </div>
                    </div>`;
                document.getElementById('ut-ban-btn').onclick = async () => {
                    await Admin.applyShadowBan(uid, { deviceId: deviceId || (/^usr_/i.test(uid) ? uid : null) });
                    Admin.lookupUserTrust();
                    Admin.fetchActiveBans();
                };
                document.getElementById('ut-lift-btn').onclick = async () => {
                    await Admin.liftShadowBan(uid, { deviceId: deviceId || (/^usr_/i.test(uid) ? uid : null) });
                    Admin.lookupUserTrust();
                    Admin.fetchActiveBans();
                };
            } catch (e) {
                out.innerHTML = `<p class="text-red-500">Lookup failed: ${e.message || e}</p>`;
            }
        };
    },

    // --- GROWTH SPRINT PHASE 8: ADMIN REPLY INBOX PROTOCOL ---
    openReplyModal: (feedbackId, deviceId) => {
        if (!deviceId) {
            if (typeof showToast === 'function') showToast("No device ID linked to this feedback.", "error");
            return;
        }

        const alias = Admin.cachedAliases && Admin.cachedAliases[deviceId] ? Admin.cachedAliases[deviceId] : null;
        const recipientHtml = alias
            ? `<span class="font-bold text-gray-800 dark:text-gray-100">${String(alias).replace(/</g, '&lt;')}</span><span class="text-gray-400 mx-1">-</span><span class="font-mono">${String(deviceId).replace(/</g, '&lt;')}</span>`
            : `<span class="font-mono text-gray-800 dark:text-gray-100">${String(deviceId).replace(/</g, '&lt;')}</span>`;
        
        let modal = document.getElementById('admin-reply-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'admin-reply-modal';
            modal.className = 'fixed inset-0 bg-black/80 z-[200] hidden flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
            modal.innerHTML = `
                <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90dvh] flex flex-col p-4 transform transition-all scale-95 border border-gray-200 dark:border-gray-700">
                    <h3 class="text-lg font-black text-gray-900 dark:text-white mb-0.5 tracking-tight flex items-center gap-2 shrink-0"><span class="text-sky-500">${Admin.icon('message', 'w-5 h-5')}</span> Reply to Commuter</h3>
                    <p id="admin-reply-recipient" class="text-[11px] text-gray-600 dark:text-gray-300 mb-1 break-all leading-snug shrink-0"></p>
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 mb-3 shrink-0">Message will be delivered to their personal inbox upon next app launch.</p>
                    
                    <div class="flex flex-col min-h-0 flex-1">
                    <div class="flex items-center w-full bg-gray-100 dark:bg-gray-700 p-0.5 border border-gray-300 dark:border-gray-600 rounded-t-lg overflow-x-auto custom-scrollbar space-x-0.5 shrink-0">
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('bold', 'admin-reply-text')" class="px-1.5 py-1 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded focus:outline-none flex-1" title="Bold">B</button>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('italic', 'admin-reply-text')" class="px-1.5 py-1 text-xs italic text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded focus:outline-none flex-1" title="Italic">I</button>
                            <div class="w-px h-4 bg-gray-300 dark:bg-gray-600 my-auto mx-0.5 shrink-0"></div>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('larger', 'admin-reply-text')" class="px-1.5 py-1 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded focus:outline-none flex-1" title="Increase Size">A+</button>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('smaller', 'admin-reply-text')" class="px-1.5 py-1 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded focus:outline-none flex-1" title="Decrease Size">A-</button>
                            <div class="w-px h-4 bg-gray-300 dark:bg-gray-600 my-auto mx-0.5 shrink-0"></div>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('justifyLeft', 'admin-reply-text')" class="px-1.5 py-1 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex justify-center focus:outline-none flex-1" title="Align Left"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h10M4 18h16"></path></svg></button>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('justifyCenter', 'admin-reply-text')" class="px-1.5 py-1 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex justify-center focus:outline-none flex-1" title="Align Center"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M7 12h10M4 18h16"></path></svg></button>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('justifyRight', 'admin-reply-text')" class="px-1.5 py-1 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex justify-center focus:outline-none flex-1" title="Align Right"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M10 12h10M4 18h16"></path></svg></button>
                            <div class="w-px h-4 bg-gray-300 dark:bg-gray-600 my-auto mx-0.5 shrink-0"></div>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('link', 'admin-reply-text')" class="px-1.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex items-center justify-center focus:outline-none flex-1" title="Add Custom Link">${Admin.icon('globe', 'w-3.5 h-3.5')}</button>
                            <label for="admin-reply-upload-file" id="admin-reply-upload-label" onmousedown="Admin.saveCursorRange()" ontouchstart="Admin.saveCursorRange()" onclick="Admin.saveCursorRange()" class="px-1.5 py-1 text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex items-center justify-center gap-1 focus:outline-none cursor-pointer flex-1 whitespace-nowrap" title="Upload Image or PDF">${Admin.icon('paperclip', 'w-3.5 h-3.5')} Media</label>
                            <input type="file" id="admin-reply-upload-file" class="hidden" accept="image/*,.pdf">
                        </div>
                        <div contenteditable="true" id="admin-reply-text" class="w-full min-h-[240px] max-h-[50dvh] overflow-y-auto p-3 bg-gray-50 dark:bg-gray-900 border border-t-0 border-gray-300 dark:border-gray-600 rounded-b-lg text-sm text-gray-900 dark:text-white focus:outline-none empty:before:content-[attr(placeholder)] empty:before:text-gray-400 custom-scrollbar" placeholder="Type your response..."></div>
                    </div>

                    <div class="flex space-x-2 mt-3 shrink-0">
                        <button id="reply-cancel" class="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-bold py-2.5 px-3 rounded-lg transition-colors focus:outline-none text-sm">Cancel</button>
                        <button id="reply-send" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-3 rounded-lg shadow-sm transition-colors focus:outline-none text-sm">Send Reply</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            // Upgrade short modal from earlier session in this page load
            const panel = modal.firstElementChild;
            if (panel) {
                panel.className = 'bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90dvh] flex flex-col p-4 transform transition-all scale-95 border border-gray-200 dark:border-gray-700';
            }
            const editor = document.getElementById('admin-reply-text');
            if (editor) {
                editor.classList.remove('min-h-[120px]', 'p-2.5');
                editor.classList.add('min-h-[240px]', 'max-h-[50dvh]', 'overflow-y-auto', 'p-3', 'custom-scrollbar');
            }
            if (!document.getElementById('admin-reply-recipient')) {
                const h3 = panel?.querySelector('h3');
                if (h3) {
                    const recip = document.createElement('p');
                    recip.id = 'admin-reply-recipient';
                    recip.className = 'text-[11px] text-gray-600 dark:text-gray-300 mb-1 break-all leading-snug shrink-0';
                    h3.insertAdjacentElement('afterend', recip);
                }
            }
        }

        const recipEl = document.getElementById('admin-reply-recipient');
        if (recipEl) recipEl.innerHTML = recipientHtml;
        
        document.getElementById('admin-reply-text').innerHTML = '';
        modal.classList.remove('hidden');
        void modal.offsetWidth; // Trigger reflow
        modal.firstElementChild.classList.remove('scale-95');
        modal.firstElementChild.classList.add('scale-100');

        const cleanup = () => {
            modal.classList.add('hidden');
            modal.firstElementChild.classList.remove('scale-100');
            modal.firstElementChild.classList.add('scale-95');
        };

        // GUARDIAN PHASE 3: Inline WYSIWYG File Uploader (Admin Inbox Reply)
        const replyUploadFile = document.getElementById('admin-reply-upload-file');
        if (replyUploadFile) {
            replyUploadFile.addEventListener('change', async function() {
                const editor = document.getElementById('admin-reply-text');
                // GUARDIAN UX FIX: Retrieve pre-upload cursor position locked via mousedown
                const savedRange = Admin._savedRange;
                if (editor) editor.focus();

                if (this.files && this.files.length > 0) {
                    const file = this.files[0];
                    if (file.size > 5242880) { // Strict 5MB limit
                        if (typeof showToast === 'function') showToast("File is too large. Max 5MB.", "error");
                        this.value = '';
                        return;
                    }
                    
                    if (!window.firebaseStorage || !window.firebaseStorageRef || !window.firebaseUploadBytesResumable || !window.firebaseGetDownloadURL) {
                        if (typeof showToast === 'function') showToast("Storage SDK not ready. Check connection.", "error");
                        this.value = '';
                        return;
                    }

                    if (typeof showToast === 'function') showToast("Uploading Attachment...", "info", 30000);

                    try {
                        const fileExt = file.name.split('.').pop().toLowerCase();
                        const isPdf = fileExt === 'pdf';
                        const fileName = `inline_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${fileExt}`;
                        const storageReference = window.firebaseStorageRef(window.firebaseStorage, `admin_attachments/${fileName}`);
                        
                        const uploadTask = window.firebaseUploadBytesResumable(storageReference, file);
                        const labelEl = document.getElementById('admin-reply-upload-label');
                        const originalLabel = labelEl ? labelEl.innerHTML : `${Admin.icon('paperclip', 'w-3.5 h-3.5')} Media`;
                        
                        uploadTask.on('state_changed', 
                            (snapshot) => {
                                const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                                if (labelEl) labelEl.innerHTML = `${Admin.icon('hourglass', 'w-3.5 h-3.5')} ${progress}%`;
                            }, 
                            (error) => {
                                if (typeof showToast === 'function') showToast("Upload failed", "error");
                                console.error("Inline Upload error:", error);
                                if (labelEl) labelEl.innerHTML = originalLabel;
                                this.value = '';
                            }, 
                            async () => {
                                if (labelEl) labelEl.innerHTML = originalLabel;
                                try {
                                    const url = await window.firebaseGetDownloadURL(uploadTask.snapshot.ref);
                                    
                                    let htmlToInsert = '';
                                    if (isPdf) {
                                        htmlToInsert = `&nbsp;<a href="${url}" target="_blank" class="text-blue-500 dark:text-blue-400 underline font-bold px-1 inline-flex items-center gap-1">${Admin.icon('file', 'w-3.5 h-3.5')} View Attached PDF</a>&nbsp;`;
                                    } else {
                                        htmlToInsert = `<br><button type="button" onclick="window.openLightbox('${url}')" class="relative block w-full focus:outline-none my-2 cursor-zoom-in rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm active:scale-[0.98] transition-transform"><img src="${url}" class="w-full h-auto object-cover hover:opacity-90 transition-opacity" alt="Admin Attachment"><span class="nt-zoom-plus absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-xs font-bold leading-none flex items-center justify-center border border-white/20 pointer-events-none select-none shadow-sm" aria-hidden="true">+</span></button><br>`;
                                    }
                                    
                                    if (editor) {
                                        editor.focus();
                                        if (savedRange) {
                                            const sel = window.getSelection();
                                            sel.removeAllRanges();
                                            sel.addRange(savedRange);
                                        }
                                        if (!document.execCommand('insertHTML', false, htmlToInsert)) {
                                            editor.innerHTML += htmlToInsert;
                                        }
                                    }
                                    if (typeof showToast === 'function') showToast("Attachment inserted!", "success");
                                } catch(e) {
                                    if (typeof showToast === 'function') showToast("Failed to insert attachment link", "error");
                                }
                                this.value = '';
                            }
                        );
                    } catch(e) {
                        if (typeof showToast === 'function') showToast("Upload system error.", "error");
                        this.value = '';
                    }
                }
            });
        }

        document.getElementById('reply-cancel').onclick = cleanup;
        document.getElementById('reply-send').onclick = async () => {
            let text = document.getElementById('admin-reply-text').innerHTML.trim();
            if (!text || text === '<br>') {
                if (typeof showToast === 'function') showToast("Please enter a message.", "error");
                return;
            }
            
            // Auto-Signoff Logic
            const adminEmail = Admin.currentUser?.email || '';
            const adminName = adminEmail.includes('enock') ? 'Enock' : (adminEmail.includes('thandeka') ? 'Thandeka' : 'Admin');
            text += `<br><br><span style="color: #9ca3af; font-style: italic;">- ${adminName}</span>`;
            
            const btn = document.getElementById('reply-send');
            btn.textContent = "Sending...";
            btn.disabled = true;

            try {
                const secret = await Admin.getAuthKey();
                if (!secret) throw new Error("Auth missing");

                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                
                // Push to inbox array via POST
                const url = `${dynamicEndpoint}inbox/${deviceId}.json?auth=${secret}`;
                const payload = {
                    message: text,
                    timestamp: Date.now(),
                    feedbackId: feedbackId,
                    read: false
                };

                const res = await fetch(url, { method: 'POST', body: JSON.stringify(payload) });
                if (!res.ok) throw new Error("Failed to send");
                
                // Flag the original ticket as replied to
                await fetch(`${dynamicEndpoint}feedback/${feedbackId}.json?auth=${secret}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ hasAdminReply: true })
                });

                // Auto-resolve the feedback item
                await Admin.resolveFeedback(feedbackId, true); 
                
                if (typeof showToast === 'function') showToast("Reply sent & archived!", "success");
                cleanup();
            } catch (e) {
                if (typeof showToast === 'function') showToast("Failed to send reply.", "error");
            } finally {
                btn.textContent = "Send Reply";
                btn.disabled = false;
            }
        };
    },

    // --- GUARDIAN PHASE 7: CONTEXTUAL ALERT VIEWER ---
    jumpToQuotedFeedback: (replyKey, snippetHint = '', scopeEl = null) => {
        const root = scopeEl && scopeEl.querySelectorAll ? scopeEl : document;
        const cleanKey = String(replyKey || '').trim();
        let el = null;

        if (cleanKey) {
            // Prefer scoped lookup (open thread), then document — keys may be HTML-escaped in id attrs
            const tryIds = [cleanKey, cleanKey.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')];
            for (const k of tryIds) {
                el = (root.getElementById && root.getElementById(`fb-msg-${k}`))
                    || document.getElementById(`fb-msg-${k}`)
                    || root.querySelector?.(`[data-fb-msg-id="${CSS.escape ? CSS.escape(k) : k}"]`)
                    || document.querySelector(`[data-fb-msg-id="${CSS.escape ? CSS.escape(k) : k}"]`);
                if (el) break;
            }
        }

        // Fuzzy-match quoted text against admin bubbles (scoped to this thread when possible)
        if (!el && snippetHint) {
            const normalize = (s) => String(s || '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/^[\[\]"'“”\s]+/, '')
                .replace(/[\[\]"'“”]+$/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
            const needle = normalize(snippetHint).slice(0, 80);
            const shortNeedle = needle.replace(/[^\p{L}\p{N}\s]/gu, '').trim().slice(0, 48);
            if (needle) {
                const bubbles = root.querySelectorAll
                    ? root.querySelectorAll('[id^="fb-msg-"], [data-fb-msg-id]')
                    : document.querySelectorAll('[id^="fb-msg-"], [data-fb-msg-id]');
                let best = null;
                let bestScore = 0;
                for (const node of bubbles) {
                    const plainAttr = normalize(node.getAttribute('data-fb-admin-plain') || '');
                    const t = plainAttr || normalize(node.textContent || '');
                    if (!t) continue;
                    if (t.includes(needle) || (shortNeedle && t.includes(shortNeedle))) {
                        el = node;
                        break;
                    }
                    // Soft match: share significant token from quote
                    const tokens = shortNeedle.split(/\s+/).filter((w) => w.length >= 4);
                    const hits = tokens.filter((w) => t.includes(w)).length;
                    if (hits >= 2 && hits > bestScore) {
                        bestScore = hits;
                        best = node;
                    }
                }
                if (!el && best) el = best;
            }
        }

        if (!el) {
            if (typeof showToast === 'function') showToast('Original message not in this thread view', 'info', 2000);
            return;
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-blue-400', 'rounded-xl');
        setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400', 'rounded-xl'), 1600);
    },

    viewContextAlert: async (alertId, fallbackText) => {
        const secret = await Admin.getAuthKey();
        if (!secret) return;
        
        if (typeof showToast === 'function') showToast("Fetching context...", "info", 1500);

        let modal = document.getElementById('admin-context-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'admin-context-modal';
            modal.className = 'fixed inset-0 bg-black/80 z-[250] hidden flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
            modal.innerHTML = `
                <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 transform transition-all scale-95 border border-blue-200 dark:border-blue-900/50 flex flex-col max-h-[85vh]">
                    <div class="flex items-center justify-between mb-4 shrink-0">
                        <div class="flex items-center space-x-2">
                            <span class="inline-flex text-amber-500">${Admin.icon('alert', 'w-5 h-5')}</span>
                            <h3 class="text-lg font-black text-gray-900 dark:text-white tracking-tight">Original Advisory</h3>
                        </div>
                        <button onclick="closeSmoothModal('admin-context-modal')" class="text-gray-400 hover:text-gray-500 focus:outline-none">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div id="admin-context-content" class="bg-gray-50 dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-800 dark:text-gray-200 leading-relaxed overflow-y-auto custom-scrollbar">
                        Loading...
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const contentDiv = document.getElementById('admin-context-content');
        contentDiv.innerHTML = `<div class="animate-pulse text-center py-4">Searching database...</div>`;
        
        openSmoothModal('admin-context-modal');

        try {
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            let foundData = null;

            // Search Active and Archived nodes
            if (alertId && alertId !== 'null' && alertId !== 'undefined') {
                let res = await fetch(`${dynamicEndpoint}notices.json?auth=${secret}`);
                let data = await res.json();
                if (data && !data.error) Object.values(data).forEach(alert => { if (alert.id === String(alertId)) foundData = alert; });
                
                if (!foundData) {
                    res = await fetch(`${dynamicEndpoint}notices_archive.json?auth=${secret}`); // GUARDIAN FIX: Removed REST index constraint to prevent 400 Bad Request
                    data = await res.json();
                    if (data && !data.error) {
                        Object.values(data).forEach(alert => { if (alert.id === String(alertId)) foundData = alert; });
                    }
                }

                // Match Transit Incident Manager entries by id (active + archive)
                if (!foundData) {
                    const disrActiveRes = await fetch(`${dynamicEndpoint}disruptions.json?auth=${secret}`);
                    const disrActiveData = await disrActiveRes.json();
                    if (disrActiveData && !disrActiveData.error) {
                        Object.entries(disrActiveData).forEach(([rId, routeNode]) => {
                            if (typeof routeNode !== 'object' || !routeNode) return;
                            Object.values(routeNode).forEach((disr) => {
                                if (disr && String(disr.id) === String(alertId)) {
                                    foundData = {
                                        ...disr,
                                        kind: 'disruption',
                                        clearedFrom: rId,
                                        severity: disr.tier === 'CRITICAL' ? 'critical' : (disr.severity || 'warning'),
                                    };
                                }
                            });
                        });
                    }
                }
                if (!foundData) {
                    const disrArchRes = await fetch(`${dynamicEndpoint}disruptions_archive.json?auth=${secret}`);
                    const disrArchData = await disrArchRes.json();
                    if (disrArchData && !disrArchData.error) {
                        Object.entries(disrArchData).forEach(([rId, routeNode]) => {
                            if (typeof routeNode !== 'object' || !routeNode) return;
                            Object.values(routeNode).forEach((disr) => {
                                if (disr && String(disr.id) === String(alertId)) {
                                    foundData = {
                                        ...disr,
                                        kind: 'disruption',
                                        clearedFrom: disr.clearedFrom || rId,
                                        severity: disr.severity || (disr.tier === 'CRITICAL' ? 'critical' : 'warning'),
                                    };
                                }
                            });
                        });
                    }
                }
            }

            // Fuzzy Text Fallback (For legacy quotes without IDs)
            if (!foundData && fallbackText) {
                const cleanFallback = fallbackText.replace(/['"]/g, '').toLowerCase().substring(0, 30); 
                
                const resActive = await fetch(`${dynamicEndpoint}notices.json?auth=${secret}`);
                const activeData = await resActive.json();
                if (activeData && !activeData.error) {
                    Object.values(activeData).forEach(alert => {
                        if (alert.message && alert.message.toLowerCase().includes(cleanFallback)) foundData = alert;
                    });
                }

                if (!foundData) {
                    const resArch = await fetch(`${dynamicEndpoint}notices_archive.json?auth=${secret}`);
                    const archData = await resArch.json();
                    if (archData && !archData.error) {
                        Object.values(archData).forEach(alert => {
                            if (alert.message && alert.message.toLowerCase().includes(cleanFallback)) foundData = alert;
                        });
                    }
                }
            }

            // GUARDIAN PHASE 14: Disruption Graveyard Sweep
            if (!foundData && fallbackText) {
                const cleanFallback = fallbackText.replace(/['"]/g, '').toLowerCase().substring(0, 30);
                
                // Sweep active disruptions globally
                const disrActiveRes = await fetch(`${dynamicEndpoint}disruptions.json?auth=${secret}`);
                const disrActiveData = await disrActiveRes.json();
                if (disrActiveData && !disrActiveData.error) {
                    Object.values(disrActiveData).forEach(routeNode => {
                        if (typeof routeNode === 'object') {
                            Object.values(routeNode).forEach(disr => {
                                const dMsg = disr.message || disr.longExplanation || '';
                                if (dMsg.toLowerCase().includes(cleanFallback) || (disr.buttonText && disr.buttonText.toLowerCase().includes(cleanFallback))) {
                                    foundData = { ...disr, severity: disr.tier === 'CRITICAL' ? 'critical' : 'warning' };
                                }
                            });
                        }
                    });
                }

                // Sweep the new Graveyard
                if (!foundData) {
                    const disrArchRes = await fetch(`${dynamicEndpoint}disruptions_archive.json?auth=${secret}`);
                    const disrArchData = await disrArchRes.json();
                    if (disrArchData && !disrArchData.error) {
                        Object.values(disrArchData).forEach(routeNode => {
                            if (typeof routeNode === 'object') {
                                Object.values(routeNode).forEach(disr => {
                                    const dMsg = disr.message || disr.longExplanation || '';
                                    if (dMsg.toLowerCase().includes(cleanFallback) || (disr.buttonText && disr.buttonText.toLowerCase().includes(cleanFallback))) {
                                        foundData = { ...disr, severity: disr.tier === 'CRITICAL' ? 'critical' : 'warning', archivedAt: disr.archivedAt };
                                    }
                                });
                            }
                        });
                    }
                }
            }

            if (foundData) {
                // Live poll tallies when previewing an active poll alert from Feedback
                if (foundData.poll && foundData.poll.active && !foundData.pollResults && foundData.id) {
                    const liveTallies = await Admin.fetchPollResultsSnapshot(foundData.id, secret);
                    if (liveTallies) foundData = { ...foundData, pollResults: liveTallies };
                }
                if (typeof closeSmoothModal === 'function') closeSmoothModal('admin-context-modal');
                else modal.classList.add('hidden');
                Admin.previewArchivedAlert(foundData);
                return;
            } else {
                contentDiv.innerHTML = `
                    <div class="text-center py-4">
                        <span class="inline-flex justify-center text-gray-400 mb-2">${Admin.icon('search', 'w-8 h-8')}</span>
                        <p class="text-gray-500 text-sm font-bold">Alert not found in database.</p>
                        <p class="text-xs text-gray-400 mt-2">It may have been permanently deleted or too old to retrieve. Here is the snippet we have:</p>
                        <div class="mt-3 p-3 bg-gray-100 dark:bg-gray-800 rounded italic text-xs text-gray-600 dark:text-gray-400">"${fallbackText}"</div>
                    </div>
                `;
            }

        } catch(e) {
            contentDiv.innerHTML = `<div class="text-red-500 text-center py-4">Error fetching context: ${e.message}</div>`;
        }
    },

// --- GUARDIAN PHASE 2: WYSIWYG CURSOR LOCK ---
    _savedRange: null,
    saveCursorRange: () => {
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            Admin._savedRange = sel.getRangeAt(0);
        }
    },

// RICH TEXT FORMATTING HELPER ---
    formatAlertText: (tag, targetId = 'alert-msg') => {
        const editor = document.getElementById(targetId);
        if (!editor) return;
        
        // GUARDIAN FIX: Inject CSS overrides for the strict 3-Tier sizing logic (Small, Normal, Large)
        // Without these !important rules, Tailwind's text-sm class squashes all larger <font> tags back to "normal"
        if (!document.getElementById('wysiwyg-extended-sizes')) {
            const style = document.createElement('style');
            style.id = 'wysiwyg-extended-sizes';
            style.innerHTML = `
                font[size="5"] { font-size: 1.15rem !important; font-weight: 700; line-height: 1.4; }
                font[size="3"] { font-size: inherit !important; font-weight: inherit !important; opacity: 1 !important; line-height: inherit; }
                font[size="2"] { font-size: 10px !important; opacity: 0.85; line-height: 1.2; }
            `;
            document.head.appendChild(style);
        }

        editor.focus();
        
        // GUARDIAN UX FIX: Restore mobile cursor selection before formatting
        if (Admin._savedRange) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(Admin._savedRange);
            Admin._savedRange = null; // Clear lock
        }
        
        if (tag === 'bold') { 
            document.execCommand('bold', false, null);
        } else if (tag === 'italic') { 
            document.execCommand('italic', false, null);
        } else if (tag === 'larger' || tag === 'smaller') {
            // GUARDIAN DOM SCANNER: queryCommandValue is broken on mobile WebViews.
            // We manually traverse the DOM to find the exact font size tag applied to the cursor.
            let currentSize = 3; // Default to Normal
            const sel = window.getSelection();
            
            if (sel.rangeCount > 0) {
                let node = sel.anchorNode;
                while (node && node !== editor) {
                    if (node.nodeType === 1 && node.tagName.toLowerCase() === 'font' && node.hasAttribute('size')) {
                        const sizeAttr = parseInt(node.getAttribute('size'), 10);
                        if (!isNaN(sizeAttr)) {
                            currentSize = sizeAttr;
                            break;
                        }
                    }
                    node = node.parentNode;
                }
            }

            // Map any chaotic legacy sizes strictly into our 3-Tier baseline
            if (currentSize < 3) currentSize = 2; // Small
            else if (currentSize > 3) currentSize = 5; // Large
            else currentSize = 3; // Normal

            let newSize = 3;
            if (tag === 'larger') {
                if (currentSize === 2) newSize = 3; // Small -> Normal
                else if (currentSize >= 3) newSize = 5; // Normal/Large -> Large
            } else if (tag === 'smaller') {
                if (currentSize === 5) newSize = 3; // Large -> Normal
                else if (currentSize <= 3) newSize = 2; // Normal/Small -> Small
            }

            document.execCommand('fontSize', false, newSize.toString());
        } else if (tag === 'justifyLeft') {
            document.execCommand('justifyLeft', false, null);
        } else if (tag === 'justifyCenter') {
            document.execCommand('justifyCenter', false, null);
        } else if (tag === 'justifyRight') {
            document.execCommand('justifyRight', false, null);
        } else if (tag === 'link') { 
            const url = prompt("Enter the full URL (e.g., https://nexttrain.co.za):", "https://");
            if (!url) return;
            const selection = window.getSelection();
            const selectedText = selection.toString() || "Link";
            const html = `<a href="${url}" target="_blank" class="text-blue-500 dark:text-blue-400 underline underline-offset-2">${selectedText}</a>`;
            document.execCommand('insertHTML', false, html);
        }
    },


    // --- 4. SERVICE ALERTS MANAGER ---
    /** Tally votes from polls/{id} payload ? { A, B, C, total }. */
    tallyPollVotes: (pollData) => {
        let A = 0, B = 0, C = 0;
        if (pollData && typeof pollData === 'object') {
            Object.values(pollData).forEach((vote) => {
                if (!vote || typeof vote !== 'object') return;
                if (vote.optionKey === 'A') A++;
                else if (vote.optionKey === 'B') B++;
                else if (vote.optionKey === 'C') C++;
            });
        }
        return { A, B, C, total: A + B + C };
    },

    fetchPollResultsSnapshot: async (pollId, secret) => {
        if (!pollId) return null;
        try {
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            const q = secret ? `?auth=${encodeURIComponent(secret)}` : `?t=${Date.now()}`;
            const res = await fetch(`${dynamicEndpoint}polls/${encodeURIComponent(pollId)}.json${q}`);
            if (!res.ok) return null;
            const data = await res.json();
            if (!data) return { A: 0, B: 0, C: 0, total: 0 };
            return Admin.tallyPollVotes(data);
        } catch {
            return null;
        }
    },

    archiveActiveNotice: async (target, secret, noticeData = null) => {
        const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
        let alertData = noticeData;
        if (!alertData) {
            const fetchRes = await window.guardianFetch(`${dynamicEndpoint}notices/${target}.json`, {}, 6000);
            if (!fetchRes.ok) return null;
            alertData = await fetchRes.json();
        }
        if (!alertData || !alertData.id) return null;

        const pollResults = (alertData.poll && alertData.poll.active)
            ? await Admin.fetchPollResultsSnapshot(alertData.id, secret)
            : (alertData.pollResults || null);

        const archived = {
            ...alertData,
            kind: 'notice',
            archivedAt: Date.now(),
            clearedFrom: target,
            archiveReason: alertData.archiveReason || 'cleared',
            pollResults: pollResults || alertData.pollResults || null,
        };
        const archiveUrl = `${dynamicEndpoint}notices_archive/${alertData.id}_${Date.now()}.json?auth=${secret}`;
        const archRes = await fetch(archiveUrl, { method: 'PUT', body: JSON.stringify(archived) });
        if (!archRes.ok) throw new Error('Failed to write notices_archive');
        await fetch(`${dynamicEndpoint}notices/${target}.json?auth=${secret}`, { method: 'DELETE' });
        return archived;
    },

    sweepExpiredAlertsToArchive: async (secret) => {
        if (!secret) return { notices: 0, disruptions: 0 };
        const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
        const now = Date.now();
        let notices = 0;
        let disruptions = 0;

        try {
            const nRes = await window.guardianFetch(`${dynamicEndpoint}notices.json`, {}, 10000);
            const nData = nRes.ok ? await nRes.json() : null;
            if (nData && typeof nData === 'object') {
                for (const [target, node] of Object.entries(nData)) {
                    if (node && node.message && node.id && node.expiresAt && node.expiresAt < now) {
                        try {
                            node.archiveReason = 'expired';
                            await Admin.archiveActiveNotice(target, secret, node);
                            notices++;
                        } catch (e) {
                            console.warn('Expired notice archive failed', target, e);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Notice expiry sweep failed', e);
        }

        try {
            const dRes = await window.guardianFetch(`${dynamicEndpoint}disruptions.json`, {}, 10000);
            const dData = dRes.ok ? await dRes.json() : null;
            if (dData && typeof dData === 'object') {
                for (const [rId, routeNode] of Object.entries(dData)) {
                    if (!routeNode || typeof routeNode !== 'object') continue;
                    for (const [key, disr] of Object.entries(routeNode)) {
                        if (!disr || !disr.id || !disr.expiresAt || disr.expiresAt >= now) continue;
                        try {
                            const payload = {
                                ...disr,
                                kind: 'disruption',
                                archivedAt: Date.now(),
                                clearedFrom: rId,
                                archiveReason: 'expired',
                                severity: disr.tier === 'CRITICAL' ? 'critical' : (disr.severity || 'warning'),
                            };
                            await fetch(`${dynamicEndpoint}disruptions_archive/${rId}/${disr.id}_${Date.now()}.json?auth=${secret}`, {
                                method: 'PUT',
                                body: JSON.stringify(payload),
                            });
                            await fetch(`${dynamicEndpoint}disruptions/${rId}/${key}.json?auth=${secret}`, { method: 'DELETE' });
                            disruptions++;
                        } catch (e) {
                            console.warn('Expired disruption archive failed', rId, key, e);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Disruption expiry sweep failed', e);
        }

        return { notices, disruptions };
    },

    loadUnifiedAlertArchive: async (secret) => {
        const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
        const items = [];

        const nRes = await fetch(`${dynamicEndpoint}notices_archive.json?auth=${secret}`);
        const nData = nRes.ok ? await nRes.json() : null;
        if (nData && typeof nData === 'object') {
            Object.entries(nData).forEach(([archKey, alert]) => {
                if (!alert || typeof alert !== 'object') return;
                items.push({
                    ...alert,
                    kind: alert.kind || 'notice',
                    _archKey: archKey,
                    _sortAt: Number(alert.archivedAt || alert.postedAt || 0),
                });
            });
        }

        const dRes = await fetch(`${dynamicEndpoint}disruptions_archive.json?auth=${secret}`);
        const dData = dRes.ok ? await dRes.json() : null;
        if (dData && typeof dData === 'object') {
            Object.entries(dData).forEach(([rId, routeNode]) => {
                if (!routeNode || typeof routeNode !== 'object') return;
                Object.entries(routeNode).forEach(([archKey, disr]) => {
                    if (!disr || typeof disr !== 'object') return;
                    items.push({
                        ...disr,
                        kind: 'disruption',
                        clearedFrom: disr.clearedFrom || rId,
                        severity: disr.severity || (disr.tier === 'CRITICAL' ? 'critical' : 'warning'),
                        message: disr.message || disr.longExplanation || disr.buttonText || '',
                        _archKey: `${rId}/${archKey}`,
                        _sortAt: Number(disr.archivedAt || disr.postedAt || 0),
                    });
                });
            });
        }

        items.sort((a, b) => (b._sortAt || 0) - (a._sortAt || 0));
        Admin._cachedAlertArchive = items;
        return items;
    },

    /** Classify archive/live notice target: all | region | route */
    classifyAlertTarget: (target) => {
        const t = String(target || '');
        if (t === 'all') return 'all';
        if (/^all_[A-Z0-9]+$/i.test(t)) return 'region';
        return t ? 'route' : '';
    },

    regionFromAlertTarget: (target) => {
        const t = String(target || '');
        if (/^all_([A-Z0-9]+)$/i.test(t)) return t.split('_')[1].toUpperCase();
        if (typeof ROUTES !== 'undefined' && ROUTES[t]) return ROUTES[t].region || '';
        return '';
    },

    filterAlertArchiveItems: (items) => {
        const scope = (document.getElementById('alert-arch-filter-scope')?.value || '').trim();
        const region = (document.getElementById('alert-arch-filter-region')?.value || '').trim().toUpperCase();
        const route = (document.getElementById('alert-arch-filter-route')?.value || '').trim();
        return (Array.isArray(items) ? items : []).filter((item) => {
            const target = String(item.clearedFrom || item.target || item.routeId || '');
            const kind = Admin.classifyAlertTarget(target);
            if (scope === 'all' && kind !== 'all') return false;
            if (scope === 'region' && kind !== 'region') return false;
            if (scope === 'route' && kind !== 'route') return false;
            if (region) {
                if (kind === 'all') return false;
                if (Admin.regionFromAlertTarget(target) !== region) return false;
            }
            if (route && target !== route) return false;
            return true;
        });
    },

    computeNextScheduleRun: (freq, fromTs) => {
        const base = Number(fromTs) || Date.now();
        if (freq === 'once') return null;
        if (freq === 'hourly') return base + 3600 * 1000;
        if (freq === 'daily') return base + 24 * 3600 * 1000;
        if (freq === 'weekly') return base + 7 * 24 * 3600 * 1000;
        if (freq === 'weekdays') {
            let next = base + 24 * 3600 * 1000;
            for (let i = 0; i < 10; i++) {
                const day = new Date(next).getDay();
                if (day !== 0 && day !== 6) return next;
                next += 24 * 3600 * 1000;
            }
            return next;
        }
        return base + 24 * 3600 * 1000;
    },

    publishDueScheduledAlerts: async (secret) => {
        if (!secret) secret = await Admin.getAuthKey();
        if (!secret) return { published: 0 };
        const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
        let published = 0;
        try {
            const res = await fetch(`${dynamicEndpoint}notices_scheduled.json?auth=${secret}`);
            if (!res.ok) return { published: 0 };
            const data = await res.json();
            if (!data || typeof data !== 'object') return { published: 0 };
            const now = Date.now();
            for (const [schedId, job] of Object.entries(data)) {
                if (!job || job.enabled === false || !job.target || !job.notice) continue;
                const nextRun = Number(job.nextRunAt || 0);
                if (!nextRun || nextRun > now) continue;
                try {
                    const notice = { ...job.notice };
                    const expiresInMs = Number(notice.expiresInMs) || (2 * 3600 * 1000);
                    delete notice.expiresInMs;
                    const payload = {
                        ...notice,
                        id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
                        postedAt: Date.now(),
                        expiresAt: Date.now() + expiresInMs,
                    };
                    const putRes = await fetch(`${dynamicEndpoint}notices/${job.target}.json?auth=${secret}`, {
                        method: 'PUT',
                        body: JSON.stringify(payload),
                    });
                    if (!putRes.ok) continue;
                    published++;
                    const next = Admin.computeNextScheduleRun(job.frequency || 'once', Math.max(nextRun, now));
                    if (next == null || job.frequency === 'once') {
                        await fetch(`${dynamicEndpoint}notices_scheduled/${schedId}.json?auth=${secret}`, { method: 'DELETE' });
                    } else {
                        await fetch(`${dynamicEndpoint}notices_scheduled/${schedId}.json?auth=${secret}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ nextRunAt: next, lastRunAt: Date.now(), lastNoticeId: payload.id }),
                        });
                    }
                } catch (e) {
                    console.warn('Scheduled alert publish failed', schedId, e);
                }
            }
        } catch (e) {
            console.warn('publishDueScheduledAlerts failed', e);
        }
        if (published && typeof checkServiceAlerts === 'function') {
            try { checkServiceAlerts(); } catch (_) {}
        }
        return { published };
    },

    fetchScheduledAlerts: async () => {
        const secret = await Admin.getAuthKey();
        if (!secret) return [];
        const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
        const res = await fetch(`${dynamicEndpoint}notices_scheduled.json?auth=${secret}`);
        if (!res.ok) return [];
        const data = await res.json();
        if (!data || typeof data !== 'object') return [];
        const items = Object.entries(data).map(([id, job]) => ({ id, ...job })).sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0));
        Admin._cachedScheduledAlerts = items;
        return items;
    },

    formatScheduleDurationLabel: (ms) => {
        const n = Number(ms) || 0;
        if (n < 60 * 1000) return `${Math.max(1, Math.round(n / 1000))}s`;
        if (n < 3600 * 1000) return `${Math.round(n / (60 * 1000))} min`;
        if (n < 48 * 3600 * 1000) {
            const h = n / (3600 * 1000);
            return Number.isInteger(h) ? `${h} hr` : `${h.toFixed(1)} hr`;
        }
        const d = n / (24 * 3600 * 1000);
        return Number.isInteger(d) ? `${d} day${d === 1 ? '' : 's'}` : `${d.toFixed(1)} days`;
    },

    renderScheduledAlertsList: (items) => {
        const listEl = document.getElementById('alert-schedule-list');
        if (!listEl) return;
        const rows = Array.isArray(items) ? items : [];
        if (!rows.length) {
            listEl.innerHTML = `<div class="text-center py-6 text-xs text-gray-400">No scheduled alerts. Add one under New Alert ? Recurring schedule.</div>`;
            return;
        }
        listEl.innerHTML = rows.map((job) => {
            const nextStr = job.nextRunAt ? Admin.formatDate(job.nextRunAt) : '-';
            const lastStr = job.lastRunAt ? Admin.formatDate(job.lastRunAt) : 'never';
            const liveFor = Admin.formatScheduleDurationLabel(job.notice?.expiresInMs || 2 * 3600 * 1000);
            const paused = job.enabled === false;
            const plain = (() => {
                try {
                    const d = document.createElement('div');
                    d.innerHTML = job.notice?.message || '';
                    return (d.textContent || '').trim().slice(0, 100) || '(empty)';
                } catch { return '(empty)'; }
            })();
            const freq = escapeHTML(String(job.frequency || 'once'));
            const target = escapeHTML(String(job.target || '-'));
            const idSafe = escapeHTML(String(job.id || ''));
            return `
                <div class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 shadow-sm ${paused ? 'opacity-70' : ''}" data-sched-id="${idSafe}">
                    <div class="flex flex-wrap items-center gap-1.5 mb-1">
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">${freq}</span>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">${target}</span>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">Live ${escapeHTML(liveFor)}</span>
                        ${paused ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-100 text-amber-700">Paused</span>' : ''}
                    </div>
                    <p class="text-xs text-gray-800 dark:text-gray-200 leading-snug line-clamp-2 mb-1">${escapeHTML(plain)}</p>
                    <div class="flex justify-between items-center gap-2 text-[9px] font-mono text-gray-400">
                        <span>Next ${escapeHTML(nextStr)} - Last ${escapeHTML(lastStr)}</span>
                        <span class="flex gap-2 shrink-0">
                            <button type="button" class="alert-sched-toggle font-bold uppercase tracking-wider focus:outline-none ${paused ? 'text-emerald-600' : 'text-amber-600'}" data-sched-id="${idSafe}" data-enabled="${paused ? '1' : '0'}">${paused ? 'Resume' : 'Pause'}</button>
                            <button type="button" class="alert-sched-delete text-red-500 hover:text-red-700 font-bold uppercase tracking-wider focus:outline-none" data-sched-id="${idSafe}">Clear</button>
                        </span>
                    </div>
                </div>`;
        }).join('');
        listEl.querySelectorAll('.alert-sched-delete').forEach((btn) => {
            btn.onclick = async () => {
                const id = btn.getAttribute('data-sched-id');
                if (!id) return;
                const ok = await Admin.secureConfirm('Clear schedule', 'Remove this automated alert?');
                if (!ok) return;
                const secret = await Admin.getAuthKey();
                if (!secret) return;
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                await fetch(`${dynamicEndpoint}notices_scheduled/${id}.json?auth=${secret}`, { method: 'DELETE' });
                Admin.refreshScheduledAlerts();
            };
        });
        listEl.querySelectorAll('.alert-sched-toggle').forEach((btn) => {
            btn.onclick = async () => {
                const id = btn.getAttribute('data-sched-id');
                const enable = btn.getAttribute('data-enabled') === '1';
                if (!id) return;
                const secret = await Admin.getAuthKey();
                if (!secret) return;
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                await fetch(`${dynamicEndpoint}notices_scheduled/${id}.json?auth=${secret}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ enabled: enable }),
                });
                Admin.refreshScheduledAlerts();
            };
        });
    },

    refreshScheduledAlerts: async () => {
        const statusEl = document.getElementById('alert-schedule-status');
        if (statusEl) statusEl.textContent = 'Checking due...';
        try {
            const secret = await Admin.getAuthKey();
            const due = await Admin.publishDueScheduledAlerts(secret);
            const items = await Admin.fetchScheduledAlerts();
            Admin.renderScheduledAlertsList(items);
            if (statusEl) {
                statusEl.textContent = due.published
                    ? `${items.length} scheduled - posted ${due.published}`
                    : `${items.length} scheduled`;
            }
        } catch (e) {
            console.warn('refreshScheduledAlerts failed', e);
            if (statusEl) statusEl.textContent = 'Failed';
        }
    },

    setupServiceAlertsManager: () => {
        if (!window._adminPremiumDropdownsBound) {
            document.addEventListener('click', (e) => {
                const checkClose = (containerId, listId, chevId) => {
                    const container = document.getElementById(containerId);
                    const list = document.getElementById(listId);
                    const chev = document.getElementById(chevId);
                    if (list && !list.classList.contains('hidden') && (!container || !container.contains(e.target))) {
                        list.classList.add('hidden');
                        if (chev) chev.classList.remove('rotate-180');
                    }
                };
                checkClose('alert-target-container', 'alert-target-list', 'alert-target-chevron');
                checkClose('alert-severity-container', 'alert-severity-list', 'alert-severity-chevron');
                checkClose('disr-route-container', 'disr-route-list', 'disr-route-chevron');
                checkClose('disr-tier-container', 'disr-tier-list', 'disr-tier-chevron');
                checkClose('disr-station-a-container', 'disr-station-a-list', 'disr-station-a-chevron');
                checkClose('disr-station-b-container', 'disr-station-b-list', 'disr-station-b-chevron');
                checkClose('excl-route-container', 'excl-route-list', 'excl-route-chevron');
            });
            window._adminPremiumDropdownsBound = true;
        }

        const alertPanel = document.getElementById('alert-panel');
        if (!alertPanel) return;
        
        const alertHeaderLen = (alertPanel.querySelector('#alert-header-btn')?.textContent || '').trim().length;
        const alertShellEmpty = !(alertPanel.innerHTML || '').trim() || alertHeaderLen < 3;
        if (alertPanel.dataset.adminLoaded === "true" && !alertShellEmpty) {
            return;
        }
        // Rebuild tile chrome — mark loaded only after HTML lands (prevents permanent blank grid card)
        alertPanel.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-visible transition-all duration-300";

        alertPanel.innerHTML = `
            <button id="alert-header-btn" class="w-full text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('megaphone', 'text-rose-500 dark:text-rose-400')}
                    <span>Service Alerts Manager</span>
                </span>
                <svg id="alert-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            
            <div id="alert-body" class="hidden mt-4 space-y-4">
                <div id="alert-tabs-swipe" class="flex border-b border-gray-200 dark:border-gray-700 touch-pan-y">
                    <button type="button" id="alert-tab-compose" class="flex-1 py-2 text-[10px] uppercase font-black border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 transition-colors focus:outline-none tracking-wider">New Alert</button>
                    <button type="button" id="alert-tab-schedule" class="flex-1 py-2 text-[10px] uppercase font-black border-b-2 border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus:outline-none tracking-wider">Schedule</button>
                    <button type="button" id="alert-tab-archive" class="flex-1 py-2 text-[10px] uppercase font-black border-b-2 border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus:outline-none tracking-wider">Archive</button>
                </div>

                <div id="alert-compose-pane" class="space-y-4">
                <div>
                    <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Target Audience (God-Mode)</label>
                    <div class="relative" id="alert-target-container">
                        <select id="alert-target" class="hidden"></select>
                        <div onclick="document.getElementById('alert-target-list').classList.toggle('hidden'); document.getElementById('alert-target-chevron').classList.toggle('rotate-180');" class="w-full h-10 px-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-900 dark:text-white transition-colors shadow-sm hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between cursor-pointer select-none">
                            <span id="alert-target-display" class="truncate flex items-center">Select Target...</span>
                            <svg id="alert-target-chevron" class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                        <ul id="alert-target-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl hidden mt-1 flex-col overflow-y-auto max-h-60 custom-scrollbar text-left"></ul>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Severity</label>
                        <div class="relative" id="alert-severity-container">
                            <select id="alert-severity" class="hidden">
                                <option value="info" selected>Info (General)</option>
                                <option value="warning">Warning (Delays)</option>
                                <option value="critical">Critical (Suspended)</option>
                            </select>
                            <div onclick="document.getElementById('alert-severity-list').classList.toggle('hidden'); document.getElementById('alert-severity-chevron').classList.toggle('rotate-180');" class="w-full h-10 px-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-900 dark:text-white transition-colors shadow-sm hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between cursor-pointer select-none">
                                <span id="alert-severity-display" class="truncate inline-flex items-center gap-1.5"><span class="inline-flex text-blue-500">${Admin.icon('circle', 'w-3 h-3')}</span> Info (General)</span>
                                <svg id="alert-severity-chevron" class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                            <ul id="alert-severity-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl hidden mt-1 flex-col overflow-hidden text-left">
                                <li onclick="document.getElementById('alert-severity').value='info'; document.getElementById('alert-severity-display').innerHTML=Admin._severityLabelHtml('info'); document.getElementById('alert-severity-list').classList.add('hidden'); document.getElementById('alert-severity-chevron').classList.remove('rotate-180');" class="px-3 py-2.5 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 cursor-pointer inline-flex items-center gap-1.5 w-full"><span class="inline-flex text-blue-500">${Admin.icon('circle', 'w-3 h-3')}</span> Info (General)</li>
                                <li onclick="document.getElementById('alert-severity').value='warning'; document.getElementById('alert-severity-display').innerHTML=Admin._severityLabelHtml('warning'); document.getElementById('alert-severity-list').classList.add('hidden'); document.getElementById('alert-severity-chevron').classList.remove('rotate-180');" class="px-3 py-2.5 text-xs font-bold hover:bg-yellow-50 dark:hover:bg-gray-700 text-yellow-700 dark:text-yellow-400 transition-colors border-b border-gray-100 dark:border-gray-700 cursor-pointer inline-flex items-center gap-1.5 w-full"><span class="inline-flex text-amber-500">${Admin.icon('alert', 'w-3 h-3')}</span> Warning (Delays)</li>
                                <li onclick="document.getElementById('alert-severity').value='critical'; document.getElementById('alert-severity-display').innerHTML=Admin._severityLabelHtml('critical'); document.getElementById('alert-severity-list').classList.add('hidden'); document.getElementById('alert-severity-chevron').classList.remove('rotate-180');" class="px-3 py-2.5 text-xs font-bold hover:bg-red-50 dark:hover:bg-gray-700 text-red-700 dark:text-red-400 transition-colors cursor-pointer inline-flex items-center gap-1.5 w-full"><span class="inline-flex text-red-500">${Admin.icon('siren', 'w-3 h-3')}</span> Critical (Suspended)</li>
                            </ul>
                        </div>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Sign-off Name</label>
                        <input type="text" id="alert-signoff" class="w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. Next Train Ops" value="Next Train Ops">
                    </div>
                </div>

                <div class="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 p-3 rounded-xl border border-blue-200 dark:border-blue-800">
                    <div>
                        <span class="font-bold text-blue-800 dark:text-blue-200 text-sm">Force Popup Alert</span>
                        <p class="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">Auto-opens modal on user screen</p>
                    </div>
                    <div class="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                        <input type="checkbox" id="alert-force-popup" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer outline-none"/>
                        <label for="alert-force-popup" class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
                    </div>
                </div>

                <div>
                    <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Message</label>
                    <div class="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
                        <div class="flex items-center w-full bg-gray-100 dark:bg-gray-700 p-0.5 border-b border-gray-300 dark:border-gray-600 overflow-x-auto custom-scrollbar space-x-0.5">
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('bold')" class="px-1.5 py-1 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded focus:outline-none flex-1" title="Bold">B</button>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('italic')" class="px-1.5 py-1 text-xs italic text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded focus:outline-none flex-1" title="Italic">I</button>
                            <div class="w-px h-4 bg-gray-300 dark:bg-gray-600 my-auto mx-0.5 shrink-0"></div>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('larger')" class="px-1.5 py-1 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded focus:outline-none flex-1" title="Increase Size">A+</button>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('smaller')" class="px-1.5 py-1 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded focus:outline-none flex-1" title="Decrease Size">A-</button>
                            <div class="w-px h-4 bg-gray-300 dark:bg-gray-600 my-auto mx-0.5 shrink-0"></div>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('justifyLeft')" class="px-1.5 py-1 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex justify-center focus:outline-none flex-1" title="Align Left"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h10M4 18h16"></path></svg></button>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('justifyCenter')" class="px-1.5 py-1 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex justify-center focus:outline-none flex-1" title="Align Center"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M7 12h10M4 18h16"></path></svg></button>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('justifyRight')" class="px-1.5 py-1 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex justify-center focus:outline-none flex-1" title="Align Right"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M10 12h10M4 18h16"></path></svg></button>
                            <div class="w-px h-4 bg-gray-300 dark:bg-gray-600 my-auto mx-0.5 shrink-0"></div>
                            <button type="button" onmousedown="event.preventDefault();" ontouchstart="Admin.saveCursorRange()" onclick="Admin.formatAlertText('link')" class="px-1.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex items-center justify-center focus:outline-none flex-1" title="Add Custom Link">${Admin.icon('globe', 'w-3.5 h-3.5')}</button>
                            <label for="alert-upload-file" id="alert-upload-label" onmousedown="Admin.saveCursorRange()" ontouchstart="Admin.saveCursorRange()" onclick="Admin.saveCursorRange()" class="px-1.5 py-1 text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex items-center justify-center gap-1 focus:outline-none cursor-pointer flex-1 whitespace-nowrap" title="Upload Image or PDF">${Admin.icon('paperclip', 'w-3.5 h-3.5')} Media</label>
                            <input type="file" id="alert-upload-file" class="hidden" accept="image/*,.pdf">
                        </div>
                        <div contenteditable="true" id="alert-msg" class="w-full min-h-[120px] p-2.5 bg-gray-50 dark:bg-gray-900 border-0 text-gray-900 dark:text-white text-xs focus:ring-0 outline-none empty:before:content-[attr(placeholder)] empty:before:text-gray-400" placeholder="e.g. Delays of 45min due to cable theft..."></div>
                    </div>
                </div>


                <!-- SUPERCHARGED: Data Source (HIDDEN IN ADVANCED TOGGLE) -->
                <div class="mt-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                    <button type="button" id="alert-source-toggle-btn" class="w-full text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center justify-between focus:outline-none">
                        <span class="inline-flex items-center gap-1.5">${Admin.icon('note', 'w-3.5 h-3.5')} Add Data Source (Advanced)</span>
                        <svg id="alert-source-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="alert-source-body" class="hidden mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50/50 dark:bg-gray-900/30 p-3 rounded-xl border border-gray-100 dark:border-gray-700/50 shadow-inner">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Source Name</label>
                            <input type="text" id="alert-source-name" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" placeholder="e.g. PRASA Official Twitter">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Source URL (Optional)</label>
                            <input type="text" id="alert-source-url" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" placeholder="https://...">
                        </div>
                    </div>
                </div>

                <!-- SUPERCHARGED: Interactive Poll Manager -->
                <div class="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 p-3 rounded-xl border border-purple-200 dark:border-purple-800 mt-2">
                    <div>
                        <span class="font-bold text-purple-800 dark:text-purple-200 text-sm">Interactive Poll Mode</span>
                        <p class="text-[10px] text-purple-600 dark:text-purple-400 mt-0.5">Add commuter voting buttons</p>
                    </div>
                    <div class="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                        <input type="checkbox" id="alert-poll-toggle" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer outline-none"/>
                        <label for="alert-poll-toggle" class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
                    </div>
                </div>

                <div id="alert-poll-container" class="hidden space-y-3 bg-purple-50/50 dark:bg-purple-900/10 p-4 rounded-xl border border-purple-100 dark:border-purple-800/50 mt-2">
                    <div>
                        <label class="block text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase mb-1">Poll Question</label>
                        <input type="text" id="alert-poll-question" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-700 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-purple-500 outline-none" placeholder="e.g. Would you use a Dark Mode feature?">
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase mb-1">Option A</label>
                            <input type="text" id="alert-poll-opt-a" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-700 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-purple-500 outline-none" placeholder="e.g. Yes">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase mb-1">Option B</label>
                            <input type="text" id="alert-poll-opt-b" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-700 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-purple-500 outline-none" placeholder="e.g. No">
                        </div>
                    </div>
                    <div id="alert-poll-opt-c-wrap" class="hidden">
                        <label class="block text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase mb-1">Option C</label>
                        <input type="text" id="alert-poll-opt-c" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-700 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-purple-500 outline-none" placeholder="e.g. Not sure">
                    </div>
                    <button type="button" id="alert-poll-add-c-btn" class="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 hover:underline focus:outline-none">+ Add third option</button>
                    <div class="flex items-center justify-between bg-white dark:bg-gray-900/60 p-3 rounded-xl border border-purple-200 dark:border-purple-800">
                        <div>
                            <span class="font-bold text-purple-800 dark:text-purple-200 text-xs">Show results to users</span>
                            <p class="text-[10px] text-purple-600 dark:text-purple-400 mt-0.5">Percentages only - after they vote (or while viewing)</p>
                        </div>
                        <div class="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                            <input type="checkbox" id="alert-poll-show-results" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer outline-none"/>
                            <label for="alert-poll-show-results" class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
                        </div>
                    </div>
                </div>

                <div>
                    <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Expiry Time</label>
                    <input type="datetime-local" id="alert-duration-custom" class="w-full h-10 px-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 outline-none">
                    <p class="text-[9px] text-gray-400 mt-1">For one-shot posts: when this live notice expires. Recurring jobs use the duration below instead.</p>
                </div>

                <div class="mt-1 border border-indigo-200 dark:border-indigo-800 rounded-xl overflow-hidden bg-indigo-50/40 dark:bg-indigo-900/10">
                    <button type="button" id="alert-recur-toggle-btn" class="w-full px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-300 flex items-center justify-between focus:outline-none">
                        <span>Recurring schedule (optional)</span>
                        <svg id="alert-recur-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="alert-recur-body" class="hidden px-3 pb-3 space-y-2 border-t border-indigo-100 dark:border-indigo-900/50">
                        <p class="text-[10px] text-indigo-800/80 dark:text-indigo-300/80 leading-snug pt-2">Saves a recipe to the <b>Schedule</b> tab. Due jobs publish when an admin opens Schedule or taps Refresh.</p>
                        <div class="grid grid-cols-2 gap-2">
                            <div class="col-span-2 sm:col-span-1">
                                <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">First run</label>
                                <input type="datetime-local" id="alert-schedule-first" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs outline-none" />
                            </div>
                            <div class="col-span-2 sm:col-span-1">
                                <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Frequency</label>
                                <select id="alert-schedule-freq" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs outline-none">
                                    <option value="once">Once</option>
                                    <option value="hourly">Hourly</option>
                                    <option value="daily">Daily</option>
                                    <option value="weekdays">Weekdays (Mon-Fri)</option>
                                    <option value="weekly">Weekly</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Live for</label>
                                <input type="number" id="alert-schedule-duration-val" min="1" max="999" value="2" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs outline-none" />
                            </div>
                            <div>
                                <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Duration unit</label>
                                <select id="alert-schedule-duration-unit" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs outline-none">
                                    <option value="minutes">Minutes</option>
                                    <option value="hours" selected>Hours</option>
                                    <option value="days">Days</option>
                                </select>
                            </div>
                        </div>
                        <p id="alert-schedule-preview" class="text-[10px] font-medium text-indigo-900 dark:text-indigo-200 bg-white/70 dark:bg-gray-900/50 rounded-lg px-2.5 py-2 border border-indigo-100 dark:border-indigo-900/40 leading-snug">Set first run &amp; duration to preview.</p>
                        <button type="button" id="alert-schedule-save-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-md focus:outline-none">Add to Schedule</button>
                    </div>
                </div>

                <div class="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                     <button id="alert-send-btn" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg shadow-sm transition-colors text-xs uppercase tracking-wide">
                        Post Alert
                    </button>
                    <button id="alert-clear-btn" class="flex-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2.5 rounded-lg shadow-sm transition-colors text-xs uppercase tracking-wide">
                        Clear
                    </button>
                </div>

                <div id="alert-live-poll-results" class="hidden pt-4 border-t border-gray-100 dark:border-gray-700 mt-4">
                    <h4 class="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-widest mb-3 flex items-center"><span class="mr-1.5 inline-flex">${Admin.icon('chart', 'w-3.5 h-3.5')}</span> Live Poll Results</h4>
                    <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-3 border border-gray-200 dark:border-gray-700">
                        <p id="poll-result-question" class="text-xs font-bold text-gray-800 dark:text-gray-200 mb-3 leading-snug">Question...</p>
                        
                        <div class="mb-2">
                            <div class="flex justify-between text-[10px] font-bold text-gray-600 dark:text-gray-400 mb-1">
                                <span id="poll-result-label-a">Option A</span>
                                <span id="poll-result-count-a">0 votes (0%)</span>
                            </div>
                            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div id="poll-result-bar-a" class="bg-purple-500 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
                            </div>
                        </div>
                        
                        <div class="mb-2">
                            <div class="flex justify-between text-[10px] font-bold text-gray-600 dark:text-gray-400 mb-1">
                                <span id="poll-result-label-b">Option B</span>
                                <span id="poll-result-count-b">0 votes (0%)</span>
                            </div>
                            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div id="poll-result-bar-b" class="bg-purple-400 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
                            </div>
                        </div>

                        <div id="poll-result-c-wrap" class="hidden mb-2">
                            <div class="flex justify-between text-[10px] font-bold text-gray-600 dark:text-gray-400 mb-1">
                                <span id="poll-result-label-c">Option C</span>
                                <span id="poll-result-count-c">0 votes (0%)</span>
                            </div>
                            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div id="poll-result-bar-c" class="bg-purple-300 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
                            </div>
                        </div>
                        
                        <div class="mt-3 text-right">
                            <span id="poll-result-total" class="text-[9px] font-black uppercase text-gray-400 tracking-wider">Total Votes: 0</span>
                        </div>
                    </div>
                </div>
                </div>

                <div id="alert-schedule-pane" class="hidden space-y-3">
                    <div class="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-lg border border-indigo-200 dark:border-indigo-800">
                        <p class="text-[10px] text-indigo-800 dark:text-indigo-300 font-medium leading-snug">
                            Live queue of scheduled alerts. Create recipes under <b>New Alert ? Recurring schedule</b>. Refresh publishes any that are due.
                        </p>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-[10px] font-bold text-gray-500 uppercase" id="alert-schedule-status">Idle</span>
                        <button type="button" id="alert-schedule-refresh-btn" class="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded px-2 py-1 text-[10px] font-bold focus:outline-none">Refresh</button>
                    </div>
                    <div id="alert-schedule-list" class="space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar"></div>
                </div>

                <div id="alert-archive-pane" class="hidden space-y-3">
                    <div class="flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-2 rounded-lg border border-gray-100 dark:border-gray-700 shadow-inner gap-2">
                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider pl-1 shrink-0" id="alert-archive-status">Idle</span>
                        <button type="button" id="alert-archive-refresh-btn" class="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 rounded px-2 py-1 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">Refresh</button>
                    </div>
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">Cleared &amp; expired service alerts, poll tallies, and Transit Incident Manager archives.</p>
                    <div class="space-y-2">
                        <button type="button" id="alert-archive-filters-toggle" class="w-full flex items-center justify-between px-2.5 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-[10px] font-black uppercase tracking-wider text-gray-500 focus:outline-none">
                            <span>Filters</span>
                            <svg id="alert-archive-filters-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                        <div id="alert-archive-filters-body" class="hidden grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                                <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Scope</label>
                                <select id="alert-arch-filter-scope" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs outline-none">
                                    <option value="">All scopes</option>
                                    <option value="all">ALL (network)</option>
                                    <option value="region">Region-wide</option>
                                    <option value="route">Route-specific</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Region</label>
                                <select id="alert-arch-filter-region" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs outline-none">
                                    <option value="">All regions</option>
                                    <option value="GP">Gauteng</option>
                                    <option value="WC">Western Cape</option>
                                    <option value="KZN">KZN</option>
                                    <option value="EC">Eastern Cape</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Route</label>
                                <select id="alert-arch-filter-route" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs outline-none">
                                    <option value="">All routes</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div id="alert-archive-list" class="space-y-3 max-h-[520px] overflow-y-auto pr-1 custom-scrollbar"></div>
                </div>
            </div>
        `;
        // Only expose tile once chrome exists
        delete alertPanel.dataset.adminShell;
        alertPanel.removeAttribute('aria-hidden');
        alertPanel.classList.remove('hidden');
        alertPanel.dataset.adminLoaded = "true";

        // --- Logic Wiring ---
        const header = document.getElementById('alert-header-btn');
        const body = document.getElementById('alert-body');
        const chevron = document.getElementById('alert-chevron');
        const alertTarget = document.getElementById('alert-target');
        const dateInput = document.getElementById('alert-duration-custom');
        const alertMsg = document.getElementById('alert-msg');
        const sendBtn = document.getElementById('alert-send-btn');
        const clearBtn = document.getElementById('alert-clear-btn');
        const severitySelect = document.getElementById('alert-severity');
        const tabCompose = document.getElementById('alert-tab-compose');
        const tabSchedule = document.getElementById('alert-tab-schedule');
        const tabArchive = document.getElementById('alert-tab-archive');
        const composePane = document.getElementById('alert-compose-pane');
        const schedulePane = document.getElementById('alert-schedule-pane');
        const archivePane = document.getElementById('alert-archive-pane');
        const archiveRefreshBtn = document.getElementById('alert-archive-refresh-btn');
        
        const signoffInput = document.getElementById('alert-signoff');
        const forcePopupToggle = document.getElementById('alert-force-popup');

        const srcToggleBtn = document.getElementById('alert-source-toggle-btn');
        const srcBody = document.getElementById('alert-source-body');
        const srcChevron = document.getElementById('alert-source-chevron');
        const sourceNameInput = document.getElementById('alert-source-name');
        const sourceUrlInput = document.getElementById('alert-source-url');

        const pollToggle = document.getElementById('alert-poll-toggle');
        const pollContainer = document.getElementById('alert-poll-container');
        const pollQuestion = document.getElementById('alert-poll-question');
        const pollOptA = document.getElementById('alert-poll-opt-a');
        const pollOptB = document.getElementById('alert-poll-opt-b');
        const pollOptC = document.getElementById('alert-poll-opt-c');
        const pollOptCWrap = document.getElementById('alert-poll-opt-c-wrap');
        const pollAddCBtn = document.getElementById('alert-poll-add-c-btn');
        const pollShowResults = document.getElementById('alert-poll-show-results');
        let existingAlertId = null;
        Admin._alertRepostDraft = false;
        Admin._skipAlertFetchOnce = false;

        Admin.currentAlertManagerTab = 'compose';
        const setAlertTab = (tab) => {
            const next = (tab === 'schedule' || tab === 'archive') ? tab : 'compose';
            Admin.currentAlertManagerTab = next;
            if (composePane) composePane.classList.toggle('hidden', next !== 'compose');
            if (schedulePane) schedulePane.classList.toggle('hidden', next !== 'schedule');
            if (archivePane) archivePane.classList.toggle('hidden', next !== 'archive');
            const activeTabCls = 'flex-1 py-2 text-[10px] uppercase font-black border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 transition-colors focus:outline-none tracking-wider';
            const idleTabCls = 'flex-1 py-2 text-[10px] uppercase font-black border-b-2 border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus:outline-none tracking-wider';
            if (tabCompose) tabCompose.className = next === 'compose' ? activeTabCls : idleTabCls;
            if (tabSchedule) tabSchedule.className = next === 'schedule' ? activeTabCls : idleTabCls;
            if (tabArchive) tabArchive.className = next === 'archive' ? activeTabCls : idleTabCls;
            if (next === 'archive') Admin.fetchAlertArchive();
            if (next === 'schedule') Admin.refreshScheduledAlerts();
        };
        Admin.setAlertManagerTab = setAlertTab;
        if (tabCompose) tabCompose.onclick = () => setAlertTab('compose');
        if (tabSchedule) tabSchedule.onclick = () => setAlertTab('schedule');
        if (tabArchive) tabArchive.onclick = () => setAlertTab('archive');
        if (archiveRefreshBtn) archiveRefreshBtn.onclick = () => Admin.fetchAlertArchive();

        document.getElementById('alert-archive-filters-toggle')?.addEventListener('click', () => {
            const bodyEl = document.getElementById('alert-archive-filters-body');
            const chev = document.getElementById('alert-archive-filters-chevron');
            if (!bodyEl) return;
            const open = bodyEl.classList.toggle('hidden') === false;
            chev?.classList.toggle('-rotate-90', !open);
        });
        const refilterArchive = () => {
            if (Admin._cachedAlertArchive) Admin.renderAlertArchiveList(Admin._cachedAlertArchive);
        };
        ['alert-arch-filter-scope', 'alert-arch-filter-region', 'alert-arch-filter-route'].forEach((id) => {
            document.getElementById(id)?.addEventListener('change', refilterArchive);
        });
        const archRouteSel = document.getElementById('alert-arch-filter-route');
        if (archRouteSel && typeof ROUTES !== 'undefined') {
            Object.values(ROUTES)
                .filter((r) => r.isActive && r.id !== 'special_event')
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
                .forEach((r) => {
                    const opt = document.createElement('option');
                    opt.value = r.id;
                    opt.textContent = `${r.region || '?'} - ${Admin.formatRouteLabelPlain ? Admin.formatRouteLabelPlain(r.name) : r.name}`;
                    archRouteSel.appendChild(opt);
                });
        }

        const bindAlertTabSwipe = (el) => {
            if (!el || el.dataset.alertSwipeBound === '1') return;
            el.dataset.alertSwipeBound = '1';
            let startX = 0;
            const order = ['compose', 'schedule', 'archive'];
            el.addEventListener('touchstart', (e) => { startX = e.changedTouches?.[0]?.screenX || 0; }, { passive: true });
            el.addEventListener('touchend', (e) => {
                const diffX = (e.changedTouches?.[0]?.screenX || 0) - startX;
                if (Math.abs(diffX) < 48) return;
                const idx = order.indexOf(Admin.currentAlertManagerTab || 'compose');
                if (diffX < 0 && idx < order.length - 1) setAlertTab(order[idx + 1]);
                else if (diffX > 0 && idx > 0) setAlertTab(order[idx - 1]);
            }, { passive: true });
        };
        bindAlertTabSwipe(document.getElementById('alert-tabs-swipe'));

        document.getElementById('alert-schedule-refresh-btn')?.addEventListener('click', () => Admin.refreshScheduledAlerts());

        const recurToggleBtn = document.getElementById('alert-recur-toggle-btn');
        const recurBody = document.getElementById('alert-recur-body');
        const recurChevron = document.getElementById('alert-recur-chevron');
        if (recurToggleBtn && recurBody) {
            recurToggleBtn.onclick = () => {
                const open = recurBody.classList.toggle('hidden') === false;
                recurChevron?.classList.toggle('-rotate-90', !open);
            };
        }

        const updateSchedulePreview = () => {
            const preview = document.getElementById('alert-schedule-preview');
            if (!preview) return;
            const firstEl = document.getElementById('alert-schedule-first');
            const freqEl = document.getElementById('alert-schedule-freq');
            const durVal = parseFloat(document.getElementById('alert-schedule-duration-val')?.value || '0');
            const durUnit = document.getElementById('alert-schedule-duration-unit')?.value || 'hours';
            const firstMs = firstEl?.value ? new Date(firstEl.value).getTime() : NaN;
            if (!Number.isFinite(firstMs) || !durVal || durVal <= 0) {
                preview.textContent = 'Set first run & duration to preview.';
                return;
            }
            let mult = 3600 * 1000;
            if (durUnit === 'minutes') mult = 60 * 1000;
            else if (durUnit === 'days') mult = 24 * 3600 * 1000;
            const liveMs = Math.max(5 * 60 * 1000, Math.round(durVal * mult));
            const freq = freqEl?.value || 'once';
            const freqLabel = ({
                once: 'once',
                hourly: 'every hour',
                daily: 'every day',
                weekdays: 'on weekdays (Mon-Fri)',
                weekly: 'every week',
            })[freq] || freq;
            const when = Admin.formatDate(firstMs);
            preview.textContent = `Starts ${when}, repeats ${freqLabel}. Each published alert stays live for ${Admin.formatScheduleDurationLabel(liveMs)}.`;
        };
        ['alert-schedule-first', 'alert-schedule-freq', 'alert-schedule-duration-val', 'alert-schedule-duration-unit'].forEach((id) => {
            document.getElementById(id)?.addEventListener('input', updateSchedulePreview);
            document.getElementById(id)?.addEventListener('change', updateSchedulePreview);
        });
        updateSchedulePreview();

        document.getElementById('alert-schedule-save-btn')?.addEventListener('click', async () => {
            const firstEl = document.getElementById('alert-schedule-first');
            const freqEl = document.getElementById('alert-schedule-freq');
            let msg = (alertMsg?.innerHTML || '').trim();
            const target = alertTarget?.value;
            if (!msg || msg === '<br>') { if (typeof showToast === 'function') showToast('Fill the alert message first.', 'error'); return; }
            if (!target) { if (typeof showToast === 'function') showToast('Pick a target audience.', 'error'); return; }
            const firstMs = firstEl?.value ? new Date(firstEl.value).getTime() : NaN;
            if (!Number.isFinite(firstMs)) { if (typeof showToast === 'function') showToast('Set a valid first-run time.', 'error'); return; }
            const durVal = parseFloat(document.getElementById('alert-schedule-duration-val')?.value || '0');
            const durUnit = document.getElementById('alert-schedule-duration-unit')?.value || 'hours';
            if (!durVal || durVal <= 0) { if (typeof showToast === 'function') showToast('Set how long each alert stays live.', 'error'); return; }
            let mult = 3600 * 1000;
            if (durUnit === 'minutes') mult = 60 * 1000;
            else if (durUnit === 'days') mult = 24 * 3600 * 1000;
            const expiresInMs = Math.max(5 * 60 * 1000, Math.round(durVal * mult));

            const secret = await Admin.getAuthKey();
            if (!secret) { if (typeof showToast === 'function') showToast('Authentication required.', 'error'); return; }

            const signoff = (signoffInput?.value || '').trim() || 'Next Train Ops';
            msg = Admin.repairMojibake(msg);
            if (!/<span[^>]*>.*?<\/span>\s*$/i.test(msg)) {
                msg += `<br><br><span class="opacity-75 text-[10px] uppercase font-bold tracking-wider">- ${signoff}</span>`;
            }
            const optCVal = pollToggle?.checked && pollOptC && !pollOptCWrap?.classList.contains('hidden')
                ? (pollOptC.value.trim() || null) : null;
            const schedId = `sched_${Date.now()}`;
            const job = {
                id: schedId,
                target,
                frequency: freqEl?.value || 'once',
                nextRunAt: firstMs,
                createdAt: Date.now(),
                enabled: true,
                notice: {
                    message: msg,
                    authorName: signoff,
                    forcePopup: !!(forcePopupToggle && forcePopupToggle.checked),
                    severity: severitySelect?.value || 'info',
                    imageUrl: null,
                    ctaUrl: null,
                    ctaText: null,
                    sourceName: sourceNameInput ? sourceNameInput.value.trim() || null : null,
                    sourceUrl: sourceUrlInput ? sourceUrlInput.value.trim() || null : null,
                    expiresInMs,
                    poll: {
                        active: !!(pollToggle && pollToggle.checked),
                        question: pollToggle?.checked ? pollQuestion.value.trim() : null,
                        optionA: pollToggle?.checked ? pollOptA.value.trim() : null,
                        optionB: pollToggle?.checked ? pollOptB.value.trim() : null,
                        optionC: optCVal,
                        showResults: pollToggle?.checked ? !!(pollShowResults && pollShowResults.checked) : false,
                    },
                },
            };
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            try {
                const res = await fetch(`${dynamicEndpoint}notices_scheduled/${schedId}.json?auth=${secret}`, {
                    method: 'PUT',
                    body: JSON.stringify(job),
                });
                if (!res.ok) throw new Error('Save failed');
                if (typeof showToast === 'function') showToast('Added to Schedule.', 'success');
                setAlertTab('schedule');
                Admin.refreshScheduledAlerts();
            } catch (e) {
                if (typeof showToast === 'function') showToast(e.message || 'Could not save schedule.', 'error');
            }
        });

        Admin.reviveArchivedAlert = (item) => {
            if (!item) return;
            if (item.kind === 'disruption') {
                if (typeof showToast === 'function') showToast('Use Transit Incident Manager to revive incidents.', 'info');
                return;
            }
            const target = item.clearedFrom || item.target || 'all';
            Admin._alertRepostDraft = true;
            Admin._skipAlertFetchOnce = true;
            setAlertTab('compose');
            body?.classList.remove('hidden');
            chevron?.classList.remove('-rotate-90');
            header?.classList.add('mb-4');

            if (alertTarget) {
                alertTarget.value = target;
                const customDisplay = document.getElementById('alert-target-display');
                const customList = document.getElementById('alert-target-list');
                const selectedOpt = Array.from(alertTarget.options).find((o) => o.value === target);
                if (customDisplay) {
                    if (customList) {
                        const matchLi = Array.from(customList.querySelectorAll('li')).find((li) => selectedOpt && li.textContent.includes(selectedOpt.textContent.split(' [')[0]));
                        if (matchLi) customDisplay.innerHTML = matchLi.innerHTML;
                        else customDisplay.textContent = selectedOpt ? selectedOpt.textContent : target;
                    } else {
                        customDisplay.textContent = selectedOpt ? selectedOpt.textContent : target;
                    }
                }
            }

            existingAlertId = null;
            let cleanedMsg = Admin.repairMojibake(item.message || '');
            cleanedMsg = cleanedMsg.replace(/(<br\s*\/?>\s*){1,2}<span[^>]*>.*?<\/span>\s*$/i, '');
            cleanedMsg = cleanedMsg.replace(/<span[^>]*>.*?<\/span>\s*$/i, '');
            if (alertMsg) alertMsg.innerHTML = cleanedMsg.trim();

            if (item.expiresAt && dateInput) {
                const expiryDate = new Date(Math.max(item.expiresAt, Date.now() + 2 * 3600 * 1000));
                expiryDate.setMinutes(expiryDate.getMinutes() - expiryDate.getTimezoneOffset());
                dateInput.value = expiryDate.toISOString().slice(0, 16);
            }
            if (severitySelect) {
                severitySelect.value = item.severity || 'info';
                const display = document.getElementById('alert-severity-display');
                if (display) {
                    display.innerHTML = Admin._severityLabelHtml(item.severity || 'info');
                }
            }
            if (signoffInput) signoffInput.value = item.authorName || item.signoff || 'Next Train Ops';
            if (forcePopupToggle) forcePopupToggle.checked = item.forcePopup !== undefined ? !!item.forcePopup : (item.severity === 'critical');
            if (sourceNameInput) sourceNameInput.value = item.sourceName || '';
            if (sourceUrlInput) sourceUrlInput.value = item.sourceUrl || '';

            if (item.poll && item.poll.active) {
                if (pollToggle) pollToggle.checked = true;
                pollContainer?.classList.remove('hidden');
                if (pollQuestion) pollQuestion.value = item.poll.question || '';
                if (pollOptA) pollOptA.value = item.poll.optionA || '';
                if (pollOptB) pollOptB.value = item.poll.optionB || '';
                if (pollShowResults) pollShowResults.checked = !!item.poll.showResults;
                if (item.poll.optionC) {
                    if (pollOptC) pollOptC.value = item.poll.optionC;
                    pollOptCWrap?.classList.remove('hidden');
                    pollAddCBtn?.classList.add('hidden');
                }
            } else {
                if (pollToggle) pollToggle.checked = false;
                pollContainer?.classList.add('hidden');
            }

            if (sendBtn) sendBtn.textContent = 'Repost Alert';
            if (typeof showToast === 'function') showToast('Draft ready - review and tap Repost Alert.', 'success');
            composePane?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };

        if (pollAddCBtn && pollOptCWrap) {
            pollAddCBtn.onclick = () => {
                pollOptCWrap.classList.remove('hidden');
                pollAddCBtn.classList.add('hidden');
                pollOptC?.focus();
            };
        }

        // GUARDIAN WYSIWYG FIX: Strip formatting on paste to prevent CSS corruption
        if (alertMsg) {
            alertMsg.addEventListener('paste', (e) => {
                e.preventDefault();
                const text = (e.originalEvent || e).clipboardData.getData('text/plain');
                document.execCommand('insertText', false, text);
            });
        }

        header.onclick = () => {

            if (Admin.isGridMode) return; // Prevent accordion action when in grid
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
                Admin.publishDueScheduledAlerts().catch(() => {});
            }
        };

        if (srcToggleBtn) {
            srcToggleBtn.onclick = () => {
                srcBody.classList.toggle('hidden');
                if (srcBody.classList.contains('hidden')) srcChevron.classList.add('-rotate-90');
                else srcChevron.classList.remove('-rotate-90');
            };
        }

        // GUARDIAN PHASE 3: Inline WYSIWYG File Uploader (Service Alerts)
        const inlineUploadFile = document.getElementById('alert-upload-file');
        if (inlineUploadFile) {
            inlineUploadFile.addEventListener('change', async function() {
                const editor = document.getElementById('alert-msg');
                // GUARDIAN UX FIX: Retrieve pre-upload cursor position locked via mousedown
                const savedRange = Admin._savedRange;
                if (editor) editor.focus();

                if (this.files && this.files.length > 0) {
                    const file = this.files[0];
                    if (file.size > 5242880) { // Strict 5MB limit
                        if (typeof showToast === 'function') showToast("File is too large. Max 5MB.", "error");
                        this.value = '';
                        return;
                    }
                    
                    if (!window.firebaseStorage || !window.firebaseStorageRef || !window.firebaseUploadBytesResumable || !window.firebaseGetDownloadURL) {
                        if (typeof showToast === 'function') showToast("Storage SDK not ready. Check connection.", "error");
                        this.value = '';
                        return;
                    }

                    if (typeof showToast === 'function') showToast("Uploading Attachment...", "info", 30000);

                    try {
                        const fileExt = file.name.split('.').pop().toLowerCase();
                        const isPdf = fileExt === 'pdf';
                        const fileName = `inline_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${fileExt}`;
                        const storageReference = window.firebaseStorageRef(window.firebaseStorage, `admin_attachments/${fileName}`);
                        
                        const uploadTask = window.firebaseUploadBytesResumable(storageReference, file);
                        const labelEl = document.getElementById('alert-upload-label');
                        const originalLabel = labelEl ? labelEl.innerHTML : `${Admin.icon('paperclip', 'w-3.5 h-3.5')} Insert Media`;
                        
                        uploadTask.on('state_changed', 
                            (snapshot) => {
                                const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                                if (labelEl) labelEl.innerHTML = `${progress}%`;
                            }, 
                            (error) => {
                                if (typeof showToast === 'function') showToast("Upload failed", "error");
                                console.error("Inline Upload error:", error);
                                if (labelEl) labelEl.innerHTML = originalLabel;
                                this.value = '';
                            }, 
                            async () => {
                                if (labelEl) labelEl.innerHTML = originalLabel;
                                try {
                                    const url = await window.firebaseGetDownloadURL(uploadTask.snapshot.ref);
                                    
                                    let htmlToInsert = '';
                                    if (isPdf) {
                                        htmlToInsert = `&nbsp;<a href="${url}" target="_blank" class="text-blue-500 dark:text-blue-400 underline font-bold px-1">View Attached PDF</a>&nbsp;`;
                                    } else {
                                        htmlToInsert = `<br><button type="button" onclick="window.openLightbox('${url}')" class="relative block w-full focus:outline-none my-2 cursor-zoom-in rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm active:scale-[0.98] transition-transform"><img src="${url}" class="w-full h-auto object-cover hover:opacity-90 transition-opacity" alt="Admin Attachment"><span class="nt-zoom-plus absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-xs font-bold leading-none flex items-center justify-center border border-white/20 pointer-events-none select-none shadow-sm" aria-hidden="true">+</span></button><br>`;
                                    }
                                    
                                    if (editor) {
                                        editor.focus();
                                        if (savedRange) {
                                            const sel = window.getSelection();
                                            sel.removeAllRanges();
                                            sel.addRange(savedRange);
                                        }
                                        // Use native execCommand for undo-stack support, fallback to manual append if strict sandboxed
                                        if (!document.execCommand('insertHTML', false, htmlToInsert)) {
                                            editor.innerHTML += htmlToInsert;
                                        }
                                        Admin._savedRange = null; // Clear lock
                                    }
                                    if (typeof showToast === 'function') showToast("Attachment inserted!", "success");
                                } catch(e) {
                                    if (typeof showToast === 'function') showToast("Failed to insert attachment link", "error");
                                }
                                this.value = '';
                            }
                        );
                    } catch(e) {
                        if (typeof showToast === 'function') showToast("Upload system error.", "error");
                        this.value = '';
                    }
                }
            });
        }

        if (pollToggle) {
            pollToggle.addEventListener('change', () => {
                if (pollToggle.checked) {
                    if (pollContainer) pollContainer.classList.remove('hidden');
                } else {
                    if (pollContainer) pollContainer.classList.add('hidden');
                }
            });
        }

        async function fetchCurrentAlert(target) {
            if (Admin._skipAlertFetchOnce) {
                Admin._skipAlertFetchOnce = false;
                return;
            }
            Admin._alertRepostDraft = false;
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                // GUARDIAN PHASE 4: Admin Shield - Wraps raw fetch in guardianFetch to prevent deadlocks
                const res = await window.guardianFetch(`${dynamicEndpoint}notices/${target}.json?t=${Date.now()}`, {}, 6000);
                const data = await res.json();
                
                if (data && data.message) {
                    existingAlertId = data.id || null;
                    let cleanedMsg = Admin.repairMojibake(data.message);
                    cleanedMsg = cleanedMsg.replace(/(<br\s*\/?>\s*){1,2}<span[^>]*>.*?<\/span>\s*$/i, '');
                    cleanedMsg = cleanedMsg.replace(/<span[^>]*>.*?<\/span>\s*$/i, '');
                    
                    alertMsg.innerHTML = cleanedMsg.trim();

                    
                    if(data.expiresAt && dateInput) {
                        const expiryDate = new Date(data.expiresAt);
                        expiryDate.setMinutes(expiryDate.getMinutes() - expiryDate.getTimezoneOffset()); 
                        dateInput.value = expiryDate.toISOString().slice(0, 16);
                    }
                    
                    if (severitySelect && data.severity) {
                        severitySelect.value = data.severity;
                        const display = document.getElementById('alert-severity-display');
                        if (display) {
                            display.innerHTML = Admin._severityLabelHtml(data.severity || 'info');
                        }
                    } else if (severitySelect) {
                        severitySelect.value = 'info';
                        const display = document.getElementById('alert-severity-display');
                        if (display) display.innerHTML = Admin._severityLabelHtml('info');
                    }

                    if (data.authorName) signoffInput.value = data.authorName;
                    else signoffInput.value = "Next Train Ops";

                    if (data.forcePopup !== undefined) forcePopupToggle.checked = data.forcePopup;
                    else forcePopupToggle.checked = (data.severity === 'critical');

                    if (data.poll && data.poll.active) {
                        pollToggle.checked = true;
                        pollContainer.classList.remove('hidden');
                        pollQuestion.value = data.poll.question || "";
                        pollOptA.value = data.poll.optionA || "";
                        pollOptB.value = data.poll.optionB || "";
                        if (pollShowResults) pollShowResults.checked = !!data.poll.showResults;
                        if (data.poll.optionC) {
                            if (pollOptC) pollOptC.value = data.poll.optionC;
                            pollOptCWrap?.classList.remove('hidden');
                            pollAddCBtn?.classList.add('hidden');
                        } else {
                            if (pollOptC) pollOptC.value = "";
                            pollOptCWrap?.classList.add('hidden');
                            pollAddCBtn?.classList.remove('hidden');
                        }

                        const pollResultsPanel = document.getElementById('alert-live-poll-results');
                        if (pollResultsPanel && data.id) {
                            try {
                                const secret = await Admin.getAuthKey();
                                const pollRes = await fetch(`${dynamicEndpoint}polls/${data.id}.json?auth=${secret}`);
                                const pollData = await pollRes.json();
                                
                                let countA = 0, countB = 0, countC = 0;
                                if (pollData) {
                                    Object.values(pollData).forEach(vote => {
                                        if (vote.optionKey === 'A') countA++;
                                        else if (vote.optionKey === 'B') countB++;
                                        else if (vote.optionKey === 'C') countC++;
                                    });
                                }
                                
                                const total = countA + countB + countC;
                                const pctA = total > 0 ? Math.round((countA / total) * 100) : 0;
                                const pctB = total > 0 ? Math.round((countB / total) * 100) : 0;
                                const pctC = total > 0 ? Math.round((countC / total) * 100) : 0;
                                
                                document.getElementById('poll-result-question').textContent = data.poll.question;
                                document.getElementById('poll-result-label-a').textContent = data.poll.optionA;
                                document.getElementById('poll-result-label-b').textContent = data.poll.optionB;
                                document.getElementById('poll-result-count-a').textContent = `${countA} votes (${pctA}%)`;
                                document.getElementById('poll-result-count-b').textContent = `${countB} votes (${pctB}%)`;
                                document.getElementById('poll-result-bar-a').style.width = `${pctA}%`;
                                document.getElementById('poll-result-bar-b').style.width = `${pctB}%`;

                                const cWrap = document.getElementById('poll-result-c-wrap');
                                if (data.poll.optionC) {
                                    cWrap?.classList.remove('hidden');
                                    document.getElementById('poll-result-label-c').textContent = data.poll.optionC;
                                    document.getElementById('poll-result-count-c').textContent = `${countC} votes (${pctC}%)`;
                                    document.getElementById('poll-result-bar-c').style.width = `${pctC}%`;
                                } else {
                                    cWrap?.classList.add('hidden');
                                }
                                
                                document.getElementById('poll-result-total').textContent = `Total Votes: ${total}`;
                                pollResultsPanel.classList.remove('hidden');
                            } catch(e) { console.warn("Could not fetch poll results", e); }
                        }
                    } else {
                        pollToggle.checked = false;
                        pollContainer.classList.add('hidden');
                        pollQuestion.value = "";
                        pollOptA.value = "";
                        pollOptB.value = "";
                        if (pollOptC) pollOptC.value = "";
                        if (pollShowResults) pollShowResults.checked = false;
                        pollOptCWrap?.classList.add('hidden');
                        pollAddCBtn?.classList.remove('hidden');
                        const pollResultsPanel = document.getElementById('alert-live-poll-results');
                        if (pollResultsPanel) pollResultsPanel.classList.add('hidden');
                    }

                    sendBtn.textContent = "Update Alert"; 
                } else {
                    existingAlertId = null;
                    alertMsg.innerHTML = "";
                    
                    const pollResultsPanel = document.getElementById('alert-live-poll-results');
                    if (pollResultsPanel) pollResultsPanel.classList.add('hidden');
                    if(severitySelect) {
                        severitySelect.value = 'info';
                        const display = document.getElementById('alert-severity-display');
                        if (display) display.innerHTML = Admin._severityLabelHtml('info');
                    }

                    signoffInput.value = "Next Train Ops";
                    forcePopupToggle.checked = false;

                    pollToggle.checked = false;
                    pollContainer.classList.add('hidden');
                    pollQuestion.value = "";
                    pollOptA.value = "";
                    pollOptB.value = "";
                    if (pollOptC) pollOptC.value = "";
                    if (pollShowResults) pollShowResults.checked = false;
                    pollOptCWrap?.classList.add('hidden');
                    pollAddCBtn?.classList.remove('hidden');

                    sendBtn.textContent = "Post Alert";
                }
            } catch (e) { console.log("No active alert."); }
        }

        Admin.populateAlertTargets = (skipFetch = false) => {
            const currentVal = alertTarget.value;
            alertTarget.innerHTML = '';
            
            const customList = document.getElementById('alert-target-list');
            if (customList) customList.innerHTML = '';
            const customDisplay = document.getElementById('alert-target-display');

            const addGroup = (label) => {
                const group = document.createElement('optgroup');
                group.label = label;
                alertTarget.appendChild(group);

                if (customList) {
                    const liGroup = document.createElement('li');
                    liGroup.className = "px-3 py-1.5 text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest bg-gray-100 dark:bg-gray-800 select-none sticky top-0 z-10 border-y border-gray-200 dark:border-gray-700";
                    liGroup.textContent = label;
                    customList.appendChild(liGroup);
                }
                return group;
            };

            const addOption = (group, value, text, htmlText = text) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = text;
                group.appendChild(opt);

                if (customList) {
                    const li = document.createElement('li');
                    // GUARDIAN UX FIX: Added pl-6 for child indentation
                    li.className = "pl-6 pr-3 py-2.5 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 cursor-pointer flex items-center";
                    li.setAttribute('data-value', value);
                    li.innerHTML = htmlText;
                    li.onclick = () => {
                        alertTarget.value = value;
                        if (customDisplay) customDisplay.innerHTML = htmlText;
                        customList.classList.add('hidden');
                        const chevron = document.getElementById('alert-target-chevron');
                        if (chevron) chevron.classList.remove('rotate-180');
                        alertTarget.dispatchEvent(new Event('change'));
                    };
                    customList.appendChild(li);
                }
            };

            const globalGroup = addGroup("Global Alerts");
            addOption(globalGroup, "all", "Entire Network (All Regions)", `<span class='truncate inline-flex items-center gap-1'>${Admin.icon('globe', 'w-3.5 h-3.5 shrink-0')} Entire Network (All Regions)</span>`);
            addOption(globalGroup, "all_GP", "Gauteng Only", "<span class='truncate'>Gauteng Only</span>");
            addOption(globalGroup, "all_WC", "Western Cape Only", "<span class='truncate'>Western Cape Only</span>");
            addOption(globalGroup, "all_KZN", "KwaZulu-Natal Only", "<span class='truncate'>KwaZulu-Natal Only</span>");
            addOption(globalGroup, "all_EC", "Eastern Cape Only", "<span class='truncate'>Eastern Cape Only</span>");

            if (typeof ROUTES !== 'undefined') {
                const regions = [
                    { code: 'GP', label: "Gauteng Routes" },
                    { code: 'WC', label: "Western Cape Routes" },
                    { code: 'KZN', label: "KwaZulu-Natal Routes" },
                    { code: 'EC', label: "Eastern Cape Routes" }
                ];

                regions.forEach(regionInfo => {
                    const regionalRoutes = Object.values(ROUTES).filter(r => r.region === regionInfo.code && r.isActive && r.id !== 'special_event');
                    if (regionalRoutes.length > 0) {
                        const group = addGroup(regionInfo.label);
                        regionalRoutes.forEach(r => {
                            const cues = typeof Admin.getRouteCues === 'function' ? Admin.getRouteCues(r.id) : '';
                            const plainName = Admin.formatRouteLabelPlain(r.name);
                            const text = `${plainName}${cues}`;
                            
                            let badgeHtml = '';
                            if (cues) {
                                if (cues.includes('Notice')) badgeHtml += '<span class="ml-1.5 px-1 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 text-[8px] rounded uppercase flex-shrink-0">Note</span>';
                                if (cues.includes('Bans')) badgeHtml += '<span class="ml-1 px-1 py-0.5 bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 text-[8px] rounded uppercase flex-shrink-0">Ban</span>';
                                if (cues.includes('Incident')) badgeHtml += '<span class="ml-1 px-1 py-0.5 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400 text-[8px] rounded uppercase flex-shrink-0">Inc</span>';
                                if (cues.includes('Alert')) badgeHtml += '<span class="ml-1 px-1 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400 text-[8px] rounded uppercase flex-shrink-0">Alert</span>';
                            }
                            const htmlText = `<span class="truncate mr-1 inline-flex items-center">${Admin.formatRouteLabelHtml(r.name)}</span>${badgeHtml}`;
                            addOption(group, r.id, text, htmlText);
                        });
                    }
                });
            }
            
            // Prefer GSM / Review deep-link target over sticky "Gauteng Only" default
            const preferVal = Admin._pendingAdminRoute || currentVal || '';
            let selectedOpt = null;
            if (preferVal) {
                const optionToSelect = Array.from(alertTarget.options).find((o) => o.value === preferVal);
                if (optionToSelect) {
                    optionToSelect.selected = true;
                    alertTarget.value = preferVal;
                    selectedOpt = optionToSelect;
                }
            }
            if (!selectedOpt) {
                const defOpt = typeof currentRegion !== 'undefined' ? `all_${currentRegion}` : 'all_GP';
                const optionToSelect = Array.from(alertTarget.options).find((o) => o.value === defOpt);
                if (optionToSelect) {
                    optionToSelect.selected = true;
                    selectedOpt = optionToSelect;
                }
            }

            if (selectedOpt) {
                Admin._syncAdminSelectDisplay('alert-target', selectedOpt.value);
            }

            if (!skipFetch) fetchCurrentAlert(alertTarget.value);
        };

        if (alertTarget) {
            alertTarget.addEventListener('change', () => fetchCurrentAlert(alertTarget.value));
        }
        Admin.populateAlertTargets();

        const now = new Date();
        now.setHours(23, 59, 59, 999);
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); 
        if(dateInput) dateInput.value = now.toISOString().slice(0, 16);

        sendBtn.onclick = async () => {
            let msg = alertMsg.innerHTML.trim();
            const target = alertTarget.value;
            const severity = severitySelect.value;
            
            const signoff = signoffInput.value.trim() || "Next Train Ops";
            const isForcePopup = forcePopupToggle.checked;
            
            const secret = await Admin.getAuthKey();
            
            if (!msg || msg === '<br>') { if (typeof showToast === 'function') showToast("Message required!", "error"); return; }
            if (!secret) { if (typeof showToast === 'function') showToast("Authentication required! Sign in again.", "error"); return; }

            msg = Admin.repairMojibake(msg);
            msg += `<br><br><span class="opacity-75 text-[10px] uppercase font-bold tracking-wider">- ${signoff}</span>`;


            let expiresAtVal = dateInput && dateInput.value ? new Date(dateInput.value).getTime() : Date.now() + (2 * 3600 * 1000);

            const optCVal = pollToggle.checked && pollOptC && !pollOptCWrap?.classList.contains('hidden')
                ? (pollOptC.value.trim() || null)
                : null;
            const isRepost = !!Admin._alertRepostDraft;
            const nowTs = Date.now();
            const payload = {
                id: existingAlertId || nowTs.toString(),
                message: msg,
                authorName: signoff,
                forcePopup: isForcePopup,
                postedAt: nowTs,
                expiresAt: expiresAtVal,
                severity: severity,
                imageUrl: null,
                ctaUrl: null,
                ctaText: null,
                sourceName: sourceNameInput ? sourceNameInput.value.trim() || null : null,
                sourceUrl: sourceUrlInput ? sourceUrlInput.value.trim() || null : null,
                isRepost: isRepost || false,
                repostedAt: isRepost ? nowTs : null,
                poll: {
                    active: pollToggle.checked,
                    question: pollToggle.checked ? pollQuestion.value.trim() : null,
                    optionA: pollToggle.checked ? pollOptA.value.trim() : null,
                    optionB: pollToggle.checked ? pollOptB.value.trim() : null,
                    optionC: optCVal,
                    showResults: pollToggle.checked ? !!(pollShowResults && pollShowResults.checked) : false,
                }
            };

            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            const url = `${dynamicEndpoint}notices/${target}.json?auth=${secret}`;

            try {
                sendBtn.textContent = isRepost ? "Reposting..." : "Posting...";
                sendBtn.disabled = true;
                // GUARDIAN PHASE 4: Admin Shield - Wraps raw fetch in guardianFetch to prevent deadlocks
                const res = await window.guardianFetch(url, { method: 'PUT', body: JSON.stringify(payload) }, 10000);
                if (res.ok) {
                    existingAlertId = payload.id;
                    Admin._alertRepostDraft = false;
                    if (typeof showToast === 'function') showToast(isRepost ? "Alert Reposted!" : "Alert Posted!", "success");
                    if (typeof checkServiceAlerts === 'function') checkServiceAlerts(); 
                } else {
                    if (typeof showToast === 'function') showToast("Failed. Check Session.", "error");
                }
            } catch (e) { if (typeof showToast === 'function') showToast("Error: " + e.message, "error"); } 
            finally { sendBtn.textContent = "Update Alert"; sendBtn.disabled = false; }
        };

        clearBtn.onclick = async () => {
            const target = alertTarget.value;
            const secret = await Admin.getAuthKey();
            if (!secret) { if (typeof showToast === 'function') showToast("Authentication required.", "error"); return; }
            
            const confirmed = await Admin.secureConfirm("Clear Alert", `Archive & clear alert for: ${target}?`);
            if (!confirmed) return;

            try {
                const archived = await Admin.archiveActiveNotice(target, secret);
                if (!archived) {
                    if (typeof showToast === 'function') showToast("No active alert to clear for this target.", "info");
                    return;
                }
                try {
                    await fetch('https://nexttrain-telemetry.enock.workers.dev/admin/purge', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${secret}` }
                    });
                } catch (pe) { console.warn("Purge failed", pe); }

                if (typeof showToast === 'function') showToast("Cleared & Archived!", "info");

                existingAlertId = null;
                alertMsg.innerHTML = "";
                signoffInput.value = "Next Train Ops";
                forcePopupToggle.checked = false;
                pollToggle.checked = false;
                pollContainer.classList.add('hidden');
                pollQuestion.value = "";
                pollOptA.value = "";
                pollOptB.value = "";
                if (pollOptC) pollOptC.value = "";
                if (pollShowResults) pollShowResults.checked = false;
                pollOptCWrap?.classList.add('hidden');
                pollAddCBtn?.classList.remove('hidden');
                const livePoll = document.getElementById('alert-live-poll-results');
                if (livePoll) livePoll.classList.add('hidden');

                sendBtn.textContent = "Post Alert";
                if (typeof checkServiceAlerts === 'function') setTimeout(checkServiceAlerts, 500);
            } catch (e) { if (typeof showToast === 'function') showToast(e.message || "Failed to clear alert.", "error"); }
        };
    },

    fetchAlertArchive: async () => {
        const statusEl = document.getElementById('alert-archive-status');
        const listEl = document.getElementById('alert-archive-list');
        if (!listEl) return;

        const secret = await Admin.getAuthKey();
        if (!secret) {
            if (statusEl) statusEl.textContent = 'Auth required';
            return;
        }

        if (statusEl) statusEl.textContent = 'Sweeping expired...';
        listEl.innerHTML = `<div class="text-center py-6 text-xs text-gray-400 animate-pulse">Loading archive...</div>`;

        try {
            const swept = await Admin.sweepExpiredAlertsToArchive(secret);
            if (statusEl) statusEl.textContent = 'Loading...';
            const items = await Admin.loadUnifiedAlertArchive(secret);
            const filtered = Admin.filterAlertArchiveItems(items);
            Admin.renderAlertArchiveList(items);
            const noticeN = filtered.filter((i) => (i.kind || 'notice') !== 'disruption').length;
            const disrN = filtered.filter((i) => i.kind === 'disruption').length;
            const sweepNote = (swept.notices || swept.disruptions)
                ? ` - moved ${swept.notices} alert(s), ${swept.disruptions} incident(s)`
                : '';
            const filterNote = filtered.length !== items.length ? ` - showing ${filtered.length}/${items.length}` : '';
            if (statusEl) statusEl.textContent = `${noticeN} alerts - ${disrN} incidents${filterNote}${sweepNote}`;
        } catch (e) {
            console.warn('fetchAlertArchive failed', e);
            if (statusEl) statusEl.textContent = 'Failed';
            listEl.innerHTML = `<div class="text-center py-6 text-xs text-red-500">Could not load archive.</div>`;
        }
    },

    renderAlertArchiveList: (items) => {
        const listEl = document.getElementById('alert-archive-list');
        if (!listEl) return;
        const all = Array.isArray(items) ? items : (Admin._cachedAlertArchive || []);
        Admin._cachedAlertArchive = all;
        const rows = Admin.filterAlertArchiveItems(all);
        if (!all.length) {
            listEl.innerHTML = `<div class="text-center py-8 text-xs text-gray-400">Archive is empty.</div>`;
            return;
        }
        if (!rows.length) {
            listEl.innerHTML = `<div class="text-center py-8 text-xs text-gray-400">No archived alerts match these filters.</div>`;
            return;
        }

        listEl.innerHTML = rows.map((item, idx) => {
            const isDisr = item.kind === 'disruption';
            const sev = (item.severity || (item.tier === 'CRITICAL' ? 'critical' : 'info')).toLowerCase();
            const sevCls = sev === 'critical'
                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                : sev === 'warning'
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
            // Unicode escapes (encoding-safe) — same glyphs as live hub titles
            const sevEmoji = sev === 'critical' ? '\uD83D\uDD34' : sev === 'warning' ? '\uD83D\uDFE1' : '\uD83D\uDD35';
            const sevLabel = sev === 'critical' ? 'Critical' : sev === 'warning' ? 'Warning' : 'Info';
            const kindCls = isDisr
                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
            const reason = item.archiveReason || (item.archivedAt ? 'cleared' : 'archived');
            const when = item.archivedAt || item.postedAt;
            const whenStr = when ? Admin.formatDate(when) : '-';
            const plain = (() => {
                try {
                    const d = document.createElement('div');
                    d.innerHTML = item.message || item.longExplanation || item.buttonText || '';
                    return (d.textContent || '').trim().slice(0, 140) || '(no message)';
                } catch { return '(no message)'; }
            })();
            const poll = item.pollResults;
            const pollHint = poll && poll.total
                ? `<span class="text-[9px] font-bold text-purple-600 dark:text-purple-400">Poll - ${poll.total} vote${poll.total === 1 ? '' : 's'}</span>`
                : (item.poll && item.poll.active
                    ? `<span class="text-[9px] font-bold text-purple-500">Had poll</span>`
                    : '');
            const scope = escapeHTML(String(item.clearedFrom || item.target || item.routeId || '-'));
            const idSafe = escapeHTML(String(item.id || item._archKey || idx));

            return `
                <button type="button" data-archive-idx="${idx}" class="alert-archive-item w-full text-left p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 hover:border-blue-400 dark:hover:border-blue-500 transition-colors shadow-sm focus:outline-none">
                    <div class="flex flex-wrap items-center gap-1.5 mb-1.5">
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${kindCls}">${isDisr ? 'Incident' : 'Alert'}</span>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${sevCls}">${sevEmoji} ${sevLabel}</span>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">${escapeHTML(reason)}</span>
                        ${pollHint}
                    </div>
                    <p class="text-xs text-gray-800 dark:text-gray-200 leading-snug line-clamp-2 mb-1">${escapeHTML(plain)}</p>
                    <div class="flex justify-between gap-2 text-[9px] font-mono text-gray-400">
                        <span class="truncate">${scope} - ${idSafe}</span>
                        <span class="shrink-0">${escapeHTML(whenStr)}</span>
                    </div>
                </button>`;
        }).join('');

        listEl.querySelectorAll('.alert-archive-item').forEach((btn) => {
            btn.onclick = () => {
                const idx = Number(btn.getAttribute('data-archive-idx'));
                const item = rows[idx];
                if (item) Admin.previewArchivedAlert(item);
            };
        });

        const statusEl = document.getElementById('alert-archive-status');
        if (statusEl && all.length) {
            const noticeN = rows.filter((i) => (i.kind || 'notice') !== 'disruption').length;
            const disrN = rows.filter((i) => i.kind === 'disruption').length;
            const filterNote = rows.length !== all.length ? ` - showing ${rows.length}/${all.length}` : '';
            statusEl.textContent = `${noticeN} alerts - ${disrN} incidents${filterNote}`;
        }
    },

    /** Rebuild full advisory HTML (message, source, poll tallies) for archive / feedback preview. */
    buildAlertPreviewHtml: (data) => {
        if (!data) return '<p class="text-sm text-gray-500">No alert data.</p>';
        const isDisr = data.kind === 'disruption' || data.tier || data.longExplanation;
        const severity = (data.severity || (data.tier === 'CRITICAL' ? 'critical' : (isDisr ? 'warning' : 'info'))).toLowerCase();
        const title = isDisr
            ? (severity === 'critical' ? '\uD83D\uDD34 CRITICAL INCIDENT' : '\uD83D\uDFE0 TRANSIT INCIDENT')
            : (severity === 'critical' ? '\uD83D\uDD34 CRITICAL ADVISORY' : severity === 'warning' ? '\uD83D\uDFE1 SERVICE WARNING' : '\uD83D\uDD35 SERVICE INFO');
        const borderCls = severity === 'critical'
            ? 'border-red-500'
            : severity === 'warning'
                ? 'border-yellow-500'
                : 'border-blue-500';
        const titleCls = severity === 'critical'
            ? 'text-red-600 dark:text-red-400'
            : severity === 'warning'
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-blue-600 dark:text-blue-400';

        let statusHtml = data.archivedAt
            ? `<span class="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase mb-2 inline-block">Archived${data.archiveReason ? ` - ${escapeHTML(String(data.archiveReason))}` : ''}</span>`
            : `<span class="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase mb-2 inline-block">Active</span>`;

        const lb = (url) => {
            const safe = String(url || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `Admin.openLightbox('${safe}')`;
        };
        let imgHtml = data.imageUrl
            ? `<button type="button" onclick="event.stopPropagation(); ${lb(data.imageUrl)}" class="relative block w-full focus:outline-none mb-3 cursor-zoom-in rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm active:scale-[0.98] transition-transform"><img src="${escapeHTML(data.imageUrl)}" class="w-full h-auto max-h-40 object-cover hover:opacity-90 transition-opacity"><span class="nt-zoom-plus absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-xs font-bold leading-none flex items-center justify-center border border-white/20 pointer-events-none select-none shadow-sm" aria-hidden="true">+</span></button>`
            : '';

        let parsedMessage = data.message || data.longExplanation || data.buttonText || data.text || 'No details provided.';
        parsedMessage = parsedMessage.replace(/(<button[^>]*>)?\s*(<img[^>]+src=["']([^"']+)["'][^>]*>)\s*(<\/button>)?/gi, (match, btnStart, imgTag, srcUrl, btnEnd) => {
            if (btnStart || btnEnd) return match;
            return `<button type="button" onclick="event.stopPropagation(); ${lb(srcUrl)}" class="relative block w-full focus:outline-none my-2 cursor-zoom-in rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm active:scale-[0.98] transition-transform">${imgTag}<span class="nt-zoom-plus absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-xs font-bold leading-none flex items-center justify-center border border-white/20 pointer-events-none select-none shadow-sm" aria-hidden="true">+</span></button>`;
        });

        if (data.sourceName) {
            const sName = escapeHTML(data.sourceName);
            const sUrl = data.sourceUrl ? escapeHTML(data.sourceUrl) : null;
            const innerCitation = sUrl
                ? `<a href="${sUrl}" target="_blank" rel="noopener" class="hover:underline text-blue-600 dark:text-blue-400 font-medium flex items-center">${sName} <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg></a>`
                : `<span class="font-medium text-gray-700 dark:text-gray-300">${sName}</span>`;
            parsedMessage += `<div class="mt-3 p-2.5 bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-lg text-[10px] text-gray-500 dark:text-gray-400 italic flex items-center shadow-sm w-fit max-w-full"><span class="mr-1.5 not-italic inline-flex text-gray-500">${Admin.icon('note', 'w-3.5 h-3.5')}</span><span class="flex items-center space-x-1"><span>Source:</span> ${innerCitation}</span></div>`;
        }

        let pollHtml = '';
        const poll = data.poll;
        const results = data.pollResults || null;
        if (poll && (poll.active || poll.question || results)) {
            const total = results ? (results.total || ((results.A || 0) + (results.B || 0) + (results.C || 0))) : 0;
            const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
            const bar = (label, count, color) => {
                const p = pct(count || 0);
                return `
                    <div class="mb-2">
                        <div class="flex justify-between text-[10px] font-bold text-gray-600 dark:text-gray-400 mb-1">
                            <span>${escapeHTML(label || 'Option')}</span>
                            <span>${count || 0} vote${(count || 0) === 1 ? '' : 's'} (${p}%)</span>
                        </div>
                        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div class="${color} h-2 rounded-full" style="width:${p}%"></div>
                        </div>
                    </div>`;
            };
            pollHtml = `
                <div class="mt-4 p-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-900/20">
                    <p class="text-[10px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-2">Poll Snapshot</p>
                    <p class="text-xs font-bold text-gray-800 dark:text-gray-200 mb-3 leading-snug">${escapeHTML(poll.question || 'Poll')}</p>
                    ${results ? `
                        ${bar(poll.optionA || 'A', results.A, 'bg-purple-500')}
                        ${bar(poll.optionB || 'B', results.B, 'bg-purple-400')}
                        ${poll.optionC || (results.C || 0) > 0 ? bar(poll.optionC || 'C', results.C, 'bg-purple-300') : ''}
                        <div class="text-right text-[9px] font-black uppercase text-gray-400 tracking-wider">Total Votes: ${total}</div>
                    ` : `
                        <div class="flex flex-wrap gap-2 text-[10px] font-bold">
                            <span class="px-2 py-1 rounded-lg bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-700">${escapeHTML(poll.optionA || 'A')}</span>
                            <span class="px-2 py-1 rounded-lg bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-700">${escapeHTML(poll.optionB || 'B')}</span>
                            ${poll.optionC ? `<span class="px-2 py-1 rounded-lg bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-700">${escapeHTML(poll.optionC)}</span>` : ''}
                        </div>
                        <p class="text-[10px] text-gray-500 mt-2">No tallies stored for this archive entry.</p>
                    `}
                </div>`;
        }

        const postedStr = data.postedAt ? Admin.formatDate(data.postedAt) : '-';
        const archivedStr = data.archivedAt ? Admin.formatDate(data.archivedAt) : null;
        const signoff = data.signoff || data.signedBy || '';
        const scope = data.clearedFrom || data.target || data.routeId || '';

        return `
            <div class="rounded-xl border-2 ${borderCls} p-3 bg-white dark:bg-gray-900/50">
                <div class="flex items-center justify-between gap-2 mb-2">
                    <h4 class="text-sm font-black tracking-tight ${titleCls}">${title}</h4>
                    ${statusHtml}
                </div>
                ${imgHtml}
                <div class="text-sm text-gray-800 dark:text-gray-200 leading-relaxed mb-2">${parsedMessage}</div>
                ${signoff ? `<p class="text-[10px] text-gray-500 italic mb-2">- ${escapeHTML(String(signoff))}</p>` : ''}
                ${pollHtml}
                <div class="text-[10px] text-gray-500 font-mono border-t border-gray-200 dark:border-gray-700 pt-2 mt-3 space-y-0.5">
                    <div>ID: ${escapeHTML(String(data.id || '-'))}</div>
                    ${scope ? `<div>Scope: ${escapeHTML(String(scope))}</div>` : ''}
                    <div>Posted: ${escapeHTML(postedStr)}</div>
                    ${archivedStr ? `<div>Archived: ${escapeHTML(archivedStr)}</div>` : ''}
                    <div>Severity: ${escapeHTML(severity)}</div>
                    ${isDisr && data.tier ? `<div>Tier: ${escapeHTML(String(data.tier))}</div>` : ''}
                </div>
            </div>`;
    },

    /** Temporarily stack user alert modals above the admin dashboard. */
    _elevateModalForAdmin: (modalEl) => {
        if (!modalEl) return () => {};
        const prev = modalEl.style.zIndex;
        modalEl.dataset.adminPrevZ = prev;
        modalEl.style.zIndex = '260';
        return () => {
            modalEl.style.zIndex = modalEl.dataset.adminPrevZ || '';
            delete modalEl.dataset.adminPrevZ;
        };
    },

    /** Body HTML for notice-modal (no outer padded card). */
    buildNoticeBodyHtml: (data) => {
        if (!data) return '<p class="text-sm text-gray-500">No alert data.</p>';
        // Admin.openLightbox (z-300) — never window.openLightbox/map-modal (z-160 under archive preview z-260)
        const lb = (url) => {
            const safe = String(url || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `Admin.openLightbox('${safe}')`;
        };
        let imgHtml = data.imageUrl
            ? `<button type="button" onclick="event.stopPropagation(); ${lb(data.imageUrl)}" class="relative block w-full focus:outline-none mb-3 cursor-zoom-in rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm active:scale-[0.98] transition-transform"><img src="${escapeHTML(data.imageUrl)}" class="w-full h-auto max-h-40 object-cover hover:opacity-90 transition-opacity"><span class="nt-zoom-plus absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-xs font-bold leading-none flex items-center justify-center border border-white/20 pointer-events-none select-none shadow-sm" aria-hidden="true">+</span></button>`
            : '';
        let parsedMessage = data.message || data.text || 'No details provided.';
        parsedMessage = parsedMessage.replace(/(<button[^>]*>)?\s*(<img[^>]+src=["']([^"']+)["'][^>]*>)\s*(<\/button>)?/gi, (match, btnStart, imgTag, srcUrl, btnEnd) => {
            if (btnStart || btnEnd) return match;
            return `<button type="button" onclick="event.stopPropagation(); ${lb(srcUrl)}" class="relative block w-full focus:outline-none my-2 cursor-zoom-in rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm active:scale-[0.98] transition-transform">${imgTag}<span class="nt-zoom-plus absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-xs font-bold leading-none flex items-center justify-center border border-white/20 pointer-events-none select-none shadow-sm" aria-hidden="true">+</span></button>`;
        });
        if (data.sourceName) {
            const sName = escapeHTML(data.sourceName);
            const sUrl = data.sourceUrl ? escapeHTML(data.sourceUrl) : null;
            const innerCitation = sUrl
                ? `<a href="${sUrl}" target="_blank" rel="noopener" class="hover:underline text-blue-600 dark:text-blue-400 font-medium flex items-center">${sName} <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg></a>`
                : `<span class="font-medium text-gray-700 dark:text-gray-300">${sName}</span>`;
            parsedMessage += `<div class="mt-3 p-2.5 bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-lg text-[10px] text-gray-500 dark:text-gray-400 italic flex items-center shadow-sm w-fit max-w-full"><span class="mr-1.5 not-italic inline-flex text-gray-500">${Admin.icon('note', 'w-3.5 h-3.5')}</span><span class="flex items-center space-x-1"><span>Source:</span> ${innerCitation}</span></div>`;
        }
        const signoff = data.signoff || data.signedBy || '';
        let pollHtml = '';
        const poll = data.poll;
        const results = data.pollResults || null;
        if (poll && (poll.active || poll.question || results)) {
            const total = results ? (results.total || ((results.A || 0) + (results.B || 0) + (results.C || 0))) : 0;
            const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
            const bar = (label, count, color) => {
                const p = pct(count || 0);
                return `<div class="mb-2"><div class="flex justify-between text-[10px] font-bold text-gray-600 dark:text-gray-400 mb-1"><span>${escapeHTML(label || 'Option')}</span><span>${count || 0} (${p}%)</span></div><div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2"><div class="${color} h-2 rounded-full" style="width:${p}%"></div></div></div>`;
            };
            pollHtml = `<div class="mt-4 p-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-900/20"><p class="text-[10px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-2">Poll Snapshot</p><p class="text-xs font-bold text-gray-800 dark:text-gray-200 mb-3">${escapeHTML(poll.question || 'Poll')}</p>${results ? `${bar(poll.optionA || 'A', results.A, 'bg-purple-500')}${bar(poll.optionB || 'B', results.B, 'bg-purple-400')}${poll.optionC || (results.C || 0) > 0 ? bar(poll.optionC || 'C', results.C, 'bg-purple-300') : ''}<div class="text-right text-[9px] font-black uppercase text-gray-400">Total: ${total}</div>` : `<p class="text-[10px] text-gray-500">No tallies stored.</p>`}</div>`;
        }
        const statusChip = data.archivedAt
            ? `<span class="inline-block bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase mb-2">Archived${data.archiveReason ? ` - ${escapeHTML(String(data.archiveReason))}` : ''}</span>`
            : '';
        return `${statusChip}${imgHtml}<div class="leading-relaxed">${parsedMessage}</div>${signoff ? `<p class="text-[10px] text-gray-500 italic mt-2">- ${escapeHTML(String(signoff))}</p>` : ''}${pollHtml}`;
    },

    previewArchivedAlert: (item) => {
        if (!item) return;
        const isDisr = item.kind === 'disruption' || !!item.tier || (!!item.longExplanation && !!item.stations);
        if (isDisr) Admin._previewArchiveAsDisruption(item);
        else Admin._previewArchiveAsNotice(item);
    },

    _previewArchiveAsNotice: (item) => {
        const modal = document.getElementById('notice-modal');
        const content = document.getElementById('notice-content');
        const timestamp = document.getElementById('notice-timestamp');
        if (!modal || !content) {
            // Fallback if hub markup missing
            if (typeof showToast === 'function') showToast('Notice modal unavailable.', 'error');
            return;
        }
        const restoreZ = Admin._elevateModalForAdmin(modal);
        const severity = (item.severity || 'info').toLowerCase();
        const modalCard = document.getElementById('notice-modal-card') || modal.firstElementChild;
        if (modalCard) {
            modalCard.classList.remove('border-red-500', 'border-yellow-500', 'border-blue-500');
            if (severity === 'critical') modalCard.classList.add('border-red-500');
            else if (severity === 'warning') modalCard.classList.add('border-yellow-500');
            else modalCard.classList.add('border-blue-500');
        }
        const modalHeader = document.getElementById('notice-modal-title') || modal.querySelector('h3');
        if (modalHeader) {
            const headerContainer = modalHeader.parentElement;
            if (headerContainer) {
                headerContainer.className = `flex items-center shrink-0 ${
                    severity === 'critical' ? 'text-red-600 dark:text-red-400'
                        : severity === 'warning' ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-blue-600 dark:text-blue-400'
                }`;
            }
            // Unicode escapes stay encoding-safe (matches live hub.js titles)
            modalHeader.textContent = severity === 'critical'
                ? '\uD83D\uDD34 CRITICAL ADVISORY'
                : severity === 'warning'
                    ? '\uD83D\uDFE1 SERVICE WARNING'
                    : '\uD83D\uDD35 SERVICE INFO';
        }
        content.innerHTML = Admin.buildNoticeBodyHtml(item);
        if (timestamp) {
            const posted = item.repostedAt || item.postedAt || item.timestamp;
            const postedStr = posted ? Admin.formatDate(posted) : '-';
            const archStr = item.archivedAt ? Admin.formatDate(item.archivedAt) : null;
            timestamp.innerHTML = `Posted: ${escapeHTML(postedStr)}${archStr ? `<br>Archived: ${escapeHTML(archStr)}` : ''}<br><span class="text-[10px]">ID: ${escapeHTML(String(item.id || '-'))}</span>`;
        }

        modal.querySelectorAll('.nt-notice-actions').forEach((el) => el.remove());
        const oldCloseBtn = document.getElementById('notice-modal-close-btn');
        if (oldCloseBtn) oldCloseBtn.style.display = 'none';

        const closePreview = () => {
            restoreZ();
            // Close without history.back() — archive preview never pushed #notice.
            if (typeof closeSmoothModal === 'function') closeSmoothModal('notice-modal', true);
            else modal.classList.add('hidden');
            if (oldCloseBtn) oldCloseBtn.style.display = '';
        };

        const btnContainer = document.createElement('div');
        btnContainer.className = 'nt-notice-actions flex space-x-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 w-full';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-bold py-2.5 px-4 rounded-lg shadow-sm transition-colors focus:outline-none';
        closeBtn.textContent = 'Close';
        closeBtn.onclick = closePreview;
        btnContainer.appendChild(closeBtn);

        if (item.archivedAt || item.archiveReason) {
            const reviveBtn = document.createElement('button');
            reviveBtn.type = 'button';
            reviveBtn.className = 'flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-4 rounded-lg shadow-sm transition-colors focus:outline-none';
            reviveBtn.textContent = 'Revive / Repost';
            reviveBtn.onclick = () => {
                closePreview();
                Admin.reviveArchivedAlert(item);
            };
            btnContainer.appendChild(reviveBtn);
        }

        const topClose = modal.querySelector('button.text-gray-400');
        if (topClose) topClose.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closePreview(); };

        if (oldCloseBtn?.parentNode) oldCloseBtn.parentNode.appendChild(btnContainer);
        else content.parentNode?.appendChild(btnContainer);

        openSmoothModal('notice-modal', null, { skipHash: true });
    },

    _previewArchiveAsDisruption: (item) => {
        const modal = document.getElementById('disruption-modal');
        if (!modal) {
            if (typeof showToast === 'function') showToast('Incident modal unavailable.', 'error');
            return;
        }
        const restoreZ = Admin._elevateModalForAdmin(modal);
        const titleEl = document.getElementById('disruption-modal-stations');
        const bodyEl = document.getElementById('disruption-modal-body');
        const badgeEl = document.getElementById('disruption-modal-tier-badge');
        const timeEl = document.getElementById('disruption-modal-timestamp');
        const iconEl = document.getElementById('disruption-icon-svg');
        const cleanStr = (s) => (s ? String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;') : '');

        let locationText = 'Route-Wide Advisory';
        if (item.stations && item.stations.length >= 2) {
            locationText = `Between <span class="text-blue-600 dark:text-blue-400">${cleanStr(item.stations[0]).replace(' STATION', '')}</span> & <span class="text-blue-600 dark:text-blue-400">${cleanStr(item.stations[1]).replace(' STATION', '')}</span>`;
        } else if (item.stations && item.stations.length === 1) {
            locationText = `At <span class="text-blue-600 dark:text-blue-400">${cleanStr(item.stations[0]).replace(' STATION', '')}</span>`;
        }
        if (titleEl) titleEl.innerHTML = locationText;
        if (bodyEl) {
            const statusChip = item.archivedAt
                ? `<span class="inline-block bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase mb-2">Archived${item.archiveReason ? ` - ${escapeHTML(String(item.archiveReason))}` : ''}</span>`
                : '';
            bodyEl.innerHTML = `${statusChip}${item.message || item.longExplanation || item.buttonText || 'No additional details provided.'}`;
        }
        if (badgeEl) {
            if (item.tier === 'CRITICAL' || item.severity === 'critical') {
                badgeEl.className = 'w-full text-center text-[10px] font-black uppercase tracking-widest text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 py-2.5 rounded-lg border border-red-200 dark:border-red-800/50';
                badgeEl.textContent = '\uD83D\uDD34 CRITICAL SERVICE DISRUPTION';
                if (iconEl) iconEl.setAttribute('class', 'w-5 h-5 mr-2 text-red-500');
            } else {
                badgeEl.className = 'w-full text-center text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 py-2.5 rounded-lg border border-yellow-200 dark:border-yellow-800/50';
                badgeEl.textContent = '\uD83D\uDFE1 EXPECT DELAYS / SINGLE TRACK';
                if (iconEl) iconEl.setAttribute('class', 'w-5 h-5 mr-2 text-yellow-500');
            }
        }
        if (timeEl) {
            const posted = item.postedAt ? Admin.formatDate(item.postedAt) : 'Recently';
            const arch = item.archivedAt ? ` - Archived: ${Admin.formatDate(item.archivedAt)}` : '';
            timeEl.textContent = `Posted: ${posted}${arch}`;
        }

        const modalCard = document.getElementById('disruption-modal-card');
        const actionsRow = modalCard?.querySelector('.flex.space-x-3');
        const prevActionsHtml = actionsRow ? actionsRow.innerHTML : null;

        const closePreview = () => {
            restoreZ();
            if (actionsRow && prevActionsHtml != null) actionsRow.innerHTML = prevActionsHtml;
            if (typeof closeSmoothModal === 'function') closeSmoothModal('disruption-modal', true);
            else modal.classList.add('hidden');
        };

        if (actionsRow) {
            const canRevive = !!(item.archivedAt || item.archiveReason);
            actionsRow.innerHTML = `
                <button type="button" id="admin-disr-preview-close" class="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-bold py-3 rounded-xl shadow-sm transition-colors focus:outline-none text-sm">Close</button>
                ${canRevive
                    ? `<button type="button" id="admin-disr-preview-revive" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow-md transition-colors focus:outline-none text-sm">Revive</button>`
                    : `<button type="button" id="admin-disr-preview-hint" class="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-500 font-bold py-3 rounded-xl text-sm cursor-default">Incident Manager</button>`}`;
            actionsRow.querySelector('#admin-disr-preview-close')?.addEventListener('click', closePreview);
            actionsRow.querySelector('#admin-disr-preview-revive')?.addEventListener('click', () => {
                closePreview();
                const rId = item.clearedFrom || item.routeId || item.target;
                if (rId && item.id && typeof Admin.reviveDisruption === 'function') {
                    Admin.reviveDisruption(rId, item.id);
                } else if (typeof showToast === 'function') {
                    showToast('Use Transit Incident Manager to revive incidents.', 'info');
                }
            });
        }

        const topClose = modalCard?.querySelector('button.text-gray-400, button.rounded-full');
        if (topClose) topClose.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closePreview(); };

        openSmoothModal('disruption-modal', null, { skipHash: true });
    },

    // --- 4.5 TRANSIT INCIDENT MANAGER (GUARDIAN PHASE 6) ---
    setupDisruptionsManager: () => {
        const alertPanel = document.getElementById('alert-panel');
        if (!alertPanel || !alertPanel.parentNode) return;

        let disrPanel = document.getElementById('disruption-panel');
        if (!disrPanel) {
            disrPanel = document.createElement('div');
            disrPanel.id = 'disruption-panel';
            alertPanel.parentNode.insertBefore(disrPanel, alertPanel.nextSibling);
        }

        if (disrPanel.dataset.adminLoaded === "true") return;
        disrPanel.dataset.adminLoaded = "true";

        disrPanel.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300";

        disrPanel.innerHTML = `
            <button id="disr-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('construction', 'text-orange-600 dark:text-orange-400')}
                    <span>Transit Incident Manager</span>
                </span>
                <svg id="disr-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            
            <div id="disr-body" class="hidden mt-4 space-y-3">
                <div class="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                    <p class="text-[10px] text-blue-800 dark:text-blue-300 font-medium leading-snug">
                        Injects live disruption badges into Planner and Next Train tabs. <b>CRITICAL</b> tiers drop the graph edge entirely (forces "No Route"). <b>WARNING</b> tiers add a visual badge but keep the route intact.
                    </p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Target Route</label>
                        <div class="relative" id="disr-route-container">
                            <select id="disr-route" class="hidden"></select>
                            <div onclick="document.getElementById('disr-route-list').classList.toggle('hidden'); document.getElementById('disr-route-chevron').classList.toggle('rotate-180');" class="w-full h-10 px-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-900 dark:text-white transition-colors shadow-sm hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between cursor-pointer select-none">
                                <span id="disr-route-display" class="truncate flex items-center">Select Route...</span>
                                <svg id="disr-route-chevron" class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                            <ul id="disr-route-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl hidden mt-1 flex-col overflow-y-auto max-h-60 custom-scrollbar text-left"></ul>
                        </div>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Severity Tier</label>
                        <div class="relative" id="disr-tier-container">
                            <select id="disr-tier" class="hidden">
                                <option value="CRITICAL">CRITICAL (Sever Line)</option>
                                <option value="WARNING">WARNING (Expect Delays)</option>
                            </select>
                            <div onclick="document.getElementById('disr-tier-list').classList.toggle('hidden'); document.getElementById('disr-tier-chevron').classList.toggle('rotate-180');" class="w-full h-10 px-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-900 dark:text-white transition-colors shadow-sm hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between cursor-pointer select-none">
                                <span id="disr-tier-display" class="truncate"><span class="text-red-600">CRITICAL (Sever Line)</span></span>
                                <svg id="disr-tier-chevron" class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                            <ul id="disr-tier-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl hidden mt-1 flex-col overflow-hidden text-left">
                                <li onclick="document.getElementById('disr-tier').value='CRITICAL'; document.getElementById('disr-tier-display').innerHTML='<span class=\\'text-red-600\\'>CRITICAL (Sever Line)</span>'; document.getElementById('disr-tier-list').classList.add('hidden'); document.getElementById('disr-tier-chevron').classList.remove('rotate-180');" class="px-3 py-2.5 text-xs font-bold hover:bg-red-50 dark:hover:bg-gray-700 text-red-600 dark:text-red-400 transition-colors border-b border-gray-100 dark:border-gray-700 cursor-pointer">CRITICAL (Sever Line)</li>
                                <li onclick="document.getElementById('disr-tier').value='WARNING'; document.getElementById('disr-tier-display').innerHTML='<span class=\\'text-yellow-600\\'>WARNING (Expect Delays)</span>'; document.getElementById('disr-tier-list').classList.add('hidden'); document.getElementById('disr-tier-chevron').classList.remove('rotate-180');" class="px-3 py-2.5 text-xs font-bold hover:bg-yellow-50 dark:hover:bg-gray-700 text-yellow-600 dark:text-yellow-400 transition-colors cursor-pointer">WARNING (Expect Delays)</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Station A</label>
                        <div class="relative" id="disr-station-a-container">
                            <select id="disr-station-a" class="hidden"><option value="">Route-Wide Advisory</option></select>
                            <div onclick="document.getElementById('disr-station-a-list').classList.toggle('hidden'); document.getElementById('disr-station-a-chevron').classList.toggle('rotate-180');" class="w-full h-10 px-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-900 dark:text-white transition-colors shadow-sm hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between cursor-pointer select-none">
                                <span id="disr-station-a-display" class="truncate">Route-Wide Advisory</span>
                                <svg id="disr-station-a-chevron" class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                            <ul id="disr-station-a-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl hidden mt-1 flex-col overflow-y-auto max-h-60 custom-scrollbar text-left"></ul>
                        </div>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Station B</label>
                        <div class="relative" id="disr-station-b-container">
                            <select id="disr-station-b" class="hidden"><option value="">None (Single Station/Route)</option></select>
                            <div onclick="document.getElementById('disr-station-b-list').classList.toggle('hidden'); document.getElementById('disr-station-b-chevron').classList.toggle('rotate-180');" class="w-full h-10 px-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-900 dark:text-white transition-colors shadow-sm hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between cursor-pointer select-none">
                                <span id="disr-station-b-display" class="truncate">None (Single Station/Route)</span>
                                <svg id="disr-station-b-chevron" class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                            <ul id="disr-station-b-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl hidden mt-1 flex-col overflow-y-auto max-h-60 custom-scrollbar text-left"></ul>
                        </div>
                    </div>
                </div>

                <div>
                    <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Badge Button Text</label>
                    <input type="text" id="disr-btn-text" class="w-full h-10 px-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-900 dark:text-white outline-none" placeholder="e.g. Sinkhole Advisory">
                </div>

                <div>
                    <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Commuter Explanation (PRASA Notice)</label>
                    <textarea id="disr-msg" rows="6" class="w-full min-h-[150px] p-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 outline-none resize-y" placeholder="The line between Centurion and Irene is suspended due to a sinkhole..."></textarea>
                </div>

                <div>
                    <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Expiry Date & Time</label>
                    <input type="datetime-local" id="disr-expiry" class="w-full h-10 px-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-900 dark:text-white outline-none">
                </div>

                <button id="disr-save-btn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-sm transition-colors text-xs uppercase tracking-wide">
                    Deploy Incident
                </button>

                <div class="pt-3 border-t border-gray-200 dark:border-gray-700 mt-4">
                    <p class="text-[10px] text-gray-400 uppercase font-bold mb-2">Active Incidents:</p>
                    <div id="disr-list" class="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar"></div>
                </div>
            </div>
        `;

        const header = document.getElementById('disr-header-btn');
        const body = document.getElementById('disr-body');
        const chevron = document.getElementById('disr-chevron');
        const routeSelect = document.getElementById('disr-route');
        const statASelect = document.getElementById('disr-station-a');
        const statBSelect = document.getElementById('disr-station-b');
        const tierSelect = document.getElementById('disr-tier');
        const msgInput = document.getElementById('disr-msg');
        const btnTextInput = document.getElementById('disr-btn-text');
        const expiryInput = document.getElementById('disr-expiry');
        const saveBtn = document.getElementById('disr-save-btn');
        const listDiv = document.getElementById('disr-list');

        // GUARDIAN PHASE 1: Auto-Expanding Textarea Engine
        if (msgInput) {
            msgInput.addEventListener('input', function() {
                this.style.height = 'auto'; // Reset to recalculate true scrollHeight
                const newHeight = Math.min(this.scrollHeight, 300); // 300px max height
                this.style.height = newHeight + 'px';
                this.style.overflowY = this.scrollHeight > 300 ? 'auto' : 'hidden';
            });
        }

        header.onclick = () => {
            if (Admin.isGridMode) return; // Prevent accordion action when in grid
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
                Admin.fetchDisruptions(routeSelect.value);
            }
        };

        Admin.populateDisruptionRoutes = () => {
            const currentVal = routeSelect.value;
            routeSelect.innerHTML = '';
            
            const customList = document.getElementById('disr-route-list');
            if (customList) customList.innerHTML = '';
            const customDisplay = document.getElementById('disr-route-display');

            const addGroup = (label) => {
                const group = document.createElement('optgroup');
                group.label = label;
                routeSelect.appendChild(group);

                if (customList) {
                    const liGroup = document.createElement('li');
                    liGroup.className = "px-3 py-1.5 text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest bg-gray-100 dark:bg-gray-800 select-none sticky top-0 z-10 border-y border-gray-200 dark:border-gray-700";
                    liGroup.textContent = label;
                    customList.appendChild(liGroup);
                }
                return group;
            };

            const addOption = (group, value, text, htmlText = text) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = text;
                group.appendChild(opt);

                if (customList) {
                    const li = document.createElement('li');
                    // GUARDIAN UX FIX: Added pl-6 for child indentation
                    li.className = "pl-6 pr-3 py-2.5 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 cursor-pointer flex items-center";
                    li.innerHTML = htmlText;
                    li.onclick = () => {
                        routeSelect.value = value;
                        if (customDisplay) customDisplay.innerHTML = htmlText;
                        customList.classList.add('hidden');
                        const chevron = document.getElementById('disr-route-chevron');
                        if (chevron) chevron.classList.remove('rotate-180');
                        routeSelect.dispatchEvent(new Event('change'));
                    };
                    customList.appendChild(li);
                }
            };
            
            if (typeof ROUTES !== 'undefined') {
                const regions = [
                    { code: 'GP', label: "Gauteng Routes" },
                    { code: 'WC', label: "Western Cape Routes" },
                    { code: 'KZN', label: "KwaZulu-Natal Routes" },
                    { code: 'EC', label: "Eastern Cape Routes" }
                ];

                regions.forEach(regionInfo => {
                    const regionalRoutes = Object.values(ROUTES).filter(r => r.region === regionInfo.code && r.isActive && r.id !== 'special_event');
                    if (regionalRoutes.length > 0) {
                        const group = addGroup(regionInfo.label);
                        regionalRoutes.forEach(r => {
                            const cues = typeof Admin.getRouteCues === 'function' ? Admin.getRouteCues(r.id) : '';
                            const plainName = Admin.formatRouteLabelPlain(r.name);
                            const text = `${plainName}${cues}`;
                            
                            let badgeHtml = '';
                            if (cues) {
                                if (cues.includes('Notice')) badgeHtml += '<span class="ml-1.5 px-1 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 text-[8px] rounded uppercase flex-shrink-0">Note</span>';
                                if (cues.includes('Bans')) badgeHtml += '<span class="ml-1 px-1 py-0.5 bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 text-[8px] rounded uppercase flex-shrink-0">Ban</span>';
                                if (cues.includes('Incident')) badgeHtml += '<span class="ml-1 px-1 py-0.5 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400 text-[8px] rounded uppercase flex-shrink-0">Inc</span>';
                                if (cues.includes('Alert')) badgeHtml += '<span class="ml-1 px-1 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400 text-[8px] rounded uppercase flex-shrink-0">Alert</span>';
                            }
                            const htmlText = `<span class="truncate mr-1 inline-flex items-center">${Admin.formatRouteLabelHtml(r.name)}</span>${badgeHtml}`;
                            addOption(group, r.id, text, htmlText);
                        });
                    }
                });
                
                let selectedOpt = null;
                if (currentVal) {
                    const optionToSelect = routeSelect.querySelector(`option[value="${currentVal}"]`);
                    if (optionToSelect) {
                        optionToSelect.selected = true;
                        selectedOpt = optionToSelect;
                    }
                } else if (!Admin._adminRouteDeepLinkActive && typeof currentRouteId !== 'undefined' && currentRouteId) {
                    const optionToSelect = routeSelect.querySelector(`option[value="${currentRouteId}"]`);
                    if (optionToSelect) {
                        optionToSelect.selected = true;
                        selectedOpt = optionToSelect;
                    }
                }

                if (Admin._pendingAdminRoute) {
                    const optionToSelect = routeSelect.querySelector(`option[value="${Admin._pendingAdminRoute}"]`);
                    if (optionToSelect) {
                        optionToSelect.selected = true;
                        selectedOpt = optionToSelect;
                    }
                }

                if (selectedOpt && customDisplay) {
                    const matchLi = Array.from(customList.querySelectorAll('li')).find(li => li.onclick && li.textContent.includes(selectedOpt.textContent.split(' [')[0]));
                    if (matchLi) customDisplay.innerHTML = matchLi.innerHTML;
                    else customDisplay.textContent = selectedOpt.textContent;
                }
            }
        };
        Admin.populateDisruptionRoutes();

        // Populate Stations strictly bound to the selected route using globalStationIndex
        const populateStations = () => {
            const rId = routeSelect.value;
            statASelect.innerHTML = '<option value="">Route-Wide Advisory</option>';
            statBSelect.innerHTML = '<option value="">None (Single Station/Route)</option>';
            
            const listA = document.getElementById('disr-station-a-list');
            const listB = document.getElementById('disr-station-b-list');
            const displayA = document.getElementById('disr-station-a-display');
            const displayB = document.getElementById('disr-station-b-display');

            if (listA) listA.innerHTML = '';
            if (listB) listB.innerHTML = '';
            
            const addStationOpt = (selectEl, listEl, displayEl, value, text, chevronId, isA = true) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = text;
                selectEl.appendChild(opt);

                if (listEl) {
                    const li = document.createElement('li');
                    li.className = "px-3 py-2.5 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 cursor-pointer";
                    li.textContent = text;
                    li.onclick = () => {
                        selectEl.value = value;
                        if (displayEl) displayEl.textContent = text;
                        listEl.classList.add('hidden');
                        const chevron = document.getElementById(chevronId);
                        if (chevron) chevron.classList.remove('rotate-180');
                        
                        // Sync display if A is cleared
                        if (isA && value === "") {
                            statBSelect.value = "";
                            if (displayB) displayB.textContent = "None (Single Station/Route)";
                        }
                    };
                    listEl.appendChild(li);
                }
            };

            addStationOpt(statASelect, listA, displayA, "", "Route-Wide Advisory", 'disr-station-a-chevron', true);
            addStationOpt(statBSelect, listB, displayB, "", "None (Single Station/Route)", 'disr-station-b-chevron', false);

            if (displayA) displayA.textContent = "Route-Wide Advisory";
            if (displayB) displayB.textContent = "None (Single Station/Route)";

            if (!rId || typeof globalStationIndex === 'undefined') return;

            const stations = [];
            for (const [stName, stData] of Object.entries(globalStationIndex)) {
                if (stData.routes && stData.routes.has(rId)) {
                    stations.push(stName);
                }
            }
            stations.sort();

            stations.forEach(st => {
                const cleanName = st.replace(' STATION', '');
                addStationOpt(statASelect, listA, displayA, st, cleanName, 'disr-station-a-chevron', true);
                addStationOpt(statBSelect, listB, displayB, st, cleanName, 'disr-station-b-chevron', false);
            });
        };

        if (routeSelect) {
            routeSelect.addEventListener('change', () => {
                populateStations();
                Admin.fetchDisruptions(routeSelect.value);
            });
        }
        populateStations();

        // Default Expiry (48 hours)
        const now = new Date();
        now.setHours(now.getHours() + 48);
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); 
        expiryInput.value = now.toISOString().slice(0, 16);

        Admin.fetchDisruptions = async (rId) => {
            if (!rId) return;
            listDiv.innerHTML = '<div class="text-xs text-gray-400 italic">Syncing...</div>';
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                // GUARDIAN PHASE 4: Admin Shield
                const res = await window.guardianFetch(`${dynamicEndpoint}disruptions/${rId}.json?t=${Date.now()}`, {}, 6000);
                const data = await res.json();
                listDiv.innerHTML = '';
                
                if (!data) {
                    listDiv.innerHTML = '<div class="text-xs text-gray-400 italic">No active incidents.</div>';
                    return;
                }
                
                const nowTs = Date.now();

                Object.keys(data).forEach(id => {
                    const item = data[id];
                    const isExpired = item.expiresAt && nowTs > item.expiresAt;
                    
                    const badgeHtml = item.tier === 'CRITICAL' 
                        ? '<span class="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest mr-2 uppercase">Critical</span>'
                        : '<span class="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest mr-2 uppercase">Warning</span>';
                    
                    let targetStr = "Route-Wide";
                    if (item.stations && item.stations.length === 2) targetStr = `${item.stations[0].replace(' STATION', '')} - ${item.stations[1].replace(' STATION', '')}`;
                    else if (item.stations && item.stations.length === 1) targetStr = item.stations[0].replace(' STATION', '');

                    const expStr = item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : 'Never';
                    const expColor = isExpired ? 'text-red-500 font-bold' : 'text-gray-400';

                    const row = document.createElement('div');
                    row.className = `flex flex-col bg-gray-50 dark:bg-gray-900 p-2.5 rounded-lg text-xs border border-gray-100 dark:border-gray-700 ${isExpired ? 'opacity-60' : ''}`;
                    const reviveBtnHtml = isExpired 
                        ? `<button class="text-xs font-bold text-green-500 hover:text-green-700 focus:outline-none mr-3" onclick="Admin.reviveDisruption('${rId}', '${id}')">Revive</button>`
                        : '';
                    row.innerHTML = `
                        <div class="flex justify-between items-center mb-1.5">
                            <div class="flex items-center min-w-0 pr-2">
                                ${badgeHtml}
                                <span class="font-bold text-gray-800 dark:text-gray-200 truncate">${targetStr}</span>
                            </div>
                            <div class="flex items-center shrink-0">
                                ${reviveBtnHtml}
                                <button class="text-xs font-bold text-blue-500 hover:text-blue-700 focus:outline-none" onclick="Admin.deleteDisruption('${rId}', '${id}')">Resolve</button>
                            </div>
                        </div>
                        <div class="text-[10px] text-gray-500 dark:text-gray-400 truncate mb-1">"${item.message || item.longExplanation || ''}"</div>
                        <div class="text-[8px] ${expColor} font-mono uppercase tracking-widest">Expires: ${expStr}</div>
                    `;
                    listDiv.appendChild(row);
                });
            } catch (e) {
                listDiv.innerHTML = `<div class="text-xs text-red-500">Error loading list.</div>`;
            }
        };

        saveBtn.onclick = async () => {
            const rId = routeSelect.value;
            const tier = tierSelect.value;
            const statA = statASelect.value;
            const statB = statBSelect.value;
            const btnText = btnTextInput.value.trim() || (tier === 'CRITICAL' ? 'Severance Advisory' : 'Delay Advisory');
            const msg = msgInput.value.trim();
            const expiryTs = expiryInput.value ? new Date(expiryInput.value).getTime() : Date.now() + (48 * 3600 * 1000);

            if (!rId) { if (typeof showToast === 'function') showToast("Select a route.", "error"); return; }
            if (!msg) { if (typeof showToast === 'function') showToast("Explanation required.", "error"); return; }
            
            const secret = await Admin.getAuthKey(); 
            if (!secret) { if (typeof showToast === 'function') showToast("Authentication required.", "error"); return; }

            const stations = [statA, statB].filter(Boolean);

            const payload = {
                id: Date.now().toString(),
                routeId: rId,
                tier: tier,
                stations: stations,
                buttonText: btnText,
                message: msg.replace(/\n/g, "<br>"),
                postedAt: Date.now(),
                expiresAt: expiryTs
            };

            try {
                saveBtn.textContent = `Deploying...`;
                saveBtn.disabled = true;
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                
                const url = `${dynamicEndpoint}disruptions/${rId}/${payload.id}.json?auth=${secret}`;
                // GUARDIAN PHASE 4: Admin Shield - Wraps raw fetch in guardianFetch to prevent deadlocks
                const res = await window.guardianFetch(url, { method: 'PUT', body: JSON.stringify(payload) }, 10000);

                if (res.ok) {
                    if (typeof showToast === 'function') showToast(`Incident Deployed!`, "success");
                    msgInput.value = '';
                    btnTextInput.value = '';
                    statASelect.value = '';
                    statBSelect.value = '';
                    Admin.fetchDisruptions(rId);
                } else {
                    if (typeof showToast === 'function') showToast("Deployment failed. Check Session.", "error");
                }
            } catch (e) {
                if (typeof showToast === 'function') showToast("Network Error: " + e.message, "error");
            } finally {
                saveBtn.textContent = "Deploy Incident";
                saveBtn.disabled = false;
            }
        };

        Admin.reviveDisruption = async function(rId, id) {
            if (typeof showToast === 'function') showToast("Loading incident data...", "info");
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const res = await fetch(`${dynamicEndpoint}disruptions/${rId}/${id}.json?t=${Date.now()}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data) {
                        document.getElementById('disr-route').value = rId;
                        document.getElementById('disr-route').dispatchEvent(new Event('change'));
                        
                        setTimeout(() => {
                            document.getElementById('disr-tier').value = data.tier || 'CRITICAL';
                            const tierDisplay = document.getElementById('disr-tier-display');
                            if (tierDisplay) {
                                if (data.tier === 'CRITICAL') tierDisplay.innerHTML = '<span class="text-red-600">CRITICAL (Sever Line)</span>';
                                else tierDisplay.innerHTML = '<span class="text-yellow-600">WARNING (Expect Delays)</span>';
                            }

                            if (data.stations && data.stations.length >= 1) {
                                document.getElementById('disr-station-a').value = data.stations[0];
                                const dispA = document.getElementById('disr-station-a-display');
                                if (dispA) dispA.textContent = data.stations[0].replace(' STATION', '');
                            }
                            if (data.stations && data.stations.length === 2) {
                                document.getElementById('disr-station-b').value = data.stations[1];
                                const dispB = document.getElementById('disr-station-b-display');
                                if (dispB) dispB.textContent = data.stations[1].replace(' STATION', '');
                            }
                            document.getElementById('disr-btn-text').value = data.buttonText || '';
                            document.getElementById('disr-msg').value = (data.message || data.longExplanation || '').replace(/<br>/g, '\n');
                            
                            const now = new Date();
                            now.setHours(now.getHours() + 48);
                            now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); 
                            document.getElementById('disr-expiry').value = now.toISOString().slice(0, 16);
                            
                            document.getElementById('disr-body').scrollIntoView({ behavior: 'smooth', block: 'start' });
                            if (typeof showToast === 'function') showToast("Ready to deploy. Review details and click Deploy.", "success");
                        }, 100); 
                    }
                }
            } catch(e) {
                if (typeof showToast === 'function') showToast("Failed to fetch incident data.", "error");
            }
        };

        Admin.deleteDisruption = async function(rId, id, skipConfirm = false) {
            if (!skipConfirm) {
                const confirmed = await Admin.secureConfirm("Resolve Incident", `Remove this incident from the live network?`);
                if (!confirmed) return;
            }

            const secret = await Admin.getAuthKey();
            if (!secret) { if (typeof showToast === 'function') showToast("Authentication required.", "error"); return; }
            
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                
                // GUARDIAN PHASE 14: The Disruption Graveyard Interceptor
                const fetchRes = await window.guardianFetch(`${dynamicEndpoint}disruptions/${rId}/${id}.json`, {}, 6000);
                if (fetchRes.ok) {
                    const disrData = await fetchRes.json();
                    if (disrData && disrData.id) {
                        const archivedPayload = {
                            ...disrData,
                            kind: 'disruption',
                            archivedAt: Date.now(),
                            clearedFrom: rId,
                            archiveReason: 'cleared',
                            severity: disrData.severity || (disrData.tier === 'CRITICAL' ? 'critical' : 'warning'),
                        };
                        const archiveUrl = `${dynamicEndpoint}disruptions_archive/${rId}/${disrData.id}_${Date.now()}.json?auth=${secret}`;
                        const archiveRes = await fetch(archiveUrl, { method: 'PUT', body: JSON.stringify(archivedPayload) });
                        if (!archiveRes.ok) throw new Error("Failed to archive disruption. Aborting delete.");
                    }
                }

                const url = `${dynamicEndpoint}disruptions/${rId}/${id}.json?auth=${secret}`;
                const res = await fetch(url, { method: 'DELETE' });
                
                if (res.ok) {
                    if (typeof showToast === 'function') showToast("Incident resolved & archived.", "success");
                    Admin.fetchDisruptions(rId);
                } else { 
                    if (typeof showToast === 'function') showToast("Delete failed.", "error"); 
                }
            } catch(e) { 
                if (typeof showToast === 'function') showToast(e.message, "error"); 
            }
        };
    },

    // --- 5. EXCLUSION MANAGER ---
    setupExclusionManager: () => {
        const alertPanel = document.getElementById('alert-panel');
        if (!alertPanel || !alertPanel.parentNode) return;

        let exclPanel = document.getElementById('exclusion-panel');
        if (!exclPanel) {
            exclPanel = document.createElement('div');
            exclPanel.id = 'exclusion-panel';
            alertPanel.parentNode.appendChild(exclPanel);
        }

        if (exclPanel.dataset.adminLoaded === "true") return;
        exclPanel.dataset.adminLoaded = "true";

        exclPanel.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300";

        exclPanel.innerHTML = `
            <button id="excl-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('stop', 'text-red-600 dark:text-red-400')}
                    <span>Schedule Exceptions</span>
                </span>
                <svg id="excl-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            
            <div id="excl-body" class="hidden mt-4 space-y-3">
                <div id="excl-review-banner" class="hidden text-[10px] leading-snug px-2.5 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-slate-700 dark:text-slate-200"></div>
                <div class="flex space-x-2">
                    <div class="relative w-2/3" id="excl-route-container">
                        <select id="excl-route" class="hidden"></select>
                        <div onclick="document.getElementById('excl-route-list').classList.toggle('hidden'); document.getElementById('excl-route-chevron').classList.toggle('rotate-180');" class="w-full h-10 px-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-900 dark:text-white transition-colors shadow-sm hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between cursor-pointer select-none">
                            <span id="excl-route-display" class="truncate flex items-center">Select Route...</span>
                            <svg id="excl-route-chevron" class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                        <ul id="excl-route-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl hidden mt-1 flex-col overflow-y-auto max-h-60 custom-scrollbar text-left"></ul>
                    </div>
                    <div class="relative w-1/3" id="excl-direction-container">
                        <select id="excl-direction" class="hidden">
                            <option value="A">To Dest A</option>
                            <option value="B">To Dest B</option>
                        </select>
                        <div onclick="document.getElementById('excl-direction-list').classList.toggle('hidden'); document.getElementById('excl-direction-chevron').classList.toggle('rotate-180');" class="w-full h-10 px-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-900 dark:text-white transition-colors shadow-sm hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between cursor-pointer select-none">
                            <span id="excl-direction-display" class="truncate">To Dest A</span>
                            <svg id="excl-direction-chevron" class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                        <ul id="excl-direction-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl hidden mt-1 flex-col overflow-hidden text-left">
                            <li onclick="document.getElementById('excl-direction').value='A'; document.getElementById('excl-direction-display').textContent=this.textContent; document.getElementById('excl-direction-list').classList.add('hidden'); document.getElementById('excl-direction-chevron').classList.remove('rotate-180'); document.getElementById('excl-direction').dispatchEvent(new Event('change'));" id="excl-dir-opt-a" class="px-3 py-2.5 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 cursor-pointer">To Dest A</li>
                            <li onclick="document.getElementById('excl-direction').value='B'; document.getElementById('excl-direction-display').textContent=this.textContent; document.getElementById('excl-direction-list').classList.add('hidden'); document.getElementById('excl-direction-chevron').classList.remove('rotate-180'); document.getElementById('excl-direction').dispatchEvent(new Event('change'));" id="excl-dir-opt-b" class="px-3 py-2.5 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors cursor-pointer">To Dest B</li>
                        </ul>
                    </div>
                </div>

                <div class="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                    <label class="block text-[10px] font-bold text-blue-800 dark:text-blue-300 uppercase mb-1">Route-Wide Grid Notice</label>
                    <div class="flex space-x-2">
                        <input type="text" id="excl-grid-notice" class="w-full h-10 px-3 bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded-lg text-xs text-gray-900 dark:text-white outline-none" placeholder="e.g. Trains 9116 & 9118 cancelled due to maintenance...">
                        <button id="excl-save-notice-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 rounded-lg shadow-sm transition-colors text-xs whitespace-nowrap focus:outline-none">Save</button>
                    </div>
                    <!-- GUARDIAN PHASE 1: Ephemerality & Export Controls for Grid Notices -->
                    <div class="flex items-center justify-between mt-2">
                        <div class="flex-1 pr-2">
                            <label class="block text-[9px] font-bold text-blue-800 dark:text-blue-300 uppercase mb-1">Expiry Date (Optional)</label>
                            <input type="datetime-local" id="excl-grid-notice-expiry" class="w-full h-8 px-2 bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded text-xs text-gray-900 dark:text-white outline-none">
                        </div>
                        <label class="flex items-center cursor-pointer mt-3">
                            <input type="checkbox" id="excl-grid-notice-export" checked class="form-checkbox h-3.5 w-3.5 text-blue-600 bg-white border-gray-300 rounded focus:ring-0">
                            <span class="text-[9px] font-bold text-blue-800 dark:text-blue-300 ml-1.5 uppercase tracking-wide">Show on Export</span>
                        </label>
                    </div>
                    <p class="text-[9px] text-blue-600 dark:text-blue-400 mt-2 border-t border-blue-200 dark:border-blue-800/50 pt-1.5">Displays a banner directly inside the full timetable grid.</p>
                </div>

                <div class="flex space-x-2 mt-2">
                    <div class="relative w-2/3" id="excl-schedule-type-container">
                        <select id="excl-schedule-type" class="hidden">
                            <option value="weekday">Weekday Schedule</option>
                            <option value="saturday">Saturday Schedule</option>
                            <option value="sunday">Sunday Schedule</option>
                        </select>
                        <div onclick="document.getElementById('excl-schedule-type-list').classList.toggle('hidden'); document.getElementById('excl-schedule-type-chevron').classList.toggle('rotate-180');" class="w-full h-10 px-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-900 dark:text-white transition-colors shadow-sm hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between cursor-pointer select-none">
                            <span id="excl-schedule-type-display" class="truncate">Weekday Schedule</span>
                            <svg id="excl-schedule-type-chevron" class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                        <ul id="excl-schedule-type-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl hidden mt-1 flex-col overflow-hidden text-left"></ul>
                    </div>
                    <button id="excl-load-trains-btn" class="w-1/3 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-bold rounded-lg text-xs hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors focus:outline-none">Load</button>
                </div>

                <div id="excl-train-picker" class="hidden border border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-gray-50 dark:bg-gray-900">
                    <p class="text-[10px] text-gray-400 uppercase font-bold mb-2">Select Trains:</p>
                    <div id="excl-train-grid" class="grid grid-cols-4 gap-2 text-xs max-h-40 overflow-y-auto"></div>
                </div>

                <input id="excl-train-manual" type="text" placeholder="Or type manually (e.g. 4401)" class="w-full h-10 px-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-900 dark:text-white outline-none hidden">
                
                <div class="flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-2 rounded-lg border border-gray-100 dark:border-gray-700 mt-2">
                    <span class="text-xs font-bold text-gray-500 mr-2">Apply To:</span>
                    <div class="flex space-x-1" id="excl-days-container"></div>
                </div>

                <div class="flex space-x-2 mt-2 mb-2">
                    <label class="flex-1 flex items-center justify-center p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg cursor-pointer transition-colors">
                        <input type="radio" name="excl-type" value="banned" checked class="form-radio h-3 w-3 text-red-600 bg-white border-gray-300 focus:ring-0">
                        <span class="text-[10px] font-bold text-red-700 dark:text-red-300 ml-1.5 uppercase tracking-wide">Ban Train</span>
                    </label>
                    <label class="flex-1 flex items-center justify-center p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg cursor-pointer transition-colors">
                        <input type="radio" name="excl-type" value="special" class="form-radio h-3 w-3 text-green-600 bg-white border-gray-300 focus:ring-0">
                        <span class="text-[10px] font-bold text-green-700 dark:text-green-300 ml-1.5 uppercase tracking-wide">Mark Special</span>
                    </label>
                </div>

                <input id="excl-reason" type="text" placeholder="Reason (e.g. Testing, Easter)" class="w-full h-10 px-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-900 dark:text-white outline-none">
                
                <div class="mt-2 mb-3">
                    <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Expiry Date & Time (Optional)</label>
                    <input type="datetime-local" id="excl-expiry" class="w-full h-10 px-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-900 dark:text-white outline-none">
                    <p class="text-[9px] text-gray-400 mt-1 mb-2">If set, the train will automatically reappear on the schedule after this date.</p>
                    <!-- GUARDIAN PHASE 1: Export Visibility Toggle -->
                    <label class="flex items-center cursor-pointer bg-gray-100 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
                        <input type="checkbox" id="excl-export-toggle" checked class="form-checkbox h-4 w-4 text-blue-600 bg-white border-gray-300 rounded focus:ring-0">
                        <span class="text-[10px] font-bold text-gray-600 dark:text-gray-300 ml-2 uppercase tracking-wide leading-none">Show "NO SVC" Tag on Export Image</span>
                    </label>
                </div>
                
                <button id="excl-save-btn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-lg shadow-sm transition-colors text-xs uppercase tracking-wide focus:outline-none">
                    Apply Exceptions
                </button>

                <div class="pt-2 border-t border-gray-200 dark:border-gray-700 mt-3">
                    <p class="text-[10px] text-gray-400 uppercase font-bold mb-2">Active Exceptions:</p>
                    <div id="excl-list" class="space-y-1 max-h-40 overflow-y-auto pr-1 custom-scrollbar"></div>
                </div>
            </div>
        `;

        const header = document.getElementById('excl-header-btn');
        const body = document.getElementById('excl-body');
        const chevron = document.getElementById('excl-chevron');
        const routeSelect = document.getElementById('excl-route');
        const dirSelect = document.getElementById('excl-direction');
        
        const noticeInput = document.getElementById('excl-grid-notice');
        const noticeSaveBtn = document.getElementById('excl-save-notice-btn');

        const schedTypeSelect = document.getElementById('excl-schedule-type');

        /** WC routes expose a dedicated Public Holiday sheet family for train picking. */
        const syncExclScheduleTypeOptions = () => {
            const rId = routeSelect?.value;
            const route = (rId && typeof ROUTES !== 'undefined') ? ROUTES[rId] : null;
            const isWc = !!(route && route.region === 'WC' && (route.sheetKeys?.pub_to_a || route.sheetKeys?.pub_to_b));
            const list = document.getElementById('excl-schedule-type-list');
            const display = document.getElementById('excl-schedule-type-display');
            if (!schedTypeSelect || !list) return;

            const prev = schedTypeSelect.value || 'weekday';
            const items = [
                { value: 'weekday', label: 'Weekday Schedule' },
                { value: 'saturday', label: 'Saturday Schedule' },
            ];
            if (isWc) items.push({ value: 'public_holiday', label: 'Public Holiday Schedule' });
            items.push({ value: 'sunday', label: 'Sunday Schedule' });

            schedTypeSelect.innerHTML = items
                .map((i) => `<option value="${i.value}">${i.label}</option>`)
                .join('');
            list.innerHTML = items.map((i, idx) => {
                const border = idx < items.length - 1 ? 'border-b border-gray-100 dark:border-gray-700' : '';
                return `<li data-excl-day="${i.value}" class="px-3 py-2.5 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors ${border} cursor-pointer">${i.label}</li>`;
            }).join('');

            list.querySelectorAll('li[data-excl-day]').forEach((li) => {
                li.addEventListener('click', () => {
                    const val = li.getAttribute('data-excl-day');
                    schedTypeSelect.value = val;
                    if (display) display.textContent = li.textContent;
                    list.classList.add('hidden');
                    document.getElementById('excl-schedule-type-chevron')?.classList.remove('rotate-180');
                });
            });

            const allowed = items.some((i) => i.value === prev) ? prev : 'weekday';
            schedTypeSelect.value = allowed;
            const selected = items.find((i) => i.value === allowed);
            if (display && selected) display.textContent = selected.label;
        };
        const loadTrainsBtn = document.getElementById('excl-load-trains-btn');
        const trainGrid = document.getElementById('excl-train-grid');
        const pickerContainer = document.getElementById('excl-train-picker');
        const saveBtn = document.getElementById('excl-save-btn');
        const listDiv = document.getElementById('excl-list');
        const daysContainer = document.getElementById('excl-days-container');

        header.onclick = () => {
            if (Admin.isGridMode) return; // Prevent accordion action when in grid
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
            }
        };

        // Inject global listener protection for Exception Dropdowns
        if (!window._adminExceptionsDropdownsBound) {
            document.addEventListener('click', (e) => {
                const checkClose = (containerId, listId, chevId) => {
                    const container = document.getElementById(containerId);
                    const list = document.getElementById(listId);
                    const chev = document.getElementById(chevId);
                    if (list && !list.classList.contains('hidden') && (!container || !container.contains(e.target))) {
                        list.classList.add('hidden');
                        if (chev) chev.classList.remove('rotate-180');
                    }
                };
                checkClose('excl-direction-container', 'excl-direction-list', 'excl-direction-chevron');
                checkClose('excl-schedule-type-container', 'excl-schedule-type-list', 'excl-schedule-type-chevron');
            });
            window._adminExceptionsDropdownsBound = true;
        }

        Admin.populateExclusionRoutes = () => {
            const currentVal = routeSelect.value;
            routeSelect.innerHTML = '';
            
            const customList = document.getElementById('excl-route-list');
            if (customList) customList.innerHTML = '';
            const customDisplay = document.getElementById('excl-route-display');

            const addGroup = (label) => {
                const group = document.createElement('optgroup');
                group.label = label;
                routeSelect.appendChild(group);

                if (customList) {
                    const liGroup = document.createElement('li');
                    liGroup.className = "px-3 py-1.5 text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest bg-gray-100 dark:bg-gray-800 select-none sticky top-0 z-10 border-y border-gray-200 dark:border-gray-700";
                    liGroup.textContent = label;
                    customList.appendChild(liGroup);
                }
                return group;
            };

            const addOption = (group, value, text, htmlText = text) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = text;
                group.appendChild(opt);

                if (customList) {
                    const li = document.createElement('li');
                    // GUARDIAN UX FIX: Added pl-6 for child indentation
                    li.className = "pl-6 pr-3 py-2.5 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 cursor-pointer flex items-center";
                    li.innerHTML = htmlText;
                    li.onclick = () => {
                        routeSelect.value = value;
                        if (customDisplay) customDisplay.innerHTML = htmlText;
                        customList.classList.add('hidden');
                        const chevron = document.getElementById('excl-route-chevron');
                        if (chevron) chevron.classList.remove('rotate-180');
                        routeSelect.dispatchEvent(new Event('change'));
                    };
                    customList.appendChild(li);
                }
            };

            if (typeof ROUTES !== 'undefined') {
                const regions = [
                    { code: 'GP', label: "Gauteng Routes" },
                    { code: 'WC', label: "Western Cape Routes" },
                    { code: 'KZN', label: "KwaZulu-Natal Routes" },
                    { code: 'EC', label: "Eastern Cape Routes" }
                ];

                regions.forEach(regionInfo => {
                    const regionalRoutes = Object.values(ROUTES).filter(r => r.region === regionInfo.code && r.isActive && r.id !== 'special_event');
                    if (regionalRoutes.length > 0) {
                        const group = addGroup(regionInfo.label);
                        regionalRoutes.forEach(r => {
                            const cues = typeof Admin.getRouteCues === 'function' ? Admin.getRouteCues(r.id) : '';
                            const plainName = Admin.formatRouteLabelPlain(r.name);
                            const text = `${plainName}${cues}`;
                            
                            let badgeHtml = '';
                            if (cues) {
                                if (cues.includes('Notice')) badgeHtml += '<span class="ml-1.5 px-1 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 text-[8px] rounded uppercase flex-shrink-0">Note</span>';
                                if (cues.includes('Bans')) badgeHtml += '<span class="ml-1 px-1 py-0.5 bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 text-[8px] rounded uppercase flex-shrink-0">Ban</span>';
                                if (cues.includes('Incident')) badgeHtml += '<span class="ml-1 px-1 py-0.5 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400 text-[8px] rounded uppercase flex-shrink-0">Inc</span>';
                                if (cues.includes('Alert')) badgeHtml += '<span class="ml-1 px-1 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400 text-[8px] rounded uppercase flex-shrink-0">Alert</span>';
                            }
                            const htmlText = `<span class="truncate mr-1 inline-flex items-center">${Admin.formatRouteLabelHtml(r.name)}</span>${badgeHtml}`;
                            addOption(group, r.id, text, htmlText);
                        });
                    }
                });
                
                let selectedOpt = null;
                const prefer = Admin._pendingAdminRoute || currentVal || '';
                if (prefer) {
                    const optionToSelect = routeSelect.querySelector(`option[value="${prefer}"]`);
                    if (optionToSelect) {
                        optionToSelect.selected = true;
                        selectedOpt = optionToSelect;
                    }
                } else if (!Admin._adminRouteDeepLinkActive && typeof currentRouteId !== 'undefined' && currentRouteId) {
                    // Only fall back to the live board when admin did not deep-link a route
                    const optionToSelect = routeSelect.querySelector(`option[value="${currentRouteId}"]`);
                    if (optionToSelect) {
                        optionToSelect.selected = true;
                        selectedOpt = optionToSelect;
                    }
                }

                if (selectedOpt && customDisplay) {
                    const matchLi = Array.from(customList.querySelectorAll('li')).find(li => li.onclick && li.textContent.includes(selectedOpt.textContent.split(' [')[0]));
                    if (matchLi) customDisplay.innerHTML = matchLi.innerHTML;
                    else customDisplay.textContent = selectedOpt.textContent;
                }
            }
        };
        Admin.populateExclusionRoutes();

        if (routeSelect) {
            routeSelect.addEventListener('change', () => {
                const rId = routeSelect.value;
                // Manual pick clears deep-link lock so subsequent populate can follow the admin choice
                if (rId && Admin._pendingAdminRoute && rId === Admin._pendingAdminRoute) {
                    /* keep lock until user picks something else */
                } else if (rId && Admin._pendingAdminRoute && rId !== Admin._pendingAdminRoute) {
                    Admin._pendingAdminRoute = rId;
                }
                const banner = document.getElementById('excl-review-banner');
                if (banner) {
                    if (Admin._adminRouteDeepLinkActive && rId && typeof ROUTES !== 'undefined' && ROUTES[rId]) {
                        banner.classList.remove('hidden');
                        banner.innerHTML = `<span class="font-black text-blue-700 dark:text-blue-300">Reviewing</span> <span class="inline-flex items-center">${Admin.formatRouteLabelHtml(ROUTES[rId].name)}</span> <span class="text-slate-500 dark:text-slate-400 font-medium">- live board route unchanged</span>`;
                    } else {
                        banner.classList.add('hidden');
                    }
                }
                syncExclScheduleTypeOptions();
                if (rId && ROUTES[rId]) {
                    const r = ROUTES[rId];
                    
                    const optA = document.getElementById('excl-dir-opt-a');
                    const optB = document.getElementById('excl-dir-opt-b');
                    const display = document.getElementById('excl-direction-display');
                    
                    if (dirSelect && dirSelect.options.length >= 2) {
                        const txtA = `To ${r.destA.replace(' STATION','')}`;
                        const txtB = `To ${r.destB.replace(' STATION','')}`;
                        
                        dirSelect.options[0].textContent = txtA;
                        dirSelect.options[1].textContent = txtB;
                        
                        if (optA) optA.textContent = txtA;
                        if (optB) optB.textContent = txtB;
                        
                        if (display) {
                            display.textContent = dirSelect.value === 'A' ? txtA : txtB;
                        }
                    }
                    fetchExclusions();
                } else {
                    const optA = document.getElementById('excl-dir-opt-a');
                    const optB = document.getElementById('excl-dir-opt-b');
                    const display = document.getElementById('excl-direction-display');

                    if (dirSelect && dirSelect.options.length >= 2) {
                        dirSelect.options[0].textContent = "To Dest A";
                        dirSelect.options[1].textContent = "To Dest B";
                        
                        if (optA) optA.textContent = "To Dest A";
                        if (optB) optB.textContent = "To Dest B";

                        if (display) {
                            display.textContent = dirSelect.value === 'A' ? "To Dest A" : "To Dest B";
                        }
                    }
                }
            });
            
            syncExclScheduleTypeOptions();
            routeSelect.dispatchEvent(new Event('change'));
        } else {
            syncExclScheduleTypeOptions();
        }

        const days = ['S','M','T','W','T','F','S'];
        days.forEach((d, idx) => {
            const label = document.createElement('label');
            label.className = "flex flex-col items-center cursor-pointer";
            label.innerHTML = `
                <input type="checkbox" value="${idx}" class="form-checkbox h-3 w-3 text-blue-600 bg-white border-gray-300 rounded mb-1 focus:ring-0">
                <span class="text-[9px] font-bold text-gray-500">${d}</span>
            `;
            daysContainer.appendChild(label);
        });
        
        function getSelectedDays() { return Array.from(daysContainer.querySelectorAll('input:checked')).map(cb => parseInt(cb.value)); }

        loadTrainsBtn.onclick = () => {
            const rId = routeSelect.value;
            const type = schedTypeSelect.value;
            const dir = dirSelect.value;

            if (!rId) { if (typeof showToast === 'function') showToast("Select a route first", "error"); return; }
            const route = ROUTES[rId];
            if (!route) return;

            let sheetKey = null;
            if (type === 'weekday') {
                sheetKey = (dir === 'A') ? route.sheetKeys.weekday_to_a : route.sheetKeys.weekday_to_b;
            } else if (type === 'saturday') {
                sheetKey = (dir === 'A') ? route.sheetKeys.saturday_to_a : route.sheetKeys.saturday_to_b;
            } else if (type === 'public_holiday') {
                // WC dedicated *_pub sheets; fall back to saturday if a pub key is missing.
                sheetKey = (dir === 'A')
                    ? (route.sheetKeys.pub_to_a || route.sheetKeys.saturday_to_a)
                    : (route.sheetKeys.pub_to_b || route.sheetKeys.saturday_to_b);
            } else if (type === 'sunday') {
                sheetKey = (dir === 'A') ? route.sheetKeys.saturday_to_a : route.sheetKeys.saturday_to_b;
            }
            
            if (typeof fullDatabase === 'undefined' || !fullDatabase) {
                if (typeof showToast === 'function') showToast("Database not ready. Refresh app.", "error");
                return;
            }

            const rawData = fullDatabase[sheetKey];
            if (!rawData) {
                if (typeof showToast === 'function') showToast(`No data found for ${type}`, "error");
                return;
            }

            let trainNumbersSet = new Set();
            try {
                rawData.forEach(row => {
                    Object.keys(row).forEach(k => {
                        if (k.match(/^\d{4}[a-zA-Z]*$/)) trainNumbersSet.add(k);
                    });
                });
            } catch(e) { console.log(e); }
            
            let trainNumbers = Array.from(trainNumbersSet).sort();

            trainGrid.innerHTML = '';
            if (trainNumbers.length === 0) {
                trainGrid.innerHTML = '<div class="col-span-4 text-gray-400">No trains found.</div>';
            } else {
                trainNumbers.forEach(tNum => {
                    const div = document.createElement('div');
                    div.className = "flex items-center space-x-1 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer";
                    div.onclick = (e) => {
                        if (e.target.tagName !== 'INPUT') {
                            const cb = div.querySelector('input');
                            cb.checked = !cb.checked;
                        }
                    };
                    div.innerHTML = `
                        <input type="checkbox" value="${tNum}" class="rounded text-blue-600 focus:ring-0 w-3 h-3 cursor-pointer">
                        <span class="font-mono text-gray-700 dark:text-gray-300">${tNum}</span>
                    `;
                    trainGrid.appendChild(div);
                });
            }
            pickerContainer.classList.remove('hidden');
        };

        // GUARDIAN Phase 3: Added Notice Save Button Logic
        noticeSaveBtn.onclick = async () => {
            const rId = routeSelect.value;
            const text = noticeInput.value.trim();
            
            const noticeExpiryInput = document.getElementById('excl-grid-notice-expiry');
            const noticeExpiryTs = (noticeExpiryInput && noticeExpiryInput.value) ? new Date(noticeExpiryInput.value).getTime() : null;
            
            const noticeExportToggle = document.getElementById('excl-grid-notice-export');
            const showOnExport = noticeExportToggle ? noticeExportToggle.checked : true;

            const secret = await Admin.getAuthKey();
            if (!secret) { if (typeof showToast === 'function') showToast("Authentication required.", "error"); return; }

            noticeSaveBtn.textContent = "...";
            noticeSaveBtn.disabled = true;

            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                
                if (text === "") {
                    await fetch(`${dynamicEndpoint}exclusions/${rId}/_grid_notice.json?auth=${secret}`, { method: 'DELETE' });
                } else {
                    await window.guardianFetch(`${dynamicEndpoint}exclusions/${rId}/_grid_notice.json?auth=${secret}`, {
                        method: 'PUT',
                        body: JSON.stringify({ 
                            text: text, 
                            updatedAt: Date.now(),
                            expiresAt: noticeExpiryTs,
                            showOnExport: showOnExport
                        })
                    }, 10000);
                }

                // GUARDIAN FIX: Cache Purge (Routed securely through telemetry worker)
                try {
                    await fetch('https://nexttrain-telemetry.enock.workers.dev/admin/purge', { 
                        method: 'POST', 
                        headers: {'Authorization': `Bearer ${secret}`} 
                    });
                } catch(pe) { console.warn("Purge failed", pe); }

                if (typeof showToast === 'function') showToast("Grid Notice updated!", "success");
                
                // Fetch to sync memory immediately
                fetchExclusions();
                
                // If the user has a grid open, re-render it so it picks up the new exclusions JSON
                if (typeof loadAllSchedules === 'function') {
                    // Small delay to allow the network flush to finish
                    setTimeout(() => { loadAllSchedules(); }, 500); 
                }
            } catch (e) {
                if (typeof showToast === 'function') showToast("Network Error: " + e.message, "error");
            } finally {
                noticeSaveBtn.textContent = "Save";
                noticeSaveBtn.disabled = false;
            }
        };

        async function fetchExclusions() {
            const rId = routeSelect.value;
            listDiv.innerHTML = '<div class="text-xs text-gray-400 italic">Loading...</div>';
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const res = await window.guardianFetch(`${dynamicEndpoint}exclusions/${rId}.json?t=${Date.now()}`, {}, 6000);
                const data = await res.json();
                
                // GUARDIAN Phase 3 & Phase 1: Extract Grid Notice Text and Ephemerality natively
                if (data && data._grid_notice) {
                    noticeInput.value = data._grid_notice.text || "";
                    
                    const noticeExpiryInput = document.getElementById('excl-grid-notice-expiry');
                    if (noticeExpiryInput) {
                        if (data._grid_notice.expiresAt) {
                            const ed = new Date(data._grid_notice.expiresAt);
                            ed.setMinutes(ed.getMinutes() - ed.getTimezoneOffset());
                            noticeExpiryInput.value = ed.toISOString().slice(0, 16);
                        } else {
                            noticeExpiryInput.value = "";
                        }
                    }
                    
                    const noticeExportToggle = document.getElementById('excl-grid-notice-export');
                    if (noticeExportToggle) {
                        noticeExportToggle.checked = data._grid_notice.showOnExport !== false;
                    }
                } else {
                    noticeInput.value = "";
                    const noticeExpiryInput = document.getElementById('excl-grid-notice-expiry');
                    if (noticeExpiryInput) {
                        // GUARDIAN PHASE 1: 24-Hour Default Time-Bomb
                        const defaultExpiry = new Date();
                        defaultExpiry.setHours(defaultExpiry.getHours() + 24);
                        defaultExpiry.setMinutes(defaultExpiry.getMinutes() - defaultExpiry.getTimezoneOffset());
                        noticeExpiryInput.value = defaultExpiry.toISOString().slice(0, 16);
                    }
                    const noticeExportToggle = document.getElementById('excl-grid-notice-export');
                    if (noticeExportToggle) noticeExportToggle.checked = true;
                }

                listDiv.innerHTML = '';
                if (!data || (Object.keys(data).length === 1 && data._grid_notice)) {
                    listDiv.innerHTML = '<div class="text-xs text-gray-400 italic">No active exceptions.</div>';
                    return;
                }
                
                Object.keys(data).forEach(trainNum => {
                    if (trainNum === '_grid_notice') return; // Skip rendering the grid notice block here
                    
                    const item = data[trainNum];
                    const dayLabels = item.days.map(d => days[d]).join('');
                    
                    const isSpecial = item.type === 'special';
                    
                    let expiryHtml = '';
                    let rowOpacityClass = '';
                    if (item.expiresAt) {
                        const expDate = new Date(item.expiresAt);
                        const isExpired = Date.now() > item.expiresAt;
                        const expStr = `${expDate.toLocaleDateString()} ${expDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
                        
                        if (isExpired) {
                            expiryHtml = `<div class="text-[9px] text-red-500 font-bold mt-0.5">EXPIRED: ${expStr}</div>`;
                            rowOpacityClass = 'opacity-60 grayscale';
                        } else {
                            expiryHtml = `<div class="text-[9px] text-blue-500 font-medium mt-0.5 inline-flex items-center gap-1">${Admin.icon('hourglass', 'w-3 h-3')} Expires: ${expStr}</div>`;
                        }
                    }

                    const badgeHtml = isSpecial 
                        ? '<span class="bg-green-100 text-green-700 px-1 rounded text-[9px] font-black tracking-widest mr-1">SPL</span>'
                        : '<span class="bg-red-100 text-red-700 px-1 rounded text-[9px] font-black tracking-widest mr-1">BAN</span>';

                    const row = document.createElement('div');
                    row.className = `flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-2 rounded text-xs border border-gray-100 dark:border-gray-700 mt-1 ${rowOpacityClass}`;
                    row.innerHTML = `
                        <div>
                            ${badgeHtml}
                            <span class="font-bold ${isSpecial ? 'text-green-600' : 'text-red-600'}">#${trainNum}</span>
                            <span class="text-gray-400 mx-1">|</span>
                            <span class="text-gray-700 dark:text-gray-300 font-mono tracking-widest">[${dayLabels}]</span>
                            <div class="text-[9px] text-gray-400 mt-0.5">${item.reason || 'No reason specified'}</div>
                            ${expiryHtml}
                        </div>
                        <button class="text-gray-400 hover:text-white hover:bg-red-500 rounded px-1.5 py-0.5 transition-colors font-bold focus:outline-none" onclick="Admin.deleteExclusion('${rId}', '${trainNum}')" aria-label="Delete">${Admin.icon('x', 'w-4 h-4')}</button>
                    `;
                    listDiv.appendChild(row);
                });
            } catch(e) {
                listDiv.innerHTML = `<div class="text-xs text-red-500">Error loading list.</div>`;
            }
        }

        saveBtn.onclick = async () => {
            const rId = routeSelect.value;
            const reason = document.getElementById('excl-reason').value.trim() || "Service Adjustment";
            const selectedDays = getSelectedDays();
            
            const typeSelect = document.querySelector('input[name="excl-type"]:checked');
            const exceptionType = typeSelect ? typeSelect.value : 'banned';
            
            const expiryInput = document.getElementById('excl-expiry').value;
            const expiryTs = expiryInput ? new Date(expiryInput).getTime() : null;
            
            const exportToggle = document.getElementById('excl-export-toggle');
            const showOnExport = exportToggle ? exportToggle.checked : true;
            
            const secret = await Admin.getAuthKey(); 
            
            const selectedTrains = Array.from(trainGrid.querySelectorAll('input:checked')).map(cb => cb.value);
            const manualTrain = document.getElementById('excl-train-manual').value.trim();
            if (manualTrain) selectedTrains.push(manualTrain);

            if (selectedTrains.length === 0 || selectedDays.length === 0) {
                if (typeof showToast === 'function') showToast("Select trains and days.", "error");
                return;
            }
            if (!secret) {
                if (typeof showToast === 'function') showToast("Authentication required.", "error");
                return;
            }

            const updates = {};
            selectedTrains.forEach(tNum => {
                updates[`${tNum}`] = {
                    days: selectedDays,
                    reason: reason,
                    type: exceptionType, 
                    expiresAt: expiryTs, 
                    showOnExport: showOnExport,
                    updatedAt: Date.now()
                };
            });

            try {
                saveBtn.textContent = `Applying...`;
                saveBtn.disabled = true;
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                
                const promises = selectedTrains.map(tNum => {
                    const url = `${dynamicEndpoint}exclusions/${rId}/${tNum}.json?auth=${secret}`;
                    // GUARDIAN PHASE 4: Admin Shield Wrap
                    return window.guardianFetch(url, { method: 'PUT', body: JSON.stringify(updates[tNum]) }, 10000);
                });
                await Promise.all(promises);

                // GUARDIAN FIX: Removed Hardcoded Cloudflare Cache Purge Key (Secured)
                try {
                    const purgeRes = await fetch('https://nexttrain-telemetry.enock.workers.dev/admin/purge', { 
                        method: 'POST', 
                        headers: {'Authorization': `Bearer ${secret}`} 
                    });
                } catch(pe) { console.warn("Purge failed", pe); }

                if (typeof showToast === 'function') showToast(`Updated ${selectedTrains.length} exceptions!`, "success");
                trainGrid.querySelectorAll('input').forEach(cb => cb.checked = false);
                document.getElementById('excl-train-manual').value = '';
                document.getElementById('excl-expiry').value = ''; 
                fetchExclusions();
                if (typeof loadAllSchedules === 'function') loadAllSchedules();
            } catch (e) {
                if (typeof showToast === 'function') showToast("Network Error: " + e.message, "error");
            } finally {
                saveBtn.textContent = "Apply Exceptions";
                saveBtn.disabled = false;
            }
        };

        Admin.deleteExclusion = async function(rId, trainNum, skipConfirm = false) {
            if (!skipConfirm) {
                const confirmed = await Admin.secureConfirm("Remove Exception", `Remove exception for Train #${trainNum}?`);
                if (!confirmed) return;
            }

            const secret = await Admin.getAuthKey(); 
            if (!secret) { if (typeof showToast === 'function') showToast("Authentication required.", "error"); return; }
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            const url = `${dynamicEndpoint}exclusions/${rId}/${trainNum}.json?auth=${secret}`;
            try {
                const res = await fetch(url, { method: 'DELETE' });
                if (res.ok) {
                    // GUARDIAN FIX: Removed Hardcoded Cloudflare Cache Purge Key (Secured)
                    try {
                        const purgeRes = await fetch('https://nexttrain-telemetry.enock.workers.dev/admin/purge', { 
                            method: 'POST', 
                            headers: {'Authorization': `Bearer ${secret}`} 
                        });
                    } catch(pe) { console.warn("Purge failed", pe); }

                    if (typeof showToast === 'function') showToast("Exception removed.", "success");
                    fetchExclusions();
                    if (typeof loadAllSchedules === 'function') loadAllSchedules();
                } else { if (typeof showToast === 'function') showToast("Delete failed.", "error"); }
            } catch(e) { if (typeof showToast === 'function') showToast(e.message, "error"); }
        };
    },

    // --- 6. SPECIAL EVENT MANAGER ---
    setupSpecialEventManager: () => {
        const alertPanel = document.getElementById('alert-panel');
        if (!alertPanel || !alertPanel.parentNode) return;
        
        let eventPanel = document.getElementById('event-panel');
        if (!eventPanel) {
            eventPanel = document.createElement('div');
            eventPanel.id = 'event-panel';
            alertPanel.parentNode.appendChild(eventPanel);
        }

        if (eventPanel.dataset.loaded === "true") return;
        eventPanel.dataset.loaded = "true";

        eventPanel.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300";

        eventPanel.innerHTML = `
            <button id="event-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('star', 'text-amber-500 dark:text-amber-400')}
                    <span>Special Event Route</span>
                </span>
                <svg id="event-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>

            <div id="event-body" class="hidden mt-4 space-y-4">
                <div class="flex items-center justify-between bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg border border-yellow-200 dark:border-yellow-800">
                    <div>
                        <span class="font-bold text-yellow-800 dark:text-yellow-200 text-sm">Enable Event Route</span>
                    </div>
                    <div class="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                        <input type="checkbox" id="event-toggle" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer outline-none"/>
                        <label for="event-toggle" class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
                    </div>
                </div>
                
                <div>
                    <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Event Name</label>
                    <input type="text" id="event-name" class="w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white outline-none" placeholder="e.g., Loftus Rugby Special">
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Destination A</label>
                        <input type="text" id="event-dest-a" class="w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white outline-none" placeholder="e.g., PRETORIA STATION">
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Destination B</label>
                        <input type="text" id="event-dest-b" class="w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white outline-none" placeholder="e.g., LOFTUS STATION">
                    </div>
                </div>
                
                <div class="pt-2 border-t border-gray-100 dark:border-gray-700">
                    <button id="event-save-btn" class="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 rounded-lg shadow-md transition-colors text-xs uppercase tracking-wide">
                        Publish Event
                    </button>
                </div>
            </div>
        `;

        const header = document.getElementById('event-header-btn');
        const body = document.getElementById('event-body');
        const chevron = document.getElementById('event-chevron');
        const toggle = document.getElementById('event-toggle');
        const nameInput = document.getElementById('event-name');
        const destAInput = document.getElementById('event-dest-a');
        const destBInput = document.getElementById('event-dest-b');
        const saveBtn = document.getElementById('event-save-btn');

        header.onclick = () => {
            if (Admin.isGridMode) return; // Prevent accordion action when in grid
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
            }
        };

        if (typeof ROUTES !== 'undefined' && ROUTES['special_event']) {
            const ev = ROUTES['special_event'];
            toggle.checked = ev.isActive;
            nameInput.value = ev.name !== "Special Event Route" ? ev.name : "";
            destAInput.value = ev.destA !== "EVENT A STATION" ? ev.destA : "";
            destBInput.value = ev.destB !== "EVENT B STATION" ? ev.destB : "";
        }

        saveBtn.onclick = async () => {
            const secret = await Admin.getAuthKey();
            if (!secret) { if (typeof showToast === 'function') showToast("Authentication required", "error"); return; }
            
            const payload = {
                isActive: toggle.checked,
                name: nameInput.value.trim() || "Special Event Route",
                destA: destAInput.value.trim().toUpperCase() || "EVENT A STATION",
                destB: destBInput.value.trim().toUpperCase() || "EVENT B STATION"
            };

            saveBtn.textContent = "Publishing...";
            saveBtn.disabled = true;

            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                // GUARDIAN PHASE 4: Admin Shield Wrap
                const res = await window.guardianFetch(`${dynamicEndpoint}config/special_event.json?auth=${secret}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                }, 10000);
                
                if (res.ok) {
                    if (typeof showToast === 'function') showToast("Special Event Updated!", "success");
                    if (typeof ROUTES !== 'undefined' && ROUTES['special_event']) {
                        ROUTES['special_event'].isActive = payload.isActive;
                        ROUTES['special_event'].name = payload.name;
                        ROUTES['special_event'].destA = payload.destA;
                        ROUTES['special_event'].destB = payload.destB;
                        if (typeof Renderer !== 'undefined') {
                            Renderer.renderRouteMenu('route-list', ROUTES, typeof currentRouteId !== 'undefined' ? currentRouteId : null);
                        }
                    }
                } else {
                    if (typeof showToast === 'function') showToast("Failed. Check Admin Key.", "error");
                }
            } catch(e) {
                if (typeof showToast === 'function') showToast("Network Error", "error");
            } finally {
                saveBtn.textContent = "Publish Event";
                saveBtn.disabled = false;
            }
        };
    },

    // --- 7. SYSTEM HEALTH / DIAGNOSTICS SCANNER ---
    setupDiagnosticsManager: () => {
        const alertPanel = document.getElementById('alert-panel');
        if (!alertPanel || !alertPanel.parentNode) return;

        let diagPanel = document.getElementById('diag-panel');
        if (!diagPanel) {
            diagPanel = document.createElement('div');
            diagPanel.id = 'diag-panel';
            alertPanel.parentNode.appendChild(diagPanel);
        }

        if (diagPanel.dataset.loaded === "true") return;
        diagPanel.dataset.loaded = "true";

        diagPanel.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300";

        diagPanel.innerHTML = `
            <button id="diag-header-btn" class="w-full text-left text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('activity', 'text-teal-500 dark:text-teal-400')}
                    <span>System Health Diagnostics</span>
                </span>
                <svg id="diag-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>

            <div id="diag-body" class="hidden mt-4 space-y-4">
                
                <!-- GUARDIAN PHASE 1: Global Target Region (Controls Both Panels) -->
                <div class="bg-gray-50 dark:bg-gray-900 p-3 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                    <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Target Region (Matrix & Scan)</label>
                    <select id="diag-region-select" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 outline-none shadow-sm">
                        <option value="CURRENT">Active Region Only</option>
                        <option value="GP">Gauteng</option>
                        <option value="WC">Western Cape</option>
                        <option value="KZN">KwaZulu-Natal</option>
                        <option value="EC">Eastern Cape</option>
                    </select>
                </div>

                <!-- CACHE PROPAGATION MATRIX ACCORDION -->
                <div class="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800 overflow-hidden shadow-sm transition-all">
                    <button id="matrix-header-btn" class="w-full px-3 py-3 bg-indigo-100/50 dark:bg-indigo-900/40 text-left text-[10px] font-black text-indigo-800 dark:text-indigo-300 uppercase tracking-widest flex items-center justify-between focus:outline-none transition-colors hover:bg-indigo-200/50 dark:hover:bg-indigo-900/60">
                        <span class="flex items-center">
                            <svg class="w-4 h-4 mr-2 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                            Cache Propagation Matrix
                        </span>
                        <svg id="matrix-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    
                    <div id="matrix-body" class="p-3 hidden">
                        <p class="text-[9px] text-indigo-700 dark:text-indigo-400 font-medium leading-snug mb-3">Interrogates global Edge Caches (Cloudflare, GitHub, Firebase) to verify version sync status. Bypasses local browser cache.</p>
                        
                        <button id="ping-diagnostics-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-lg shadow-md transition-colors text-[10px] uppercase tracking-wide focus:outline-none flex justify-center items-center">
                            <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.906 14.142 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"></path></svg>
                            Probe Edge Caches
                        </button>
                        
                        <div id="ping-results" class="hidden mt-3">
                            <div class="overflow-x-auto rounded-lg border border-indigo-200 dark:border-indigo-800/50 shadow-sm">
                                <table class="w-full text-left text-[9px]">
                                    <thead class="bg-indigo-100/70 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-200 uppercase tracking-wider font-bold">
                                        <tr>
                                            <th class="px-1.5 py-2 border-b border-indigo-200 dark:border-indigo-800/50">Pipeline</th>
                                            <th class="px-1.5 py-2 border-b border-indigo-200 dark:border-indigo-800/50">App Version</th>
                                            <th class="px-1.5 py-2 border-b border-indigo-200 dark:border-indigo-800/50 text-right">DB Freshness & Ping</th>
                                        </tr>
                                    </thead>
                                    <tbody id="matrix-tbody" class="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800 text-gray-700 dark:text-gray-300">
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- DEEP NETWORK SCAN ACCORDION -->
                <div class="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 overflow-hidden shadow-sm transition-all">
                    <button id="deepscan-header-btn" class="w-full px-3 py-3 bg-blue-100/50 dark:bg-blue-900/40 text-left text-[10px] font-black text-blue-800 dark:text-blue-300 uppercase tracking-widest flex items-center justify-between focus:outline-none transition-colors hover:bg-blue-200/50 dark:hover:bg-blue-900/60">
                        <span class="flex items-center">
                            <svg class="w-4 h-4 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path></svg>
                            Deep Network Scan
                        </span>
                        <svg id="deepscan-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    
                    <div id="deepscan-body" class="p-3 hidden">
                        <p class="text-[9px] text-blue-700 dark:text-blue-400 font-medium leading-snug mb-3">Scans the database to verify if all configured routes have successfully downloaded their timetables and checks for structural anomalies.</p>

                        <div class="mb-3">
                            <label class="block text-[10px] font-bold text-blue-800 dark:text-blue-300 uppercase mb-1">Data Source</label>
                            <select id="deepscan-source-select" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800/50 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 outline-none shadow-sm">
                                <option value="RAM">RAM (Current Active Cache)</option>
                                <option value="CLOUDFLARE">Cloudflare Edge Cache</option>
                                <option value="GITHUB">GitHub CDN</option>
                                <option value="FIREBASE">Firebase Live RTDB</option>
                            </select>
                        </div>

                        <button id="diag-run-btn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg shadow-md transition-colors text-[10px] uppercase tracking-wide focus:outline-none flex justify-center items-center">
                            Run Deep Scan
                        </button>
                        
                        <div id="diag-results" class="mt-3 space-y-1 max-h-60 overflow-y-auto custom-scrollbar"></div>
                    </div>
                </div>

                <!-- Zone Distance Audit - fare zone vs computed route km -->
                <div class="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800 overflow-hidden shadow-sm transition-all">
                    <button id="zone-audit-header-btn" class="w-full px-3 py-3 bg-emerald-100/50 dark:bg-emerald-900/40 text-left text-[10px] font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-widest flex items-center justify-between focus:outline-none transition-colors hover:bg-emerald-200/50 dark:hover:bg-emerald-900/60">
                        <span class="flex items-center gap-2">
                            <span class="text-emerald-600 dark:text-emerald-400">${Admin.icon('ruler', 'w-4 h-4')}</span>
                            Zone Distance Audit
                        </span>
                        <svg id="zone-audit-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>

                    <div id="zone-audit-body" class="p-3 hidden space-y-3">
                        <p class="text-[9px] text-emerald-800 dark:text-emerald-400 font-medium leading-snug">
                            Measures route km from station coordinates (path sum; prefers KM_MARK when present)
                            and checks the assigned fare zone against PRASA Aug 2025 travel distances:
                            Z1 1-15 - Z2 16-40 - Z3 41-135 - Z4 &gt;135 km.
                        </p>

                        <div>
                            <label class="block text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase mb-1">Data Source</label>
                            <select id="zone-audit-source-select" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-800 border border-emerald-200 dark:border-emerald-800/50 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm">
                                <option value="RAM">RAM (Current Active Cache)</option>
                                <option value="FIREBASE" selected>Firebase Live RTDB</option>
                                <option value="CLOUDFLARE">Cloudflare Edge Cache</option>
                                <option value="GITHUB">GitHub CDN</option>
                            </select>
                        </div>

                        <div>
                            <label class="block text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase mb-1">Zone max km (Z1 / Z2 / Z3) - PRASA defaults</label>
                            <div class="grid grid-cols-3 gap-2">
                                <input type="number" id="zone-audit-z1" min="1" step="1" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-800 border border-emerald-200 dark:border-emerald-800/50 text-gray-900 dark:text-white text-xs text-center outline-none focus:ring-2 focus:ring-emerald-500" title="Z1 max km (official 15)">
                                <input type="number" id="zone-audit-z2" min="1" step="1" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-800 border border-emerald-200 dark:border-emerald-800/50 text-gray-900 dark:text-white text-xs text-center outline-none focus:ring-2 focus:ring-emerald-500" title="Z2 max km (official 40)">
                                <input type="number" id="zone-audit-z3" min="1" step="1" class="w-full h-9 px-2 rounded-lg bg-white dark:bg-gray-800 border border-emerald-200 dark:border-emerald-800/50 text-gray-900 dark:text-white text-xs text-center outline-none focus:ring-2 focus:ring-emerald-500" title="Z3 max km (official 135)">
                            </div>
                            <p class="text-[8px] text-emerald-700/80 dark:text-emerald-500 mt-1">Defaults 15 / 40 / 135. Above Z3 max ? Z4. Override only for sensitivity checks. Uses Target Region above.</p>
                        </div>

                        <div class="flex gap-2">
                            <button id="zone-audit-run-btn" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-lg shadow-md transition-colors text-[10px] uppercase tracking-wide focus:outline-none flex justify-center items-center gap-1.5">
                                ${Admin.icon('ruler', 'w-3.5 h-3.5')} Run Distance Audit
                            </button>
                            <button id="zone-audit-export-btn" class="px-3 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 font-bold py-2.5 rounded-lg text-[10px] uppercase tracking-wide focus:outline-none inline-flex items-center gap-1" title="Download last audit as JSON">
                                ${Admin.icon('download', 'w-3.5 h-3.5')} Export
                            </button>
                        </div>

                        <div id="zone-audit-summary" class="hidden"></div>
                        <div id="zone-audit-results" class="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar"></div>
                    </div>
                </div>

                <!-- GUARDIAN PHASE 6.3: Transplated Time Simulation Engine -->
                <div class="bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm transition-all">
                    <button id="sim-header-btn" class="w-full px-3 py-3 bg-gray-100/50 dark:bg-gray-800/40 text-left text-[10px] font-black text-gray-800 dark:text-gray-300 uppercase tracking-widest flex items-center justify-between focus:outline-none transition-colors hover:bg-gray-200/50 dark:hover:bg-gray-700/60">
                        <span class="flex items-center gap-2">
                            <span class="text-amber-600 dark:text-amber-400">${Admin.icon('hourglass', 'w-4 h-4')}</span> Time Simulation Engine
                        </span>
                        <svg id="sim-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    
                    <div id="sim-body" class="p-3 hidden space-y-4">
                        <div class="flex items-center justify-between">
                            <label class="text-sm font-bold text-gray-700 dark:text-gray-300">Enable Sim Mode</label>
                            <input type="checkbox" id="sim-enabled" class="h-5 w-5 text-blue-600 rounded focus:ring-blue-500 bg-gray-200 dark:bg-gray-600 border-gray-300 dark:border-gray-500">
                        </div>
                        
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Time (HH:MM)</label>
                                <input type="time" id="sim-time" step="1" class="w-full p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Day Type</label>
                                <select id="sim-day" class="w-full p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                                    <option value="1">Weekday (Mon)</option>
                                    <option value="6">Saturday</option>
                                    <option value="0">Sunday</option>
                                    <option value="specific">Specific Date...</option>
                                </select>
                            </div>
                        </div>

                        <div id="sim-date-container" class="hidden">
                            <label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Select Date (2026)</label>
                            <input type="date" id="sim-date" class="w-full p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-500 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                        </div>

                        <div class="flex gap-2 pt-2">
                            <button id="sim-apply-btn" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg shadow-sm transition-colors text-sm focus:outline-none">
                                Apply
                            </button>
                            <button id="sim-exit-btn" class="flex-1 bg-white hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 font-bold py-2.5 rounded-lg shadow-sm transition-colors text-sm focus:outline-none">
                                Exit
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const header = document.getElementById('diag-header-btn');
        const body = document.getElementById('diag-body');
        const chevron = document.getElementById('diag-chevron');
        const runBtn = document.getElementById('diag-run-btn');
        const resultsDiv = document.getElementById('diag-results');

        // Accordions
        const matrixHeader = document.getElementById('matrix-header-btn');
        const matrixBody = document.getElementById('matrix-body');
        const matrixChevron = document.getElementById('matrix-chevron');

        const deepscanHeader = document.getElementById('deepscan-header-btn');
        const deepscanBody = document.getElementById('deepscan-body');
        const deepscanChevron = document.getElementById('deepscan-chevron');
        
        const simHeader = document.getElementById('sim-header-btn');
        const simBody = document.getElementById('sim-body');
        const simChevron = document.getElementById('sim-chevron');

        const zoneAuditHeader = document.getElementById('zone-audit-header-btn');
        const zoneAuditBody = document.getElementById('zone-audit-body');
        const zoneAuditChevron = document.getElementById('zone-audit-chevron');
        const zoneAuditRunBtn = document.getElementById('zone-audit-run-btn');
        const zoneAuditExportBtn = document.getElementById('zone-audit-export-btn');
        const zoneAuditResults = document.getElementById('zone-audit-results');
        const zoneAuditSummary = document.getElementById('zone-audit-summary');
        let lastZoneAuditReport = null;

        const defaultBands = (typeof DEFAULT_ZONE_KM_BANDS !== 'undefined' && DEFAULT_ZONE_KM_BANDS)
            ? DEFAULT_ZONE_KM_BANDS
            : { Z1: 15, Z2: 40, Z3: 135 };
        const z1Input = document.getElementById('zone-audit-z1');
        const z2Input = document.getElementById('zone-audit-z2');
        const z3Input = document.getElementById('zone-audit-z3');
        if (z1Input) z1Input.value = defaultBands.Z1;
        if (z2Input) z2Input.value = defaultBands.Z2;
        if (z3Input) z3Input.value = defaultBands.Z3;

        if (zoneAuditHeader && zoneAuditBody) {
            zoneAuditHeader.onclick = () => {
                zoneAuditBody.classList.toggle('hidden');
                if (zoneAuditChevron) {
                    if (zoneAuditBody.classList.contains('hidden')) zoneAuditChevron.classList.add('-rotate-90');
                    else zoneAuditChevron.classList.remove('-rotate-90');
                }
            };
        }

        /**
         * Astro cutover: app version lives in public/app-version.json (not SPA js/config.js).
         * Accept JSON `{version}` or legacy `const APP_VERSION = '…'` text.
         */
        const parseAppVersionPayload = async (res) => {
            if (!res || !res.ok) return null;
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('json')) {
                const j = await res.json();
                const v = j && (j.version || j.appVersion || j.APP_VERSION);
                return v ? String(v).split(' - ')[0] : 'Unknown';
            }
            const confText = await res.text();
            try {
                const j = JSON.parse(confText);
                const v = j && (j.version || j.appVersion || j.APP_VERSION);
                if (v) return String(v).split(' - ')[0];
            } catch { /* not JSON */ }
            const verMatch = confText.match(/const APP_VERSION\s*=\s*["']([^"']+)["']/);
            return verMatch ? verMatch[1].split(' - ')[0] : 'Unknown';
        };

        /** Fetch JSON for diagnostics; surface worker deny bodies (e.g. Unauthorized Domain). */
        const fetchDiagJson = async (url) => {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) {
                let detail = `HTTP ${res.status}`;
                try {
                    const errBody = await res.clone().json();
                    if (errBody && errBody.error) detail += ` — ${errBody.error}`;
                } catch { /* ignore */ }
                throw new Error(detail);
            }
            return res.json();
        };

        const fetchDbForZoneAudit = async (targetRegion, scanSource) => {
            if (scanSource === 'RAM') {
                if (typeof fullDatabase === 'undefined' || !fullDatabase) {
                    throw new Error('Offline cache (RAM) is empty for this session.');
                }
                return fullDatabase;
            }

            const paths = {
                GP: scanSource === 'GITHUB' ? 'full-database.json' : 'schedules/gauteng.json',
                WC: scanSource === 'GITHUB' ? 'full-database.json' : 'schedules/westerncape.json',
                KZN: scanSource === 'GITHUB' ? 'full-database.json' : 'schedules/kzn.json',
                EC: scanSource === 'GITHUB' ? 'full-database.json' : 'schedules/easterncape.json',
            };
            const dbPath = paths[targetRegion];
            let fetchUrl = '';
            if (scanSource === 'GITHUB') {
                fetchUrl = `https://cdn.jsdelivr.net/gh/enock-elk/metrorail-app@main/data/${dbPath}?t=${Date.now()}`;
            } else if (scanSource === 'FIREBASE') {
                fetchUrl = `https://metrorail-next-train-default-rtdb.firebaseio.com/${dbPath}?t=${Date.now()}`;
            } else {
                fetchUrl = `https://nexttrain-cache.enock.workers.dev/${dbPath}?t=${Date.now()}`;
            }

            const rawData = await fetchDiagJson(fetchUrl);

            if (targetRegion === 'GP' && rawData.gauteng) return rawData.gauteng;
            if (targetRegion === 'WC' && rawData.westerncape) return rawData.westerncape;
            if (targetRegion === 'KZN' && rawData.kzn) return rawData.kzn;
            if (targetRegion === 'EC' && rawData.easterncape) return rawData.easterncape;
            if (targetRegion === 'GP' && rawData.schedules && !rawData.gauteng) return rawData.schedules;
            return rawData;
        };

        const renderZoneAuditReport = (report) => {
            lastZoneAuditReport = report;
            const { summary, routes, bands } = report;
            const esc = (typeof escapeHTML === 'function')
                ? escapeHTML
                : (t) => String(t).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

            if (zoneAuditSummary) {
                zoneAuditSummary.classList.remove('hidden');
                zoneAuditSummary.innerHTML = `
                    <div class="grid grid-cols-4 gap-1.5">
                        <div class="text-center bg-emerald-100/70 dark:bg-emerald-900/30 rounded-lg p-2 border border-emerald-200 dark:border-emerald-800/40">
                            <span class="block text-[8px] uppercase font-bold text-emerald-700 tracking-wider">Routes</span>
                            <span class="text-sm font-black text-emerald-900 dark:text-emerald-200">${summary.routesScanned}</span>
                        </div>
                        <div class="text-center bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 border border-amber-100 dark:border-amber-800/40">
                            <span class="block text-[8px] uppercase font-bold text-amber-600 tracking-wider">Mismatch</span>
                            <span class="text-sm font-black text-amber-700 dark:text-amber-300">${summary.mismatches}</span>
                        </div>
                        <div class="text-center bg-red-50 dark:bg-red-900/20 rounded-lg p-2 border border-red-100 dark:border-red-800/40">
                            <span class="block text-[8px] uppercase font-bold text-red-600 tracking-wider">No Zone</span>
                            <span class="text-sm font-black text-red-700 dark:text-red-300">${summary.missingZones}</span>
                        </div>
                        <div class="text-center bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2 border border-slate-200 dark:border-slate-700">
                            <span class="block text-[8px] uppercase font-bold text-slate-500 tracking-wider">OK</span>
                            <span class="text-sm font-black text-slate-700 dark:text-slate-200">${summary.ok}</span>
                        </div>
                    </div>
                    <p class="text-[8px] text-emerald-700/80 dark:text-emerald-500 mt-1.5 text-center">
                        PRASA bands: Z1 1-${bands.Z1} - Z2 ${bands.Z1 + 1}-${bands.Z2} - Z3 ${bands.Z2 + 1}-${bands.Z3} - Z4 &gt;${bands.Z3} km
                    </p>
                `;
            }

            if (!zoneAuditResults) return;

            if (!routes?.length) {
                zoneAuditResults.innerHTML = `<div class="text-xs text-amber-700 dark:text-amber-300 font-bold bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 rounded-lg text-center">${esc(summary.error || 'No active routes in this region.')}</div>`;
                return;
            }

            const statusStyle = {
                mismatch: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50',
                missing_zone: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50',
                thin_coords: 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700',
                no_sheets: 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700',
                ok: 'bg-white dark:bg-gray-900 border-emerald-100 dark:border-emerald-900/40',
            };

            zoneAuditResults.innerHTML = routes.map((r) => {
                const p = r.primary;
                const distLabel = p?.distanceKm != null
                    ? `${p.distanceKm.toFixed(1)} km`
                    : '-';
                const srcBit = p?.distanceSource
                    ? ({ path: 'path', km_mark: 'km mark', crow: 'crow-flies' }[p.distanceSource] || p.distanceSource)
                    : '';
                const assigned = p?.assignedZone || (r.zones?.[0] || '-');
                const suggested = p?.suggestedZone || '-';
                const rangeLabels = (typeof ZONE_KM_RANGE_LABELS !== 'undefined' && ZONE_KM_RANGE_LABELS) ? ZONE_KM_RANGE_LABELS : {};
                const suggestedRange = suggested !== '-' && rangeLabels[suggested] ? ` (${rangeLabels[suggested]})` : '';
                const routeBit = Admin.formatRouteLabelHtml(r.routeName);
                const style = statusStyle[r.status] || statusStyle.ok;
                const statusLabel = {
                    mismatch: 'MISMATCH',
                    missing_zone: 'NO ZONE',
                    thin_coords: 'THIN COORDS',
                    no_sheets: 'NO SHEETS',
                    ok: 'OK',
                }[r.status] || r.status;

                const dirRows = (r.directions || []).map((d) => {
                    const m = d.measure || {};
                    const segPreview = (m.segments || [])
                        .filter((s) => s.km != null)
                        .slice(0, 8)
                        .map((s) => `${esc(s.from)} -> ${esc(s.to)} ${s.km}km`)
                        .join(' - ');
                    const more = (m.segments || []).length > 8 ? ' -' : '';
                    return `
                        <div class="border-t border-black/5 dark:border-white/5 pt-1.5 mt-1.5">
                            <div class="flex justify-between gap-2 font-mono text-[9px]">
                                <span class="truncate">${esc(d.dayDir)} - ${esc(d.sheetKey)}</span>
                                <span>${d.distanceKm != null ? d.distanceKm.toFixed(1) + ' km' : '-'} - ${esc(d.assignedZone || '-')}/${esc(d.suggestedZone || '-')}${d.mismatch ? ' !' : ''}</span>
                            </div>
                            <div class="text-[8px] opacity-70 mt-0.5">
                                path ${m.pathKm != null ? m.pathKm + ' km' : '-'}
                                - crow ${m.crowKm != null ? m.crowKm + ' km' : '-'}
                                - km-mark ${m.kmMarkDelta != null ? m.kmMarkDelta + ' km' : '-'}
                                - coords ${m.withCoords || 0}/${m.stationCount || 0}
                            </div>
                            ${segPreview ? `<div class="text-[8px] opacity-60 mt-0.5 leading-snug">${segPreview}${more}</div>` : ''}
                        </div>
                    `;
                }).join('');

                return `
                    <details class="rounded-lg border text-[10px] leading-snug ${style}" ${r.status === 'mismatch' || r.status === 'missing_zone' ? 'open' : ''}>
                        <summary class="p-2.5 cursor-pointer list-none flex items-start justify-between gap-2 select-none">
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-1.5 mb-0.5">
                                    <span class="font-black uppercase tracking-wider text-[9px] opacity-80">${statusLabel}</span>
                                    <span class="font-mono text-[9px] opacity-60">${esc(assigned)} -> ${esc(suggested)}${esc(suggestedRange)}</span>
                                </div>
                                <div class="font-semibold truncate">${routeBit}</div>
                                <div class="text-[9px] opacity-70 mt-0.5">${esc(r.destA || '')} - ${esc(r.destB || '')}</div>
                            </div>
                            <div class="text-right shrink-0">
                                <div class="text-sm font-black leading-none">${distLabel}</div>
                                <div class="text-[8px] uppercase opacity-60 mt-0.5">${esc(srcBit)}</div>
                            </div>
                        </summary>
                        <div class="px-2.5 pb-2.5 pt-0">
                            ${dirRows || '<div class="text-[9px] opacity-60">No direction sheets found.</div>'}
                        </div>
                    </details>
                `;
            }).join('');
        };

        if (zoneAuditRunBtn) {
            zoneAuditRunBtn.onclick = async () => {
                const regionSelect = document.getElementById('diag-region-select');
                const sourceSelect = document.getElementById('zone-audit-source-select');
                const scanRegion = regionSelect?.value || 'CURRENT';
                const scanSourceRaw = sourceSelect?.value || 'FIREBASE';
                const activeRegion = typeof currentRegion !== 'undefined' ? currentRegion : 'GP';
                const targetRegion = scanRegion === 'CURRENT' ? activeRegion : scanRegion;
                const scanSource = (scanSourceRaw === 'RAM' && targetRegion !== activeRegion) ? 'FIREBASE' : scanSourceRaw;

                const bands = {
                    Z1: parseFloat(z1Input?.value) || defaultBands.Z1,
                    Z2: parseFloat(z2Input?.value) || defaultBands.Z2,
                    Z3: parseFloat(z3Input?.value) || defaultBands.Z3,
                };
                if (!(bands.Z1 < bands.Z2 && bands.Z2 < bands.Z3)) {
                    if (typeof showToast === 'function') showToast('Zone max km must be Z1 < Z2 < Z3', 'error');
                    return;
                }

                if (zoneAuditResults) {
                    zoneAuditResults.innerHTML = `<div class="text-xs text-gray-500 text-center py-4 flex flex-col items-center">${Admin.icon('hourglass', 'w-5 h-5 mb-2 animate-pulse')} Measuring ${targetRegion} from ${scanSource}-</div>`;
                }
                if (zoneAuditSummary) zoneAuditSummary.classList.add('hidden');

                try {
                    if (typeof runZoneDistanceAudit !== 'function') {
                        throw new Error('Zone audit engine not loaded (runZoneDistanceAudit missing).');
                    }
                    const db = await fetchDbForZoneAudit(targetRegion, scanSource);
                    const report = runZoneDistanceAudit(db, targetRegion, {
                        bands,
                        parseJSONSchedule: typeof parseJSONSchedule === 'function' ? parseJSONSchedule : null,
                    });
                    report.meta = {
                        region: targetRegion,
                        source: scanSource,
                        generatedAt: new Date().toISOString(),
                    };
                    renderZoneAuditReport(report);
                    if (typeof showToast === 'function') {
                        const s = report.summary;
                        showToast(
                            `Distance audit: ${s.mismatches} mismatch, ${s.missingZones} no zone`,
                            s.mismatches || s.missingZones ? 'info' : 'success',
                            2500
                        );
                    }
                } catch (e) {
                    if (zoneAuditResults) {
                        zoneAuditResults.innerHTML = `<div class="text-xs text-red-600 font-bold bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">Audit failed: ${String(e.message || e)}</div>`;
                    }
                }
            };
        }

        if (zoneAuditExportBtn) {
            zoneAuditExportBtn.onclick = () => {
                if (!lastZoneAuditReport) {
                    if (typeof showToast === 'function') showToast('Run a distance audit first', 'info', 1500);
                    return;
                }
                const name = `zone-distance-audit-${lastZoneAuditReport.meta?.region || 'region'}-${Date.now()}.json`;
                Admin.downloadFile(name, JSON.stringify(lastZoneAuditReport, null, 2), 'application/json;charset=utf-8');
                if (typeof showToast === 'function') showToast('Downloaded audit report', 'success', 1500);
            };
        }

        if (simHeader) {
            simHeader.onclick = () => {
                simBody.classList.toggle('hidden');
                if (simBody.classList.contains('hidden')) simChevron.classList.add('-rotate-90');
                else simChevron.classList.remove('-rotate-90');
            };
        }

        // Transplanted Simulation Control Logic
        const simApplyBtn = document.getElementById('sim-apply-btn');
        const simExitBtn = document.getElementById('sim-exit-btn');
        const simEnabledCheckbox = document.getElementById('sim-enabled');
        const simTimeInput = document.getElementById('sim-time');
        const dayDropdown = document.getElementById('sim-day');
        const dateContainer = document.getElementById('sim-date-container');
        const dateInput = document.getElementById('sim-date');
        const pipelineDropdown = document.getElementById('sim-pipeline-override');

        if (dayDropdown && dateContainer && dateInput) {
            dayDropdown.addEventListener('change', () => {
                if (dayDropdown.value === 'specific') {
                    dateContainer.classList.remove('hidden');
                    dateInput.focus();
                } else {
                    dateContainer.classList.add('hidden');
                }
            });
        }

        if (simApplyBtn) {
            simApplyBtn.addEventListener('click', () => {
                if (!simTimeInput || !simEnabledCheckbox) return;
                
                // If they hit apply, we assume they want to turn it ON
                simEnabledCheckbox.checked = true;

                window.isSimMode = true;
                window.simTimeStr = simTimeInput.value + (simTimeInput.value.length === 5 ? ":00" : "");
                try { window.__ntLastSimKey = null; } catch (e) {}
                
                // GUARDIAN PHASE 4: Save Pipeline Override to sessionStorage
                if (pipelineDropdown && pipelineDropdown.value !== 'AUTO') {
                    try { sessionStorage.setItem('dev_force_source', pipelineDropdown.value); } catch(e){}
                } else {
                    try { sessionStorage.removeItem('dev_force_source'); } catch(e){}
                }
                
                if (dayDropdown && dayDropdown.value === 'specific') {
                    if (dateInput && dateInput.value) {
                        const d = new Date(dateInput.value);
                        window.simDayIndex = d.getDay(); 
                    } else {
                        if (typeof showToast === 'function') showToast("Please select a valid date.", "error");
                        return;
                    }
                } else if (dayDropdown) {
                    window.simDayIndex = parseInt(dayDropdown.value);
                } else {
                    window.simDayIndex = 1;
                }

                if (typeof showToast === 'function') showToast("Dev Simulation Active! Fetching data...", "success");
                
                // Leave Dev Mode entirely (not just exitDrillToGrid on #dev-*).
                if (typeof Admin.closeDevModal === 'function') Admin.closeDevModal({ force: true });
                else if (typeof closeSmoothModal === 'function') closeSmoothModal('dev-modal', true);
                
                // GUARDIAN HOTFIX: Force network sync to apply Pipeline Overrides, then update UI
                if (typeof loadAllSchedules === 'function') {
                    loadAllSchedules(true).then(() => {
                        if (typeof updateTime === 'function') updateTime(); 
                        if (typeof findNextTrains === 'function') findNextTrains();
                    });
                } else {
                    if (typeof updateTime === 'function') updateTime(); 
                    if (typeof findNextTrains === 'function') findNextTrains();
                }
            });
        }

        if (simExitBtn) {
            simExitBtn.addEventListener('click', () => {
                window.isSimMode = false;
                window.simTimeStr = null;
                window.simDayIndex = null;
                try { window.__ntLastSimKey = null; } catch (e) {}
                if(simEnabledCheckbox) simEnabledCheckbox.checked = false;
                
                // GUARDIAN PHASE 4: Clear Pipeline Override on exit
                try { sessionStorage.removeItem('dev_force_source'); } catch(e){}
                const pipelineDropdown = document.getElementById('sim-pipeline-override');
                if (pipelineDropdown) pipelineDropdown.value = 'AUTO';

                if (typeof showToast === 'function') showToast("Exited Developer Mode", "info");
                
                if (typeof Admin.closeDevModal === 'function') Admin.closeDevModal({ force: true });
                else if (typeof closeSmoothModal === 'function') closeSmoothModal('dev-modal', true);

                if (typeof updateTime === 'function') updateTime(); 
                if (typeof findNextTrains === 'function') findNextTrains();
            });
        }

        if (matrixHeader) {
            matrixHeader.onclick = () => {
                matrixBody.classList.toggle('hidden');
                if (matrixBody.classList.contains('hidden')) matrixChevron.classList.add('-rotate-90');
                else matrixChevron.classList.remove('-rotate-90');
            };
        }

        if (deepscanHeader) {
            deepscanHeader.onclick = () => {
                deepscanBody.classList.toggle('hidden');
                if (deepscanBody.classList.contains('hidden')) deepscanChevron.classList.add('-rotate-90');
                else deepscanChevron.classList.remove('-rotate-90');
            };
        }

        // Main Module Toggle
        header.onclick = () => {
            if (Admin.isGridMode) return; 
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) chevron.classList.add('-rotate-90');
            else chevron.classList.remove('-rotate-90');
        };

        // --- CACHE PROPAGATION MATRIX LOGIC ---
        const pingBtn = document.getElementById('ping-diagnostics-btn');
        const pingResults = document.getElementById('ping-results');
        const matrixTbody = document.getElementById('matrix-tbody');

        const formatNiceDate = (dateStr) => {
            if (!dateStr || dateStr === 'Unknown') return 'Unknown';
            try {
                const d = new Date(dateStr.replace(/^last updated[:\s-]*/i, '').trim());
                if (isNaN(d.getTime())) return dateStr;
                const day = d.getDate();
                const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
                const year = d.getFullYear();
                let hours = d.getHours();
                const ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12;
                hours = hours ? hours : 12; 
                const minutes = d.getMinutes().toString().padStart(2, '0');
                return `${day} ${month} ${year} - ${hours}:${minutes}${ampm}`;
            } catch(e) { return dateStr; }
        };

        if (pingBtn) {
            pingBtn.onclick = async () => {
                pingResults.classList.remove('hidden');
                matrixTbody.innerHTML = `<tr><td colspan="3" class="px-2 py-6 text-center italic text-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/10">Probing Global Edge Networks...<br><span class="text-[8px] opacity-70">Bypassing local caches</span></td></tr>`;
                
                const regionSelect = document.getElementById('diag-region-select');
                const targetRegion = regionSelect ? regionSelect.value : 'CURRENT';
                const activeRegion = typeof currentRegion !== 'undefined' ? currentRegion : 'GP';
                const actualRegion = targetRegion === 'CURRENT' ? activeRegion : targetRegion;

                const getRegionDbPath = (source) => {
                    const paths = {
                        'GP': source === 'GITHUB' ? 'full-database.json' : 'schedules/gauteng.json',
                        'WC': source === 'GITHUB' ? 'full-database.json' : 'schedules/westerncape.json',
                        'KZN': source === 'GITHUB' ? 'full-database.json' : 'schedules/kzn.json',
                        'EC': source === 'GITHUB' ? 'full-database.json' : 'schedules/easterncape.json'
                    };
                    return paths[actualRegion];
                };

                // Astro: probe app-version.json (SPA used js/config.js APP_VERSION scrape).
                // Cloudflare column = production CDN host; GitHub = jsDelivr metrorail-app deploy.
                const pipelines = [
                    {
                        name: 'Cloudflare Edge',
                        configUrl: 'https://nexttrain.co.za/app-version.json',
                        dbUrl: `https://nexttrain-cache.enock.workers.dev/${getRegionDbPath('CLOUDFLARE')}`,
                        expectApp: true
                    },
                    {
                        name: 'GitHub CDN',
                        configUrl: 'https://cdn.jsdelivr.net/gh/enock-elk/metrorail-app@main/app-version.json',
                        dbUrl: `https://cdn.jsdelivr.net/gh/enock-elk/metrorail-app@main/data/${getRegionDbPath('GITHUB')}`,
                        expectApp: true
                    },
                    {
                        name: 'Firebase Live',
                        configUrl: null,
                        dbUrl: `https://metrorail-next-train-default-rtdb.firebaseio.com/${getRegionDbPath('FIREBASE')}`,
                        expectApp: false // RTDB has schedules only — no app shell version
                    }
                ];

                const probePromises = pipelines.map(async (pipe) => {
                    const start = Date.now();
                    let appVer = "Error";
                    let appTime = "Fetch Failed";
                    let dbTime = "Fetch Failed";
                    let latency = 0;
                    let latencyClass = "text-red-600 dark:text-red-400"; // Default failure state

                    try {
                        // Concurrent non-blocking fetches using cache: 'no-store'
                        const [confRes, dbRes] = await Promise.all([
                            pipe.configUrl
                                ? fetch(pipe.configUrl, { cache: 'no-store' }).catch(() => null)
                                : Promise.resolve(null),
                            fetch(pipe.dbUrl, { cache: 'no-store' }).catch(() => null)
                        ]);

                        latency = Date.now() - start;

                        if (confRes && confRes.ok) {
                            const parsed = await parseAppVersionPayload(confRes);
                            appVer = parsed || 'Unknown';
                            const lastMod = confRes.headers.get('Last-Modified');
                            if (lastMod) appTime = formatNiceDate(lastMod);
                            else appTime = "Cache Verified";
                        } else if (!pipe.expectApp) {
                            appVer = "N/A";
                            appTime = "RTDB Data Only";
                        } else if (confRes && !confRes.ok) {
                            appTime = `HTTP ${confRes.status}`;
                        }

                        // Parse Database Freshness
                        if (dbRes && dbRes.ok) {
                            const dbJson = await dbRes.json();
                            if (dbJson) {
                                let targetObj = dbJson;
                                // Unwrap nested regions if necessary
                                if (actualRegion === 'GP' && dbJson.gauteng) targetObj = dbJson.gauteng;
                                else if (actualRegion === 'WC' && dbJson.westerncape) targetObj = dbJson.westerncape;
                                else if (actualRegion === 'KZN' && dbJson.kzn) targetObj = dbJson.kzn;
                                else if (actualRegion === 'EC' && dbJson.easterncape) targetObj = dbJson.easterncape;
                                else if (actualRegion === 'GP' && dbJson.schedules && !dbJson.gauteng) targetObj = dbJson.schedules;
                                
                                let dbVer = targetObj.lastUpdated || 'Unknown';
                                dbTime = formatNiceDate(dbVer);
                            }
                        } else if (dbRes && !dbRes.ok) {
                            try {
                                const errBody = await dbRes.clone().json();
                                dbTime = errBody && errBody.error
                                    ? `HTTP ${dbRes.status} — ${errBody.error}`
                                    : `HTTP ${dbRes.status}`;
                            } catch {
                                dbTime = `HTTP ${dbRes.status}`;
                            }
                        }

                        // Color-coding latency & validation matrix
                        if (appVer !== "Error" && dbTime !== "Fetch Failed" && !String(dbTime).startsWith('HTTP ')) {
                            if (latency < 500) {
                                latencyClass = "text-green-600 dark:text-green-400";
                            } else if (latency < 1000) {
                                latencyClass = "text-orange-500 dark:text-orange-400";
                            } else {
                                latencyClass = "text-red-600 dark:text-red-400"; // Slow response
                            }
                        }

                    } catch (e) {
                        latency = Date.now() - start;
                        latencyClass = "text-red-600 dark:text-red-400";
                    }

                    return {
                        name: pipe.name,
                        appVer: appVer,
                        appTime: appTime,
                        dbTime: dbTime,
                        latency: latency,
                        latencyClass: latencyClass
                    };
                });

                const results = await Promise.all(probePromises);
                
                let html = '';
                const currentAppVer = typeof APP_VERSION !== 'undefined' ? APP_VERSION.split(' - ')[0] : 'Unknown';

                results.forEach(res => {
                    let appVerClass = "text-blue-600 dark:text-blue-400";
                    if (res.appVer !== "Error" && res.appVer !== "N/A") {
                        if (res.appVer === currentAppVer) {
                            appVerClass = "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded";
                        } else {
                            appVerClass = "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400 px-1.5 py-0.5 rounded";
                        }
                    }

                    // GUARDIAN FIX: Adjusted padding and wrapping to ensure narrow mobile screens don't stretch
                    html += `
                        <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                            <td class="px-1.5 py-2 border-r border-gray-100 dark:border-gray-800 align-top">
                                <div class="font-bold text-gray-900 dark:text-white leading-tight mt-0.5">${res.name}</div>
                            </td>
                            <td class="px-1.5 py-2 border-r border-gray-100 dark:border-gray-800 align-top">
                                <div class="font-mono font-bold inline-block mb-1 ${appVerClass}">${res.appVer}</div>
                                <div class="text-[8px] text-gray-500 uppercase tracking-wider leading-tight">${res.appTime}</div>
                            </td>
                            <td class="px-1.5 py-2 text-right align-top">
                                <div class="font-mono font-black text-xs ${res.latencyClass} mb-1">${res.latency}ms</div>
                                <div class="text-[8px] text-gray-500 uppercase tracking-wider leading-tight block break-words">${res.dbTime}</div>
                            </td>
                        </tr>
                    `;
                });
                
                matrixTbody.innerHTML = html;
            };
        }

        // --- DEEP NETWORK SCAN LOGIC ---
        runBtn.onclick = async () => {
            resultsDiv.innerHTML = '<div class="text-xs text-gray-500 text-center py-4 flex flex-col items-center"><svg class="animate-spin h-5 w-5 text-blue-600 mb-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Initializing scan...</div>';
            
            // GUARDIAN PHASE 2: Dynamic Region & Source Engine
            const regionSelect = document.getElementById('diag-region-select');
            const sourceSelect = document.getElementById('deepscan-source-select');
            const scanRegion = regionSelect ? regionSelect.value : 'CURRENT';
            const scanSourceRaw = sourceSelect ? sourceSelect.value : 'RAM';
            const activeRegion = typeof currentRegion !== 'undefined' ? currentRegion : 'GP';
            const targetRegion = scanRegion === 'CURRENT' ? activeRegion : scanRegion;

            // Failsafe: Prevent scanning non-active regions from Local RAM cache
            const scanSource = (scanSourceRaw === 'RAM' && targetRegion !== activeRegion) ? 'CLOUDFLARE' : scanSourceRaw;

            let dbToScan = null;

            if (scanSource !== 'RAM') {
                // Fetch target region database from specific pipeline
                try {
                    const getRegionDbPath = (source) => {
                        const paths = {
                            'GP': source === 'GITHUB' ? 'full-database.json' : 'schedules/gauteng.json',
                            'WC': source === 'GITHUB' ? 'full-database.json' : 'schedules/westerncape.json',
                            'KZN': source === 'GITHUB' ? 'full-database.json' : 'schedules/kzn.json',
                            'EC': source === 'GITHUB' ? 'full-database.json' : 'schedules/easterncape.json'
                        };
                        return paths[targetRegion];
                    };

                    let fetchUrl = '';
                    let loadingMsg = '';
                    const dbPath = getRegionDbPath(scanSource);

                    if (scanSource === 'GITHUB') {
                        fetchUrl = `https://cdn.jsdelivr.net/gh/enock-elk/metrorail-app@main/data/${dbPath}?t=${Date.now()}`;
                        loadingMsg = 'Downloading GitHub CDN payload...';
                    } else if (scanSource === 'FIREBASE') {
                        fetchUrl = `https://metrorail-next-train-default-rtdb.firebaseio.com/${dbPath}?t=${Date.now()}`;
                        loadingMsg = 'Downloading Firebase Live payload...';
                    } else {
                        fetchUrl = `https://nexttrain-cache.enock.workers.dev/${dbPath}?t=${Date.now()}`;
                        loadingMsg = 'Downloading Cloudflare payload...';
                    }

                    resultsDiv.innerHTML = `<div class="text-xs text-gray-500 text-center py-4 flex flex-col items-center"><svg class="animate-spin h-5 w-5 text-blue-600 mb-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>${loadingMsg}</div>`;
                    
                    let rawData = await fetchDiagJson(fetchUrl);
                    
                    if (targetRegion === 'GP' && rawData.gauteng) dbToScan = rawData.gauteng;
                    else if (targetRegion === 'WC' && rawData.westerncape) dbToScan = rawData.westerncape;
                    else if (targetRegion === 'KZN' && rawData.kzn) dbToScan = rawData.kzn;
                    else if (targetRegion === 'EC' && rawData.easterncape) dbToScan = rawData.easterncape;
                    else if (targetRegion === 'GP' && rawData.schedules && !rawData.gauteng) dbToScan = rawData.schedules;
                    else dbToScan = rawData;
                } catch(e) {
                    const hint = /Unauthorized Domain|Missing Origin/i.test(String(e.message || ''))
                        ? ' Deploy workers/nexttrain-cache (allowlist enock-elk.github.io) or run diagnostics on nexttrain.co.za.'
                        : '';
                    resultsDiv.innerHTML = `<div class="text-xs text-red-500 font-bold bg-red-50 p-2 rounded">Error: Failed to fetch ${targetRegion} from ${scanSource}. ${e.message}${hint}</div>`;
                    return;
                }
            } else {
                resultsDiv.innerHTML = `<div class="text-xs text-gray-500 text-center py-4 flex flex-col items-center"><svg class="animate-spin h-5 w-5 text-blue-600 mb-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Scanning local memory cache...</div>`;
                if (typeof fullDatabase === 'undefined' || !fullDatabase) {
                    resultsDiv.innerHTML = '<div class="text-xs text-red-500 font-bold bg-red-50 p-2 rounded">Error: Offline Cache (RAM) is missing.</div>';
                    return;
                }
                dbToScan = fullDatabase;
            }

            // Small delay to allow UI to breathe
            setTimeout(() => {
                let html = '';
                let healthyCount = 0;
                let brokenCount = 0;
                let totalRoutes = 0;

                if (typeof ROUTES !== 'undefined') {
                    Object.values(ROUTES).forEach(route => {
                        if (!route.isActive || route.id === 'special_event') return;
                        if (route.region !== targetRegion) return;
                        
                        totalRoutes++;
                        let routeHealthy = true;
                        let missingSheets = [];
                        let structuralErrors = []; 

                        if (route.sheetKeys) {
                            Object.entries(route.sheetKeys).forEach(([dayDir, key]) => {
                                const sheet = dbToScan[key];
                                if (!sheet || !Array.isArray(sheet) || sheet.length === 0) {
                                    routeHealthy = false;
                                    missingSheets.push(key); 
                                } else {
                                    const parsedSchedule = typeof parseJSONSchedule === 'function' ? parseJSONSchedule(sheet) : null;
                                    
                                    if (!parsedSchedule || !parsedSchedule.headers || parsedSchedule.headers.length <= 1) {
                                        routeHealthy = false;
                                        if (!structuralErrors.includes("0 Trains")) structuralErrors.push(`0 Trains (${key})`); 
                                    }
                                    
                                    const cleanA = route.destA.replace(' STATION', '').trim().toUpperCase();
                                    const cleanB = route.destB.replace(' STATION', '').trim().toUpperCase();
                                    
                                    const stationsInSheet = parsedSchedule ? parsedSchedule.rows.map(r => String(r.STATION || '').replace(' STATION', '').trim().toUpperCase()) : [];
                                    const hasA = stationsInSheet.some(s => s.includes(cleanA));
                                    const hasB = stationsInSheet.some(s => s.includes(cleanB));
                                    
                                    if (!hasA) {
                                        routeHealthy = false;
                                        const err = `Missing Dest A: ${cleanA}`;
                                        if (!structuralErrors.includes(err)) structuralErrors.push(err);
                                    }
                                    if (!hasB) {
                                        routeHealthy = false;
                                        const err = `Missing Dest B: ${cleanB}`;
                                        if (!structuralErrors.includes(err)) structuralErrors.push(err);
                                    }
                                }
                            });
                        } else {
                            routeHealthy = false;
                            missingSheets.push("Configuration Error");
                        }

                        if (routeHealthy) {
                            healthyCount++;
                            html += `
                                <div class="flex justify-between items-center bg-green-50 dark:bg-green-900/20 p-2.5 rounded-lg text-xs border border-green-100 dark:border-green-800/50 mt-1.5">
                                    <span class="font-bold text-green-800 dark:text-green-300 inline-flex items-center">${Admin.formatRouteLabelHtml(route.name)}</span>
                                    <span class="bg-green-500 text-white px-2 py-0.5 rounded shadow-sm text-[9px] uppercase tracking-wider font-bold">Healthy</span>
                                </div>
                            `;
                        } else {
                            brokenCount++;
                            let errorsHtml = '';
                            if (missingSheets.length > 0) errorsHtml += `<div class="text-[10px] text-red-600 dark:text-red-400 font-mono bg-red-100/50 dark:bg-red-900/40 p-1.5 rounded mb-1 border border-red-200 dark:border-red-800/50">Missing DB: ${missingSheets.join(', ')}</div>`;
                            if (structuralErrors.length > 0) errorsHtml += `<div class="text-[10px] text-orange-600 dark:text-orange-400 font-mono bg-orange-100/50 dark:bg-orange-900/40 p-1.5 rounded border border-orange-200 dark:border-orange-800/50">Structure: ${structuralErrors.join(' | ')}</div>`;
                            
                            html += `
                                <div class="flex flex-col bg-red-50 dark:bg-red-900/20 p-2.5 rounded-lg text-xs border border-red-100 dark:border-red-800/50 mt-1.5">
                                    <div class="flex justify-between items-center mb-1.5">
                                        <span class="font-bold text-red-800 dark:text-red-300 inline-flex items-center">${Admin.formatRouteLabelHtml(route.name)}</span>
                                        <span class="bg-red-500 text-white px-2 py-0.5 rounded shadow-sm text-[9px] uppercase tracking-wider font-bold">Errors Found</span>
                                    </div>
                                    ${errorsHtml}
                                </div>
                            `;
                        }
                    });
                }

                const regionNameMap = { 'GP': 'Gauteng', 'WC': 'Western Cape', 'KZN': 'KwaZulu-Natal', 'EC': 'Eastern Cape' };
                const displayRegion = regionNameMap[targetRegion] || targetRegion;

                let dataAgeStr = "Unknown";
                if (dbToScan && dbToScan.lastUpdated) {
                    let rawDate = String(dbToScan.lastUpdated).replace(/^last updated[:\s-]*/i, '').trim();
                    dataAgeStr = typeof formatEffectiveDate === 'function' ? formatEffectiveDate(rawDate) : rawDate;
                }

                const summary = `
                    <div class="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg border border-blue-100 dark:border-blue-800/50 mb-3 shadow-sm">
                        <span class="text-[10px] font-bold text-blue-800 dark:text-blue-300 uppercase tracking-widest flex items-center gap-1.5">${Admin.icon('clock', 'w-3.5 h-3.5')} Source Data Age</span>
                        <span class="font-mono text-[10px] font-black text-blue-700 dark:text-blue-400 bg-white dark:bg-gray-800 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-700/50">${dataAgeStr}</span>
                    </div>
                    <div class="flex justify-between bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl mb-4 border border-gray-100 dark:border-gray-600">
                        <div class="text-center flex-1 border-r border-gray-200 dark:border-gray-600"><span class="block text-[9px] text-gray-500 uppercase font-bold tracking-widest mb-0.5">${displayRegion} Routes</span><span class="text-lg font-black text-gray-800 dark:text-gray-200 leading-none">${totalRoutes}</span></div>
                        <div class="text-center flex-1 border-r border-gray-200 dark:border-gray-600"><span class="block text-[9px] text-green-600 uppercase font-bold tracking-widest mb-0.5">Healthy</span><span class="text-lg font-black text-green-600 leading-none">${healthyCount}</span></div>
                        <div class="text-center flex-1"><span class="block text-[9px] text-red-600 uppercase font-bold tracking-widest mb-0.5">Errors</span><span class="text-lg font-black text-red-600 leading-none">${brokenCount}</span></div>
                    </div>
                `;

                resultsDiv.innerHTML = summary + html;
            }, 400);
        };
    },

    /**
     * Standalone Schedule QA - data quality (duplicate adjacent times, regressions,
     * delta variance). Kept separate from System Health Diagnostics (cache/network).
     */
    setupScheduleQaManager: () => {
        const diagPanel = document.getElementById('diag-panel');
        const alertPanel = document.getElementById('alert-panel');
        const parent = diagPanel?.parentNode || alertPanel?.parentNode;
        if (!parent) return;

        let qaPanel = document.getElementById('sched-qa-panel');
        if (!qaPanel) {
            qaPanel = document.createElement('div');
            qaPanel.id = 'sched-qa-panel';
            if (diagPanel?.nextSibling) parent.insertBefore(qaPanel, diagPanel.nextSibling);
            else parent.appendChild(qaPanel);
        }

        if (qaPanel.dataset.loaded === 'true') return;
        qaPanel.dataset.loaded = 'true';

        // overflow-visible so the issue-type menu is not clipped by the white card
        qaPanel.className = 'bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-visible transition-all duration-300';

        qaPanel.innerHTML = `
            <button id="sched-qa-header-btn" class="w-full text-left text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('search', 'text-violet-500 dark:text-violet-400')}
                    <span>Schedule Data QA</span>
                </span>
                <svg id="sched-qa-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>

            <div id="sched-qa-body" class="hidden mt-4 space-y-4 overflow-visible">
                <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
                    Flags impossible or suspicious timetable cells: identical adjacent stops, time regressions,
                    delta variance, missing coordinates, day mismatches, and more.
                    Diagnostics (above) covers cache/network - this panel is schedule content only.
                </p>

                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Region</label>
                        <select id="sched-qa-region" class="w-full h-10 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500 outline-none">
                            <option value="CURRENT">Active region</option>
                            <option value="GP">Gauteng</option>
                            <option value="WC">Western Cape</option>
                            <option value="KZN">KwaZulu-Natal</option>
                            <option value="EC">Eastern Cape</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Source</label>
                        <select id="sched-qa-source" class="w-full h-10 px-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500 outline-none">
                            <option value="FIREBASE" selected>Firebase</option>
                            <option value="CLOUDFLARE">Cloudflare</option>
                            <option value="GITHUB">GitHub CDN</option>
                            <option value="RAM">RAM cache</option>
                        </select>
                    </div>
                </div>

                <div class="relative z-30" id="sched-qa-filter-wrap">
                    <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Issue types to show</label>
                    <button type="button" id="sched-qa-filter-btn" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-xs text-left text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500 outline-none flex items-center justify-between">
                        <span id="sched-qa-filter-label">All default issue types</span>
                        <svg class="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="sched-qa-filter-menu" class="hidden absolute left-0 right-0 z-[80] mt-1 w-full max-h-56 overflow-y-auto custom-scrollbar bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-2 space-y-0.5">
                        <div class="flex gap-2 px-1 pb-2 mb-1 border-b border-gray-100 dark:border-gray-800">
                            <button type="button" id="sched-qa-filter-all" class="text-[9px] font-bold uppercase text-violet-600 hover:underline">All</button>
                            <button type="button" id="sched-qa-filter-defaults" class="text-[9px] font-bold uppercase text-gray-500 hover:underline">Defaults</button>
                            <button type="button" id="sched-qa-filter-none" class="text-[9px] font-bold uppercase text-gray-500 hover:underline">None</button>
                        </div>
                        <div id="sched-qa-filter-list" class="space-y-0.5"></div>
                    </div>
                </div>

                <div class="flex gap-2">
                    <button id="sched-qa-run-btn" class="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-bold py-2.5 rounded-lg shadow-md transition-colors text-[10px] uppercase tracking-wide focus:outline-none flex justify-center items-center gap-1.5">
                        ${Admin.icon('search', 'w-3.5 h-3.5')} Run QA report
                    </button>
                    <button id="sched-qa-export-btn" class="px-3 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 font-bold py-2.5 rounded-lg text-[10px] uppercase tracking-wide focus:outline-none inline-flex items-center gap-1" title="Download last report as JSON">
                        ${Admin.icon('download', 'w-3.5 h-3.5')} Export
                    </button>
                </div>

                <div id="sched-qa-summary" class="hidden"></div>
                <div id="sched-qa-results" class="space-y-1.5 max-h-80 overflow-y-auto custom-scrollbar"></div>
            </div>
        `;

        const header = document.getElementById('sched-qa-header-btn');
        const body = document.getElementById('sched-qa-body');
        const chevron = document.getElementById('sched-qa-chevron');
        const runBtn = document.getElementById('sched-qa-run-btn');
        const exportBtn = document.getElementById('sched-qa-export-btn');
        const resultsDiv = document.getElementById('sched-qa-results');
        const summaryDiv = document.getElementById('sched-qa-summary');
        const filterList = document.getElementById('sched-qa-filter-list');
        const filterBtn = document.getElementById('sched-qa-filter-btn');
        const filterMenu = document.getElementById('sched-qa-filter-menu');
        const filterLabel = document.getElementById('sched-qa-filter-label');

        let lastReport = null;
        const issueTypes = (typeof QA_ISSUE_TYPES !== 'undefined' && Array.isArray(QA_ISSUE_TYPES))
            ? QA_ISSUE_TYPES
            : [
                { code: 'DUPLICATE_ADJACENT', label: 'Identical adjacent times', defaultOn: true },
                { code: 'TIME_REGRESSION', label: 'Time goes backwards', defaultOn: true },
                { code: 'DELTA_VARIANCE', label: 'Inconsistent deltas', defaultOn: true },
                { code: 'MISSING_COORDS', label: 'Missing coordinates', defaultOn: true },
            ];

        const syncFilterLabel = () => {
            const boxes = filterList?.querySelectorAll('input[data-qa-code]') || [];
            const on = [...boxes].filter((b) => b.checked).length;
            if (filterLabel) filterLabel.textContent = on === boxes.length ? 'All issue types' : `${on} of ${boxes.length} types selected`;
        };

        if (filterList) {
            filterList.innerHTML = issueTypes.map((t) => `
                <label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 cursor-pointer text-[11px] text-gray-700 dark:text-gray-200">
                    <input type="checkbox" data-qa-code="${t.code}" class="rounded text-violet-600" ${t.defaultOn ? 'checked' : ''} />
                    <span class="font-medium">${t.label}</span>
                    <span class="ml-auto font-mono text-[9px] text-gray-400">${t.code}</span>
                </label>
            `).join('');
            filterList.querySelectorAll('input').forEach((el) => el.addEventListener('change', () => {
                syncFilterLabel();
                if (lastReport) renderReport(lastReport);
            }));
            syncFilterLabel();
        }

        if (filterBtn && filterMenu) {
            filterBtn.onclick = (e) => {
                e.stopPropagation();
                filterMenu.classList.toggle('hidden');
                // Lift this card above neighbouring white panels while the menu is open
                qaPanel.style.zIndex = filterMenu.classList.contains('hidden') ? '' : '50';
            };
            document.addEventListener('click', (e) => {
                const wrap = document.getElementById('sched-qa-filter-wrap');
                if (wrap && !wrap.contains(e.target)) {
                    filterMenu.classList.add('hidden');
                    qaPanel.style.zIndex = '';
                }
            });
        }
        document.getElementById('sched-qa-filter-all')?.addEventListener('click', () => {
            filterList?.querySelectorAll('input').forEach((b) => { b.checked = true; });
            syncFilterLabel();
            if (lastReport) renderReport(lastReport);
        });
        document.getElementById('sched-qa-filter-none')?.addEventListener('click', () => {
            filterList?.querySelectorAll('input').forEach((b) => { b.checked = false; });
            syncFilterLabel();
            if (lastReport) renderReport(lastReport);
        });
        document.getElementById('sched-qa-filter-defaults')?.addEventListener('click', () => {
            filterList?.querySelectorAll('input[data-qa-code]').forEach((b) => {
                const meta = issueTypes.find((t) => t.code === b.dataset.qaCode);
                b.checked = !!(meta && meta.defaultOn);
            });
            syncFilterLabel();
            if (lastReport) renderReport(lastReport);
        });

        if (header && body) {
            header.onclick = () => {
                body.classList.toggle('hidden');
                if (chevron) {
                    if (body.classList.contains('hidden')) chevron.classList.add('-rotate-90');
                    else chevron.classList.remove('-rotate-90');
                }
            };
        }

        const fetchDbForQa = async (targetRegion, scanSource) => {
            if (scanSource === 'RAM') {
                if (typeof fullDatabase === 'undefined' || !fullDatabase) {
                    throw new Error('Offline cache (RAM) is empty for this session.');
                }
                return fullDatabase;
            }

            const paths = {
                GP: scanSource === 'GITHUB' ? 'full-database.json' : 'schedules/gauteng.json',
                WC: scanSource === 'GITHUB' ? 'full-database.json' : 'schedules/westerncape.json',
                KZN: scanSource === 'GITHUB' ? 'full-database.json' : 'schedules/kzn.json',
                EC: scanSource === 'GITHUB' ? 'full-database.json' : 'schedules/easterncape.json',
            };
            const dbPath = paths[targetRegion];
            let fetchUrl = '';
            if (scanSource === 'GITHUB') {
                fetchUrl = `https://cdn.jsdelivr.net/gh/enock-elk/metrorail-app@main/data/${dbPath}?t=${Date.now()}`;
            } else if (scanSource === 'FIREBASE') {
                fetchUrl = `https://metrorail-next-train-default-rtdb.firebaseio.com/${dbPath}?t=${Date.now()}`;
            } else {
                fetchUrl = `https://nexttrain-cache.enock.workers.dev/${dbPath}?t=${Date.now()}`;
            }

            const rawData = await fetchDiagJson(fetchUrl);

            if (targetRegion === 'GP' && rawData.gauteng) return rawData.gauteng;
            if (targetRegion === 'WC' && rawData.westerncape) return rawData.westerncape;
            if (targetRegion === 'KZN' && rawData.kzn) return rawData.kzn;
            if (targetRegion === 'EC' && rawData.easterncape) return rawData.easterncape;
            if (targetRegion === 'GP' && rawData.schedules && !rawData.gauteng) return rawData.schedules;
            return rawData;
        };

        const severityStyles = {
            error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-300',
            warn: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-900 dark:text-amber-200',
            info: 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300',
        };

        const selectedCodes = () => {
            const boxes = filterList?.querySelectorAll('input[data-qa-code]:checked') || [];
            return new Set([...boxes].map((b) => b.dataset.qaCode));
        };

        const renderReport = (report) => {
            lastReport = report;
            const allowed = selectedCodes();
            let findings = (report.findings || []).filter((f) => allowed.has(f.code) || (f.code === 'NO_DB' && allowed.size === 0));
            // If nothing selected, show empty intentionally
            if (allowed.size === 0) findings = [];

            const { summary } = report;
            if (summaryDiv) {
                summaryDiv.classList.remove('hidden');
                summaryDiv.innerHTML = `
                    <div class="grid grid-cols-4 gap-1.5 mb-2">
                        <div class="text-center bg-violet-50 dark:bg-violet-900/20 rounded-lg p-2 border border-violet-100 dark:border-violet-800/40">
                            <span class="block text-[8px] uppercase font-bold text-violet-600 tracking-wider">Sheets</span>
                            <span class="text-sm font-black text-violet-800 dark:text-violet-200">${summary.sheetsScanned}</span>
                        </div>
                        <div class="text-center bg-red-50 dark:bg-red-900/20 rounded-lg p-2 border border-red-100 dark:border-red-800/40">
                            <span class="block text-[8px] uppercase font-bold text-red-600 tracking-wider">Errors</span>
                            <span class="text-sm font-black text-red-700 dark:text-red-300">${summary.errors}</span>
                        </div>
                        <div class="text-center bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 border border-amber-100 dark:border-amber-800/40">
                            <span class="block text-[8px] uppercase font-bold text-amber-600 tracking-wider">Warns</span>
                            <span class="text-sm font-black text-amber-700 dark:text-amber-300">${summary.warnings}</span>
                        </div>
                        <div class="text-center bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2 border border-slate-200 dark:border-slate-700">
                            <span class="block text-[8px] uppercase font-bold text-slate-500 tracking-wider">Shown</span>
                            <span class="text-sm font-black text-slate-700 dark:text-slate-200">${findings.length}</span>
                        </div>
                    </div>
                `;
            }

            if (!findings.length) {
                resultsDiv.innerHTML = `<div class="text-xs text-green-700 dark:text-green-400 font-bold bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 rounded-lg text-center">${allowed.size === 0 ? 'Select at least one issue type above.' : (summary.errors + summary.warnings === 0 ? 'Schedule looks clean for this region.' : 'No findings match the selected issue types.')}</div>`;
                return;
            }

            resultsDiv.innerHTML = findings.map((f) => {
                const style = severityStyles[f.severity] || severityStyles.info;
                const routeBit = f.routeName ? Admin.formatRouteLabelHtml(f.routeName) : (f.routeId || '');
                const meta = [f.sheetKey, f.dayDir, f.train, f.station].filter(Boolean).join(' - ');
                return `
                    <div class="p-2.5 rounded-lg border text-[10px] leading-snug ${style}">
                        <div class="flex items-center justify-between gap-2 mb-1">
                            <span class="font-black uppercase tracking-wider text-[9px]">${f.severity} - ${f.code}</span>
                            <span class="font-mono text-[9px] opacity-70 truncate">${meta}</span>
                        </div>
                        <div class="font-semibold mb-0.5">${routeBit}</div>
                        <div>${String(f.message || '').replace(/</g, '&lt;')}</div>
                    </div>
                `;
            }).join('');
        };

        if (runBtn) {
            runBtn.onclick = async () => {
                const regionSelect = document.getElementById('sched-qa-region');
                const sourceSelect = document.getElementById('sched-qa-source');
                const scanRegion = regionSelect?.value || 'CURRENT';
                const scanSourceRaw = sourceSelect?.value || 'FIREBASE';
                const activeRegion = typeof currentRegion !== 'undefined' ? currentRegion : 'GP';
                const targetRegion = scanRegion === 'CURRENT' ? activeRegion : scanRegion;
                const scanSource = (scanSourceRaw === 'RAM' && targetRegion !== activeRegion) ? 'FIREBASE' : scanSourceRaw;

                resultsDiv.innerHTML = `<div class="text-xs text-gray-500 text-center py-4 flex flex-col items-center">${Admin.icon('hourglass', 'w-5 h-5 mb-2 animate-pulse')} Loading ${targetRegion} from ${scanSource}-</div>`;
                if (summaryDiv) summaryDiv.classList.add('hidden');

                try {
                    if (typeof runScheduleQaReport !== 'function') {
                        throw new Error('QA engine not loaded (runScheduleQaReport missing).');
                    }
                    const db = await fetchDbForQa(targetRegion, scanSource);
                    const report = runScheduleQaReport(db, targetRegion, typeof parseJSONSchedule === 'function' ? parseJSONSchedule : null);
                    report.meta = {
                        region: targetRegion,
                        source: scanSource,
                        generatedAt: new Date().toISOString(),
                        dataAge: db?.lastUpdated || null,
                    };
                    renderReport(report);
                    if (typeof showToast === 'function') {
                        showToast(`QA: ${report.summary.errors} errors, ${report.summary.warnings} warnings`, report.summary.errors ? 'error' : 'success', 2500);
                    }
                } catch (e) {
                    resultsDiv.innerHTML = `<div class="text-xs text-red-600 font-bold bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">QA failed: ${String(e.message || e)}</div>`;
                }
            };
        }

        if (exportBtn) {
            exportBtn.onclick = () => {
                if (!lastReport) {
                    if (typeof showToast === 'function') showToast('Run a QA report first', 'info', 1500);
                    return;
                }
                const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `schedule-qa-${lastReport.meta?.region || 'region'}-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
            };
        }
    },

// --- 7.9 HOLIDAY NOTICE APPROVALS (per-region; Pending / Approved tabs) ---
    setupHolidayApprovalsManager: () => {
        const exclusionPanel = document.getElementById('exclusion-panel');
        if (!exclusionPanel || !exclusionPanel.parentNode) return;

        let holidayPanel = document.getElementById('holiday-approvals-panel');
        if (!holidayPanel) {
            holidayPanel = document.createElement('div');
            holidayPanel.id = 'holiday-approvals-panel';
            exclusionPanel.parentNode.insertBefore(holidayPanel, exclusionPanel.nextSibling);
        }
        if (holidayPanel.dataset.adminLoaded === 'true') return;
        holidayPanel.dataset.adminLoaded = 'true';

        holidayPanel.className = 'bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300';
        holidayPanel.innerHTML = `
            <button id="holiday-approvals-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('calendar', 'text-amber-500 dark:text-amber-400')}
                    <span>Holiday Notices</span>
                </span>
                <span id="holiday-approvals-badge" class="admin-unread-badge hidden" aria-label="Regions awaiting approval"></span>
                <svg id="holiday-approvals-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            <div id="holiday-approvals-body" class="hidden mt-4 space-y-3">
                <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">Approve each region separately before commuters see the notice. Tick approves; cross defers that region until info is available.</p>
                <p id="holiday-approvals-enforce-note" class="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2.5 py-2 leading-snug"></p>
                <div class="flex gap-2 items-center">
                    <button type="button" id="holiday-tab-pending" class="holiday-tab-btn flex-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-wider">Pending</button>
                    <button type="button" id="holiday-tab-approved" class="holiday-tab-btn flex-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-wider">Approved</button>
                    <button type="button" id="holiday-approvals-refresh" class="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 border border-blue-200 dark:border-blue-800 rounded px-2 py-1.5 text-[10px] font-bold transition-colors shadow-sm focus:outline-none">Refresh</button>
                </div>
                <div id="holiday-approvals-list" class="space-y-3 max-h-[520px] overflow-y-auto custom-scrollbar"></div>
            </div>
        `;

        const header = document.getElementById('holiday-approvals-header-btn');
        const body = document.getElementById('holiday-approvals-body');
        const chevron = document.getElementById('holiday-approvals-chevron');
        const listDiv = document.getElementById('holiday-approvals-list');
        const refreshBtn = document.getElementById('holiday-approvals-refresh');
        const badge = document.getElementById('holiday-approvals-badge');
        const tabPending = document.getElementById('holiday-tab-pending');
        const tabApproved = document.getElementById('holiday-tab-approved');
        let holidayTab = 'pending';

        const HOLIDAY_DAY_TYPES = [
            { value: 'public_holiday', label: 'Public Holiday' },
            { value: 'saturday', label: 'Saturday' },
            { value: 'weekday', label: 'Weekday' },
            { value: 'sunday', label: 'Sunday (no service)' },
        ];

        const dayTypeOptions = (selected) => HOLIDAY_DAY_TYPES
            .map((t) => `<option value="${t.value}"${t.value === selected ? ' selected' : ''}>${t.label}</option>`)
            .join('');

        const pad2 = (n) => String(n).padStart(2, '0');
        const names = (typeof HOLIDAY_NAMES !== 'undefined' && HOLIDAY_NAMES) ? HOLIDAY_NAMES : {};
        const defaults = (typeof SPECIAL_DATES !== 'undefined' && SPECIAL_DATES) ? SPECIAL_DATES : {};
        const regions = ['GP', 'WC', 'KZN', 'EC'];

        const upcomingHolidayCandidates = (now = new Date()) => {
            const out = [];
            for (let offset = 0; offset < 21; offset++) {
                const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
                const key = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
                const name = names[key];
                if (!name) continue;
                const y = d.getFullYear();
                out.push({
                    key,
                    name,
                    year: y,
                    iso: `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
                    offset,
                    defaultDayType: defaults[key] || 'public_holiday',
                    whenLabel: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
                });
            }
            return out;
        };

        const readRegionRow = (entry, code, fallbackDayType) => {
            if (entry?.regions?.[code]) {
                const row = entry.regions[code];
                // Normalize legacy "rejected" ? deferred for UI grouping
                if (row?.status === 'rejected') return { ...row, status: 'deferred' };
                return row;
            }
            if (entry?.status === 'approved') {
                return {
                    status: 'approved',
                    dayType: entry.regionDayTypes?.[code] || entry.defaultDayType || fallbackDayType,
                    approvedAt: entry.approvedAt || null,
                };
            }
            return { status: 'pending', dayType: entry?.defaultDayType || fallbackDayType };
        };

        Admin.fetchHolidayApprovals = async () => {
            const secret = await Admin.getAuthKey();
            if (!secret || !listDiv) return;
            listDiv.innerHTML = '<div class="text-xs text-gray-500 italic text-center py-4">Loading holiday approvals...</div>';
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const res = await window.guardianFetch(`${dynamicEndpoint}holiday_approvals.json?auth=${secret}`, {}, 10000);
                const data = res.ok ? await res.json() : {};
                const approvals = (data && typeof data === 'object' && !data.error) ? data : {};
                const uid = Admin.currentUser?.uid || '';
                const today = new Date();
                const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                const enforced = todayIso >= '2026-08-11';
                const enforceNote = document.getElementById('holiday-approvals-enforce-note');
                if (enforceNote) {
                    enforceNote.textContent = enforced
                        ? 'Enforcement is live: commuters only see notices after their region is approved.'
                        : 'Commuter enforcement starts 11 Aug 2026. You can approve regions early for later holidays.';
                }

                const candidates = upcomingHolidayCandidates();
                let pendingCount = 0;
                const pendingBlocks = [];
                const approvedRows = [];

                candidates.forEach((h) => {
                    const entry = approvals[h.iso] || {};
                    const regionRows = regions.map((code) => {
                        const row = readRegionRow(entry, code, h.defaultDayType);
                        return { code, row, holiday: h };
                    });

                    regionRows.forEach(({ code, row, holiday }) => {
                        if (row.status === 'approved') {
                            approvedRows.push({ code, row, holiday });
                        } else {
                            pendingCount += 1;
                        }
                    });

                    const pendingRegions = regionRows.filter(({ row }) => row.status !== 'approved');
                    if (pendingRegions.length === 0) return;

                    pendingBlocks.push(`
                        <div class="holiday-approval-card bg-amber-50/60 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3" data-iso="${h.iso}" data-key="${h.key}" data-name="${escapeHTML(h.name)}" data-default="${h.defaultDayType}">
                            <div class="mb-2">
                                <p class="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">${escapeHTML(h.whenLabel)}</p>
                                <p class="text-sm font-black text-gray-900 dark:text-white leading-snug">${escapeHTML(h.name)}</p>
                                <p class="text-[10px] text-gray-500 font-mono mt-0.5">${escapeHTML(h.iso)}</p>
                            </div>
                            <div class="space-y-1.5">
                                ${pendingRegions.map(({ code, row }) => `
                                    <div class="holiday-region-row flex items-center gap-2" data-region="${code}">
                                        <span class="text-[10px] font-black text-gray-600 dark:text-gray-300 uppercase w-9 shrink-0">${code}</span>
                                        <select class="holiday-region-day flex-1 min-w-0 h-8 px-2 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-[10px] text-gray-900 dark:text-white outline-none" data-region="${code}">
                                            ${dayTypeOptions(row.dayType || h.defaultDayType)}
                                        </select>
                                        <button type="button" class="holiday-region-approve shrink-0 w-8 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center focus:outline-none" data-region="${code}" title="Approve ${code}" aria-label="Approve ${code}">${Admin.icon('check', 'w-4 h-4')}</button>
                                        <button type="button" class="holiday-region-reject shrink-0 w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-red-100 dark:hover:bg-red-900/40 text-gray-700 dark:text-gray-200 flex items-center justify-center focus:outline-none" data-region="${code}" title="Defer ${code}" aria-label="Defer ${code}">${Admin.icon('x', 'w-4 h-4')}</button>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `);
                });

                const approvedHtml = approvedRows.length
                    ? approvedRows.map(({ code, row, holiday }) => `
                        <div class="bg-emerald-50/70 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/50 rounded-xl p-3 flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <p class="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">${escapeHTML(holiday.whenLabel)} - ${escapeHTML(code)}</p>
                                <p class="text-sm font-black text-gray-900 dark:text-white leading-snug">${escapeHTML(holiday.name)}</p>
                                <p class="text-[10px] text-gray-500 mt-0.5">${escapeHTML(HOLIDAY_DAY_TYPES.find((t) => t.value === row.dayType)?.label || row.dayType || '-')}</p>
                            </div>
                            <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 shrink-0">Approved</span>
                        </div>
                    `).join('')
                    : '<div class="text-xs text-gray-500 italic text-center py-4">No approved regions yet.</div>';

                listDiv.innerHTML = holidayTab === 'approved'
                    ? approvedHtml
                    : (pendingBlocks.join('') || '<div class="text-xs text-gray-500 italic text-center py-4">No pending regions in the next 3 weeks.</div>');

                if (badge) {
                    if (pendingCount > 0) {
                        badge.textContent = String(pendingCount);
                        badge.classList.remove('hidden');
                    } else {
                        badge.classList.add('hidden');
                    }
                }

                const saveRegion = async (card, code, status, dayType) => {
                    const iso = card?.dataset?.iso;
                    if (!iso || !code) return;
                    const secret2 = await Admin.getAuthKey();
                    if (!secret2) return;
                    // Atomic per-region write - avoids full-document PUT races wiping sibling regions.
                    const regionPayload = status === 'approved'
                        ? {
                            status: 'approved',
                            dayType,
                            approvedBy: uid,
                            approvedAt: Date.now(),
                        }
                        : {
                            status: 'deferred',
                            dayType,
                            deferredBy: uid,
                            deferredAt: Date.now(),
                        };
                    const regionRes = await window.guardianFetch(
                        `${dynamicEndpoint}holiday_approvals/${iso}/regions/${code}.json?auth=${secret2}`,
                        { method: 'PUT', body: JSON.stringify(regionPayload) },
                        10000
                    );
                    if (!regionRes.ok) throw new Error(`HTTP ${regionRes.status}`);
                    // Best-effort holiday metadata (merge - does not replace sibling regions).
                    await window.guardianFetch(
                        `${dynamicEndpoint}holiday_approvals/${iso}.json?auth=${secret2}`,
                        {
                            method: 'PATCH',
                            body: JSON.stringify({
                                dateKey: card.dataset.key || null,
                                name: card.dataset.name || null,
                                defaultDayType: card.dataset.default || dayType || 'public_holiday',
                            }),
                        },
                        10000
                    ).catch(() => {});
                };

                listDiv.querySelectorAll('.holiday-region-approve').forEach((btn) => {
                    btn.onclick = async () => {
                        const card = btn.closest('.holiday-approval-card');
                        const code = btn.dataset.region;
                        const sel = card?.querySelector(`.holiday-region-day[data-region="${code}"]`);
                        const dayType = sel?.value || 'public_holiday';
                        btn.disabled = true;
                        try {
                            await saveRegion(card, code, 'approved', dayType);
                            if (typeof showToast === 'function') showToast(`${code} approved`, 'success');
                            Admin.fetchHolidayApprovals();
                        } catch (e) {
                            if (typeof showToast === 'function') showToast('Approve failed', 'error');
                            btn.disabled = false;
                        }
                    };
                });

                listDiv.querySelectorAll('.holiday-region-reject').forEach((btn) => {
                    btn.onclick = async () => {
                        const card = btn.closest('.holiday-approval-card');
                        const code = btn.dataset.region;
                        const sel = card?.querySelector(`.holiday-region-day[data-region="${code}"]`);
                        const dayType = sel?.value || 'public_holiday';
                        btn.disabled = true;
                        try {
                            await saveRegion(card, code, 'rejected', dayType);
                            if (typeof showToast === 'function') showToast(`${code} deferred`, 'info');
                            Admin.fetchHolidayApprovals();
                        } catch (e) {
                            if (typeof showToast === 'function') showToast('Update failed', 'error');
                            btn.disabled = false;
                        }
                    };
                });
            } catch (e) {
                listDiv.innerHTML = `<div class="text-xs text-red-500 text-center py-4">Failed to load holiday approvals.<br><span class="text-[9px] text-gray-500">${escapeHTML(String(e.message || e))}</span></div>`;
            }
        };

        if (header) {
            header.onclick = () => {
                if (Admin.isGridMode) return;
                body.classList.toggle('hidden');
                if (body.classList.contains('hidden')) chevron?.classList.add('-rotate-90');
                else {
                    chevron?.classList.remove('-rotate-90');
                    Admin.fetchHolidayApprovals();
                }
            };
        }
        if (refreshBtn) refreshBtn.onclick = () => Admin.fetchHolidayApprovals();

        // Wire tabs AFTER fetchHolidayApprovals exists (calling setHolidayTab earlier threw on iOS)
        const setHolidayTab = (tab) => {
            holidayTab = tab;
            tabPending?.classList.toggle('ring-2', tab === 'pending');
            tabPending?.classList.toggle('ring-amber-400', tab === 'pending');
            tabApproved?.classList.toggle('ring-2', tab === 'approved');
            tabApproved?.classList.toggle('ring-emerald-400', tab === 'approved');
            if (typeof Admin.fetchHolidayApprovals === 'function') Admin.fetchHolidayApprovals();
        };
        tabPending?.addEventListener('click', () => setHolidayTab('pending'));
        tabApproved?.addEventListener('click', () => setHolidayTab('approved'));
        setHolidayTab('pending');
    },

// --- 8. MAINTENANCE MODE MANAGER ---
    setupMaintenanceManager: () => {
        const exclusionPanel = document.getElementById('exclusion-panel');
        const adminContainer = document.getElementById('admin-modules-container');
        const host = (exclusionPanel && exclusionPanel.parentNode) || adminContainer;
        if (!host) return;

        let maintPanel = document.getElementById('maint-panel');
        if (!maintPanel) {
            maintPanel = document.createElement('div');
            maintPanel.id = 'maint-panel';
            host.appendChild(maintPanel);
        }

        // Re-init if an older admin session left a panel without newer controls
        if (
            maintPanel.dataset.loaded === "true"
            && (!document.getElementById('maint-mode-header') || !document.getElementById('cf-purge-everything-btn'))
        ) {
            delete maintPanel.dataset.loaded;
            maintPanel.innerHTML = '';
        }
        if (maintPanel.dataset.loaded === "true") return;
        maintPanel.dataset.loaded = "true";

        maintPanel.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300";

        maintPanel.innerHTML = `
            <button id="maint-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('wrench', 'text-slate-500 dark:text-slate-300')}
                    <span>System Controls</span>
                </span>
                <svg id="maint-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            
            <div id="maint-body" class="hidden mt-4 space-y-4">
                <!-- Maintenance Mode (accordion) -->
                <div class="bg-orange-50 dark:bg-orange-900/20 rounded-xl border border-orange-200 dark:border-orange-800 overflow-hidden shadow-sm transition-all">
                    <button type="button" id="maint-mode-header" class="w-full px-3 py-3 bg-orange-100/50 dark:bg-orange-900/40 text-left text-[10px] font-black text-orange-800 dark:text-orange-300 uppercase tracking-widest flex items-center justify-between focus:outline-none transition-colors hover:bg-orange-200/50 dark:hover:bg-orange-900/60">
                        <span class="flex items-center gap-2">
                            <span class="text-orange-600 dark:text-orange-300">${Admin.icon('wrench', 'w-4 h-4')}</span> Maintenance Mode
                            <span id="maint-active-count" class="hidden ml-1 px-1.5 py-0.5 rounded bg-orange-600 text-white text-[9px] font-black normal-case tracking-normal">0</span>
                        </span>
                        <svg id="maint-mode-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="maint-mode-body" class="hidden p-4 space-y-3">
                        <div class="flex items-center justify-between gap-3">
                            <div>
                                <span class="font-bold text-orange-800 dark:text-orange-200 text-sm">Publish banners</span>
                                <p class="text-[10px] text-orange-600 dark:text-orange-400 mt-0.5">Add multiple scoped banners. Pause all = master off. Empty scope = everyone.</p>
                            </div>
                            <div class="relative inline-block w-10 mr-1 align-middle select-none transition duration-200 ease-in shrink-0" title="Master pause — off hides all banners">
                                <input type="checkbox" name="toggle" id="maint-toggle" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer outline-none"/>
                                <label for="maint-toggle" class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
                            </div>
                        </div>
                        <input type="text" id="maint-message" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-700/50 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-orange-500 outline-none shadow-sm" placeholder="Banner text (e.g. Cape Town Northern Line update...)">
                        <div>
                            <p class="text-[9px] font-black uppercase tracking-widest text-orange-700 dark:text-orange-300 mb-1.5">Regions (optional)</p>
                            <div id="maint-region-checks" class="flex flex-wrap gap-2">
                                ${['GP', 'WC', 'KZN', 'EC'].map((code) => `
                                    <label class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/80 dark:bg-gray-900/40 border border-orange-200 dark:border-orange-800/60 text-[10px] font-bold text-orange-900 dark:text-orange-200 cursor-pointer">
                                        <input type="checkbox" class="maint-region-cb rounded border-orange-300 text-orange-600 focus:ring-orange-500" value="${code}">
                                        ${code}
                                    </label>`).join('')}
                            </div>
                        </div>
                        <div>
                            <div class="flex items-center justify-between mb-1.5">
                                <p class="text-[9px] font-black uppercase tracking-widest text-orange-700 dark:text-orange-300">Routes (optional)</p>
                                <button type="button" id="maint-routes-clear" class="text-[9px] font-bold text-orange-600 dark:text-orange-400 hover:underline focus:outline-none">Clear</button>
                            </div>
                            <div id="maint-route-checks" class="max-h-36 overflow-y-auto custom-scrollbar space-y-1 rounded-lg border border-orange-200 dark:border-orange-800/60 bg-white/60 dark:bg-gray-900/30 p-2">
                                <p class="text-[10px] text-orange-500 italic">Select a region to list its routes.</p>
                            </div>
                        </div>
                        <div>
                            <p class="text-[9px] font-black uppercase tracking-widest text-orange-700 dark:text-orange-300 mb-1.5">Expires</p>
                            <input type="datetime-local" id="maint-expires" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-700/50 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-orange-500 outline-none shadow-sm">
                            <p class="text-[9px] text-orange-500 dark:text-orange-400 mt-1">Clear the field for no auto-expiry (until you deactivate).</p>
                        </div>
                        <input type="hidden" id="maint-edit-id" value="">
                        <div class="flex gap-2">
                            <button type="button" id="maint-add-btn" class="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-2.5 rounded-lg text-xs uppercase tracking-wide focus:outline-none">Add banner</button>
                            <button type="button" id="maint-cancel-edit" class="hidden px-3 bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-700 text-orange-700 dark:text-orange-300 font-bold py-2.5 rounded-lg text-xs uppercase tracking-wide focus:outline-none">Cancel</button>
                        </div>
                        <div class="pt-2 border-t border-orange-200 dark:border-orange-800/60">
                            <p class="text-[9px] font-black uppercase tracking-widest text-orange-700 dark:text-orange-300 mb-2">Active maintenance</p>
                            <div id="maint-active-list" class="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                                <p class="text-[10px] text-orange-500 italic text-center py-3">No active banners.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Force schedule type (accordion, collapsed by default) -->
                <div class="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 overflow-hidden shadow-sm transition-all">
                    <button type="button" id="sched-override-header" class="w-full px-3 py-3 bg-blue-100/50 dark:bg-blue-900/40 text-left text-[10px] font-black text-blue-800 dark:text-blue-300 uppercase tracking-widest flex items-center justify-between focus:outline-none transition-colors hover:bg-blue-200/50 dark:hover:bg-blue-900/60">
                        <span class="flex items-center gap-2">
                            <span class="text-blue-600 dark:text-blue-300">${Admin.icon('calendar', 'w-4 h-4')}</span> Force schedule type
                        </span>
                        <svg id="sched-override-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="sched-override-body" class="hidden p-4 space-y-3">
                        <p class="text-[10px] text-blue-600 dark:text-blue-400 leading-snug">Override the live timetable per region. Commuters boot normally, then see your message and switch.</p>
                        <div id="sched-override-regions" class="space-y-3"></div>
                        <button type="button" id="sched-override-save" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg text-xs uppercase tracking-wide focus:outline-none">Save schedule overrides</button>
                    </div>
                </div>

                <!-- Shadow-ban default experience (accordion, collapsed by default) -->
                <div class="bg-violet-50 dark:bg-violet-900/20 rounded-xl border border-violet-200 dark:border-violet-800 overflow-hidden shadow-sm transition-all">
                    <button type="button" id="shadow-ban-default-header" class="w-full px-3 py-3 bg-violet-100/50 dark:bg-violet-900/40 text-left text-[10px] font-black text-violet-800 dark:text-violet-300 uppercase tracking-widest flex items-center justify-between focus:outline-none transition-colors hover:bg-violet-200/50 dark:hover:bg-violet-900/60">
                        <span class="flex items-center gap-2">
                            <span class="text-violet-600 dark:text-violet-300">${Admin.icon('ban', 'w-4 h-4')}</span> Shadow-ban default mode
                        </span>
                        <svg id="shadow-ban-default-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="shadow-ban-default-body" class="hidden p-4">
                        <p class="text-[10px] text-violet-600 dark:text-violet-400 mb-3 leading-snug">Prefills the Shadow ban dialog. Per-ban mode is stored on the user/device (clients no longer read this global config publicly).</p>
                        <select id="shadow-ban-default-mode" class="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-800 border border-violet-200 dark:border-violet-700/50 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-violet-500 outline-none shadow-sm mb-2">
                            <option value="offline">Fake offline / lie-fi</option>
                            <option value="freeze">Freeze / unresponsive</option>
                            <option value="fouc">True FOUC (unstyled)</option>
                            <option value="lost">404 / End of the Line</option>
                        </select>
                        <button type="button" id="shadow-ban-default-save" class="w-full bg-violet-600 hover:bg-violet-700 text-white font-bold py-2.5 rounded-lg text-xs uppercase tracking-wide focus:outline-none">Save default mode</button>
                    </div>
                </div>

                <!-- Transplanted Growth & Promo -->
                <div class="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-200 dark:border-indigo-800 overflow-hidden shadow-sm transition-all">
                    <button id="promo-header-btn" class="w-full px-3 py-3 bg-blue-100/50 dark:bg-indigo-900/40 text-left text-[10px] font-black text-indigo-800 dark:text-indigo-300 uppercase tracking-widest flex items-center justify-between focus:outline-none transition-colors hover:bg-blue-200/50 dark:hover:bg-indigo-900/60">
                        <span class="flex items-center gap-2">
                            <span class="text-indigo-600 dark:text-indigo-300">${Admin.icon('rocket', 'w-4 h-4')}</span> Growth & Promo
                        </span>
                        <svg id="promo-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="promo-body" class="hidden p-4">
                        <p class="text-[10px] text-indigo-800 dark:text-indigo-300 font-medium leading-snug mb-4 text-center px-2">Let commuters scan this to instantly open and install the app without typing the URL.</p>
                        <div class="flex flex-col items-center justify-center bg-white p-3 rounded-2xl shadow-sm border border-indigo-100 dark:border-gray-800 w-max mx-auto">
                            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=https://nexttrain.co.za&color=1e3a8a&bgcolor=ffffff" alt="Next Train QR Code" class="w-40 h-40 object-contain rounded-lg">
                        </div>
                        <div class="text-center mt-4 mb-1">
                            <span class="text-xs font-bold text-indigo-900 dark:text-indigo-100 bg-white/60 dark:bg-black/20 px-4 py-1.5 rounded-full border border-indigo-200 dark:border-indigo-800 shadow-sm">nexttrain.co.za</span>
                        </div>
                    </div>
                </div>

                <!-- Transplanted Nuclear Cache Wipe -->
                <div class="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 overflow-hidden shadow-sm transition-all">
                    <button id="nuke-header-btn" class="w-full px-3 py-3 bg-red-100/50 dark:bg-red-900/40 text-left text-[10px] font-black text-red-600 dark:text-red-400 uppercase tracking-widest flex items-center justify-between focus:outline-none transition-colors hover:bg-red-200/50 dark:hover:bg-red-900/60">
                        <span class="flex items-center">
                            <span class="text-red-500 dark:text-red-400 mr-2 inline-flex">${Admin.icon('siren', 'w-4 h-4')}</span> Nuclear Cache Wipe
                        </span>
                        <svg id="nuke-chevron" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    
                    <div id="nuke-body" class="p-3 hidden space-y-3">
                        <p class="text-[11px] text-red-600 dark:text-red-300 font-bold leading-snug">WARNING: This will instantly force ALL users globally to wipe their caches and hard-reload the app on their next boot.</p>
                        <p class="text-[10px] text-red-500 dark:text-red-400 mb-2">Use only for catastrophic data corruption to force an update immediately without waiting for Service Worker lifecycles.</p>
                        <button id="nuke-fire-btn" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-lg shadow-md transition-colors text-xs uppercase tracking-wide focus:outline-none">
                            Fire Killswitch
                        </button>

                        <div class="border-t border-red-200 dark:border-red-800 pt-3 space-y-2">
                            <p class="text-[11px] text-orange-700 dark:text-orange-300 font-bold leading-snug">Cloudflare edge cache</p>
                            <p class="text-[10px] text-orange-600/90 dark:text-orange-400/90 leading-snug">Same as Dashboard → Caching → Configuration → <span class="font-bold">Purge Everything</span>. Clears CDN-cached HTML / SW / assets for nexttrain.co.za (does not wipe user devices or fire the killswitch).</p>
                            <button id="cf-purge-everything-btn" class="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded-lg shadow-md transition-colors text-xs uppercase tracking-wide focus:outline-none">
                                Purge Cloudflare Cache
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const header = document.getElementById('maint-header-btn');
        const body = document.getElementById('maint-body');
        const chevron = document.getElementById('maint-chevron');
        const toggle = document.getElementById('maint-toggle');
        const maintMsg = document.getElementById('maint-message');
        const maintExpires = document.getElementById('maint-expires');
        const maintEditId = document.getElementById('maint-edit-id');
        const maintRegionBox = document.getElementById('maint-region-checks');
        const maintRouteBox = document.getElementById('maint-route-checks');
        const maintRoutesClear = document.getElementById('maint-routes-clear');
        const maintAddBtn = document.getElementById('maint-add-btn');
        const maintCancelEdit = document.getElementById('maint-cancel-edit');
        const maintActiveList = document.getElementById('maint-active-list');
        const maintActiveCount = document.getElementById('maint-active-count');
        const maintModeHeader = document.getElementById('maint-mode-header');
        const maintModeBody = document.getElementById('maint-mode-body');
        const maintModeChevron = document.getElementById('maint-mode-chevron');
        let _maintSelectedRoutes = new Set();
        let _maintItems = {}; // id → item
        let _maintRootActive = true;

        const getMaintSelectedRegions = () =>
            Array.from(maintRegionBox?.querySelectorAll('.maint-region-cb:checked') || []).map((el) => el.value);

        const toLocalDatetimeValue = (ms) => {
            if (!ms) return '';
            const d = new Date(ms);
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            return d.toISOString().slice(0, 16);
        };

        const defaultMaintExpiryValue = () => {
            const now = new Date();
            now.setHours(23, 59, 0, 0);
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            return now.toISOString().slice(0, 16);
        };

        const resetMaintComposer = () => {
            if (maintMsg) maintMsg.value = '';
            if (maintEditId) maintEditId.value = '';
            if (maintExpires) maintExpires.value = defaultMaintExpiryValue();
            _maintSelectedRoutes = new Set();
            maintRegionBox?.querySelectorAll('.maint-region-cb').forEach((cb) => { cb.checked = false; });
            renderMaintRouteChecks();
            if (maintAddBtn) maintAddBtn.textContent = 'Add banner';
            maintCancelEdit?.classList.add('hidden');
        };

        const listMaintItemsLocal = () => {
            if (typeof window.listMaintenanceItems === 'function') {
                return window.listMaintenanceItems({ active: true, items: _maintItems });
            }
            return Object.keys(_maintItems).map((k) => ({ id: k, ..._maintItems[k] }));
        };

        const countLiveMaint = () => {
            const now = Date.now();
            return listMaintItemsLocal().filter((it) => {
                if (it.active === false) return false;
                if (it.expiresAt && Number(it.expiresAt) <= now) return false;
                return true;
            }).length;
        };

        const buildMaintFirebasePayload = (rootActiveOverride) => {
            const rootActive = typeof rootActiveOverride === 'boolean' ? rootActiveOverride : _maintRootActive;
            const now = Date.now();
            const items = {};
            Object.keys(_maintItems).forEach((id) => {
                const it = _maintItems[id];
                if (!it) return;
                const entry = {
                    id,
                    active: it.active !== false,
                    message: String(it.message || '').trim(),
                    updatedAt: it.updatedAt || now,
                    updatedBy: it.updatedBy || (Admin.currentUser?.email || 'Admin'),
                };
                if (it.createdAt) entry.createdAt = it.createdAt;
                if (Array.isArray(it.regions) && it.regions.length) entry.regions = it.regions;
                if (Array.isArray(it.routes) && it.routes.length) entry.routes = it.routes;
                if (it.expiresAt) entry.expiresAt = Number(it.expiresAt);
                items[id] = entry;
            });

            // Root shim for older clients: primary live item (most specific), with its scope
            const live = Object.values(items).filter((it) => {
                if (it.active === false) return false;
                if (it.expiresAt && Number(it.expiresAt) <= now) return false;
                return true;
            });
            live.sort((a, b) => {
                const sa = (a.routes?.length ? 2 : a.regions?.length ? 1 : 0);
                const sb = (b.routes?.length ? 2 : b.regions?.length ? 1 : 0);
                return sb - sa;
            });
            const primary = live[0];
            const payload = {
                active: !!(rootActive && primary),
                items,
                updatedAt: now,
                updatedBy: Admin.currentUser?.email || 'Admin',
            };
            if (primary) {
                payload.message = primary.message || 'MAINTENANCE IN PROGRESS';
                if (primary.regions?.length) payload.regions = primary.regions;
                if (primary.routes?.length) payload.routes = primary.routes;
                if (primary.expiresAt) payload.expiresAt = primary.expiresAt;
            } else {
                payload.message = '';
            }
            // Explicit root pause even when items exist
            if (!rootActive) payload.active = false;
            return payload;
        };

        const renderMaintActiveList = () => {
            const now = Date.now();
            const items = listMaintItemsLocal().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            const liveCount = countLiveMaint();
            if (maintActiveCount) {
                if (liveCount > 0 && _maintRootActive) {
                    maintActiveCount.textContent = String(liveCount);
                    maintActiveCount.classList.remove('hidden');
                } else {
                    maintActiveCount.classList.add('hidden');
                }
            }
            if (!maintActiveList) return;
            if (!items.length) {
                maintActiveList.innerHTML = `<p class="text-[10px] text-orange-500 italic text-center py-3">No maintenance banners yet.</p>`;
                return;
            }
            const esc = (typeof escapeHTML === 'function')
                ? escapeHTML
                : (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
            const routesObj = (typeof ROUTES !== 'undefined' && ROUTES) || window.ROUTES || {};
            maintActiveList.innerHTML = items.map((it) => {
                const expired = it.expiresAt && Number(it.expiresAt) <= now;
                const inactive = it.active === false || expired || !_maintRootActive;
                const scopeBits = [];
                if (it.regions?.length) scopeBits.push(it.regions.join('+'));
                else scopeBits.push('All regions');
                if (it.routes?.length) {
                    const names = it.routes.slice(0, 2).map((rid) => {
                        const r = routesObj[rid];
                        return r ? (Admin.formatRouteLabelPlain ? Admin.formatRouteLabelPlain(r.name) : r.name) : rid;
                    });
                    scopeBits.push(it.routes.length > 2 ? `${names.join(', ')} +${it.routes.length - 2}` : names.join(', '));
                } else {
                    scopeBits.push('All routes');
                }
                const expStr = it.expiresAt
                    ? (expired ? 'Expired' : `Expires ${Admin.formatDate ? Admin.formatDate(it.expiresAt) : new Date(it.expiresAt).toLocaleString()}`)
                    : 'No expiry';
                const msg = esc(String(it.message || 'MAINTENANCE IN PROGRESS'));
                const idSafe = esc(String(it.id));
                return `<div class="flex flex-col gap-1.5 p-2.5 rounded-lg border ${inactive ? 'border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40 opacity-70' : 'border-orange-200 dark:border-orange-800/60 bg-white/80 dark:bg-gray-900/40'}">
                    <div class="flex items-start justify-between gap-2">
                        <p class="text-[11px] font-bold text-orange-950 dark:text-orange-100 leading-snug break-words">${msg}</p>
                        <span class="text-[8px] font-black uppercase tracking-wider shrink-0 ${inactive ? 'text-gray-400' : 'text-orange-600 dark:text-orange-400'}">${inactive ? (expired ? 'Expired' : (!_maintRootActive ? 'Paused' : 'Off')) : 'Live'}</span>
                    </div>
                    <p class="text-[9px] text-orange-700/80 dark:text-orange-300/80">${escapeHTML(scopeBits.join(' · '))} · ${escapeHTML(expStr)}</p>
                    <div class="flex gap-1.5 pt-1">
                        <button type="button" data-maint-edit="${idSafe}" class="flex-1 text-[9px] font-bold py-1.5 rounded-md bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-700 text-orange-800 dark:text-orange-200 focus:outline-none">Edit</button>
                        <button type="button" data-maint-extend="${idSafe}" class="flex-1 text-[9px] font-bold py-1.5 rounded-md bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-700 text-orange-800 dark:text-orange-200 focus:outline-none ${it.expiresAt ? '' : 'opacity-40 cursor-not-allowed'}" ${it.expiresAt ? '' : 'disabled'}>+24h</button>
                        <button type="button" data-maint-toggle="${idSafe}" class="flex-1 text-[9px] font-bold py-1.5 rounded-md bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-700 text-orange-800 dark:text-orange-200 focus:outline-none">${it.active === false ? 'Enable' : 'Disable'}</button>
                        <button type="button" data-maint-del="${idSafe}" class="flex-1 text-[9px] font-bold py-1.5 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 focus:outline-none">Delete</button>
                    </div>
                </div>`;
            }).join('');

            maintActiveList.querySelectorAll('[data-maint-edit]').forEach((btn) => {
                btn.onclick = () => loadMaintItemIntoComposer(btn.getAttribute('data-maint-edit'));
            });
            maintActiveList.querySelectorAll('[data-maint-extend]').forEach((btn) => {
                btn.onclick = () => extendMaintItem(btn.getAttribute('data-maint-extend'));
            });
            maintActiveList.querySelectorAll('[data-maint-toggle]').forEach((btn) => {
                btn.onclick = () => toggleMaintItemActive(btn.getAttribute('data-maint-toggle'));
            });
            maintActiveList.querySelectorAll('[data-maint-del]').forEach((btn) => {
                btn.onclick = () => deleteMaintItem(btn.getAttribute('data-maint-del'));
            });
        };

        const loadMaintItemIntoComposer = (id) => {
            const it = _maintItems[id];
            if (!it) return;
            if (maintEditId) maintEditId.value = id;
            if (maintMsg) maintMsg.value = it.message || '';
            if (maintExpires) maintExpires.value = it.expiresAt ? toLocalDatetimeValue(it.expiresAt) : '';
            const regions = Array.isArray(it.regions) ? it.regions : [];
            maintRegionBox?.querySelectorAll('.maint-region-cb').forEach((cb) => {
                cb.checked = regions.includes(cb.value);
            });
            _maintSelectedRoutes = new Set((it.routes || []).map(String));
            renderMaintRouteChecks();
            if (maintAddBtn) maintAddBtn.textContent = 'Update banner';
            maintCancelEdit?.classList.remove('hidden');
            maintModeBody?.classList.remove('hidden');
            maintModeChevron?.classList.remove('-rotate-90');
        };

        const renderMaintRouteChecks = () => {
            if (!maintRouteBox) return;
            const regions = getMaintSelectedRegions();
            const routesObj = (typeof ROUTES !== 'undefined' && ROUTES) || window.ROUTES || {};
            const list = Object.values(routesObj).filter((r) =>
                r && r.isActive !== false && r.id && (!regions.length || regions.includes(r.region))
            );
            if (!list.length) {
                maintRouteBox.innerHTML = `<p class="text-[10px] text-orange-500 italic">${regions.length ? 'No routes for selected regions.' : 'Select a region to list its routes — or leave empty for all users.'}</p>`;
                return;
            }
            list.sort((a, b) => String(a.region).localeCompare(b.region) || String(a.name || a.id).localeCompare(b.name || b.id));
            maintRouteBox.innerHTML = list.map((r) => {
                const label = Admin.formatRouteLabelPlain
                    ? Admin.formatRouteLabelPlain(r.name || r.id)
                    : (r.name || r.id);
                const checked = _maintSelectedRoutes.has(r.id) ? 'checked' : '';
                return `<label class="flex items-start gap-2 text-[10px] text-orange-900 dark:text-orange-100 cursor-pointer py-0.5">
                    <input type="checkbox" class="maint-route-cb mt-0.5 rounded border-orange-300 text-orange-600 focus:ring-orange-500" value="${r.id}" ${checked}>
                    <span><span class="font-black text-orange-600 dark:text-orange-300">${r.region}</span> · ${label}</span>
                </label>`;
            }).join('');
            maintRouteBox.querySelectorAll('.maint-route-cb').forEach((cb) => {
                cb.onchange = () => {
                    if (cb.checked) _maintSelectedRoutes.add(cb.value);
                    else _maintSelectedRoutes.delete(cb.value);
                };
            });
        };

        maintRegionBox?.querySelectorAll('.maint-region-cb').forEach((cb) => {
            cb.onchange = () => {
                const regions = getMaintSelectedRegions();
                if (regions.length) {
                    const routesObj = (typeof ROUTES !== 'undefined' && ROUTES) || window.ROUTES || {};
                    _maintSelectedRoutes = new Set(
                        Array.from(_maintSelectedRoutes).filter((id) => regions.includes(routesObj[id]?.region))
                    );
                }
                renderMaintRouteChecks();
            };
        });
        if (maintRoutesClear) {
            maintRoutesClear.onclick = () => {
                _maintSelectedRoutes = new Set();
                renderMaintRouteChecks();
            };
        }
        if (maintExpires && !maintExpires.value) maintExpires.value = defaultMaintExpiryValue();
        renderMaintRouteChecks();

        if (maintModeHeader && maintModeBody) {
            maintModeHeader.onclick = () => {
                maintModeBody.classList.toggle('hidden');
                if (maintModeBody.classList.contains('hidden')) maintModeChevron?.classList.add('-rotate-90');
                else maintModeChevron?.classList.remove('-rotate-90');
            };
        }
        if (maintCancelEdit) {
            maintCancelEdit.onclick = () => resetMaintComposer();
        }

        const nukeHeader = document.getElementById('nuke-header-btn');
        const nukeBody = document.getElementById('nuke-body');
        const nukeChevron = document.getElementById('nuke-chevron');
        const nukeFireBtn = document.getElementById('nuke-fire-btn');
        const cfPurgeBtn = document.getElementById('cf-purge-everything-btn');

        const promoHeader = document.getElementById('promo-header-btn');
        const promoBody = document.getElementById('promo-body');
        const promoChevron = document.getElementById('promo-chevron');
        const banModeSelect = document.getElementById('shadow-ban-default-mode');
        const banModeSave = document.getElementById('shadow-ban-default-save');
        const banDefaultHeader = document.getElementById('shadow-ban-default-header');
        const banDefaultBody = document.getElementById('shadow-ban-default-body');
        const banDefaultChevron = document.getElementById('shadow-ban-default-chevron');
        const schedOverrideHeader = document.getElementById('sched-override-header');
        const schedOverrideBody = document.getElementById('sched-override-body');
        const schedOverrideChevron = document.getElementById('sched-override-chevron');
        const schedOverrideRegions = document.getElementById('sched-override-regions');
        const schedOverrideSave = document.getElementById('sched-override-save');
        const SCHED_OVERRIDE_REGIONS = ['GP', 'WC', 'KZN', 'EC'];
        const SCHED_DAY_TYPES = [
            { value: 'public_holiday', label: 'Public Holiday' },
            { value: 'saturday', label: 'Saturday' },
            { value: 'weekday', label: 'Weekday' },
            { value: 'sunday', label: 'Sunday (no service)' },
        ];

        if (schedOverrideRegions) {
            schedOverrideRegions.innerHTML = SCHED_OVERRIDE_REGIONS.map((code) => `
                <div class="sched-override-region bg-white/80 dark:bg-gray-900/50 rounded-lg border border-blue-100 dark:border-blue-900/40 p-3 space-y-2" data-region="${code}">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-[10px] font-black uppercase tracking-widest text-blue-800 dark:text-blue-200">${code}</span>
                        <label class="flex items-center gap-1.5 text-[10px] font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
                            <input type="checkbox" class="sched-override-active rounded border-gray-300 text-blue-600 focus:ring-blue-500" data-region="${code}">
                            Active
                        </label>
                    </div>
                    <select class="sched-override-day w-full h-9 px-2 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[10px] text-gray-900 dark:text-white outline-none" data-region="${code}">
                        ${SCHED_DAY_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
                    </select>
                    <input type="text" class="sched-override-title w-full h-9 px-2 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[10px] text-gray-900 dark:text-white outline-none" data-region="${code}" placeholder="Popup title (e.g. Public holiday today)" maxlength="120">
                    <textarea class="sched-override-body w-full min-h-[56px] px-2 py-1.5 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[10px] text-gray-900 dark:text-white outline-none resize-y" data-region="${code}" placeholder="Popup message explaining the situation" maxlength="500"></textarea>
                </div>
            `).join('');
        }

        if (nukeHeader) {
            nukeHeader.onclick = () => {
                nukeBody.classList.toggle('hidden');
                if (nukeBody.classList.contains('hidden')) nukeChevron.classList.add('-rotate-90');
                else nukeChevron.classList.remove('-rotate-90');
            };
        }

        if (promoHeader) {
            promoHeader.onclick = () => {
                promoBody.classList.toggle('hidden');
                if (promoBody.classList.contains('hidden')) promoChevron.classList.add('-rotate-90');
                else promoChevron.classList.remove('-rotate-90');
            };
        }

        if (banDefaultHeader && banDefaultBody) {
            banDefaultHeader.onclick = () => {
                banDefaultBody.classList.toggle('hidden');
                if (banDefaultBody.classList.contains('hidden')) banDefaultChevron?.classList.add('-rotate-90');
                else banDefaultChevron?.classList.remove('-rotate-90');
            };
        }

        if (schedOverrideHeader && schedOverrideBody) {
            schedOverrideHeader.onclick = () => {
                schedOverrideBody.classList.toggle('hidden');
                if (schedOverrideBody.classList.contains('hidden')) schedOverrideChevron?.classList.add('-rotate-90');
                else schedOverrideChevron?.classList.remove('-rotate-90');
            };
        }

        if (header) {
            header.onclick = () => {
                if (Admin.isGridMode) return;
                body?.classList.toggle('hidden');
                if (body?.classList.contains('hidden')) {
                    chevron?.classList.add('-rotate-90');
                    header.classList.remove('mb-4');
                } else {
                    chevron?.classList.remove('-rotate-90');
                    header.classList.add('mb-4');
                }
            };
        }
        
        async function checkStatus() {
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                
                // Fetch Maintenance Payload (multi-item + legacy flat)
                const resMaint = await fetch(`${dynamicEndpoint}config/maintenance.json`);
                const maintData = await resMaint.json();
                _maintItems = {};
                if (maintData === true) {
                    _maintRootActive = true;
                    if (toggle) toggle.checked = true;
                    const id = `m_${Date.now().toString(36)}`;
                    _maintItems[id] = {
                        id, active: true, message: 'MAINTENANCE IN PROGRESS',
                        regions: [], routes: [], expiresAt: null, createdAt: Date.now(), updatedAt: Date.now(),
                    };
                } else if (maintData !== null && typeof maintData === 'object') {
                    _maintRootActive = maintData.active !== false;
                    if (toggle) toggle.checked = _maintRootActive;
                    if (maintData.items && typeof maintData.items === 'object') {
                        Object.keys(maintData.items).forEach((key) => {
                            const it = maintData.items[key] || {};
                            _maintItems[String(it.id || key)] = {
                                id: String(it.id || key),
                                active: it.active !== false,
                                message: it.message || '',
                                regions: Array.isArray(it.regions) ? it.regions : [],
                                routes: Array.isArray(it.routes) ? it.routes.map(String) : [],
                                expiresAt: it.expiresAt || null,
                                createdAt: it.createdAt || null,
                                updatedAt: it.updatedAt || null,
                                updatedBy: it.updatedBy || null,
                            };
                        });
                    } else if (maintData.active || maintData.message) {
                        // Migrate flat legacy into items map (in-memory; persisted on next save)
                        const id = '_legacy';
                        _maintItems[id] = {
                            id,
                            active: !!maintData.active,
                            message: maintData.message || 'MAINTENANCE IN PROGRESS',
                            regions: Array.isArray(maintData.regions) ? maintData.regions : [],
                            routes: Array.isArray(maintData.routes) ? maintData.routes.map(String) : [],
                            expiresAt: maintData.expiresAt || null,
                            createdAt: maintData.createdAt || Date.now(),
                            updatedAt: maintData.updatedAt || Date.now(),
                            updatedBy: maintData.updatedBy || null,
                        };
                    }
                } else {
                    _maintRootActive = !!maintData;
                    if (toggle) toggle.checked = _maintRootActive;
                }
                resetMaintComposer();
                renderMaintActiveList();
                if (countLiveMaint() > 0) {
                    maintModeBody?.classList.remove('hidden');
                    maintModeChevron?.classList.remove('-rotate-90');
                }

                try {
                    const banSecret = await Admin.getAuthKey();
                    const banUrl = banSecret
                        ? `${dynamicEndpoint}config/shadow_ban_mode.json?auth=${banSecret}`
                        : `${dynamicEndpoint}config/shadow_ban_mode.json`;
                    const resBan = await fetch(banUrl);
                    if (resBan.ok) {
                        const banCfg = await resBan.json();
                        const mode = (typeof trustNormalizeShadowBanMode === 'function')
                            ? trustNormalizeShadowBanMode(banCfg?.mode || banCfg)
                            : (banCfg?.mode || 'offline');
                        if (banModeSelect) banModeSelect.value = mode;
                    }
                } catch (be) { /* optional config */ }

                try {
                    const resSched = await fetch(`${dynamicEndpoint}config/schedule_override.json`);
                    if (resSched.ok) {
                        const schedCfg = await resSched.json();
                        const regionsCfg = schedCfg?.regions || {};
                        SCHED_OVERRIDE_REGIONS.forEach((code) => {
                            const r = regionsCfg[code] || {};
                            const activeEl = schedOverrideRegions?.querySelector(`.sched-override-active[data-region="${code}"]`);
                            const dayEl = schedOverrideRegions?.querySelector(`.sched-override-day[data-region="${code}"]`);
                            const titleEl = schedOverrideRegions?.querySelector(`.sched-override-title[data-region="${code}"]`);
                            const bodyEl = schedOverrideRegions?.querySelector(`.sched-override-body[data-region="${code}"]`);
                            if (activeEl) activeEl.checked = !!r.active;
                            if (dayEl && r.dayType) dayEl.value = r.dayType;
                            if (titleEl) titleEl.value = r.title || '';
                            if (bodyEl) bodyEl.value = r.body || '';
                        });
                    }
                } catch (se) { /* optional config */ }

                } catch(e) { console.warn("Failed to check system status"); }
        }
        checkStatus();

        if (banModeSave && banModeSelect) {
            banModeSave.onclick = async () => {
                try {
                    const secret = await Admin.getAuthKey();
                    if (!secret) {
                        if (typeof showToast === 'function') showToast('Authentication required.', 'error');
                        return;
                    }
                    const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                    const mode = (typeof trustNormalizeShadowBanMode === 'function')
                        ? trustNormalizeShadowBanMode(banModeSelect.value)
                        : (banModeSelect.value || 'offline');
                    const res = await window.guardianFetch(`${dynamicEndpoint}config/shadow_ban_mode.json?auth=${secret}`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            mode,
                            updatedAt: Date.now(),
                            updatedBy: Admin.currentUser ? Admin.currentUser.email : 'Admin',
                        }),
                    }, 10000);
                    if (!res.ok) throw new Error('Auth failed');
                    if (typeof showToast === 'function') showToast(`Shadow-ban default: ${mode}`, 'success');
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Failed to save ban mode.', 'error');
                }
            };
        }

        if (schedOverrideSave && schedOverrideRegions) {
            schedOverrideSave.onclick = async () => {
                try {
                    const secret = await Admin.getAuthKey();
                    if (!secret) {
                        if (typeof showToast === 'function') showToast('Authentication required.', 'error');
                        return;
                    }
                    const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                    const regions = {};
                    SCHED_OVERRIDE_REGIONS.forEach((code) => {
                        regions[code] = {
                            active: !!schedOverrideRegions.querySelector(`.sched-override-active[data-region="${code}"]`)?.checked,
                            dayType: schedOverrideRegions.querySelector(`.sched-override-day[data-region="${code}"]`)?.value || 'public_holiday',
                            title: (schedOverrideRegions.querySelector(`.sched-override-title[data-region="${code}"]`)?.value || '').trim(),
                            body: (schedOverrideRegions.querySelector(`.sched-override-body[data-region="${code}"]`)?.value || '').trim(),
                            updatedAt: Date.now(),
                        };
                    });
                    const payload = {
                        updatedAt: Date.now(),
                        updatedBy: Admin.currentUser?.email || 'Admin',
                        regions,
                    };
                    const res = await window.guardianFetch(`${dynamicEndpoint}config/schedule_override.json?auth=${secret}`, {
                        method: 'PUT',
                        body: JSON.stringify(payload),
                    }, 10000);
                    if (!res.ok) throw new Error('Auth failed');
                    if (typeof showToast === 'function') showToast('Schedule overrides saved', 'success');
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Failed to save schedule overrides.', 'error');
                }
            };
        }

        const saveMaintenanceConfig = async (rootActiveOverride, successMsg) => {
            const secret = await Admin.getAuthKey();
            if (!secret) {
                if (typeof showToast === 'function') showToast('Authentication required.', 'error');
                return false;
            }
            const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
            if (typeof rootActiveOverride === 'boolean') _maintRootActive = rootActiveOverride;
            const payload = buildMaintFirebasePayload(_maintRootActive);
            const res = await window.guardianFetch(`${dynamicEndpoint}config/maintenance.json?auth=${secret}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            }, 10000);
            if (!res.ok) throw new Error('Auth failed');
            const live = countLiveMaint();
            if (typeof showToast === 'function') {
                showToast(successMsg || `Maintenance saved · ${live} live`, 'success');
            }
            renderMaintActiveList();
            if (typeof window.checkMaintenanceStatus === 'function') {
                try { window.checkMaintenanceStatus(); } catch { /* ignore */ }
            }
            if (typeof Admin.fetchActionRequired === 'function') {
                try { Admin.fetchActionRequired(); } catch { /* ignore */ }
            }
            return true;
        };

        const collectComposerItem = () => {
            const message = (maintMsg?.value || '').trim();
            if (!message) {
                if (typeof showToast === 'function') showToast('Enter a banner message.', 'error');
                return null;
            }
            const regions = getMaintSelectedRegions();
            const routes = Array.from(_maintSelectedRoutes);
            let expiresAt = null;
            if (maintExpires?.value) {
                const t = new Date(maintExpires.value).getTime();
                if (!Number.isFinite(t)) {
                    if (typeof showToast === 'function') showToast('Invalid expiry date.', 'error');
                    return null;
                }
                expiresAt = t;
            }
            const editId = (maintEditId?.value || '').trim();
            const id = editId || `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            const prev = _maintItems[id] || {};
            return {
                id,
                active: prev.active !== false,
                message,
                regions,
                routes,
                expiresAt,
                createdAt: prev.createdAt || Date.now(),
                updatedAt: Date.now(),
                updatedBy: Admin.currentUser?.email || 'Admin',
            };
        };

        const extendMaintItem = async (id) => {
            const it = _maintItems[id];
            if (!it || !it.expiresAt) return;
            it.expiresAt = Number(it.expiresAt) + 86400000;
            it.updatedAt = Date.now();
            try {
                await saveMaintenanceConfig(undefined, 'Maintenance extended +24h');
            } catch (e) {
                if (typeof showToast === 'function') showToast('Failed to extend.', 'error');
            }
        };

        const toggleMaintItemActive = async (id) => {
            const it = _maintItems[id];
            if (!it) return;
            it.active = it.active === false;
            it.updatedAt = Date.now();
            try {
                await saveMaintenanceConfig(undefined, it.active ? 'Banner enabled' : 'Banner disabled');
            } catch (e) {
                if (typeof showToast === 'function') showToast('Failed to update banner.', 'error');
            }
        };

        const deleteMaintItem = async (id) => {
            const confirmed = await Admin.secureConfirm('Delete banner', 'Remove this maintenance banner?');
            if (!confirmed) return;
            delete _maintItems[id];
            if (maintEditId?.value === id) resetMaintComposer();
            try {
                await saveMaintenanceConfig(undefined, 'Banner deleted');
            } catch (e) {
                if (typeof showToast === 'function') showToast('Failed to delete banner.', 'error');
            }
        };

        if (toggle) {
            toggle.addEventListener('change', async () => {
                try {
                    await saveMaintenanceConfig(toggle.checked, `Maintenance master: ${toggle.checked ? 'ON' : 'PAUSED'}`);
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Failed to update status.', 'error');
                    toggle.checked = !toggle.checked;
                    _maintRootActive = toggle.checked;
                }
            });
        }

        if (maintAddBtn) {
            maintAddBtn.onclick = async () => {
                const item = collectComposerItem();
                if (!item) return;
                _maintItems[item.id] = item;
                if (!_maintRootActive && toggle) {
                    toggle.checked = true;
                    _maintRootActive = true;
                }
                try {
                    const editing = !!(maintEditId?.value);
                    await saveMaintenanceConfig(undefined, editing ? 'Banner updated' : 'Banner added');
                    resetMaintComposer();
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Failed to save banner.', 'error');
                }
            };
        }

        // Expose for GSM resolve/extend
        Admin._saveMaintenanceItems = saveMaintenanceConfig;
        Admin._getMaintenanceItems = () => ({ ..._maintItems });
        Admin._setMaintenanceItem = (id, item) => { if (item) _maintItems[id] = item; else delete _maintItems[id]; };
        Admin._reloadMaintenanceUi = () => { renderMaintActiveList(); };
        Admin.openMaintenanceAccordion = () => {
            body?.classList.remove('hidden');
            chevron?.classList.remove('-rotate-90');
            maintModeBody?.classList.remove('hidden');
            maintModeChevron?.classList.remove('-rotate-90');
        };

        if (nukeFireBtn) {
            nukeFireBtn.onclick = async () => {
                const secret = await Admin.getAuthKey(); 
                if (!secret) { if (typeof showToast === 'function') showToast("Authentication required.", "error"); return; }
                
                const confirmed = await Admin.secureConfirm("Nuclear Cache Wipe", "Type 'NUKE' to confirm mass cache wipe:", "NUKE");
                if (!confirmed) return;
                
                nukeFireBtn.textContent = "Firing...";
                nukeFireBtn.disabled = true;

                try {
                    const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                    const url = `${dynamicEndpoint}config/killswitch.json?auth=${secret}`;
                    const payload = { timestamp: Date.now(), triggeredBy: Admin.currentUser ? Admin.currentUser.email : 'Admin' };
                    
                    const res = await window.guardianFetch(url, { method: 'PUT', body: JSON.stringify(payload) }, 10000);
                    if (res.ok) {
                        try {
                            await fetch('https://nexttrain-telemetry.enock.workers.dev/admin/purge-cloudflare-cache', { 
                                method: 'POST', 
                                headers: {'Authorization': `Bearer ${secret}`} 
                            });
                        } catch(pe) { console.warn("Purge failed", pe); }

                        if (typeof showToast === 'function') showToast("Nuclear Wipe Triggered Globally!", "success", 5000);
                    } else {
                        if (typeof showToast === 'function') showToast("Auth failed.", "error");
                    }
                } catch(e) {
                    if (typeof showToast === 'function') showToast("Network Error", "error");
                } finally {
                    nukeFireBtn.textContent = "Fire Killswitch";
                    nukeFireBtn.disabled = false;
                }
            };
        }

        if (cfPurgeBtn) {
            cfPurgeBtn.onclick = async () => {
                const secret = await Admin.getAuthKey();
                if (!secret) {
                    if (typeof showToast === 'function') showToast("Authentication required.", "error");
                    return;
                }

                const confirmed = await Admin.secureConfirm(
                    "Purge Cloudflare Cache",
                    "Type 'PURGE' to clear the Cloudflare edge cache for nexttrain.co.za (Purge Everything):",
                    "PURGE"
                );
                if (!confirmed) return;

                const label = cfPurgeBtn.textContent;
                cfPurgeBtn.textContent = "Purging...";
                cfPurgeBtn.disabled = true;
                try {
                    const res = await fetch('https://nexttrain-telemetry.enock.workers.dev/admin/purge-cloudflare-cache', {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${secret}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ reason: 'admin_panel', at: Date.now() }),
                    });
                    let data = null;
                    try { data = await res.json(); } catch { /* ignore */ }
                    if (res.ok && data?.success) {
                        if (typeof showToast === 'function') {
                            showToast("Cloudflare cache purged — fresh origin fetch in ~5s", "success", 5000);
                        }
                    } else {
                        const detail = data?.error || data?.details?.[0]?.message || `HTTP ${res.status}`;
                        if (typeof showToast === 'function') showToast(`Cloudflare purge failed: ${detail}`, "error", 6000);
                    }
                } catch (e) {
                    if (typeof showToast === 'function') showToast("Network error contacting purge endpoint", "error");
                } finally {
                    cfPurgeBtn.textContent = label || "Purge Cloudflare Cache";
                    cfPurgeBtn.disabled = false;
                }
            };
        }
    },

    // --- 10. OPERATIONS ROADMAP (JIRA BOARD) ---
    setupRoadmapManager: () => {
        const adminContainer = document.getElementById('admin-modules-container');
        if (!adminContainer) return;

        let roadmapPanel = document.getElementById('roadmap-panel');
        if (!roadmapPanel) {
            roadmapPanel = document.createElement('div');
            roadmapPanel.id = 'roadmap-panel';
            adminContainer.appendChild(roadmapPanel);
        }

        if (roadmapPanel.dataset.adminLoaded === "true") return;
        roadmapPanel.dataset.adminLoaded = "true";

        Admin.cachedRoadmapData = [];

        roadmapPanel.className = "bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 relative overflow-hidden transition-all duration-300";

        roadmapPanel.innerHTML = `
            <button id="roadmap-header-btn" class="w-full text-left text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center focus:outline-none relative">
                <span class="flex flex-col items-center">
                    ${Admin.tileIcon('map', 'text-blue-600 dark:text-blue-400')}
                    <span>Operations Roadmap</span>
                </span>
                <svg id="roadmap-chevron" class="w-4 h-4 transform transition-transform -rotate-90 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            <div id="roadmap-body" class="hidden mt-4 flex flex-col space-y-3">
                <!-- Controls Header -->
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-gray-100 dark:bg-gray-900 p-3 rounded-xl border border-gray-300 dark:border-gray-700 shadow-inner">
                    <div class="flex items-center gap-2 w-full sm:w-auto">
                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider pl-1" id="roadmap-status-display">Syncing Board...</span>
                    </div>
                    
                    <div class="flex items-center gap-2 w-full sm:w-auto">
                        <!-- Search Bar -->
                        <div class="relative flex-grow sm:w-48">
                            <svg class="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            <input type="text" id="roadmap-search-input" placeholder="Search tickets..." class="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block pl-8 p-2 shadow-sm outline-none transition-colors">
                        </div>
                        
                        <button id="roadmap-refresh-btn" class="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500 hover:text-blue-500 transition-colors focus:outline-none shadow-sm shrink-0" title="Refresh">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357 2m0 0H15"></path></svg>
                        </button>
                        <select id="roadmap-date-filter" class="h-9 max-w-[7.5rem] px-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-[10px] font-bold rounded-lg focus:ring-blue-500 outline-none shadow-sm shrink-0" title="Filter by date">
                            <option value="all">All dates</option>
                            <option value="7">Last 7 days</option>
                            <option value="30">Last 30 days</option>
                            <option value="90">Last 90 days</option>
                        </select>
                        <button onclick="Admin.openTicketModal()" class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-md focus:outline-none shrink-0">
                            ${Admin.icon('plus', 'w-3.5 h-3.5')} New Ticket
                        </button>
                    </div>
                </div>

                <!-- Kanban Board Area (Responsive Grid) -->
                <div class="overflow-x-auto pb-4 custom-scrollbar snap-x flex-grow w-full">
                    <!-- GUARDIAN UX FIX: Fluid Grid on Desktop, Snap Flex on Mobile -->
                    <div class="flex md:grid md:grid-cols-3 gap-4 h-full items-start px-1 w-full min-w-max md:min-w-0" id="roadmap-kanban-board">
                        
                        <!-- Column: Backlog -->
                        <div class="flex flex-col w-[280px] md:w-auto md:min-w-0 max-h-[500px] bg-gray-100 dark:bg-gray-900 rounded-xl border border-gray-300 dark:border-gray-700 shadow-inner overflow-hidden snap-center shrink-0 md:shrink">
                            <div class="p-3 border-b border-gray-300 dark:border-gray-700 flex justify-between items-center bg-white dark:bg-gray-800 shrink-0">
                                <div class="flex items-center gap-2">
                                    <span class="w-2.5 h-2.5 rounded-full bg-gray-400 shadow-sm"></span>
                                    <h2 class="text-[10px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">To-Do / Backlog</h2>
                                    <span id="roadmap-count-backlog" class="hidden bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-[9px] py-0.5 px-2 rounded-full font-bold"></span>
                                </div>
                                <button onclick="Admin.exportColumn('backlog')" class="text-gray-400 hover:text-blue-500 p-1 focus:outline-none transition-colors" title="Export Backlog">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                </button>
                            </div>
                            <div id="roadmap-col-backlog" class="flex-1 p-2 overflow-y-auto space-y-2 min-h-[150px] custom-scrollbar">
                                <div class="text-center text-gray-400 dark:text-gray-500 text-xs py-6 italic" id="empty-backlog">No tickets</div>
                            </div>
                        </div>

                        <!-- Column: In Progress -->
                        <div class="flex flex-col w-[280px] md:w-auto md:min-w-0 max-h-[500px] bg-gray-100 dark:bg-gray-900 rounded-xl border border-blue-300 dark:border-blue-800 shadow-inner overflow-hidden snap-center shrink-0 md:shrink">
                            <div class="p-3 border-b border-blue-300 dark:border-blue-800 flex justify-between items-center bg-white dark:bg-gray-800 shrink-0">
                                <div class="flex items-center gap-2">
                                    <span class="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-sm ring-2 ring-blue-200 dark:ring-blue-900"></span>
                                    <h2 class="text-[10px] font-black uppercase tracking-widest text-blue-800 dark:text-blue-300">In Progress</h2>
                                    <span id="roadmap-count-progress" class="hidden bg-blue-200 dark:bg-blue-800/80 text-blue-800 dark:text-blue-200 text-[9px] py-0.5 px-2 rounded-full font-bold"></span>
                                </div>
                                <button onclick="Admin.exportColumn('progress')" class="text-blue-400 hover:text-blue-600 p-1 focus:outline-none transition-colors" title="Export In Progress">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                </button>
                            </div>
                            <div id="roadmap-col-progress" class="flex-1 p-2 overflow-y-auto space-y-2 min-h-[150px] custom-scrollbar">
                                <div class="text-center text-gray-400 dark:text-gray-500 text-xs py-6 italic hidden" id="empty-inprogress">No tickets</div>
                            </div>
                        </div>

                        <!-- Column: Completed -->
                        <div class="flex flex-col w-[280px] md:w-auto md:min-w-0 max-h-[500px] bg-gray-100 dark:bg-gray-900 rounded-xl border border-green-300 dark:border-green-800 shadow-inner overflow-hidden snap-center shrink-0 md:shrink">
                            <div class="p-3 border-b border-green-300 dark:border-green-800 flex justify-between items-center bg-white dark:bg-gray-800 shrink-0">
                                <div class="flex items-center gap-2">
                                    <span class="w-2.5 h-2.5 rounded-full bg-green-500 shadow-sm ring-2 ring-green-200 dark:ring-green-900"></span>
                                    <h2 class="text-[10px] font-black uppercase tracking-widest text-green-800 dark:text-green-300">Completed</h2>
                                    <span id="roadmap-count-done" class="hidden bg-green-200 dark:bg-green-800/80 text-green-800 dark:text-green-200 text-[9px] py-0.5 px-2 rounded-full font-bold"></span>
                                </div>
                                <button onclick="Admin.exportColumn('done')" class="text-green-400 hover:text-green-600 p-1 focus:outline-none transition-colors" title="Export Completed">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                </button>
                            </div>
                            <div id="roadmap-col-done" class="flex-1 p-2 overflow-y-auto space-y-2 min-h-[150px] custom-scrollbar">
                                <div class="text-center text-gray-400 dark:text-gray-500 text-xs py-6 italic hidden" id="empty-completed">No tickets</div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        `;

        const header = document.getElementById('roadmap-header-btn');
        const body = document.getElementById('roadmap-body');
        const chevron = document.getElementById('roadmap-chevron');
        const refreshBtn = document.getElementById('roadmap-refresh-btn');
        Admin._roadmapDateFilter = 'all';

        header.onclick = () => {
            if (Admin.isGridMode) return;
            body.classList.toggle('hidden');
            if (body.classList.contains('hidden')) {
                chevron.classList.add('-rotate-90');
                header.classList.remove('mb-4');
            } else {
                chevron.classList.remove('-rotate-90');
                header.classList.add('mb-4');
                Admin.fetchRoadmap();
            }
        };

        refreshBtn.onclick = () => Admin.fetchRoadmap();

        Admin.renderRoadmapList = () => {
            const colBacklog = document.getElementById('roadmap-col-backlog');
            const colProgress = document.getElementById('roadmap-col-progress');
            const colDone = document.getElementById('roadmap-col-done');

            // Clear columns except for empty state markers
            Array.from(colBacklog.children).forEach(c => { if (c.id !== 'empty-backlog') c.remove(); });
            Array.from(colProgress.children).forEach(c => { if (c.id !== 'empty-inprogress') c.remove(); });
            Array.from(colDone.children).forEach(c => { if (c.id !== 'empty-completed') c.remove(); });

            let counts = { backlog: 0, progress: 0, done: 0 };
            
            const searchInput = document.getElementById('roadmap-search-input');
            const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
            const dateFilterEl = document.getElementById('roadmap-date-filter');
            const dateFilter = (dateFilterEl?.value || Admin._roadmapDateFilter || 'all');
            Admin._roadmapDateFilter = dateFilter;
            const dateCutoff = dateFilter === 'all' ? 0 : (Date.now() - (Number(dateFilter) * 86400000));

            // Quick escapeHTML helper
            const safeHTML = (str) => {
                if (!str) return '';
                return String(str).replace(/[&<>"']/g, function(m) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
                });
            };

            const getPriorityStyles = (priority) => {
                const styles = {
                    low: { bg: 'bg-gray-100 dark:bg-gray-800', border: 'border-gray-200 dark:border-gray-600', text: 'text-gray-600 dark:text-gray-300', icon: 'M19 14l-7 7m0 0l-7-7m7 7V3' }, // Arrow down
                    medium: { bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-200 dark:border-blue-700/50', text: 'text-blue-700 dark:text-blue-300', icon: 'M20 12H4' }, // Minus
                    high: { bg: 'bg-orange-50 dark:bg-orange-900/30', border: 'border-orange-200 dark:border-orange-700/50', text: 'text-orange-700 dark:text-orange-300', icon: 'M5 10l7-7m0 0l7 7m-7-7v18' }, // Arrow up
                    critical: { bg: 'bg-red-50 dark:bg-red-900/30', border: 'border-red-200 dark:border-red-700/50', text: 'text-red-700 dark:text-red-400', icon: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z' } // Fire
                };
                return styles[priority] || styles.medium;
            };

            Admin.cachedRoadmapData.forEach(ticket => {
                // Search filtering
                if (searchTerm) {
                    const searchableText = `${ticket.title} ${ticket.description || ''} ${ticket.source || ''}`.toLowerCase();
                    if (!searchableText.includes(searchTerm)) return; // Skip if no match
                }
                if (dateCutoff > 0) {
                    const ts = Number(ticket.timestamp || ticket.createdAt || 0);
                    if (!ts || ts < dateCutoff) return;
                }

                const status = ticket.status || 'backlog';
                if (!counts.hasOwnProperty(status)) return; // Failsafe
                
                counts[status]++;

                const dateStr = Admin.formatDate(ticket.timestamp);
                const safeTitle = safeHTML(ticket.title || 'Untitled');
                let shortDesc = safeHTML(ticket.description || 'No description provided.');
                
                // Truncate description for card view
                if (shortDesc.length > 80) shortDesc = shortDesc.substring(0, 80) + '...';
                
                const pStyles = getPriorityStyles(ticket.severity || 'medium');
                
                let sourceBadge = '';
                if (ticket.source) {
                    sourceBadge = `<div class="mt-1 text-[9px] text-blue-500 dark:text-blue-400 font-mono truncate">Ref: ${safeHTML(ticket.source)}</div>`;
                }
                
                let typeIconName = 'pin';
                if (ticket.type === 'bug') typeIconName = 'bug';
                else if (ticket.type === 'feature') typeIconName = 'rocket';
                else if (ticket.type === 'route') typeIconName = 'map';
                const typeIcon = `<span class="inline-flex text-gray-500 dark:text-gray-400 shrink-0 mt-0.5" title="${ticket.type || 'task'}">${Admin.icon(typeIconName, 'w-3.5 h-3.5')}</span>`;

                // Native SVG icons replacing FontAwesome
                const editIcon = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>`;
                const trashIcon = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`;
                const leftArrowIcon = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>`;
                const rightArrowIcon = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>`;
                const prioritySvg = `<svg class="w-2.5 h-2.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${pStyles.icon}"></path></svg>`;

                let moveControls = '';
                if (status === 'backlog') {
                    moveControls = `<button class="text-gray-400 hover:text-blue-500 p-2 rounded hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors focus:outline-none" onclick="event.stopPropagation(); Admin.updateTicketStatus('${ticket.id}', 'progress')" title="Move to Progress">${rightArrowIcon}</button>`;
                } else if (status === 'progress') {
                    moveControls = `
                        <button class="text-gray-400 hover:text-blue-500 p-2 rounded hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors focus:outline-none" onclick="event.stopPropagation(); Admin.updateTicketStatus('${ticket.id}', 'backlog')" title="Move to Backlog">${leftArrowIcon}</button>
                        <button class="text-gray-400 hover:text-green-500 p-2 rounded hover:bg-green-50 dark:hover:bg-gray-700 transition-colors focus:outline-none" onclick="event.stopPropagation(); Admin.updateTicketStatus('${ticket.id}', 'done')" title="Move to Done">${rightArrowIcon}</button>
                    `;
                } else if (status === 'done') {
                    moveControls = `<button class="text-gray-400 hover:text-blue-500 p-2 rounded hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors focus:outline-none" onclick="event.stopPropagation(); Admin.updateTicketStatus('${ticket.id}', 'progress')" title="Move to Progress">${leftArrowIcon}</button>`;
                }

                const cardHtml = `
                    <div class="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 p-3 rounded-lg shadow-sm hover:shadow-md hover:border-blue-400 dark:hover:border-blue-500 transition-all cursor-pointer group flex flex-col gap-2 relative overflow-hidden" onclick="Admin.openViewModal('${ticket.id}')">
                        <div class="flex items-start min-w-0 gap-1.5">
                            ${typeIcon}
                            <h4 class="font-bold text-gray-900 dark:text-gray-200 text-sm leading-tight line-clamp-2 break-words min-w-0 flex-1">${safeTitle}</h4>
                        </div>

                        <div class="relative flex flex-col gap-1 min-h-[2.5rem]">
                            <p class="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed pr-16">${shortDesc}</p>
                            ${sourceBadge}
                            <span class="absolute bottom-0 right-0 text-[9px] text-gray-400 dark:text-gray-500 font-mono whitespace-nowrap">
                                ${dateStr.split(',')[0]}
                            </span>
                        </div>
                        
                        <div class="flex items-center justify-between gap-2 mt-0.5 pt-2 border-t border-gray-100 dark:border-gray-700/50">
                            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider flex items-center shrink-0 ${pStyles.bg} ${pStyles.border} ${pStyles.text}">
                                ${prioritySvg} ${(ticket.severity || 'medium')}
                            </span>
                            <div class="flex items-center gap-0.5 shrink-0">
                                ${moveControls}
                                <div class="w-px h-4 bg-gray-200 dark:bg-gray-600 my-auto mx-0.5"></div>
                                <button class="text-gray-400 hover:text-blue-500 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none" onclick="event.stopPropagation(); Admin.openTicketModal('${ticket.id}')" title="Edit Ticket">
                                    ${editIcon}
                                </button>
                                <button class="text-gray-400 hover:text-red-500 p-2 rounded hover:bg-red-50 dark:hover:bg-gray-700 transition-colors focus:outline-none" onclick="event.stopPropagation(); Admin.deleteTicket('${ticket.id}')" title="Delete Ticket">
                                    ${trashIcon}
                                </button>
                            </div>
                        </div>
                    </div>
                `;

                if (status === 'backlog') colBacklog.insertAdjacentHTML('beforeend', cardHtml);
                else if (status === 'progress') colProgress.insertAdjacentHTML('beforeend', cardHtml);
                else if (status === 'done') colDone.insertAdjacentHTML('beforeend', cardHtml);
            });

            // Update Counts - hide badges when zero
            const setRoadmapCount = (id, n) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.textContent = String(n);
                el.classList.toggle('hidden', !n);
            };
            setRoadmapCount('roadmap-count-backlog', counts.backlog);
            setRoadmapCount('roadmap-count-progress', counts.progress);
            setRoadmapCount('roadmap-count-done', counts.done);

            // Handle Empty States
            document.getElementById('empty-backlog').classList.toggle('hidden', counts.backlog > 0);
            document.getElementById('empty-inprogress').classList.toggle('hidden', counts.progress > 0);
            document.getElementById('empty-completed').classList.toggle('hidden', counts.done > 0);
        };

        const searchInput = document.getElementById('roadmap-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', Admin.renderRoadmapList);
        }
        const dateFilterInput = document.getElementById('roadmap-date-filter');
        if (dateFilterInput) {
            dateFilterInput.addEventListener('change', () => {
                Admin._roadmapDateFilter = dateFilterInput.value || 'all';
                Admin.renderRoadmapList();
            });
        }

        Admin.fetchRoadmap = async () => {
            const secret = await Admin.getAuthKey();
            if (!secret) return;

            document.getElementById('roadmap-status-display').textContent = 'Syncing Board...';
            
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                // GUARDIAN FIX: Added cache-buster ?t=Date.now() to prevent ghost syncs
                const res = await window.guardianFetch(`${dynamicEndpoint}roadmap.json?auth=${secret}&t=${Date.now()}`, {}, 10000);
                
                if (!res.ok) throw new Error("HTTP " + res.status);
                const data = await res.json();
                
                Admin.cachedRoadmapData = (data && typeof data === 'object') ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
                
                // Sort by timestamp desc
                Admin.cachedRoadmapData.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

                Admin.renderRoadmapList();
                document.getElementById('roadmap-status-display').textContent = 'Board Synced';
            } catch(e) {
                console.error("Roadmap fetch error:", e);
                document.getElementById('roadmap-status-display').textContent = 'Sync Failed';
            }
        };

        Admin.updateTicketStatus = async (ticketId, newStatus) => {
            const secret = await Admin.getAuthKey();
            if (!secret) return;

            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const res = await fetch(`${dynamicEndpoint}roadmap/${ticketId}.json?auth=${secret}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: newStatus, updatedAt: Date.now() })
                });
                
                // GUARDIAN FIX: Catch silent HTTP rejections
                if (!res.ok) throw new Error("Failed to patch ticket.");
                
                // Update local RAM and re-render instantly
                const ticket = Admin.cachedRoadmapData.find(t => t.id === ticketId);
                if (ticket) ticket.status = newStatus;
                Admin.renderRoadmapList();
                
                if (typeof showToast === 'function') showToast(`Ticket moved to ${newStatus}`, "success");
            } catch(e) {
                if (typeof showToast === 'function') showToast("Failed to move ticket.", "error");
            }
        };

        Admin.deleteTicket = async (ticketId) => {
            const confirmed = await Admin.secureConfirm("Delete Ticket", "Permanently remove this ticket from the Roadmap?");
            if (!confirmed) return;

            const secret = await Admin.getAuthKey();
            if (!secret) return;

            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const res = await fetch(`${dynamicEndpoint}roadmap/${ticketId}.json?auth=${secret}`, { method: 'DELETE' });
                
                // GUARDIAN FIX: Catch silent HTTP rejections
                if (!res.ok) throw new Error("Failed to delete ticket.");

                Admin.cachedRoadmapData = Admin.cachedRoadmapData.filter(t => t.id !== ticketId);
                Admin.renderRoadmapList();
                
                if (typeof showToast === 'function') showToast("Ticket deleted.", "success");
            } catch(e) {
                if (typeof showToast === 'function') showToast("Failed to delete ticket.", "error");
            }
        };

        // Ticket View Modal UI (Read Only / Long Description)
        Admin.openViewModal = (ticketId) => {
            const ticket = Admin.cachedRoadmapData.find(t => t.id === ticketId);
            if (!ticket) return;

            let modal = document.getElementById('admin-ticket-view-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'admin-ticket-view-modal';
                modal.className = 'fixed inset-0 bg-black/80 z-[250] hidden flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
                document.body.appendChild(modal);
            }

            const getPriorityStyles = (priority) => {
                const styles = {
                    low: { bg: 'bg-gray-100 dark:bg-gray-800', border: 'border-gray-200 dark:border-gray-600', text: 'text-gray-600 dark:text-gray-300', icon: 'M19 14l-7 7m0 0l-7-7m7 7V3' },
                    medium: { bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-200 dark:border-blue-700/50', text: 'text-blue-700 dark:text-blue-300', icon: 'M20 12H4' },
                    high: { bg: 'bg-orange-50 dark:bg-orange-900/30', border: 'border-orange-200 dark:border-orange-700/50', text: 'text-orange-700 dark:text-orange-300', icon: 'M5 10l7-7m0 0l7 7m-7-7v18' },
                    critical: { bg: 'bg-red-50 dark:bg-red-900/30', border: 'border-red-200 dark:border-red-700/50', text: 'text-red-700 dark:text-red-400', icon: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z' }
                };
                return styles[priority] || styles.medium;
            };

            const safeHTML = (str) => {
                if (!str) return '';
                return String(str).replace(/[&<>"']/g, function(m) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
                });
            };

            const pStyles = getPriorityStyles(ticket.severity || 'medium');
            const statusMap = { backlog: 'To-Do / Backlog', progress: 'In Progress', done: 'Completed' };
            const statusText = statusMap[ticket.status || 'backlog'];
            const safeTitle = safeHTML(ticket.title);
            const safeDesc = safeHTML(ticket.description || 'No description provided.');

            modal.innerHTML = `
                <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] transform transition-all scale-95 border border-gray-200 dark:border-gray-700">
                    <div class="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-start gap-4 shrink-0 bg-gray-50 dark:bg-gray-900/50 rounded-t-xl">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-2 flex-wrap">
                                <span class="text-[10px] px-2 py-0.5 rounded border uppercase tracking-wider font-bold flex items-center ${pStyles.bg} ${pStyles.border} ${pStyles.text}">
                                    <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${pStyles.icon}"></path></svg>
                                    ${(ticket.severity || 'medium')}
                                </span>
                                <span class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider flex items-center">
                                    <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                    ${statusText}
                                </span>
                            </div>
                            <h3 class="text-lg sm:text-xl font-black text-gray-900 dark:text-white leading-tight break-words">${safeTitle}</h3>
                        </div>
                        <div class="flex gap-1 sm:gap-2 shrink-0">
                            <button id="view-export-btn" class="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-800 transition-colors focus:outline-none shadow-sm" title="Export this ticket">
                                <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                            </button>
                            <button id="view-edit-btn" class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg border border-indigo-200 dark:border-indigo-800 transition-colors focus:outline-none shadow-sm" title="Edit">
                                <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                            </button>
                            <button onclick="closeSmoothModal('admin-ticket-view-modal')" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 p-2 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors focus:outline-none shadow-sm" title="Close">
                                <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                    </div>
                    
                    <div class="p-4 sm:p-6 overflow-y-auto flex-1 bg-white dark:bg-gray-800 custom-scrollbar">
                        <h4 class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Description</h4>
                        <div class="text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-700 font-mono text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words min-h-[150px]">
                            ${safeDesc}
                        </div>
                    </div>
                </div>
            `;

            openSmoothModal('admin-ticket-view-modal');

            // Wire up internal buttons
            document.getElementById('view-edit-btn').onclick = () => {
                closeSmoothModal('admin-ticket-view-modal');
                setTimeout(() => Admin.openTicketModal(ticketId), 300); // Wait for transition
            };

            document.getElementById('view-export-btn').onclick = () => {
                // Ensure array format for compatibility with the export engine
                Admin.exportColumn(null, [ticket], `ticket-${ticket.id}`);
            };
        };

        // Ticket Editor Modal UI
        Admin.openTicketModal = (ticketId = null, prefillData = null) => {
            let modal = document.getElementById('admin-ticket-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'admin-ticket-modal';
                modal.className = 'fixed inset-0 bg-black/80 z-[250] hidden flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
                document.body.appendChild(modal);
            }

            let ticket = { type: 'bug', severity: 'low', title: '', description: '', source: '', status: 'backlog' };
            
            if (ticketId) {
                const found = Admin.cachedRoadmapData.find(t => t.id === ticketId);
                if (found) ticket = { ...found };
            } else if (prefillData) {
                ticket = { ...ticket, ...prefillData };
            }
            
            // Quick escapeHTML helper for modal payload
            const safeHTML = (str) => {
                if (!str) return '';
                return String(str).replace(/[&<>"']/g, function(m) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
                });
            };

            const typeOpts = [
                { value: 'bug', label: 'Bug', icon: 'bug', active: 'border-rose-400 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300' },
                { value: 'feature', label: 'Feature', icon: 'rocket', active: 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300' },
                { value: 'route', label: 'Route', icon: 'map', active: 'border-sky-400 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300' },
            ];
            const sevOpts = [
                { value: 'low', label: 'Low', icon: 'circle', active: 'border-gray-400 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300' },
                { value: 'high', label: 'High', icon: 'alert', active: 'border-orange-400 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300' },
                { value: 'critical', label: 'Critical', icon: 'flame', active: 'border-red-400 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' },
            ];
            const statusOpts = [
                { value: 'backlog', label: 'Backlog', icon: 'pin', active: 'border-gray-400 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300' },
                { value: 'progress', label: 'Progress', icon: 'hourglass', active: 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' },
                { value: 'done', label: 'Done', icon: 'check', active: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' },
            ];
            const chipBtn = (group, opt, selected) => {
                const base = 'tkt-chip flex flex-col items-center justify-center gap-1 px-1 py-2 rounded-lg border text-[9px] font-bold uppercase tracking-wide transition-colors focus:outline-none';
                const idle = 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:border-gray-300';
                return `<button type="button" data-group="${group}" data-value="${opt.value}" class="${base} ${selected === opt.value ? opt.active : idle}">${Admin.icon(opt.icon, 'w-4 h-4')}<span>${opt.label}</span></button>`;
            };

            modal.innerHTML = `
                <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-5 transform transition-all scale-95 border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh]">
                    <div class="flex items-center justify-between mb-4 shrink-0">
                        <h3 class="text-lg font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
                            <span class="inline-flex text-blue-500">${Admin.icon('note', 'w-5 h-5')}</span> ${ticketId ? 'Edit Ticket' : 'New Ticket'}
                        </h3>
                        <button onclick="closeSmoothModal('admin-ticket-modal')" class="text-gray-400 hover:text-gray-500 focus:outline-none bg-gray-100 dark:bg-gray-700 rounded-full p-1.5">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    
                    <div class="overflow-y-auto custom-scrollbar flex-grow space-y-3 pr-1 pb-2">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Title</label>
                            <input type="text" id="tkt-title" class="w-full h-10 px-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-900 dark:text-white outline-none" value="${safeHTML(ticket.title)}" placeholder="Short summary">
                        </div>
                        <input type="hidden" id="tkt-type" value="${safeHTML(ticket.type || 'bug')}">
                        <input type="hidden" id="tkt-severity" value="${safeHTML(ticket.severity || 'low')}">
                        <input type="hidden" id="tkt-status" value="${safeHTML(ticket.status || 'backlog')}">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1.5">Type</label>
                            <div class="grid grid-cols-3 gap-1.5" id="tkt-type-chips">
                                ${typeOpts.map((o) => chipBtn('type', o, ticket.type || 'bug')).join('')}
                            </div>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1.5">Severity</label>
                            <div class="grid grid-cols-3 gap-1.5" id="tkt-severity-chips">
                                ${sevOpts.map((o) => chipBtn('severity', o, ticket.severity || 'low')).join('')}
                            </div>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1.5">Status</label>
                            <div class="grid grid-cols-3 gap-1.5" id="tkt-status-chips">
                                ${statusOpts.map((o) => chipBtn('status', o, ticket.status || 'backlog')).join('')}
                            </div>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Description</label>
                            <textarea id="tkt-desc" rows="4" class="w-full p-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-900 dark:text-white outline-none resize-none">${safeHTML(ticket.description)}</textarea>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Source / Reference (Optional)</label>
                            <input type="text" id="tkt-source" class="w-full h-10 px-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-[10px] font-mono text-gray-900 dark:text-white outline-none" value="${safeHTML(ticket.source)}" placeholder="e.g. Feedback ID: 12345">
                        </div>
                    </div>

                    <div class="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 shrink-0 flex gap-2">
                        <button onclick="closeSmoothModal('admin-ticket-modal')" class="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-bold py-2.5 rounded-lg transition-colors text-xs">Cancel</button>
                        <button id="tkt-save-btn" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg shadow-sm transition-colors text-xs">Save Ticket</button>
                    </div>
                </div>
            `;

            // Wire chip selectors ? hidden inputs
            const chipMaps = { type: typeOpts, severity: sevOpts, status: statusOpts };
            modal.querySelectorAll('.tkt-chip').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const group = btn.dataset.group;
                    const value = btn.dataset.value;
                    const hidden = document.getElementById(`tkt-${group}`);
                    if (hidden) hidden.value = value;
                    const opts = chipMaps[group] || [];
                    modal.querySelectorAll(`.tkt-chip[data-group="${group}"]`).forEach((b) => {
                        const opt = opts.find((o) => o.value === b.dataset.value);
                        const idle = 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:border-gray-300';
                        b.className = `tkt-chip flex flex-col items-center justify-center gap-1 px-1 py-2 rounded-lg border text-[9px] font-bold uppercase tracking-wide transition-colors focus:outline-none ${b.dataset.value === value && opt ? opt.active : idle}`;
                    });
                });
            });

            openSmoothModal('admin-ticket-modal');

            document.getElementById('tkt-save-btn').onclick = async () => {
                const title = document.getElementById('tkt-title').value.trim();
                const desc = document.getElementById('tkt-desc').value.trim();
                if (!title) { if (typeof showToast === 'function') showToast("Title required", "error"); return; }

                const secret = await Admin.getAuthKey();
                if (!secret) return;

                const payload = {
                    title: title,
                    description: desc,
                    type: document.getElementById('tkt-type').value,
                    severity: document.getElementById('tkt-severity').value,
                    source: document.getElementById('tkt-source').value.trim(),
                    status: document.getElementById('tkt-status').value,
                    timestamp: ticketId ? ticket.timestamp : Date.now(),
                    updatedAt: Date.now()
                };

                const targetId = ticketId || Date.now().toString();

                try {
                    document.getElementById('tkt-save-btn').disabled = true;
                    document.getElementById('tkt-save-btn').textContent = "Saving...";

                    const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                    const res = await fetch(`${dynamicEndpoint}roadmap/${targetId}.json?auth=${secret}`, {
                        method: 'PUT',
                        body: JSON.stringify(payload)
                    });

                    // GUARDIAN FIX: Catch silent HTTP rejections
                    if (!res.ok) throw new Error("Failed to PUT ticket data.");

                    if (typeof showToast === 'function') showToast("Ticket saved!", "success");
                    closeSmoothModal('admin-ticket-modal');
                    Admin.fetchRoadmap();
                } catch(e) {
                    if (typeof showToast === 'function') showToast("Failed to save.", "error");
                    document.getElementById('tkt-save-btn').disabled = false;
                    document.getElementById('tkt-save-btn').textContent = "Save Ticket";
                }
            };
        };

        // Escalate hook kept on Admin root (see Admin.escalateToRoadmap / escalateFromEl)

        // Export Engine
        Admin.ticketsToTxt = (tickets, heading = 'OPERATIONS ROADMAP') => {
            let txt = `NEXT TRAIN - ${heading}\nExported: ${Admin.formatDate(Date.now())}\nTickets: ${tickets.length}\n${'='.repeat(48)}\n\n`;
            tickets.forEach((t, i) => {
                txt += `#${i + 1}  [${String(t.status || 'backlog').toUpperCase()}] ${t.title || '(untitled)'}\n`;
                txt += `  Type: ${t.type || '-'} - Severity: ${t.severity || '-'} - ID: ${t.id || '-'}\n`;
                if (t.source) txt += `  Source: ${t.source}\n`;
                if (t.createdAt) txt += `  Created: ${Admin.formatDate(t.createdAt)}\n`;
                if (t.updatedAt) txt += `  Updated: ${Admin.formatDate(t.updatedAt)}\n`;
                const desc = String(t.description || '').replace(/\r/g, '').trim();
                if (desc) txt += `  Description:\n${desc.split('\n').map((l) => `    ${l}`).join('\n')}\n`;
                txt += `\n`;
            });
            return txt;
        };

        Admin.exportColumn = (statusColumn, targetArray = null, filenameOverride = null) => {
            let dataToExport = [];
            
            if (targetArray) {
                dataToExport = targetArray;
            } else {
                if (!Admin.cachedRoadmapData || Admin.cachedRoadmapData.length === 0) {
                    if (typeof showToast === 'function') showToast("No data to export.", "warning");
                    return;
                }
                if (statusColumn === 'all' || !statusColumn) {
                    dataToExport = [...Admin.cachedRoadmapData];
                } else {
                    dataToExport = Admin.cachedRoadmapData.filter(t => (t.status || 'backlog') === statusColumn);
                }
            }

            if (dataToExport.length === 0) {
                if (typeof showToast === 'function') showToast("No tickets to export.", "warning");
                return;
            }

            const dateStr = new Date().toISOString().slice(0, 10);
            const scope = statusColumn === 'all' || !statusColumn ? 'board' : statusColumn;
            const finalFilename = filenameOverride
                ? `${filenameOverride}_${dateStr}.txt`
                : `roadmap_${scope}_${dateStr}.txt`;
            const heading = statusColumn === 'all' ? 'OPERATIONS ROADMAP (FULL BOARD)' : `OPERATIONS ROADMAP (${String(scope).toUpperCase()})`;
            const txt = Admin.ticketsToTxt(dataToExport, heading);
            const ok = Admin.downloadFile(finalFilename, txt);
            if (ok && typeof showToast === 'function') showToast(`Downloaded ${dataToExport.length} ticket(s)`, "success");
        };
    }
};

window.Admin = Admin;
// Astro bootstrap calls Admin.init() after Firebase + globals are ready