// --- CONFIGURATION & CONSTANTS ---

// 0. Version Control
/** In-app / badge version — keep in sync with CHANGELOG_DATA[0].id, package.json, and public/app-version.json. */
export const APP_VERSION = "V8_08.02";

/** Always ends with `/` (except we normalize bare empty to `/`). Fixes `/next-train-astromanifest` joins. */
export function normalizeBase(base) {
    const raw = String(base == null || base === '' ? '/' : base).trim();
    if (raw === '/') return '/';
    return raw.endsWith('/') ? raw : `${raw}/`;
}

/** App base path (e.g. `/next-train-astro/` on GitHub Pages, `/` locally / custom domain). */
export const APP_BASE = normalizeBase(
    (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
);

/**
 * Web app manifest filename. Matches the live SPA's `/manifest.json` so cached
 * shells and bookmarks keep resolving after the cutover. Must stay in sync with
 * `manifestFilename` in astro.config.mjs — verify-url-parity.mjs asserts this.
 */
export const MANIFEST_FILENAME = 'manifest.json';

/** Prefix a root-absolute path with the Astro `base` (public assets, in-app navigations). */
export function withBase(path = '/') {
    const base = normalizeBase(APP_BASE);
    const p = String(path || '/').replace(/^\//, '');
    if (!p) return base;
    return `${base}${p}`;
}

// GUARDIAN: Set to 'true' to force an immediate hard reload on startup. 
// Set to 'false' for silent background updates (Stale-While-Revalidate).
// V6.00.10: Set to false to prevent infinite reload loops if SW caching fails.
export const FORCE_UPDATE_REQUIRED = true;

// --- 🛡️ GUARDIAN PHASE 5: WATERFALL DATA PIPELINE. ---
// The Data Pipeline Router automatically falls back to backups if the primary endpoint fails.

export const PIPELINE_SOURCES = {
    'CLOUDFLARE': {
        url: "https://nexttrain-cache.enock.workers.dev/",
        useRootNode: false
    },
    'GITHUB': {
        url: "https://cdn.jsdelivr.net/gh/enock-elk/metrorail-app@main/data/",
        useRootNode: true // GitHub serves the unified export payload directly
    },
    'FIREBASE': {
        url: "https://metrorail-next-train-default-rtdb.firebaseio.com/",
        useRootNode: false
    }
};

// The preferred initial source (can be overridden remotely by Admin in logic.js)
export let PRIMARY_DATA_SOURCE = 'CLOUDFLARE';

// Legacy Reference (Safeguard until logic.js Waterfall is fully injected)
export let SCHEDULE_BASE_URL = PIPELINE_SOURCES[PRIMARY_DATA_SOURCE].url;

// Firebase fallback baseline
export const FIREBASE_BASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/";

// Dynamic Data (Admin Bans, Alerts, Maintenance) ALWAYS uses Firebase for real-time capability.
export const DYNAMIC_BASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/";

export const REGIONS = {
    'GP': { 
        dbNode: 'schedules/gauteng.json', 
        rootNode: 'full-database.json',
        name: 'Gauteng' 
    },
    'WC': { 
        dbNode: 'schedules/westerncape.json', 
        rootNode: 'full-database.json',
        name: 'Western Cape' 
    },
    'KZN': { 
        dbNode: 'schedules/kzn.json', 
        rootNode: 'full-database.json',
        name: 'KwaZulu-Natal' 
    },
    'EC': { 
        dbNode: 'schedules/easterncape.json', 
        rootNode: 'full-database.json',
        name: 'Eastern Cape' 
    }
};
export const MAX_RADIUS_KM = 6;

// SA public holidays → schedule day-type overrides (ported from SPA logic.js)
export const SPECIAL_DATES = {
    // 2026
    "01-01": "saturday", // New Year's Day
    "03-21": "saturday", // Human Rights Day
    "04-03": "saturday", // Good Friday
    "04-06": "saturday", // Family Day
    "04-27": "saturday", // Freedom Day
    "05-01": "saturday", // Workers' Day
    "06-16": "saturday", // Youth Day
    "08-09": "sunday",   // National Women's Day
    "08-10": "saturday", // Women's Day Observed
    "09-24": "saturday", // Heritage Day
    "12-16": "saturday", // Day of Reconciliation
    "12-25": "sunday",   // Christmas Day
    "12-26": "sunday"    // Day of Goodwill
};

export const HOLIDAY_NAMES = {
    "01-01": "New Year's Day",
    "03-21": "Human Rights Day",
    "04-03": "Good Friday",
    "04-06": "Family Day",
    "04-27": "Freedom Day",
    "05-01": "Workers' Day",
    "06-16": "Youth Day",
    "08-09": "National Women's Day",
    "08-10": "Women's Day Observed",
    "09-24": "Heritage Day",
    "12-16": "Day of Reconciliation",
    "12-25": "Christmas Day",
    "12-26": "Day of Goodwill"
};

// 1. Legal Text Definitions
export const LEGAL_TEXTS = {
    terms: `
        <h4 class="font-bold text-lg mb-2">1. Independent Service &amp; Disclaimer</h4>
        <p class="mb-3"><strong>Next Train</strong> is an independent, crowdsourced digital tool developed by Kazembe CodeWorks. We are <strong>not affiliated with, endorsed by, or directly associated with PRASA, Metrorail, or any government entity</strong>.</p>

        <h4 class="font-bold text-lg mb-2 mt-4">2. Schedule Accuracy &amp; Liability</h4>
        <p class="mb-3">Transit schedules, fares, and routing information presented in this app are aggregated estimations based on official timetables and commuter crowdsourcing. Because train schedules are subject to sudden delays and infrastructure changes, we do not guarantee absolute real-time accuracy. Kazembe CodeWorks cannot be held liable for any missed trains, financial losses, disciplinary actions at work, or personal damages arising from the use of this app.</p>

        <h4 class="font-bold text-lg mb-2 mt-4">3. Acceptable Use</h4>
        <p class="mb-3">Next Train is built for personal, non-commercial transit planning. Automated data scraping, reverse-engineering of our databases, or malicious interference with our cloud infrastructure is strictly prohibited.</p>
    `,
    privacy: `
        <h4 class="font-bold text-lg mb-2">1. What Information Do We Collect?</h4>
        <p class="mb-3">We respect your privacy. Next Train is designed to be used without creating an account.</p>
        <p class="mb-3"><strong>Location Data:</strong> If you use the “Find Nearest Station” feature, your GPS coordinates are processed strictly locally on your device. We never transmit, track, or store your physical location on our servers.</p>
        <p class="mb-3"><strong>Anonymous Telemetry:</strong> To keep the app fast and crash-free, we automatically collect basic diagnostic data (e.g., device model, operating system, generic region, and crash logs).</p>
        <p class="mb-3"><strong>Voluntary Information:</strong> If you use the In-App Feedback tool, you may optionally provide your email or WhatsApp number. This is used only to reply to your specific query and is never used for marketing.</p>

        <h4 class="font-bold text-lg mb-2 mt-4">2. Third-Party Tracking &amp; Cookies</h4>
        <p class="mb-3">To understand how commuters use the app and to keep the servers running, we integrate with industry-standard third-party services:</p>
        <p class="mb-3"><strong>Analytics:</strong> We use Google Analytics 4 and Microsoft Clarity to track generic usage patterns (e.g., which routes are most popular) and identify UX roadblocks. All data is highly anonymized.</p>
        <p class="mb-3"><strong>Advertising:</strong> We use third-party ad networks to help cover server costs. These networks may use cookies to serve relevant ads. (Note: We will soon be introducing a cookie consent banner to give you full control over this).</p>
        <p class="mb-3"><strong>Infrastructure:</strong> Our schedules and live alerts are distributed via secure, globally recognized cloud infrastructure providers.</p>

        <h4 class="font-bold text-lg mb-2 mt-4">3. Your POPIA Rights (South Africa)</h4>
        <p class="mb-3">Under the Protection of Personal Information Act (POPIA), you have the right to request access to, correction of, or deletion of any personal data you have voluntarily provided to us (such as feedback emails). To exercise these rights, or if you have any privacy concerns, please contact our Admin Team at <a href="mailto:admin@nexttrain.co.za" class="text-blue-600 dark:text-blue-400 underline font-semibold">admin@nexttrain.co.za</a>.</p>
    `
};

// 3. Route Definitions
export const ROUTES = {
    // ==========================================
    // 🛡️ GAUTENG ROUTES (AUTHENTIC LEGACY CONFIG)
    // ==========================================
    'special_event': { 
        id: 'special_event', 
        name: "Special Event Route", 
        corridorId: "SPECIAL",
        region: "GP",
        colorClass: "text-yellow-500", 
        isActive: false, 
        destA: 'EVENT A STATION', 
        destB: 'EVENT B STATION', 
        transferStation: null, 
        relayStation: null,
        sheetKeys: { weekday_to_a: 'event_to_a_weekday', weekday_to_b: 'event_to_b_weekday', saturday_to_a: 'event_to_a_sat', saturday_to_b: 'event_to_b_sat' } 
    },
    'pta-pien': { 
        id: 'pta-pien', 
        name: "Pretoria <-> Pienaarspoort", 
        corridorId: "EAST_LINE",
        region: "GP",
        colorClass: "text-green-500", 
        isActive: true, 
        destA: 'PRETORIA STATION', 
        destB: 'PIENAARSPOORT STATION', 
        transferStation: 'KOEDOESPOORT STATION', 
        relayStation: 'KOEDOESPOORT STATION', 
        sheetKeys: { weekday_to_a: 'pien_to_pta_weekday', weekday_to_b: 'pta_to_pien_weekday', saturday_to_a: 'pien_to_pta_sat', saturday_to_b: 'pta_to_pien_sat' } 
    },
    'pta-mabopane': { 
        id: 'pta-mabopane', 
        name: "Pretoria <-> Mabopane", 
        corridorId: "NORTH_LINE", 
        region: "GP",
        colorClass: "text-orange-500", 
        isActive: true, 
        destA: 'PRETORIA STATION', 
        destB: 'MABOPANE STATION', 
        transferStation: null, 
        sheetKeys: { weekday_to_a: 'mab_to_pta_weekday', weekday_to_b: 'pta_to_mab_weekday', saturday_to_a: 'mab_to_pta_sat', saturday_to_b: 'pta_to_mab_sat' } 
    },
    'mab-belle': { 
        id: 'mab-belle', 
        name: "Mabopane <-> Belle Ombre", 
        corridorId: "NORTH_LINE",
        region: "GP",
        colorClass: "text-orange-500", 
        isActive: true, 
        destA: 'MABOPANE STATION', 
        destB: 'BELLE OMBRE STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'belle_to_mab_weekday', 
            weekday_to_b: 'mab_to_belle_weekday', 
            saturday_to_a: 'belle_to_mab_sat', 
            saturday_to_b: 'mab_to_belle_sat' 
        } 
    },
    'pta-dewildt': { 
        id: 'pta-dewildt', 
        name: "Pretoria <-> De Wildt", 
        corridorId: "NORTH_LINE", 
        region: "GP",
        colorClass: "text-purple-500", 
        isActive: true, 
        destA: 'PRETORIA STATION', 
        destB: 'DE WILDT STATION', 
        transferStation: null, 
        relayStation: null, 
        sheetKeys: { 
            weekday_to_a: 'dewil_to_pta_weekday', 
            weekday_to_b: 'pta_to_dewil_weekday',
            saturday_to_a: 'dewil_to_pta_sat', 
            saturday_to_b: 'pta_to_dewil_sat'
        } 
    },
    'herc-koed': { 
        id: 'herc-koed', 
        name: "Hercules <-> Koedoespoort", 
        corridorId: "NORTH_LINE", 
        region: "GP",
        colorClass: "text-indigo-500", 
        isActive: true, 
        destA: 'HERCULES STATION', 
        destB: 'KOEDOESPOORT STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'koed_to_herc_weekday', 
            weekday_to_b: 'herc_to_koed_weekday',
            saturday_to_a: 'koed_to_herc_sat', 
            saturday_to_b: 'herc_to_koed_sat'
        } 
    },
    'pta-saul': { 
        id: 'pta-saul', 
        name: "Pretoria <-> Saulsville", 
        corridorId: "SAUL_LINE", 
        region: "GP",
        colorClass: "text-green-500", 
        isActive: true, 
        destA: 'PRETORIA STATION', 
        destB: 'SAULSVILLE STATION', 
        transferStation: null, 
        sheetKeys: {
            weekday_to_a: 'saul_to_pta_weekday', 
            weekday_to_b: 'pta_to_saul_weekday',
            saturday_to_a: 'saul_to_pta_sat', 
            saturday_to_b: 'pta_to_saul_sat'
        } 
    },
    'germ-leralla': { 
        id: 'germ-leralla', 
        name: "Germiston <-> Leralla", 
        corridorId: "JHB_EAST",
        region: "GP",
        colorClass: "text-blue-500", 
        isActive: true, 
        destA: 'GERMISTON STATION', 
        destB: 'LERALLA STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'lerl_to_germ_weekday', 
            weekday_to_b: 'germ_to_lerl_weekday', 
            saturday_to_a: 'lerl_to_germ_sat', 
            saturday_to_b: 'germ_to_lerl_sat' 
        } 
    },
    'germ-kwesine': { 
        id: 'germ-kwesine', 
        name: "Germiston <-> Kwesine", 
        corridorId: "JHB_EAST",
        region: "GP",
        colorClass: "text-yellow-500", 
        isActive: true, 
        destA: 'GERMISTON STATION', 
        destB: 'KWESINE STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'kwesi_to_germ_weekday', 
            weekday_to_b: 'germ_to_kwesi_weekday', 
            saturday_to_a: 'kwesi_to_germ_sat', 
            saturday_to_b: 'germ_to_kwesi_sat' 
        } 
    },
    'pta-irene': { 
        id: 'pta-irene', 
        name: "Pretoria <-> Irene", 
        corridorId: "SOUTH_LINE", 
        region: "GP",
        colorClass: "text-blue-500", 
        isActive: true, 
        destA: 'PRETORIA STATION', 
        destB: 'IRENE STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'irene_to_pta_weekday', 
            weekday_to_b: 'pta_to_irene_weekday', 
            saturday_to_a: 'irene_to_pta_sat', 
            saturday_to_b: 'pta_to_irene_sat' 
        } 
    },
    'jhb-germiston': { 
        id: 'jhb-germiston', 
        name: "JHB <-> Germiston", 
        corridorId: "JHB_CORE", 
        region: "GP",
        colorClass: "text-red-500", 
        isActive: true, 
        destA: 'JOHANNESBURG STATION', 
        destB: 'GERMISTON STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'germ_to_jhb_weekday', 
            weekday_to_b: 'jhb_to_germ_weekday',
            saturday_to_a: 'germ_to_jhb_sat', 
            saturday_to_b: 'jhb_to_germ_sat'
        } 
    },
    'pta-kempton': { 
        id: 'pta-kempton', 
        name: "Pretoria <-> Kempton Park", 
        corridorId: "SOUTH_LINE", 
        region: "GP",
        colorClass: "text-blue-500", 
        isActive: true, 
        destA: 'PRETORIA STATION', 
        destB: 'KEMPTON PARK STATION', 
        transferStation: null, 
        sheetKeys: {
            weekday_to_a: 'kemp_to_pta_weekday', 
            weekday_to_b: 'pta_to_kemp_weekday', 
            saturday_to_a: 'kemp_to_pta_sat', 
            saturday_to_b: 'pta_to_kemp_sat'     
        } 
    },
    'jhb-rand': { 
        id: 'jhb-rand', 
        name: "JHB <-> Randfontein", 
        corridorId: "JHB_WEST", 
        region: "GP",
        colorClass: "text-yellow-500", 
        isActive: true, 
        destA: 'JOHANNESBURG STATION', 
        destB: 'RANDFONTEIN STATION', 
        transferStation: 'ROODEPOORT STATION', 
        relayStation: 'ROODEPOORT STATION', 
        sheetKeys: {
            weekday_to_a: 'rand_to_jhb_weekday', 
            weekday_to_b: 'jhb_to_rand_weekday',
            saturday_to_a: 'rand_to_jhb_sat', 
            saturday_to_b: 'jhb_to_rand_sat'
        } 
    },
    'jhb-soweto': { 
        id: 'jhb-soweto', 
        name: "JHB <-> Naledi", 
        corridorId: "JHB_WEST", 
        region: "GP",
        colorClass: "text-yellow-500", 
        isActive: true, 
        destA: 'JOHANNESBURG STATION', 
        destB: 'NALEDI STATION', 
        transferStation: null, 
        sheetKeys: {
            weekday_to_a: 'nald_to_jhb_weekday', 
            weekday_to_b: 'jhb_to_nald_weekday',
            saturday_to_a: 'nald_to_jhb_sat', 
            saturday_to_b: 'jhb_to_nald_sat'
        } 
    },
    'jhb-midway': { 
        id: 'jhb-midway', 
        name: "JHB <-> Midway/Lenz", 
        corridorId: "JHB_SOUTH", 
        region: "GP",
        colorClass: "text-yellow-500", 
        isActive: true, 
        destA: 'JOHANNESBURG STATION', 
        destB: 'LENZ STATION', 
        transferStation: null, 
        sheetKeys: {
            weekday_to_a: 'midwy_to_jhb_weekday', 
            weekday_to_b: 'jhb_to_midwy_weekday',
            saturday_to_a: 'midwy_to_jhb_sat', 
            saturday_to_b: 'jhb_to_midwy_sat'
        } 
    },

    // ==========================================
    // 🛡️ WESTERN CAPE ROUTES (V6 EXPANSION)
    // ==========================================
    'ct-chrishani': { 
        id: 'ct-chrishani', 
        name: 'Cape Town <-> Chris Hani', 
        corridorId: 'WC_CENTRAL', 
        region: 'WC', 
        colorClass: 'text-orange-500', 
        isActive: true, 
        destA: 'CAPE TOWN STATION', 
        destB: 'CHRIS HANI STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'hani_to_ct_weekday', 
            weekday_to_b: 'ct_to_hani_weekday', 
            saturday_to_a: 'hani_to_ct_sat', 
            saturday_to_b: 'ct_to_hani_sat' 
        } 
    },
    'ct-kapteinsklip': { 
        id: 'ct-kapteinsklip', 
        name: 'Cape Town <-> Kapteinsklip', 
        corridorId: 'WC_CENTRAL', 
        region: 'WC', 
        colorClass: 'text-purple-500', 
        isActive: true, 
        destA: 'CAPE TOWN STATION', 
        destB: 'KAPTEINSKLIP STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'kap_to_ct_weekday', 
            weekday_to_b: 'ct_to_kap_weekday', 
            saturday_to_a: 'kap_to_ct_sat', 
            saturday_to_b: 'ct_to_kap_sat' 
        } 
    },
    'ct-nolu': { 
        id: 'ct-nolu', 
        name: 'Cape Town <-> Nolungile', 
        corridorId: 'WC_CENTRAL', 
        region: 'WC', 
        colorClass: 'text-blue-500', 
        isActive: true, 
        destA: 'CAPE TOWN STATION', 
        destB: 'NOLUNGILE STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'nolu_to_ct_weekday', 
            weekday_to_b: 'ct_to_nolu_weekday', 
            saturday_to_a: 'nolu_to_ct_sat', 
            saturday_to_b: 'ct_to_nolu_sat' 
        } 
    },
    'bellville-mutual': { 
        id: 'bellville-mutual', 
        name: 'Bellville <-> Mutual', 
        corridorId: 'WC_NORTHERN', 
        region: 'WC', 
        colorClass: 'text-green-500', 
        isActive: true, 
        destA: 'BELLVILLE STATION', 
        destB: 'MUTUAL STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'mutul_to_bellv_weekday', 
            weekday_to_b: 'bellv_to_mutul_weekday', 
            saturday_to_a: 'mutul_to_bellv_sat', 
            saturday_to_b: 'bellv_to_mutul_sat' 
        } 
    },
    'ct-simon': { 
        id: 'ct-simon', 
        name: "Cape Town <-> Simon's Town", 
        corridorId: 'WC_SOUTHERN', 
        region: 'WC', 
        colorClass: 'text-red-500', 
        isActive: true, // GUARDIAN: Set active due to new data in log
        destA: 'CAPE TOWN STATION', 
        destB: "SIMON'S TOWN STATION", 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'simon_to_ct_weekday', 
            weekday_to_b: 'ct_to_simon_weekday', 
            saturday_to_a: 'simon_to_ct_sat', 
            saturday_to_b: 'ct_to_simon_sat' 
        } 
    },
    'ct-flats': { 
        id: 'ct-flats', 
        name: "Cape Town <-> Retreat (Cape Flats)", 
        corridorId: 'WC_FLATS', 
        region: 'WC', 
        colorClass: 'text-yellow-600', 
        isActive: true, 
        destA: 'CAPE TOWN STATION', 
        destB: "RETREAT STATION", 
        transferStation: null, 
        sheetKeys: { 
            // GUARDIAN FIX: Corrected to match Apps Script sanitized keys exactly
            weekday_to_a: 'rtret_to_ct_weekday', 
            weekday_to_b: 'ct_to_rtret_weekday', 
            saturday_to_a: 'rtret_to_ct_sat', 
            saturday_to_b: 'ct_to_rtret_sat' 
        } 
    },
    'ct-bellv': { 
        id: 'ct-bellv', 
        name: "Cape Town <-> Bellville", 
        corridorId: 'WC_NORTHERN', 
        region: 'WC', 
        colorClass: 'text-green-500', 
        isActive: true, // GUARDIAN: Set active due to new data in log
        destA: 'CAPE TOWN STATION', 
        destB: "BELLVILLE STATION", 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'bellv_to_ct_weekday', 
            weekday_to_b: 'ct_to_bellv_weekday', 
            saturday_to_a: 'bellv_to_ct_sat', 
            saturday_to_b: 'ct_to_bellv_sat' 
        } 
    },
    'ct-kraai': { 
        id: 'ct-kraai', 
        name: "Cape Town <-> Kraaifontein", 
        corridorId: 'WC_NORTHERN', 
        region: 'WC', 
        colorClass: 'text-green-500', 
        isActive: true, // GUARDIAN: Set active due to new data in log
        destA: 'CAPE TOWN STATION', 
        destB: "KRAAIFONTEIN STATION", 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'kraai_to_ct_weekday', 
            weekday_to_b: 'ct_to_kraai_weekday', 
            saturday_to_a: 'kraai_to_ct_sat', 
            saturday_to_b: 'ct_to_kraai_sat' 
        } 
    },
    'ct-eerst': { 
        id: 'ct-eerst', 
        name: "Cape Town <-> Eerste River", 
        corridorId: 'WC_NORTHERN', 
        region: 'WC', 
        colorClass: 'text-green-500', 
        isActive: true, // GUARDIAN: Set active due to new data in log
        destA: 'CAPE TOWN STATION', 
        destB: "EERSTE RIVER STATION", 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'eerst_to_ct_weekday', 
            weekday_to_b: 'ct_to_eerst_weekday', 
            saturday_to_a: 'eerst_to_ct_sat', 
            saturday_to_b: 'ct_to_eerst_sat' 
        } 
    },
    'ct-strnd': { 
        id: 'ct-strnd', 
        name: "Cape Town <-> Strand", 
        corridorId: 'WC_NORTHERN', 
        region: 'WC', 
        colorClass: 'text-green-500', 
        isActive: true, // GUARDIAN: Set active due to new data in log
        destA: 'CAPE TOWN STATION', 
        destB: "STRAND STATION", 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'strnd_to_ct_weekday', 
            weekday_to_b: 'ct_to_strnd_weekday', 
            saturday_to_a: 'strnd_to_ct_sat', 
            saturday_to_b: 'ct_to_strnd_sat' 
        } 
    },
    'eerst-dtoit': { 
        id: 'eerst-dtoit', 
        name: "Eerste River <-> Du Toit", 
        corridorId: 'WC_NORTHERN', 
        region: 'WC', 
        colorClass: 'text-green-500', 
        isActive: true, // GUARDIAN: Set active due to new data in log
        destA: 'EERSTE RIVER STATION', 
        destB: "DU TOIT STATION", 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'dtoit_to_eerst_weekday', 
            weekday_to_b: 'eerst_to_dtoit_weekday', 
            saturday_to_a: 'dtoit_to_eerst_sat', 
            saturday_to_b: 'eerst_to_dtoit_sat' 
        } 
    },
    'ct-well': { 
        id: 'ct-well', 
        name: "Cape Town <-> Wellington", 
        corridorId: 'WC_NORTHERN', 
        region: 'WC', 
        colorClass: 'text-green-500', 
        isActive: true, // GUARDIAN: Set active due to new data in log
        destA: 'CAPE TOWN STATION', 
        destB: "WELLINGTON STATION", 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'well_to_ct_weekday', 
            weekday_to_b: 'ct_to_well_weekday', 
            saturday_to_a: 'well_to_ct_sat', 
            saturday_to_b: 'ct_to_well_sat' 
        } 
    },
    'ct-malm': { 
        id: 'ct-malm', 
        name: "Cape Town <-> Malmesbury", 
        corridorId: 'WC_REGIONAL', 
        region: 'WC', 
        colorClass: 'text-lime-500', // GUARDIAN: Preserved the lime-500 color correction
        isActive: true, 
        destA: 'CAPE TOWN STATION', 
        destB: "MALMESBURY STATION", 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'malm_to_ct_weekday', 
            weekday_to_b: 'ct_to_malm_weekday', 
            saturday_to_a: 'malm_to_ct_sat', 
            saturday_to_b: 'ct_to_malm_sat' 
        } 
    },

    // ==========================================
    // 🛡️ KWAZULU-NATAL ROUTES (V6 EXPANSION)
    // ==========================================
    'kzn-umlazi': { 
        id: 'kzn-umlazi', 
        name: 'Durban <-> Umlazi', 
        corridorId: 'KZN_SOUTH', 
        region: 'KZN', 
        colorClass: 'text-red-500', 
        isActive: true, 
        destA: 'DURBAN YARD STATION', 
        destB: 'UMLAZI STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'umlaz_to_durbn_weekday', 
            weekday_to_b: 'durbn_to_umlaz_weekday', 
            saturday_to_a: 'umlaz_to_durbn_sat', 
            saturday_to_b: 'durbn_to_umlaz_sat' 
        } 
    },
    'kzn-bridgecity': { 
        id: 'kzn-bridgecity', 
        name: 'Berea Road <-> Bridge City', 
        corridorId: 'KZN_NORTH', 
        region: 'KZN', 
        colorClass: 'text-red-500', 
        isActive: true, 
        destA: 'BEREA ROAD STATION', 
        destB: 'BRIDGE CITY STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'bridg_to_durbn_weekday', 
            weekday_to_b: 'durbn_to_bridg_weekday', 
            saturday_to_a: 'bridg_to_durbn_sat', 
            saturday_to_b: 'durbn_to_bridg_sat' 
        } 
    },
    'kzn-winklespruit': { 
        id: 'kzn-winklespruit', 
        name: 'Durban <-> Winklespruit', 
        corridorId: 'KZN_SOUTH', 
        region: 'KZN', 
        colorClass: 'text-blue-500', 
        isActive: true, 
        destA: 'DURBAN YARD STATION', 
        destB: 'WINKLESPRUIT STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'winkl_to_durbn_weekday', 
            weekday_to_b: 'durbn_to_winkl_weekday', 
            saturday_to_a: 'winkl_to_durbn_sat', 
            saturday_to_b: 'durbn_to_winkl_sat' 
        } 
    },
    'kzn-catoridge': { 
        id: 'kzn-catoridge', 
        name: 'Durban <-> Cato Ridge', 
        corridorId: 'KZN_WEST', 
        region: 'KZN', 
        colorClass: 'text-indigo-500', 
        isActive: true, 
        destA: 'DURBAN YARD STATION', 
        destB: 'CATO RIDGE STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'cator_to_durbn_weekday', 
            weekday_to_b: 'durbn_to_cator_weekday', 
            saturday_to_a: 'cator_to_durbn_sat', 
            saturday_to_b: 'durbn_to_cator_sat' 
        } 
    },
    'kzn-pinetown': { 
        id: 'kzn-pinetown', 
        name: 'Durban <-> Pinetown', 
        corridorId: 'KZN_WEST', 
        region: 'KZN', 
        colorClass: 'text-orange-500', 
        isActive: true, 
        destA: 'DURBAN YARD STATION', 
        destB: 'PINETOWN STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'pinet_to_durbn_weekday', 
            weekday_to_b: 'durbn_to_pinet_weekday', 
            saturday_to_a: 'pinet_to_durbn_sat', 
            saturday_to_b: 'durbn_to_pinet_sat' 
        } 
    },

    // ==========================================
    // 🛡️ EASTERN CAPE ROUTES (V6 EXPANSION)
    // ==========================================
    'ec-berlin': { 
        id: 'ec-berlin', 
        name: 'East London <-> Berlin', 
        corridorId: 'EC_CENTRAL', 
        region: 'EC', 
        colorClass: 'text-red-500', 
        isActive: true, 
        destA: 'EAST LONDON STATION', 
        destB: 'BERLIN STATION', 
        transferStation: null, 
        sheetKeys: { 
            weekday_to_a: 'berln_to_eastl_weekday', 
            weekday_to_b: 'eastl_to_berln_weekday', 
            saturday_to_a: 'berln_to_eastl_sat', 
            saturday_to_b: 'eastl_to_berln_sat' 
        } 
    }
};

// 4. Refresh Settings
export const REFRESH_CONFIG = { standardInterval: 5 * 60 * 1000, activeInterval: 60 * 1000, nightModeStart: 21, nightModeEnd: 4 };

// 5. Smart Pricing Configuration (RESTORED TO AUTHENTIC V5 LOGIC)
export const FARE_CONFIG = {
    offPeakStart: 9.5,  // 09:30
    offPeakEnd: 14.5,   // 14:30
    
    // Legacy support for logic.js (keeps existing code working)
    zones: {
        "Z1": 10.00,
        "Z2": 12.00,
        "Z3": 14.00,
        "Z4": 15.00
    },

    // NEW V4.60.42: Detailed Pricing Table
    zones_detailed: {
        "Z1": { single: 10.00, return: 20.00, weekly_mon_fri: 60.00, weekly_mon_sat: 75.00, monthly: 180.00 },
        "Z2": { single: 12.00, return: 24.00, weekly_mon_fri: 70.00, weekly_mon_sat: 80.00, monthly: 220.00 },
        "Z3": { single: 14.00, return: 28.00, weekly_mon_fri: 80.00, weekly_mon_sat: 100.00, monthly: 250.00 },
        "Z4": { single: 15.00, return: 30.00, weekly_mon_fri: 90.00, weekly_mon_sat: 120.00, monthly: 280.00 }
    },

    profiles: {
        "Adult":     { base: 1.0, offPeak: 0.6 }, // 40% Discount
        "Scholar":   { base: 0.5, offPeak: 0.5 }, // Flat 50%
        "Pensioner": { base: 1.0, offPeak: 0.5 }, // 50% Off-Peak Discount
        "Military":  { base: 1.0, offPeak: 0.5 }  // 50% Off-Peak Discount
    }
};

// 6. GHOST TRAIN PROTOCOL (Default Exclusions)
// Fallback rules if Firebase is unreachable.
// Day Index: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
export const DEFAULT_EXCLUSIONS = {
    'pta-kempton': {
        // Runs Tue, Wed, Thu only. Exclude Mon (1) and Fri (5).
        "0618": { days: [1, 5], reason: "Runs Tue-Thu Only" },
        "0619": { days: [1, 5], reason: "Runs Tue-Thu Only" }
    }
};

// 7. CHANGELOG — drives the in-app "What's New" modal (keep short: 3–5 bullets).
// Longer release notes live in /CHANGELOG.md. Badge / seen key use `id` (=== APP_VERSION for latest).
export const CHANGELOG_DATA = [
    {
        id: "V8_08.02",
        title: "Weekend Clarity Edition",
        date: "02 Aug 2026",
        forceShow: false,
        features: [
            "<b>No Weekend Service:</b> Routes without Saturday timetables (e.g. Hercules/Koedoespoort, Eastern Cape) show stations with a clear notice, plus the next weekday train on the live board.",
            "<b>Sunday No Service:</b> The day chip highlights “No Service” in red so Sundays and no-service holidays are obvious at a glance.",
            "<b>You're Here:</b> Terminus stops use a location pin instead of plain “You are at this station” text.",
            "<b>Clearer Holiday Guide:</b> FAQ updated: public holidays are not always Saturday schedules, and some routes have no weekend service at all."
        ]
    },
    {
        id: "V7_07.28",
        title: "Performance Polish Edition",
        date: "28 Jul 2026",
        forceShow: false,
        features: [
            "<b>Smoother App Navigation:</b> Fine-tuned rapid taps and screen transitions for a faster, more responsive feel.",
            "<b>Smarter Connectivity Checks:</b> Better detection when the network struggles, with safer fallback to saved offline schedules.",
            "<b>Cleaner Visuals:</b> Tighter route cards and a simpler timeline view for easier trip reading.",
            "<b>Background Improvements:</b> Leaner data engine for less battery use and more reliable schedule updates."
        ]
    },
    {
        id: "V7_07.11",
        title: "Performance & Precision Polish",
        date: "11 Jul 2026",
        forceShow: false,
        features: [
            "<b>Smarter Incident Warnings:</b> Safe journeys near a disruption no longer flash a false “Line Severed” warning; alerts only when your train crosses the danger zone.",
            "<b>Seamless Navigation:</b> “See Next Available Day” on empty late-night/Sunday boards syncs the day dropdown correctly.",
            "<b>Sleeker Interface:</b> Trip Planner result cards cleaned up with fewer glitches and misaligned borders."
        ]
    },
    {
        id: "V7_06.29",
        title: "Trip Planner Polish",
        date: "29 Jun 2026",
        forceShow: false,
        features: [
            "<b>Sleeker Timeline:</b> Tighter Trip Planner timeline for more screen space and clearer transfers.",
            "<b>Clearer Disruptions:</b> Line-severance alerts break out of the timeline to show exactly where a train terminates.",
            "<b>Official Rebranding:</b> Rebranded to <b>Next Train</b> for legal clarity as an unaffiliated commuter tool."
        ]
    },
    {
        id: "V7_06.24",
        title: "The Corporate Glass Update",
        date: "24 Jun 2026",
        forceShow: false,
        features: [
            "<b>Sleeker Design:</b> Modern icons and cleaner timeline layouts in place of cluttered emoji chrome.",
            "<b>Smarter Route Status:</b> Impossible connections explain why (incidents or extreme timetable gaps) with quick links.",
            "<b>Layover Warnings:</b> Unusually long transfer waits are flagged so you are not stranded.",
            "<b>Smoother Experience:</b> Fixed mobile text clipping and improved station-select prompts."
        ]
    },
    {
        id: "V7_06.17",
        title: "The Precision Update",
        date: "17 Jun 2026",
        forceShow: false,
        features: [
            "<b>Smarter Trip Planner:</b> Finds overnight and extended weekend connections that were previously hidden.",
            "<b>Clearer Journey Timelines:</b> Unified colours and fixed text cut-off on smaller phones.",
            "<b>Accurate Route Status:</b> Explains why a trip is impossible today (incident, gaps, or disconnected lines)."
        ]
    },
    {
        id: "V7_05.31",
        title: "Performance Polish",
        date: "31 May 2026",
        forceShow: false,
        features: [
            "<b>Instant Loading:</b> Welcome screen no longer freezes on “Loading Route”.",
            "<b>Cleaner Interface:</b> Tighter menus, better small-screen text, ads no longer leak onto welcome.",
            "<b>Data Reliability:</b> Stronger background sync on patchy networks."
        ]
    },
    {
        id: "V7_05.16",
        title: "Western Cape Expansion",
        date: "16 May 2026",
        forceShow: false,
        features: [
            "<b>Cape Town is Complete:</b> Six new routes covering Central and Northern Line networks.",
            "<b>Cinematic UI:</b> Dropdowns dim the background for a cleaner native feel."
        ]
    },
    {
        id: "V7_05.12",
        title: "KZN & EC Launch",
        date: "12 May 2026",
        forceShow: false,
        features: [
            "<b>National Expansion:</b> Now live in KwaZulu-Natal and the Eastern Cape.",
            "<b>Cross-Region Support:</b> Switch provinces from the main menu."
        ]
    },
    {
        id: "V6_05.01",
        title: "Growth Edition",
        date: "1 May 2026",
        forceShow: false,
        features: [
            "<b>Server Support Ads:</b> Small, non-intrusive ads help keep the app free.",
            "<b>UI Polish:</b> Smarter timetable scrolling and clearer delayed/severed routes."
        ]
    },
    {
        id: "V6_04.26",
        title: "Guardian Edition",
        date: "26 Apr 2026",
        forceShow: false,
        features: [
            "<b>Smart Weekend & Holiday Routing:</b> Planner skips to the next working train on Sundays/holidays.",
            "<b>Clearer Disruption Alerts:</b> “Line Severed” blocks show where the train terminates.",
            "<b>Sleeker Look & Feel:</b> Better time menus and less text clipping."
        ]
    },
    {
        id: "V6_00",
        title: "Western Cape Launch",
        date: "Apr 2026",
        forceShow: false,
        features: [
            "<b>Cape Town is Here:</b> Full Western Cape schedules and offline trip planning.",
            "<b>All-New App Menu:</b> Settings, sync, and region in one side menu.",
            "<b>Better Navigation:</b> Back closes popups instead of exiting the app."
        ]
    },
    {
        id: "V5_0",
        title: "The Timetable Update",
        date: "Mar 2026",
        forceShow: false,
        features: [
            "<b>Full Daily Timetables:</b> See the whole day like a station board.",
            "<b>Share Your Trip:</b> Send planned routes via WhatsApp in one tap.",
            "<b>Offline Memory:</b> Remembers recent searches underground."
        ]
    },
    {
        id: "V4_0",
        title: "The Trip Planner",
        date: "Feb 2026",
        forceShow: false,
        features: [
            "<b>Smart Trip Planner:</b> Origin, destination, and transfers in one search.",
            "<b>Fare Calculator:</b> Scholar, pensioner, and off-peak discounts built in."
        ]
    }
];

/** Normalize legacy spaced IDs ("V7 06.17") and HTML-bearing version strings to badge form. */
export function normalizeChangelogId(value) {
    return String(value || '')
        .split('<')[0]
        .trim()
        .replace(/\s+/g, '_');
}

export function getLatestChangelog() {
    return CHANGELOG_DATA[0] || null;
}

export function getChangelogVersionId(entry) {
    if (!entry) return '';
    if (entry.id) return normalizeChangelogId(entry.id);
    return normalizeChangelogId(entry.version);
}