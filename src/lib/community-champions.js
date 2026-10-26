/**
 * Next Train Champions — community leaders thanked on the About sheet.
 * Display is name + region. Optional contact fields become icon links when set.
 *
 * region: GP | WC | KZN | EC (or a short custom label)
 * whatsapp: digits or +E.164 (opens wa.me)
 * whatsappChannel: full https URL to a WhatsApp channel
 * facebook: full https Facebook profile URL
 */
import { REGIONS } from './config.js';

/** @typedef {{ name: string, region: string, whatsapp?: string, whatsappChannel?: string, facebook?: string }} CommunityChampion */

/** @type {CommunityChampion[]} */
export const COMMUNITY_CHAMPIONS = [
    // Add champions here. Example:
    // {
    //     name: 'Thabo M.',
    //     region: 'GP',
    //     whatsapp: '+27821234567',
    //     whatsappChannel: 'https://whatsapp.com/channel/…',
    //     facebook: 'https://www.facebook.com/…',
    // },
];

const REGION_FALLBACK = {
    GP: 'Gauteng',
    WC: 'Western Cape',
    KZN: 'KwaZulu-Natal',
    EC: 'Eastern Cape',
};

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

export function listCommunityChampions() {
    return (COMMUNITY_CHAMPIONS || [])
        .filter((row) => row && String(row.name || '').trim())
        .map((row) => ({
            name: String(row.name).trim().slice(0, 80),
            region: championRegionLabel(row.region),
            links: championContactLinks(row),
        }));
}
