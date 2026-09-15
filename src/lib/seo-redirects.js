/**
 * Crawl typos Google already requested (GA junk landings).
 * Astro `redirects` emit HTML with meta-refresh + noindex + canonical-to-target
 * (see node_modules/astro/dist/core/routing/3xx.js). GitHub Pages serves those
 * files; Cloudflare Pages also gets public/_redirects.
 *
 * Keys are extensionless (build.format = 'file' appends .html). Destinations
 * keep .html so production GitHub Pages hits the real landing.
 */
export const SEO_REDIRECTS = [
    {
        from: '/routes/cape-town-to-chloris-hani',
        to: '/routes/cape-town-to-chris-hani.html',
        label: 'Cape Town to Chris Hani train times',
    },
    {
        from: '/routes/cape-town-to-chris-hnai',
        to: '/routes/cape-town-to-chris-hani.html',
        label: 'Cape Town to Chris Hani train times',
    },
    {
        from: '/regions/western-cable',
        to: '/regions/western-cape.html',
        label: 'Western Cape Metrorail',
    },
    {
        from: '/regions/western-coder',
        to: '/regions/western-cape.html',
        label: 'Western Cape Metrorail',
    },
    {
        from: '/regions/eastern-angle',
        to: '/regions/eastern-cape.html',
        label: 'Eastern Cape Metrorail',
    },
    {
        from: '/corridors/western-line-northern-line',
        to: '/corridors/western-cape-northern-line.html',
        label: 'Western Cape Northern Line',
    },
    {
        from: '/routes/52a06c623e767edc20000003/leralla-germiston',
        to: '/routes/germiston-to-leralla.html',
        label: 'Germiston to Leralla train times',
    },
];

/** Astro `defineConfig({ redirects })` map. */
export function astroRedirectMap() {
    const out = {};
    for (const row of SEO_REDIRECTS) out[row.from] = row.to;
    return out;
}

/** dist-relative HTML files Astro emits for these redirects. */
export function listSeoRedirectHtmlFiles() {
    return SEO_REDIRECTS.map((row) => `${row.from.replace(/^\//, '')}.html`);
}

export function isSeoRedirectHtmlFile(rel) {
    return listSeoRedirectHtmlFiles().includes(String(rel || '').replace(/\\/g, '/'));
}

/** Cloudflare Pages `_redirects` lines (extensionless targets avoid CF .html↔bare loops). */
export function cloudflareRedirectLines() {
    const lines = [];
    for (const row of SEO_REDIRECTS) {
        const dest = row.to.replace(/\.html$/, '');
        lines.push(`${row.from}  ${dest}  301`);
        lines.push(`${row.from}.html  ${dest}  301`);
    }
    return lines;
}
