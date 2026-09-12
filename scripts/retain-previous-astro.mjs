#!/usr/bin/env node
/**
 * Keep previous hashed /_astro/ generations alive after rsync --delete.
 *
 * A production publish replaces every content-hashed file and the host sweep
 * removes the old ones. Anything still pointing at the previous build then 404s
 * every stylesheet and module — that is the unstyled "Next Train could not
 * finish updating" render in Clarity, and the real FOUC commuters hit when
 * their HTML is older than the assets on the host.
 *
 * Three different readers hold stale HTML, and they need different windows:
 *
 *   Commuters      an open tab, a warm PWA session, the browser HTTP cache and
 *                  the Cloudflare edge object all keep serving the previous
 *                  index.html for a while. They need the matching JS *and* CSS.
 *   Googlebot      re-renders indexed SEO pages from its own cached copy.
 *   Clarity        does not inline our stylesheets. It records the <link href>
 *                  and re-fetches it from nexttrain.co.za when you press play,
 *                  possibly days later. A swept hash means every older replay
 *                  and heatmap renders as raw HTML.
 *                  https://learn.microsoft.com/en-us/clarity/session-recordings/troubleshooting-recordings
 *
 * So retention is split. Whole generations (JS + CSS, a few hundred KB each)
 * cover in-flight readers; CSS alone is tiny, so it is kept far longer to keep
 * session replay and heatmaps legible. Releasing many times in one day burns
 * through generations fast — that is why these counts are not 1.
 *
 *   snapshot   host /_astro/ before this rsync (live gen ∪ everything retained)
 *   dest       host /_astro/ after rsync       (the build being published)
 *   manifest   what we retained last time, newest generation first
 *   demoted    snapshot − dest − manifest      (the generation going stale now)
 *
 * Usage:
 *   node scripts/retain-previous-astro.mjs \
 *     --snapshot /tmp/prev-astro \
 *     --dest site/_astro \
 *     --manifest /tmp/astro-retained-generation.json \
 *     --out-manifest site/astro-retained-generation.json \
 *     --keep 8 --keep-css 30
 */
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Generations of JS + CSS kept for readers still running the old build. */
export const DEFAULT_KEEP = 8;
/** Generations kept for CSS only — Clarity replay and heatmap fidelity. */
export const DEFAULT_KEEP_CSS = 30;

const isStylesheet = (rel) => /\.css$/i.test(rel);

/**
 * Decide which snapshot files to copy back and what the next manifest holds.
 * Pure, so verify can exercise the ageing rules without touching a disk.
 */
export function retainPreviousAstro({
    snapshotFiles = [],
    destFiles = [],
    previousGenerations = [],
    keep = DEFAULT_KEEP,
    keepCss = DEFAULT_KEEP_CSS,
} = {}) {
    const dest = new Set(destFiles.map(normRel));
    const priorGenerations = previousGenerations.map((files) =>
        [...new Set((files || []).map(normRel).filter(Boolean))].sort()
    );
    const alreadyRetained = new Set(priorGenerations.flat());

    // Whatever the host served until this publish, minus what the new build
    // ships and minus what we were already holding for older builds.
    const demoted = [];
    for (const raw of snapshotFiles) {
        const rel = normRel(raw);
        if (!rel || dest.has(rel) || alreadyRetained.has(rel)) continue;
        demoted.push(rel);
    }
    demoted.sort();

    // Newest generation first. An empty demotion (a rebuild of the same commit)
    // must not push a blank entry through and age real generations out early.
    const generations = demoted.length ? [demoted, ...priorGenerations] : priorGenerations;

    const restored = [];
    const seen = new Set();
    let dropped = 0;
    generations.forEach((files, age) => {
        const withinFull = age < keep;
        const withinCss = age < keepCss;
        for (const rel of files) {
            if (dest.has(rel) || seen.has(rel)) continue;
            const keepThis = withinFull || (withinCss && isStylesheet(rel));
            if (!keepThis) {
                dropped += 1;
                continue;
            }
            seen.add(rel);
            restored.push(rel);
        }
    });
    restored.sort();

    // Record only what actually survives, so the next run ages from the truth
    // rather than from files it can no longer find on the host.
    const nextGenerations = generations
        .map((files) => files.filter((rel) => seen.has(rel)))
        .filter((files) => files.length);

    return { restored, dropped, generations: nextGenerations };
}

function normRel(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.?\//, '');
}

export function walkRelativeFiles(root) {
    const files = [];
    if (!root || !existsSync(root)) return files;
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        for (const name of readdirSync(dir)) {
            const abs = join(dir, name);
            const st = statSync(abs);
            if (st.isDirectory()) stack.push(abs);
            else if (st.isFile()) files.push(relative(root, abs).split('\\').join('/'));
        }
    }
    return files;
}

/** Reads both the current `generations` manifest and the legacy `{files:[]}` one. */
export function readManifestGenerations(path) {
    if (!path || !existsSync(path)) return [];
    try {
        const data = JSON.parse(readFileSync(path, 'utf8'));
        if (Array.isArray(data?.generations)) {
            return data.generations
                .map((gen) => (Array.isArray(gen) ? gen : gen?.files))
                .map((files) => (Array.isArray(files) ? files.map(String) : []))
                .filter((files) => files.length);
        }
        if (Array.isArray(data?.files) && data.files.length) return [data.files.map(String)];
        return [];
    } catch {
        return [];
    }
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        if (key === '--snapshot') out.snapshotDir = argv[++i];
        else if (key === '--dest') out.destDir = argv[++i];
        else if (key === '--manifest') out.manifestPath = argv[++i];
        else if (key === '--out-manifest') out.outManifestPath = argv[++i];
        else if (key === '--keep') out.keep = Number(argv[++i]);
        else if (key === '--keep-css') out.keepCss = Number(argv[++i]);
    }
    return out;
}

export function applyRetention({
    snapshotDir,
    destDir,
    previousGenerations = [],
    keep = DEFAULT_KEEP,
    keepCss = DEFAULT_KEEP_CSS,
}) {
    const result = retainPreviousAstro({
        snapshotFiles: walkRelativeFiles(snapshotDir),
        destFiles: walkRelativeFiles(destDir),
        previousGenerations,
        keep,
        keepCss,
    });
    mkdirSync(destDir, { recursive: true });
    for (const rel of result.restored) {
        const src = join(snapshotDir, rel);
        const dest = join(destDir, rel);
        if (!existsSync(src)) continue;
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
    }
    return result;
}

function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (!args.snapshotDir || !args.destDir) {
        console.error('retain-previous-astro: --snapshot and --dest are required');
        process.exit(2);
    }
    const keep = Number.isFinite(args.keep) && args.keep > 0 ? args.keep : DEFAULT_KEEP;
    const keepCss = Number.isFinite(args.keepCss) && args.keepCss > 0 ? args.keepCss : DEFAULT_KEEP_CSS;
    const snapshotDir = resolve(args.snapshotDir);
    const destDir = resolve(args.destDir);
    const previousGenerations = readManifestGenerations(
        args.manifestPath ? resolve(args.manifestPath) : ''
    );
    const { restored, dropped, generations } = applyRetention({
        snapshotDir,
        destDir,
        previousGenerations,
        keep,
        keepCss,
    });
    const outPath = args.outManifestPath
        ? resolve(args.outManifestPath)
        : join(destDir, '..', 'astro-retained-generation.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(
        outPath,
        `${JSON.stringify(
            {
                keep,
                keepCss,
                kept: restored.length,
                generations: generations.map((files) => ({ files })),
                // Legacy readers (and any half-rolled-out deploy) still expect a flat list.
                files: restored,
            },
            null,
            2
        )}\n`
    );
    console.log(
        `Retained ${restored.length} previous /_astro/ files across ${generations.length} generation(s); ` +
        `dropped ${dropped} past --keep ${keep} / --keep-css ${keepCss}.`
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
