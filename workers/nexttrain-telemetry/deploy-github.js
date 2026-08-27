/**
 * GitHub Actions helpers for admin “Publish live”.
 * Token (GH_ACTIONS_TOKEN) is Actions read/write on next-train-astro only.
 * Do not store the live-host Contents-write PAT on this Worker.
 */

export const GH_SOURCE_REPO = 'enock-elk/next-train-astro';
export const GH_HOST_REPO = 'enock-elk/metrorail-app';
export const GH_WORKFLOW_FILE = 'deploy-production.yml';
export const GH_SOURCE_REF = 'main';

const GH_API = 'https://api.github.com';
const GH_API_VERSION = '2022-11-28';

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export function shaMatches(a, b) {
    const x = String(a || '').trim().toLowerCase();
    const y = String(b || '').trim().toLowerCase();
    if (!x || !y) return false;
    return x === y || x.startsWith(y) || y.startsWith(x);
}

export function summarizeRun(run) {
    if (!run || typeof run !== 'object') return null;
    return {
        runId: run.id,
        status: run.status || null,
        conclusion: run.conclusion || null,
        htmlUrl: run.html_url || null,
        name: run.name || run.display_title || null,
        headSha: run.head_sha || null,
        headBranch: run.head_branch || null,
        event: run.event || null,
        createdAt: run.created_at || null,
        updatedAt: run.updated_at || null,
        displayTitle: run.display_title || run.name || null,
    };
}

export function summarizeJobs(jobs) {
    if (!Array.isArray(jobs)) return [];
    return jobs.map((j) => ({
        name: j.name || j.id || 'job',
        status: j.status || null,
        conclusion: j.conclusion || null,
        startedAt: j.started_at || null,
        completedAt: j.completed_at || null,
    }));
}

/**
 * queued | in_progress | waiting_host | published | failure | cancelled | unknown
 */
export function computeDeployPhase({ run, host, runId } = {}) {
    if (!run || !run.status) return 'unknown';
    if (run.status !== 'completed') {
        return run.status === 'queued' ? 'queued' : 'in_progress';
    }
    const conclusion = String(run.conclusion || '');
    if (conclusion && conclusion !== 'success') return conclusion;
    const hostRun = host && host.workflowRun != null ? String(host.workflowRun) : '';
    const id = runId != null ? String(runId) : (run.runId != null ? String(run.runId) : '');
    const hostSha = host && (host.sourceSha || host.sha);
    const runSha = run.headSha;
    if ((hostRun && id && hostRun === id) || shaMatches(hostSha, runSha)) return 'published';
    return 'waiting_host';
}

export async function githubJson(env, path, init = {}) {
    const token = String(env?.GH_ACTIONS_TOKEN || '').trim();
    if (!token) {
        return {
            ok: false,
            status: 500,
            error: 'Server misconfigured: set GH_ACTIONS_TOKEN on nexttrain-telemetry (fine-grained PAT, Actions read/write on next-train-astro only)',
        };
    }
    const res = await fetch(`${GH_API}${path}`, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': GH_API_VERSION,
            'User-Agent': 'nexttrain-telemetry',
            ...(init.headers || {}),
        },
    });
    if (res.status === 204) return { ok: true, status: 204, data: null };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.message || data?.error || `GitHub HTTP ${res.status}`;
        return {
            ok: false,
            status: 502,
            error: 'GitHub Actions API failed',
            details: data,
            githubStatus: res.status,
            message: msg,
        };
    }
    return { ok: true, status: res.status, data };
}

export async function loadHostDeployProvenance() {
    try {
        const res = await fetch(
            `https://raw.githubusercontent.com/${GH_HOST_REPO}/main/astro-deploy.json`,
            { headers: { 'User-Agent': 'nexttrain-telemetry', Accept: 'application/json' } },
        );
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function listDispatchRuns(env) {
    const path = `/repos/${GH_SOURCE_REPO}/actions/workflows/${GH_WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=10`;
    return githubJson(env, path);
}

function pickRunFromList(runs, { runId, sinceMs } = {}) {
    const list = Array.isArray(runs) ? runs : [];
    if (runId) {
        const id = String(runId);
        return list.find((r) => String(r.id) === id) || null;
    }
    if (sinceMs) {
        const floor = Number(sinceMs) - 8000;
        return list.find((r) => {
            const t = Date.parse(r.created_at || '');
            return Number.isFinite(t) && t >= floor && (r.head_branch === GH_SOURCE_REF || !r.head_branch);
        }) || null;
    }
    return list[0] || null;
}

export async function dispatchProductionDeploy(env, { dryRun = false, triggeredBy = null } = {}) {
    const dispatchedAt = Date.now();
    const posted = await githubJson(
        env,
        `/repos/${GH_SOURCE_REPO}/actions/workflows/${GH_WORKFLOW_FILE}/dispatches`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ref: GH_SOURCE_REF,
                inputs: {
                    confirm: 'DEPLOY',
                    dry_run: dryRun ? 'true' : 'false',
                },
            }),
        },
    );
    if (!posted.ok) return posted;

    let run = null;
    for (let i = 0; i < 10; i++) {
        await sleep(800);
        const listed = await listDispatchRuns(env);
        if (!listed.ok) continue;
        run = pickRunFromList(listed.data?.workflow_runs, { sinceMs: dispatchedAt });
        if (run) break;
    }

    return {
        ok: true,
        status: 200,
        dispatched: true,
        dryRun: !!dryRun,
        dispatchedAt,
        triggeredBy: triggeredBy || null,
        run: summarizeRun(run),
        message: run
            ? 'Workflow started'
            : 'Workflow accepted by GitHub; run id should appear on the next status poll',
    };
}

export async function getDeployStatus(env, { runId = null, sinceMs = null } = {}) {
    let runRaw = null;
    if (runId) {
        const one = await githubJson(env, `/repos/${GH_SOURCE_REPO}/actions/runs/${runId}`);
        if (!one.ok) return one;
        runRaw = one.data;
    } else {
        const listed = await listDispatchRuns(env);
        if (!listed.ok) return listed;
        runRaw = pickRunFromList(listed.data?.workflow_runs, { sinceMs });
        if (!runRaw) {
            return {
                ok: true,
                status: 200,
                run: null,
                jobs: [],
                hostDeploy: null,
                phase: 'idle',
                message: 'No production deploy run found',
            };
        }
    }

    const jobsRes = await githubJson(env, `/repos/${GH_SOURCE_REPO}/actions/runs/${runRaw.id}/jobs`);
    const jobs = jobsRes.ok ? summarizeJobs(jobsRes.data?.jobs) : [];
    const hostDeploy = await loadHostDeployProvenance();
    const run = summarizeRun(runRaw);
    const phase = computeDeployPhase({ run, host: hostDeploy, runId: runRaw.id });

    return {
        ok: true,
        status: 200,
        run,
        jobs,
        hostDeploy,
        phase,
        hostMatchesRun: phase === 'published',
    };
}
