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

export function formatTimeDisplay(timeStr) {
    if (!timeStr) return "--:--";
    const s = String(timeStr);
    const parts = s.split(':');
    if (parts.length >= 2) {
        return `${parts[0]}:${parts[1]}`;
    }
    return s;
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
            'last_impression_timestamp' // 🛡️ GUARDIAN FIX: Protect ad frequency cap
        ];
        
        const vault = {};
        
        // 1. Extract to RAM Vault (With Ad Network Wildcard Support)
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (exactProtectedKeys.includes(key) || key.startsWith('clever_') || key.startsWith('cws_') || key.startsWith('firebase:authUser:')) {
                    vault[key] = localStorage.getItem(key);
                }
            }
        } catch(e) {
            // Fallback if localStorage iteration is blocked
            exactProtectedKeys.forEach(key => {
                const val = this.getItem(key);
                if (val !== null) vault[key] = val;
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