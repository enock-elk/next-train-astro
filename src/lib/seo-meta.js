/**
 * Shared SEO meta and BreadcrumbList helpers.
 * Google typically displays ~150–160 characters of a meta description;
 * keep builders at or under META_DESCRIPTION_MAX so SERP snippets stay intact.
 */

/** Soft SERP display budget for meta descriptions. */
export const META_DESCRIPTION_MAX = 160;

/** Title display budget (approximate). */
export const META_TITLE_MAX = 60;

/**
 * Collapse whitespace and trim to max at a word boundary.
 * Prefer a clean cut over stuffing past the SERP window.
 */
export function clipMetaDescription(text, max = META_DESCRIPTION_MAX) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  const cut = s.slice(0, Math.max(1, max - 1));
  const sp = cut.lastIndexOf(' ');
  const base = (sp > max * 0.55 ? cut.slice(0, sp) : cut).replace(/[,:;.\-–—]\s*$/u, '').trim();
  return base;
}

/**
 * One BreadcrumbList ListItem with name both on the ListItem and inside item.
 * Nested item.name is what Search Console's "Item name" column reads; the
 * flat name keeps validators that expect schema.org ListItem.name happy.
 */
export function breadcrumbListItem(position, name, url) {
  const label = String(name || '').trim() || 'Page';
  const href = String(url || '').trim();
  return {
    '@type': 'ListItem',
    position: Number(position) || 1,
    name: label,
    item: {
      '@type': 'WebPage',
      '@id': href,
      name: label,
    },
  };
}

/**
 * @param {{ name: string, url: string }[]} crumbs
 * @returns {{ '@type': 'BreadcrumbList', itemListElement: object[] }}
 */
export function buildBreadcrumbList(crumbs) {
  const list = Array.isArray(crumbs) ? crumbs.filter((c) => c && c.name && c.url) : [];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: list.map((c, i) => breadcrumbListItem(i + 1, c.name, c.url)),
  };
}
