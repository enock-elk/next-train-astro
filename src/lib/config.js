// --- CONFIGURATION & CONSTANTS ---

// 0. Version Control
export const APP_VERSION = "V7_06.17"; // v4 - BUMPED: UX Polish, 18-Hour Layover Uncap & Precision Routing.
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

// 1. Legal Text Definitions (GUARDIAN V5.01: TWA Compliance & Opaque Infrastructure)
export const LEGAL_TEXTS = {
    terms: `
        <h4 class="font-bold text-lg mb-2">1. Independent Service & Disclaimer</h4>
        <p class="mb-3"><strong>Metrorail Next Train</strong> is an independent digital tool developed by Kazembe CodeWorks. This application is <strong>not affiliated with, endorsed by, or directly associated with PRASA or Metrorail</strong>. The service is provided "as is" without warranties of any kind.</p>
        
        <h4 class="font-bold text-lg mb-2 mt-4">2. Schedule Accuracy & Liability</h4>
        <p class="mb-3">All transit schedules, fares, and routing information presented within this application are aggregated estimations based on publicly available data. We do not guarantee absolute real-time accuracy. Kazembe CodeWorks and its developers shall not be held liable for any missed transit connections, financial losses, disciplinary actions at places of employment, or personal damages arising from the use of this information.</p>
        
        <h4 class="font-bold text-lg mb-2 mt-4">3. Acceptable Use</h4>
        <p class="mb-3">By accessing this application, you agree to use it strictly for personal, non-commercial transit planning. Automated data scraping, reverse-engineering of the application's secure endpoints, or malicious interference with our cloud infrastructure is strictly prohibited and will result in immediate service denial.</p>
    `,
    privacy: `
        <h4 class="font-bold text-lg mb-2">1. Data Collection & Analytics</h4>
        <p class="mb-3">To continuously improve the commuter experience, we utilize industry-standard analytics tools (including Google Analytics and Microsoft Clarity) to monitor application performance and user engagement. This tracking measures generic usage patterns, origin-destination planning flows, and crash reports. <strong>All data collected is strictly anonymized.</strong> We do not request, process, or store personally identifiable information (PII) such as names or contact details.</p>
        
        <h4 class="font-bold text-lg mb-2 mt-4">2. Location Services</h4>
        <p class="mb-3">Our "Find Nearest Station" feature requires access to your device's GPS coordinates. This location data is processed locally on your device in real-time to calculate distances to nearby stations. <strong>Your exact GPS location is never transmitted to, or stored on, our backend servers for tracking.</strong></p>
        
        <h4 class="font-bold text-lg mb-2 mt-4">3. Third-Party Infrastructure</h4>
        <p class="mb-3">Schedule data and application states are distributed via secure, globally recognized cloud infrastructure providers. While your device downloads data from these secure endpoints, your individual connection metrics are governed by the strict privacy frameworks of those enterprise cloud providers. We do not broker your individual device fingerprints to external marketing agencies.</p>
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

// 7. CHANGELOG 
// This drives the "What's New" modal.
// GUARDIAN: HTML spans injected to force flexbox wrapping in renderer.js without altering the parent UI structure.
export const CHANGELOG_DATA = [
    {
        version: "V7 06.17 <br><span class='text-sm text-blue-600 dark:text-blue-400'>The Precision Update</span>",
        date: "17 Jun 2026",
        features: [
            "<b>Smarter Trip Planner:</b> The routing engine now actively finds overnight and extended weekend connections that were previously hidden, ensuring you see every possible travel option.",
            "<b>Clearer Journey Timelines:</b> We've polished the visual timeline with a unified, professional color scheme and fixed text that was getting cut off on smaller mobile screens.",
            "<b>Accurate Route Status:</b> If a trip is impossible today, the app now specifically tells you why-whether it's due to an active incident, extreme timetable gaps, or disconnected lines."
        ]
    },
    {
    version: "V7 05.31 <br><span class='text-sm text-blue-600 dark:text-blue-400'>Performance Polish</span>",
    date: "31 May 2026",
    features: [
        "<b>Instant Loading:</b> Squashed a bug that occasionally caused the Welcome Screen to freeze on 'Loading Route'. The app now drops you straight into your schedule.",
        "<b>Cleaner Interface:</b> Tightened up the side menus, optimized text for smaller screens, and fixed an issue where popup ads were leaking onto the welcome screen.",
        "<b>Data Reliability:</b> Upgraded our background sync engines to ensure your timetables update perfectly, even on patchy cell networks."
    ]
    },
    {
        version: "V7 05.16 <br><span class='text-sm text-blue-600 dark:text-blue-400'>Western Cape Expansion</span>",
        date: "16 May 2026",
        features: [
            "<b>Cape Town is Complete:</b> Added 6 massive new routes, ensuring full coverage for the Central Line and Northern Line networks.",
            "<b>Cinematic UI:</b> Dropdown menus now dim the background for a cleaner, native-app feel."
        ]
    },
    {
        version: "V7 05.12 <br><span class='text-sm text-blue-600 dark:text-blue-400'>KZN & EC Launch</span>",
        date: "12 May 2026",
        features: [
            "<b>National Expansion:</b> Metrorail Next Train has officially launched in KwaZulu-Natal and the Eastern Cape!",
            "<b>Cross-Region Support:</b> Easily switch between provinces in the main menu to view local timetables."
        ]
    },
    {
        version: "V6.05.01 <br><span class='text-sm text-blue-600 dark:text-blue-400'>Growth Edition</span>",
        date: "1 May 2026",
        features: [
            "<b>Server Support Ads:</b> To help cover our growing server costs and keep the app 100% free, we've introduced small, non-intrusive advertisements. Thank you for supporting the project!",
            "<b>UI Polish:</b> Smarter timetable auto-scrolling, cleaner action buttons, and better legibility for delayed or severed train routes."
        ]
    },
    {
        version: "V6.04.26 <br><span class='text-sm text-blue-600 dark:text-blue-400'>Guardian Edition</span>",
        date: "26 Apr 2026",
        features: [
            "<b>Smart Weekend & Holiday Routing:</b> The Trip Planner now intelligently predicts Public Holidays. If you search on a Sunday, it automatically skips forward to find the next available working train.",
            "<b>Clearer Disruption Alerts:</b> Redesigned the 'Line Severed' warning blocks to be instantly readable at a glance, so you know exactly where the train terminates.",
            "<b>Sleeker Look & Feel:</b> Upgraded the time selection menus, fixed text clipping on smaller screens, and smoothed out the overall app experience."
        ]
    },
    {
        version: "V6.00 <br><span class='text-[13px] text-blue-600 dark:text-blue-400'>Western Cape Launch</span>",
        date: "Apr 2026",
        features: [
            "<b>Cape Town is Here!:</b> Metrorail Next Train now fully supports Western Cape routes. You can check schedules and plan trips for Cape Town completely offline.",
            "<b>All-New App Menu:</b> We've combined all your settings, offline syncing, and region selection into a clean, easy-to-use side menu.",
            "<b>Better Navigation:</b> Swiping back or using your phone's back button now cleanly closes popups instead of accidentally exiting the app."
        ]
    },
    {
        version: "V5.0 <br><span class='text-[13px] text-blue-600 dark:text-blue-400'>The Timetable Update</span>",
        date: "Mar 2026",
        features: [
            "<b>Full Daily Timetables:</b> You can now view the entire day's train schedule at a glance, just like the printed station boards.",
            "<b>Share Your Trip:</b> Easily send your planned routes and train times to friends or family via WhatsApp with a single tap.",
            "<b>Offline Memory:</b> The app now remembers your most recent searches, making it easy to find your usual trains even when underground."
        ]
    },
    {
        version: "V4.0 <br><span class='text-[13px] text-blue-600 dark:text-blue-400'>The Trip Planner</span>",
        date: "Feb 2026",
        features: [
            "<b>Smart Trip Planner:</b> Enter where you are and where you want to go, and the app will calculate the fastest route, including transfers between different lines.",
            "<b>Fare Calculator:</b> See exactly how much your trip will cost, with built-in discounts for Scholars, Pensioners, and Off-Peak travel."
        ]
    }
];