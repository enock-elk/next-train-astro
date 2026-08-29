#!/usr/bin/env node
/**
 * Keep the previous hashed /_astro/ generation after rsync --delete.
 *
 * A production publish replaces every content-hashed file and the host sweep
 * removes the old ones. Any device still rendering the previous index.html
 * then 404s every stylesheet and module — that is the FOUC / "You are offline"
 * Clarity session. Restoring the last generation (only) gives those in-flight
 * tabs a working CSS/JS set until they refetch HTML.
 *
 * We keep one previous generation, not the full history:
 *   snapshot  = host /_astro/ before this rsync  (gen N ∪ gen N-1)
 *   dest      = host /_astro/ after rsync        (gen N+1)
 *   manifest  = files we retained last time      (gen N-1)
 *   restore   = snapshot − dest − manifest       (≈ gen N)
 *
 * Usage:
 *   node scripts/retain-previous-astro.mjs \
 *     --snapshot /tmp/prev-astro \
 *     --dest site/_astro \
 *     --manifest /tmp/astro-retained-generation.json \
 *     --out-manifest site/astro-retained-generation.json
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

/** Decide which snapshot files to copy back. Pure — used by verify. */
export function retainPreviousAstro({
    snapshotFiles = [],
    destFiles = [],
    previousManifestFiles = [],
} = {}) {
    const dest = new Set(destFiles.map(normRel));
    const oldRetained = new Set(previousManifestFiles.map(normRel));
    const restored = [];
    let dropped = 0;
    for (const raw of snapshotFiles) {
        const rel = normRel(raw);
        if (!rel) continue;
        if (dest.has(rel)) continue;
        if (oldRetained.has(rel)) {
            dropped += 1;
            continue;
        }
        restored.push(rel);
    }
    restored.sort();
    return { restored, dropped };
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

function readManifestFiles(path) {
    if (!path || !existsSync(path)) return [];
    try {
        const data = JSON.parse(readFileSync(path, 'utf8'));
        return Array.isArray(data?.files) ? data.files.map(String) : [];
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
    }
    return out;
}

export function applyRetention({ snapshotDir, destDir, previousManifestFiles = [] }) {
    const result = retainPreviousAstro({
        snapshotFiles: walkRelativeFiles(snapshotDir),
        destFiles: walkRelativeFiles(destDir),
        previousManifestFiles,
    });
    mkdirSync(destDir, { recursive: true });
    for (const rel of result.restored) {
        const src = join(snapshotDir, rel);
        const dest = join(destDir, rel);
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
    const snapshotDir = resolve(args.snapshotDir);
    const destDir = resolve(args.destDir);
    const previous = readManifestFiles(args.manifestPath ? resolve(args.manifestPath) : '');
    const { restored, dropped } = applyRetention({
        snapshotDir,
        destDir,
        previousManifestFiles: previous,
    });
    const outPath = args.outManifestPath
        ? resolve(args.outManifestPath)
        : join(destDir, '..', 'astro-retained-generation.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify({ files: restored, kept: restored.length }, null, 2)}\n`);
    console.log(`Retained ${restored.length} previous /_astro/ files; dropped ${dropped} from the generation before that.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
