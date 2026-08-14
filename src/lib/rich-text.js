/**
 * Shared rich-text pipeline for service alerts and admin replies.
 * Admin WYSIWYG (execCommand) emits <font size>, <font face>, <u>, headings,
 * and align styles. The user modal must keep those tags and the same CSS,
 * or size/font formatting silently falls back to normal text.
 */
import { repairMojibake } from './utils.js';

export const RICH_TEXT_STYLE_ID = 'nt-rich-text-styles';

/** Same 3-tier sizes the admin editor uses (Tailwind text-sm otherwise wins). */
export const RICH_TEXT_CSS = `
.nt-rich-body, #notice-content, #developer-reply-content, #alert-msg, #admin-reply-text, #disr-msg, #disruption-modal-body {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.nt-rich-body a, #notice-content a, #developer-reply-content a, #alert-msg a, #admin-reply-text a, #disr-msg a, #disruption-modal-body a {
  overflow-wrap: anywhere;
  word-break: break-word;
}
font[size="5"], .nt-rich-body font[size="5"] { font-size: 1.15rem !important; font-weight: 700; line-height: 1.4; }
font[size="3"], .nt-rich-body font[size="3"] { font-size: inherit !important; font-weight: inherit !important; opacity: 1 !important; line-height: inherit; }
font[size="2"], .nt-rich-body font[size="2"] { font-size: 10px !important; opacity: 0.85; line-height: 1.2; }
font[face="Verdana"], font[face="verdana"],
.nt-rich-body font[face="Verdana"], .nt-rich-body font[face="verdana"] {
  font-family: Verdana, Geneva, sans-serif !important;
}
font[face="Times New Roman"], font[face="Times New Roman"], font[face="times new roman"],
.nt-rich-body font[face="Times New Roman"], .nt-rich-body font[face="times new roman"] {
  font-family: "Times New Roman", Times, serif !important;
}
.nt-rich-body u, #notice-content u, #developer-reply-content u, #alert-msg u, #admin-reply-text u, #disr-msg u, #disruption-modal-body u {
  text-decoration: underline;
}
.nt-rich-body h1, .nt-rich-body h2, .nt-rich-body h3, .nt-rich-body h4,
#notice-content h1, #notice-content h2, #notice-content h3, #notice-content h4,
#developer-reply-content h1, #developer-reply-content h2, #developer-reply-content h3,
#alert-msg h1, #alert-msg h2, #alert-msg h3, #admin-reply-text h3,
#disr-msg h3, #disruption-modal-body h3 {
  font-size: 1.15rem;
  font-weight: 800;
  line-height: 1.3;
  margin: 0.15rem 0 0.45rem;
  color: inherit;
  letter-spacing: -0.01em;
}
`;

const ALLOWED_TAGS = new Set([
    'B', 'I', 'U', 'STRONG', 'EM', 'A', 'BR', 'P', 'SPAN', 'DIV',
    'UL', 'OL', 'LI', 'IMG', 'BUTTON', 'FONT', 'H1', 'H2', 'H3', 'H4',
]);

const ATTR_KEEP = new Set(['target', 'class', 'rel', 'alt', 'type', 'size', 'face', 'align']);

const STYLE_ALLOW = new Set([
    'text-align', 'font-family', 'font-size', 'font-weight', 'font-style',
    'text-decoration', 'opacity', 'line-height', 'color',
]);

const SAFE_HREF = /^(https?|mailto|tel):/i;

/** Combined scanner: URL, email, then SA phone (0xx xxx xxxx / +27). */
const CONTACT_RE = /https?:\/\/[^\s<>"'()]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|(?:\+?27|0)[\s.-]*[1-8]\d[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/g;

export function injectRichTextStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(RICH_TEXT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = RICH_TEXT_STYLE_ID;
    style.textContent = RICH_TEXT_CSS;
    document.head.appendChild(style);
}

export function isSafeHref(href) {
    return SAFE_HREF.test(String(href || '').trim());
}

export function sanitizeStyleAttr(raw) {
    if (!raw) return '';
    const lower = String(raw).toLowerCase();
    if (lower.includes('url(') || lower.includes('expression') || lower.includes('javascript')) return '';
    const kept = [];
    String(raw).split(';').forEach((part) => {
        const idx = part.indexOf(':');
        if (idx < 0) return;
        const prop = part.slice(0, idx).trim().toLowerCase();
        const val = part.slice(idx + 1).trim();
        if (!STYLE_ALLOW.has(prop) || !val) return;
        if (/url\s*\(|expression|javascript/i.test(val)) return;
        if (prop === 'font-family' && !/verdana|times new roman|\btimes\b/i.test(val.replace(/['"]/g, ''))) return;
        kept.push(`${prop}: ${val}`);
    });
    return kept.join('; ');
}

function peelTrailingPunctuation(url) {
    let href = url;
    let trail = '';
    while (href.length > 8 && /[.,;:!?]$/.test(href)) {
        trail = href.slice(-1) + trail;
        href = href.slice(0, -1);
    }
    return { href, trail };
}

function phoneToTel(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `27${digits.slice(1)}`;
    if (!digits.startsWith('27')) digits = `27${digits}`;
    return `tel:+${digits}`;
}

/**
 * Split plain text into text / url / email / phone tokens.
 * Pure string helper — safe to unit-test in Node without a DOM.
 */
export function splitContactTokens(text) {
    const src = String(text || '');
    if (!src) return [];
    const parts = [];
    let last = 0;
    CONTACT_RE.lastIndex = 0;
    let m = CONTACT_RE.exec(src);
    while (m) {
        if (m.index > last) parts.push({ type: 'text', value: src.slice(last, m.index) });
        const raw = m[0];
        if (/^https?:\/\//i.test(raw)) {
            const { href, trail } = peelTrailingPunctuation(raw);
            parts.push({ type: 'url', value: href, href });
            if (trail) parts.push({ type: 'text', value: trail });
        } else if (raw.includes('@')) {
            parts.push({ type: 'email', value: raw, href: `mailto:${raw}` });
        } else {
            parts.push({ type: 'phone', value: raw, href: phoneToTel(raw) });
        }
        last = m.index + raw.length;
        m = CONTACT_RE.exec(src);
    }
    if (last < src.length) parts.push({ type: 'text', value: src.slice(last) });
    return parts.length ? parts : [{ type: 'text', value: src }];
}

const SKIP_AUTOLINK_PARENTS = new Set(['A', 'SCRIPT', 'STYLE', 'TEXTAREA', 'BUTTON']);

function shouldSkipAutolink(node) {
    let el = node.parentNode;
    while (el && el.nodeType === 1) {
        if (SKIP_AUTOLINK_PARENTS.has(el.tagName)) return true;
        el = el.parentNode;
    }
    return false;
}

export function autolinkContactsIn(root) {
    if (!root || typeof document === 'undefined') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n = walker.nextNode();
    while (n) {
        nodes.push(n);
        n = walker.nextNode();
    }
    nodes.forEach((textNode) => {
        if (!textNode.nodeValue || !textNode.parentNode) return;
        if (shouldSkipAutolink(textNode)) return;
        const tokens = splitContactTokens(textNode.nodeValue);
        const hasLink = tokens.some((t) => t.type !== 'text');
        if (!hasLink) return;
        const frag = document.createDocumentFragment();
        tokens.forEach((t) => {
            if (t.type === 'text') {
                frag.appendChild(document.createTextNode(t.value));
                return;
            }
            const a = document.createElement('a');
            a.setAttribute('href', t.href);
            a.className = 'text-blue-600 dark:text-blue-400 underline underline-offset-2';
            a.textContent = t.value;
            if (t.type === 'url') {
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener');
            }
            frag.appendChild(a);
        });
        textNode.parentNode.replaceChild(frag, textNode);
    });
}

function sanitizeHref(el, attrName) {
    const value = el.getAttribute(attrName);
    if (!value) {
        el.removeAttribute(attrName);
        return;
    }
    if (attrName === 'href' && !isSafeHref(value)) el.removeAttribute(attrName);
    if (attrName === 'src' && !/^https?:/i.test(value)) el.removeAttribute(attrName);
}

function cleanNode(node) {
    Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType !== 1) return;
        if (!ALLOWED_TAGS.has(child.tagName)) {
            child.replaceWith(...Array.from(child.childNodes));
            cleanNode(node);
            return;
        }
        Array.from(child.attributes).forEach((attr) => {
            const attrName = attr.name.toLowerCase();
            if (attrName === 'href' || attrName === 'src') {
                sanitizeHref(child, attrName);
            } else if (attrName === 'onclick') {
                if (!/^window\.openLightbox\(.*\)$/.test(attr.value)
                    && !/^Admin\.openLightbox\(.*\)$/.test(attr.value)) {
                    child.removeAttribute(attr.name);
                }
            } else if (attrName === 'style') {
                const cleaned = sanitizeStyleAttr(attr.value);
                if (cleaned) child.setAttribute('style', cleaned);
                else child.removeAttribute('style');
            } else if (attrName === 'target' && child.tagName === 'A') {
                try {
                    const href = child.getAttribute('href');
                    if (href) {
                        const u = new URL(href, typeof location !== 'undefined' ? location.href : 'https://nexttrain.co.za');
                        if (typeof location !== 'undefined' && u.origin === location.origin) {
                            child.removeAttribute('target');
                        }
                    }
                } catch { /* keep target */ }
            } else if (!ATTR_KEEP.has(attrName)) {
                child.removeAttribute(attr.name);
            }
        });
        cleanNode(child);
    });
}

export function sanitizeRichHtml(dirtyHtml) {
    if (typeof DOMParser === 'undefined') return String(dirtyHtml || '');
    const doc = new DOMParser().parseFromString(repairMojibake(dirtyHtml || ''), 'text/html');
    cleanNode(doc.body);
    return doc.body.innerHTML;
}

/** Sanitize + autolink emails, phones, and bare http(s) URLs. */
export function prepareRichHtml(dirtyHtml) {
    injectRichTextStyles();
    if (typeof DOMParser === 'undefined') return sanitizeRichHtml(dirtyHtml);
    const sanitized = sanitizeRichHtml(dirtyHtml);
    const doc = new DOMParser().parseFromString(sanitized, 'text/html');
    autolinkContactsIn(doc.body);
    return doc.body.innerHTML;
}

if (typeof window !== 'undefined') {
    window.injectRichTextStyles = injectRichTextStyles;
    window.prepareRichHtml = prepareRichHtml;
    window.sanitizeRichHtml = sanitizeRichHtml;
}
