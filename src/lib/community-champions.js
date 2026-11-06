/**
 * Next Train Champions — community leaders thanked on the About sheet.
 * Loaded from RTDB config/community_champions (admin panel). Name + region always;
 * WhatsApp / channel / Facebook icons only when those fields are set.
 */
import { DYNAMIC_BASE_URL, REGIONS } from './config.js';

/** @typedef {{ id?: string, name: string, region: string, whatsapp?: string, whatsappChannel?: string, facebook?: string, order?: number }} CommunityChampion */

export const COMMUNITY_CHAMPIONS_PATH = 'config/community_champions';

const REGION_FALLBACK = {
    GP: 'Gauteng',
    WC: 'Western Cape',
    KZN: 'KwaZulu-Natal',
    EC: 'Eastern Cape',
};

let cachedRows = null;
let cachedAt = 0;
let loadPromise = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function championRegionLabel(region) {
    const code = String(region || '').trim().toUpperCase();
    if (REGIONS?.[code]?.name) return REGIONS[code].name;
    if (REGION_FALLBACK[code]) return REGION_FALLBACK[code];
    return String(region || '').trim() || 'South Africa';
}

function safeHttpsUrl(raw) {
    const url = String(raw || '').trim();
    if (!url) return '';
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return '';
        return parsed.href;
    } catch {
        return '';
    }
}

/** Build wa.me link from digits / +E.164. Returns '' when invalid. */
export function championWhatsAppHref(raw) {
    const digits = String(raw || '').replace(/\D+/g, '');
    if (digits.length < 9 || digits.length > 15) return '';
    return `https://wa.me/${digits}`;
}

export function championContactLinks(row) {
    if (!row || typeof row !== 'object') return [];
    const links = [];
    const wa = championWhatsAppHref(row.whatsapp);
    if (wa) links.push({ kind: 'whatsapp', href: wa, label: 'WhatsApp' });
    const channel = safeHttpsUrl(row.whatsappChannel);
    if (channel) links.push({ kind: 'channel', href: channel, label: 'WhatsApp channel' });
    const fb = safeHttpsUrl(row.facebook);
    if (fb) links.push({ kind: 'facebook', href: fb, label: 'Facebook' });
    return links;
}

/** Normalize RTDB payload (items map or array) into sorted champion rows. */
export function normalizeCommunityChampionsPayload(data) {
    if (!data || typeof data !== 'object' || data.error) return [];
    const raw = data.items != null ? data.items : data;
    const list = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object'
            ? Object.keys(raw).map((key) => {
                const row = raw[key];
                if (!row || typeof row !== 'object') return null;
                return { id: row.id || key, ...row };
            })
            : []);
    return list
        .filter((row) => row && String(row.name || '').trim())
        .map((row, index) => ({
            id: String(row.id || `c_${index}`).slice(0, 40),
            name: String(row.name).trim().slice(0, 80),
            region: String(row.region || 'GP').trim().slice(0, 40),
            whatsapp: String(row.whatsapp || '').trim().slice(0, 40),
            whatsappChannel: String(row.whatsappChannel || '').trim().slice(0, 240),
            facebook: String(row.facebook || '').trim().slice(0, 240),
            order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
        }))
        .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
}

export function listCommunityChampions(rows = cachedRows) {
    return (rows || [])
        .filter((row) => row && String(row.name || '').trim())
        .map((row) => ({
            name: String(row.name).trim().slice(0, 80),
            region: championRegionLabel(row.region),
            links: championContactLinks(row),
        }));
}

export async function fetchCommunityChampions(force = false) {
    if (!force && cachedRows && (Date.now() - cachedAt) < CACHE_TTL_MS) {
        return listCommunityChampions(cachedRows);
    }
    if (!force && loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const res = await fetch(`${DYNAMIC_BASE_URL}${COMMUNITY_CHAMPIONS_PATH}.json?t=${Date.now()}`, {
                cache: 'no-store',
            });
            if (!res.ok) {
                cachedRows = cachedRows || [];
            } else {
                const data = await res.json();
                cachedRows = normalizeCommunityChampionsPayload(data);
            }
        } catch {
            cachedRows = cachedRows || [];
        }
        cachedAt = Date.now();
        loadPromise = null;
        return listCommunityChampions(cachedRows);
    })();

    return loadPromise;
}

if (typeof window !== 'undefined') {
    window.fetchCommunityChampions = fetchCommunityChampions;
}
