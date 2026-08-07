// --- METRORAIL NEXT TRAIN UTILITIES (V7 06.17 - Guardian Edition) ---
// Pure, stateless helper functions shared across the application.

export function pad(num) {
    var s = "00" + num;
    return s.substr(s.length - 2);
}

export function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

/** Timetable sheet family for a logical day type (public holidays use Saturday sheets). */
export function usesWeekdayScheduleSheet(dayType) {
    return dayType === 'weekday' || dayType === 'monday';
}

export function usesSaturdayScheduleSheet(dayType) {
    return dayType === 'saturday' || dayType === 'public_holiday';
}

export function normalizeScheduleSheetDay(dayType) {
    if (!dayType || dayType === 'sunday') return 'weekday';
    if (dayType === 'public_holiday') return 'saturday';
    return dayType;
}

export function scheduleDayTypeLabel(dayType) {
    if (dayType === 'sunday') return 'No Sunday service';
    if (dayType === 'public_holiday') return 'Public holiday timetable';
    if (dayType === 'saturday') return 'Saturday / public-holiday timetable';
    if (dayType === 'weekday') return 'Weekday timetable';
    return 'Special schedule';
}

/**
 * Repair common UTF-8-as-Latin1/Windows-1252 mojibake in remote HTML/text
 * (e.g. Firebase notices saved as mojibake em-dash + "Next Train Ops").
 * Bad-side keys use \u escapes so source scanners cannot "fix" them away.
 */
export function repairMojibake(str) {
    if (str == null) return '';
    let s = String(str);
    if (!s) return s;

    // Windows-1252 misread of UTF-8 em dash (E2 80 94) → â + € + ”
    const mojibakeEmDash = '\u00E2\u20AC\u201D';
    // Variant where 0x94 was already an em dash glyph
    const mojibakeEmDashAlt = '\u00E2\u20AC\u2014';
    // Latin-1 misread of same bytes
    const latin1EmDash = '\u00E2\u0080\u0094';
    const exact = [
        [mojibakeEmDash, '\u2014'],
        [mojibakeEmDashAlt, '\u2014'],
        [latin1EmDash, '\u2014'],
        ['\u00E2\u20AC\u201C', '\u2013'], // en dash via CP1252
        ['\u00E2\u0080\u0093', '\u2013'],
        ['\u00E2\u20AC\u00A2', '\u2022'], // bullet via CP1252
        ['\u00E2\u0080\u00A2', '\u2022'],
        ['\u00E2\u20AC\u00A6', '\u2026'],
        ['\u00E2\u0080\u00A6', '\u2026'],
        ['\u00E2\u20AC\u2122', '\u2019'],
        ['\u00E2\u0080\u0099', '\u2019'],
        ['\u00E2\u20AC\u02DC', '\u2018'],
        ['\u00E2\u0080\u0098', '\u2018'],
        ['\u00E2\u20AC\u0153', '\u201C'],
        ['\u00E2\u0080\u009C', '\u201C'],
        ['\u00E2\u20AC\u009D', '\u201D'],
        ['\u00E2\u0080\u009D', '\u201D'],
        ['\u00E2\u2020\u201D', '\u2194'], // â†”
        ['\u00E2\u0086\u0094', '\u2194'],
        ['\u00E2\u02C6\u00A0\u00EF\u00B8\u008F', '⚠️'], // âš ï¸
        ['\u00E2\u009A\u00A0\u00EF\u00B8\u008F', '⚠️'],
        ['\u00E2\u009A\u00A0\uFE0F', '⚠️'],
        ['\u00E2\u009A\u00A0', '\u26A0'],
        ['\u00E2\u02DC\u00A2\uFE0F', '☢️'], // â˜¢️
        ['\u00E2\u0098\u00A2\uFE0F', '☢️'],
        ['\u00E2\u0098\u00A2', '\u2622'],
        ['\u00E2\u009B\u0094', '\u26D4'],
        ['\u00C3\u0097', '\u00D7'],
        ['\u00C2\u00A0', ' '],
        ['\u00C2', ''],
    ];
    for (const [bad, good] of exact) {
        if (bad && s.includes(bad)) s = s.split(bad).join(good);
    }

    // Generic: decode runs that look like UTF-8 misread as Latin-1
    s = s.replace(/[\u00C2-\u00F4][\u0080-\u00FF]{1,5}/g, (match) => {
        try {
            const bytes = Uint8Array.from([...match].map((c) => c.charCodeAt(0) & 0xff));
            const out = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            if (!out || out.includes('\uFFFD') || out === match) return match;
            return out;
        } catch {
            return match;
        }
    });

    // CP1252 path: map common high chars back to bytes then UTF-8 decode
    s = s.replace(/[\u00C2-\u00F4](?:[\u0080-\u00FF]|[\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201C\u201D\u2020\u2021\u2022\u2026\u2030\u20AC\u2122]){1,6}/g, (match) => {
        const cp1252 = {
            0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
            0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
            0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
            0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
            0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
            0x017E: 0x9E, 0x0178: 0x9F,
        };
        try {
            const bytes = Uint8Array.from([...match].map((ch) => {
                const cp = ch.codePointAt(0);
                if (cp <= 0xff) return cp;
                return cp1252[cp] != null ? cp1252[cp] : cp;
            }).filter((b) => b <= 0xff));
            const out = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            if (!out || out.includes('\uFFFD') || out === match) return match;
            return out;
        } catch {
            return match;
        }
    });

    return s;
}

/** Adaptable SVG bidirectional arrow for route labels (replaces ↔ emoji / text). */
export function routeArrowSvg(className = 'inline-block w-3.5 h-3.5 mx-0.5 align-[-2px] text-current shrink-0') {
    return `<svg class="${className}" viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M5 6h14M8 3L5 6l3 3M16 3l3 3-3 3" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Plain-text route label for titles / a11y (uses ↔). */
export function formatRouteLabelPlain(raw) {
    if (typeof raw !== 'string' || !raw) return 'Select a route';
    return raw.replace(/\s*<->\s*/g, ' ↔ ').replace(/\s*↔\s*/g, ' ↔ ').trim();
}

/** HTML route label with SVG arrow between corridor ends. */
export function formatRouteLabelHtml(raw) {
    if (typeof raw !== 'string' || !raw) return escapeHTML('Select a route');
    const parts = raw.split(/\s*<->\s*|\s*↔\s*/);
    if (parts.length < 2) return escapeHTML(raw.trim());
    return parts.map((p) => escapeHTML(p.trim())).filter(Boolean).join(routeArrowSvg());
}

/** True for timetable clock cells (rejects notes like "Monte", dashes, blanks). */
export function isRealTime(val) {
    if (val == null) return false;
    const s = String(val).trim();
    if (!s || s === '-' || s === '—' || s === '–') return false;
    return /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
}

export function formatTimeDisplay(timeStr) {
    if (!isRealTime(timeStr)) return "--:--";
    const s = String(timeStr).trim();
    const parts = s.split(':');
    return `${parts[0]}:${parts[1]}`;
}

/**
 * Shared-corridor pill label: "Cape Town <-> Retreat (Cape Flats)" → "Retreat".
 * Strips parenthetical line suffixes so the time box stays short.
 */
export function shortSharedSourceLabel(sourceRoute) {
    let rawName = String(sourceRoute || '').replace(/\bRoute\b/gi, '').trim();
    let routeName = rawName;
    if (rawName.includes('<->')) routeName = rawName.split('<->')[1].trim();
    else if (rawName.includes('•')) routeName = rawName.split('•')[1].trim();
    else if (rawName.includes('↔')) routeName = rawName.split('↔')[1].trim();
    routeName = routeName.replace(/\s*\([^)]*\)\s*$/g, '').trim();
    return routeName || rawName;
}

export function normalizeStationName(name) {
    if (!name) return "";
    return String(name)
        .toUpperCase()
        .replace(/ STATION/g, '')  
        .replace(/-/g, ' ')        
        .replace(/\s+/g, ' ')      
        .trim();
}

export function timeToSeconds(timeStr) {
    try {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(Number);
        const h = parts[0] || 0; const m = parts[1] || 0; const s = parts[2] || 0;
        return (h * 3600) + (m * 60) + s;
    } catch (e) { return 0; }
}

// --- GEOSPATIAL HELPERS ---

export function deg2rad(deg) { 
    return deg * (Math.PI/180); 
}

export function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c; 
}

// --- GUARDIAN PHASE 1 & 2: RESILIENT STORAGE WRAPPER ---
// Protects against SecurityError (Safari Private Mode) AND Apple ITP 7-Day Purge via IndexedDB Mirroring
// 🛡️ GUARDIAN QUOTA CLEANSER: Nuke legacy 5MB databases from LocalStorage to ensure safeStorage can breathe.

if (typeof window !== 'undefined') {
    try {
        ['GP', 'WC', 'KZN', 'EC'].forEach(region => {
            localStorage.removeItem(`full_db_${region}`);
        });
    } catch(e) {}
}

export const safeStorage = {
    memoryFallback: {},
    
    // Standard Synchronous Get (For UI state, preferences, etc.)
    getItem: function(key) {
        if (typeof window === 'undefined') return this.memoryFallback[key] || null;
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.warn(`🛡️ Guardian: localStorage.getItem blocked. Using RAM fallback for ${key}.`);
            return this.memoryFallback[key] || null;
        }
    },
    
    // Standard Synchronous Set
    setItem: function(key, value) {
        if (typeof window === 'undefined') {
            this.memoryFallback[key] = value;
            return;
        }
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.warn(`🛡️ Guardian: localStorage.setItem blocked (Quota/Privacy). Using RAM fallback for ${key}.`);
            this.memoryFallback[key] = value;
        }
    },
    
    removeItem: function(key) {
        if (typeof window === 'undefined') {
            delete this.memoryFallback[key];
            return;
        }
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn(`🛡️ Guardian: localStorage.removeItem blocked. Using RAM fallback for ${key}.`);
            delete this.memoryFallback[key];
        }
    },

    // GUARDIAN PHASE 2 (Identity Protection): Safe Volatile Flush
    // Mass-deletes localStorage to clear zombie cache items, while surgically extracting, 
    // protecting, and restoring core identity/preference keys.
    flushVolatile: function() {
        if (typeof window === 'undefined') return;
        
        const exactProtectedKeys = [
            'next_train_device_id',
            'userProfile',
            'theme',
            'hapticsEnabled',
            'userRegion',
            'navStyle',
            'colourPack',
            'welcomeSeen',
            'authUid',
            'analytics_ignore',
            'defaultRoute_GP',
            'defaultRoute_WC',
            'defaultRoute_KZN', // 🛡️ GUARDIAN FIX: Protect KZN
            'defaultRoute_EC',  // 🛡️ GUARDIAN FIX: Protect EC
            'last_killswitch_timestamp', // Protect killswitch memory
            'analytics_queue', // Protect offline events queue
            'nt_trip_plan_queue_v1', // Protect batched trip-plan telemetry until flush
            'last_impression_timestamp' // 🛡️ GUARDIAN FIX: Protect ad frequency cap
        ];
        
        const vault = {};
        
        // 1. Extract to RAM Vault (With Ad Network Wildcard Support)
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (
                    exactProtectedKeys.includes(key) ||
                    key.startsWith('clever_') ||
                    key.startsWith('cws_') ||
                    key.startsWith('firebase:authUser:') ||
                    key.startsWith('plannerHistory_') ||
                    key.startsWith('seen_holiday_')
                ) {
                    vault[key] = localStorage.getItem(key);
                }
            }
        } catch(e) {
            // Fallback if localStorage iteration is blocked
            exactProtectedKeys.forEach(key => {
                const val = this.getItem(key);
                if (val !== null) vault[key] = val;
            });
            // Also preserve regional planner history in the fallback path
            ['GP', 'WC', 'KZN', 'EC'].forEach((region) => {
                const hk = `plannerHistory_${region}`;
                const val = this.getItem(hk);
                if (val !== null) vault[hk] = val;
            });
        }
        
        // 2. Nuke Local Storage Completely
        try {
            localStorage.clear();
        } catch(e) {
            console.warn("🛡️ Guardian: localStorage.clear blocked.");
        }
        this.memoryFallback = {};
        
        // 3. Resurrect from Vault
        Object.keys(vault).forEach(key => {
            this.setItem(key, vault[key]);
        });
        
        console.log("🛡️ Guardian: Volatile cache flushed. Identity & preferences secured and restored.");
    },

    // --- ITP RESILIENCE (IndexedDB Mirroring) ---
    _idbInstance: null,
    _idbOpenPromise: null,
    _mirroredKeys: new Set(),

    _initIDB: function() {
        if (this._idbInstance) return Promise.resolve(this._idbInstance);
        if (this._idbOpenPromise) return this._idbOpenPromise; // Dedup concurrent callers

        this._idbOpenPromise = new Promise((resolve, reject) => {
            if (typeof window === 'undefined' || !window.indexedDB) {
                reject(new Error("IndexedDB not supported or running on server"));
                return;
            }
            try {
                const request = indexedDB.open('GuardianIdentityDB', 1);
                request.onerror = (e) => reject(e.target.error || new Error("IDB Open Error"));
                request.onsuccess = (e) => {
                    this._idbInstance = e.target.result;
                    resolve(this._idbInstance);
                };
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('IdentityStore')) {
                        db.createObjectStore('IdentityStore');
                    }
                };
            } catch(err) {
                reject(err);
            }
        });
        return this._idbOpenPromise;
    },

    // Asynchronously fetches from localStorage. If missing (purged), resurrects from IndexedDB.
    getResilientItem: async function(key) {
        // Fast path: Check synchronous storage first
        let val = this.getItem(key);
        if (val) {
            // Background sync to ensure IDB is up-to-date (Only once per session to prevent IO storm)
            if (!this._mirroredKeys.has(key)) {
                this._mirroredKeys.add(key);
                this.setResilientItem(key, val);
            }
            return val;
        }

        // Slow path: Resurrect from IndexedDB
        try {
            const db = await this._initIDB();
            return new Promise((resolve) => {
                const tx = db.transaction('IdentityStore', 'readonly');
                const request = tx.objectStore('IdentityStore').get(key);
                request.onsuccess = () => {
                    if (request.result && request.result.value) {
                        console.log(`🛡️ Guardian: Resurrected ${key} from IndexedDB after ITP purge.`);
                        // Restore it to fast synchronous storage for the rest of the session
                        this.setItem(key, request.result.value);
                        resolve(request.result.value);
                    } else {
                        resolve(null);
                    }
                };
                request.onerror = () => resolve(null); // Fail gracefully
            });
        } catch (e) {
            console.warn("🛡️ Guardian: IDB read failed.", e);
            return null;
        }
    },

    // Synchronously saves to localStorage, then asynchronously mirrors to IndexedDB
    setResilientItem: async function(key, value) {
        this.setItem(key, value); // Instant UI availability
        try {
            const db = await this._initIDB();
            return new Promise((resolve) => {
                const tx = db.transaction('IdentityStore', 'readwrite');
                tx.objectStore('IdentityStore').put({ value: value, timestamp: Date.now() }, key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch (e) {
            console.warn("🛡️ Guardian: IDB mirror write failed.", e);
            return false;
        }
    }
};

// 🛡️ GUARDIAN PHASE 2: Identity ITP Protection Bootstrapper
// The UUID is generated synchronously in index.html to ensure GA4 fires immediately.
// We run a deferred sweep here to mirror it into IndexedDB, permanently shielding it from Apple's 7-Day ITP wipe.
export const _mirrorDeviceId = () => {
    if (typeof window === 'undefined') return;
    const currentId = safeStorage.getItem('next_train_device_id');
    if (currentId) {
        safeStorage.setResilientItem('next_train_device_id', currentId);
    }
};

if (typeof window !== 'undefined') {
    setTimeout(_mirrorDeviceId, 2000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            _mirrorDeviceId();
        }
    }, { once: true });
}