/**
 * Apply nexttrain-edge Cache Rules + response header transforms, then
 * optionally detach the Worker routes.
 *
 * Safe merge: existing zone rules that are not nt-edge-* refs stay put.
 * A PUT of only our rules would wipe the rest of the phase ruleset.
 *
 *   CLOUDFLARE_API_TOKEN=… node scripts/apply-nexttrain-edge-cache-rules.mjs
 *   node scripts/apply-nexttrain-edge-cache-rules.mjs --dry-run
 *   node scripts/apply-nexttrain-edge-cache-rules.mjs --detach-worker
 *
 * Token needs Zone Cache Rules Edit + Zone Transform Rules Write.
 * --detach-worker also needs Zone Workers Routes Edit.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PATH = join(ROOT, 'workers/nexttrain-edge/zone-rules.json');

export const NT_EDGE_REF_PREFIX = 'nt-edge-';

export function loadEdgeZoneSpec() {
    return JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
}

export function managedRefs(spec = loadEdgeZoneSpec()) {
    return new Set([
        ...spec.cache.map((r) => r.ref),
        ...spec.transform.map((r) => r.ref),
    ]);
}

/** Keep foreign rules; replace our refs in place. */
export function mergeManagedRules(existing = [], managed = [], refs = managedRefs()) {
    const kept = (existing || []).filter((r) => !refs.has(r.ref) && !String(r.description || '').startsWith('nt-edge:'));
    const next = managed.map((rule) => {
        const prev = (existing || []).find((r) => r.ref === rule.ref);
        return prev?.id ? { ...rule, id: prev.id } : { ...rule };
    });
    return [...kept, ...next];
}

function parseArgs(argv) {
    return {
        dryRun: argv.includes('--dry-run'),
        detachWorker: argv.includes('--detach-worker'),
        zoneId: argv.includes('--zone-id') ? argv[argv.indexOf('--zone-id') + 1] : '',
    };
}

async function cf(token, method, path, body) {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
        const err = (json.errors || []).map((e) => e.message).join('; ') || res.statusText;
        const error = new Error(`${method} ${path}: ${err}`);
        error.status = res.status;
        error.body = json;
        throw error;
    }
    return json.result;
}

async function upsertPhase(token, zoneId, phase, name, managed, refs) {
    let entry = null;
    try {
        entry = await cf(token, 'GET', `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`);
    } catch (e) {
        if (e.status !== 404) throw e;
    }
    const existing = entry?.rules || [];
    const rules = mergeManagedRules(existing, managed, refs);
    if (!entry?.id) {
        return cf(token, 'POST', `/zones/${zoneId}/rulesets`, {
            name,
            description: 'Managed by scripts/apply-nexttrain-edge-cache-rules.mjs',
            kind: 'zone',
            phase,
            rules,
        });
    }
    return cf(token, 'PUT', `/zones/${zoneId}/rulesets/${entry.id}`, { rules });
}

async function detachWorkerRoutes(token, zoneId, scriptName) {
    const routes = await cf(token, 'GET', `/zones/${zoneId}/workers/routes`);
    const ours = (routes || []).filter((r) => r.script === scriptName);
    const removed = [];
    for (const route of ours) {
        await cf(token, 'DELETE', `/zones/${zoneId}/workers/routes/${route.id}`);
        removed.push(route.pattern);
    }
    return removed;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const spec = loadEdgeZoneSpec();
    const refs = managedRefs(spec);
    const zoneId = args.zoneId || process.env.CF_ZONE_ID || spec.zoneId;
    const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '';

    console.log(`Zone ${zoneId}`);
    console.log(`Cache rules: ${spec.cache.map((r) => r.ref).join(', ')}`);
    console.log(`Transform rules: ${spec.transform.map((r) => r.ref).join(', ')}`);

    if (args.dryRun) {
        console.log('dry-run: no API writes');
        return;
    }
    if (!token) {
        throw new Error('Set CLOUDFLARE_API_TOKEN (Zone Cache Rules Edit + Transform Rules Write).');
    }

    await upsertPhase(
        token,
        zoneId,
        'http_request_cache_settings',
        'Next Train cache rules',
        spec.cache,
        refs,
    );
    console.log('Applied Cache Rules (edge TTL + bypass probes).');

    await upsertPhase(
        token,
        zoneId,
        'http_response_headers_transform',
        'Next Train cache headers',
        spec.transform,
        refs,
    );
    console.log('Applied response header transforms (browser Cache-Control).');

    if (args.detachWorker) {
        const removed = await detachWorkerRoutes(token, zoneId, spec.scriptName);
        console.log(removed.length
            ? `Detached ${spec.scriptName} routes: ${removed.join(', ')}`
            : `No ${spec.scriptName} routes attached.`);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
}
