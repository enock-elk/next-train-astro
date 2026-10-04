/**
 * Alert poll chrome — feed, notice modal, and live percentages.
 * Percentages only. Vote lists stay on Firebase polls/{id}.
 */
import { DYNAMIC_BASE_URL } from './config.js';
import { escapeHTML, safeStorage } from './utils.js';

export function pollSeverity(value) {
    const s = String(value || 'info').toLowerCase();
    if (s === 'critical' || s === 'warning') return s;
    return 'info';
}

export function tallyPollVotes(pollData) {
    let A = 0;
    let B = 0;
    let C = 0;
    if (pollData && typeof pollData === 'object') {
        Object.values(pollData).forEach((vote) => {
            if (!vote || typeof vote !== 'object') return;
            if (vote.optionKey === 'A') A += 1;
            else if (vote.optionKey === 'B') B += 1;
            else if (vote.optionKey === 'C') C += 1;
        });
    }
    return { A, B, C, total: A + B + C };
}

export function readVotedPollOption(pollId) {
    if (!pollId) return '';
    try {
        return safeStorage.getItem('poll_voted_' + pollId) || '';
    } catch {
        return '';
    }
}

function seedTallies(counts, seedVote) {
    const next = {
        A: Number(counts?.A || 0),
        B: Number(counts?.B || 0),
        C: Number(counts?.C || 0),
    };
    if (seedVote === 'A' && next.A === 0) next.A = 1;
    else if (seedVote === 'B' && next.B === 0) next.B = 1;
    else if (seedVote === 'C' && next.C === 0) next.C = 1;
    next.total = next.A + next.B + next.C;
    return next;
}

export function buildPollResultsHtml({
    poll,
    counts = { A: 0, B: 0, C: 0, total: 0 },
    votedOption = '',
    includeQuestion = true,
} = {}) {
    if (!poll) return '';
    const total = Number(counts.total || ((counts.A || 0) + (counts.B || 0) + (counts.C || 0)));
    const pct = (n) => (total > 0 ? Math.round((Number(n) || 0) / total * 100) : 0);
    const row = (key, label, n) => {
        if (!label) return '';
        const p = pct(n);
        const mine = votedOption === key;
        return `
            <div class="nt-poll-row${mine ? ' is-mine' : ''}">
                <div class="nt-poll-row-head">
                    <span class="nt-poll-label">${escapeHTML(label)}${mine ? '<span class="nt-poll-yours">Your vote</span>' : ''}</span>
                    <span class="nt-poll-pct">${p}%</span>
                </div>
                <div class="nt-poll-track" aria-hidden="true">
                    <div class="nt-poll-fill" style="width:${p}%"></div>
                </div>
            </div>`;
    };
    const question = includeQuestion && poll.question
        ? `<p class="nt-poll-q">${escapeHTML(poll.question)}</p>`
        : '';
    return `${question}
        ${row('A', poll.optionA, counts.A)}
        ${row('B', poll.optionB, counts.B)}
        ${poll.optionC ? row('C', poll.optionC, counts.C) : ''}
        <p class="nt-poll-foot">Live percentages</p>`;
}

export function buildPollThanksHtml() {
    return `<p class="nt-poll-thanks">Thanks for voting!</p>
        <p class="nt-poll-foot">Your response has been recorded.</p>`;
}

function pollChoiceButtons(pollId, poll) {
    const btn = (key, text) => text
        ? `<button type="button" data-poll-id="${escapeHTML(pollId)}" data-poll-opt="${key}" data-poll-text="${escapeHTML(text)}" class="nt-poll-vote">${escapeHTML(text)}</button>`
        : '';
    return `<div class="nt-poll-choices">${btn('A', poll.optionA)}${btn('B', poll.optionB)}${btn('C', poll.optionC)}</div>`;
}

function pollMetaJson(poll, severity) {
    return JSON.stringify({
        question: poll.question || '',
        optionA: poll.optionA || '',
        optionB: poll.optionB || '',
        optionC: poll.optionC || '',
        showResults: !!poll.showResults,
        severity,
    });
}

export function buildPollShellHtml(notice, { mode = 'live' } = {}) {
    if (!notice?.poll?.active) return '';
    const poll = notice.poll;
    const pollId = String(notice.id || 'preview');
    const severity = pollSeverity(notice.severity || poll.severity);
    const showResults = !!poll.showResults;
    const voted = mode === 'live' ? readVotedPollOption(pollId) : '';
    const idAttr = escapeHTML(pollId);
    const metaAttr = escapeHTML(pollMetaJson(poll, severity));
    const attrs = `id="poll-container-${idAttr}" data-poll-shell="${idAttr}" data-poll-meta="${metaAttr}" data-poll-severity="${escapeHTML(severity)}" class="nt-poll"`;

    if (voted && !showResults) {
        return `<div ${attrs}>${buildPollThanksHtml()}</div>`;
    }

    const resultsBox = showResults
        ? `<div class="nt-poll-results" data-poll-hydrate="1" data-poll-id="${idAttr}" data-poll-voted="${escapeHTML(voted)}">${buildPollResultsHtml({
            poll,
            counts: { A: 0, B: 0, C: 0, total: 0 },
            votedOption: voted,
            includeQuestion: !!voted,
        })}</div>`
        : '';

    if (voted && showResults) {
        return `<div ${attrs}>${resultsBox}</div>`;
    }

    return `<div ${attrs}>
        <p class="nt-poll-q">${escapeHTML(poll.question || '')}</p>
        ${pollChoiceButtons(pollId, poll)}
        ${resultsBox}
    </div>`;
}

export async function fetchPollTallies(pollId, { seedVote = null } = {}) {
    if (!pollId || pollId === 'preview') return seedTallies({ A: 0, B: 0, C: 0 }, seedVote);
    const res = await fetch(`${DYNAMIC_BASE_URL}polls/${encodeURIComponent(pollId)}.json?t=${Date.now()}`);
    const data = res.ok ? await res.json() : null;
    return seedTallies(tallyPollVotes(data), seedVote);
}

export async function renderPollResultsInto(container, pollId, poll, votedOption = '', _severity = 'info', seedVote = null) {
    if (!container || !pollId || !poll) return;
    const nested = container.hasAttribute('data-poll-hydrate') || String(container.id || '').startsWith('poll-live-results');
    try {
        const counts = await fetchPollTallies(pollId, { seedVote });
        container.innerHTML = buildPollResultsHtml({
            poll,
            counts,
            votedOption,
            includeQuestion: !nested || !!votedOption,
        });
        if (nested) container.classList.add('nt-poll-results');
    } catch {
        if (nested && !votedOption) {
            container.innerHTML = `<p class="nt-poll-foot">Results are not available right now.</p>`;
            return;
        }
        container.innerHTML = buildPollThanksHtml();
    }
}

export function hydratePollResults(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('[data-poll-hydrate="1"]').forEach((el) => {
        const pollId = el.getAttribute('data-poll-id') || '';
        if (!pollId || pollId === 'preview') return;
        const shell = el.closest('[data-poll-shell]');
        let poll = null;
        try {
            poll = JSON.parse(shell?.dataset?.pollMeta || 'null');
        } catch {
            poll = null;
        }
        if (!poll) return;
        const voted = el.getAttribute('data-poll-voted') || '';
        renderPollResultsInto(el, pollId, poll, voted, poll.severity);
    });
}

function pollShellSelector(pollId) {
    const safe = String(pollId || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `[data-poll-shell="${safe}"]`;
}

export function paintPollShellsAfterVote(pollId, pollMeta, optionKey, severity) {
    if (!pollId || typeof document === 'undefined') return;
    const shells = document.querySelectorAll(pollShellSelector(pollId));
    const list = shells.length
        ? shells
        : [document.getElementById(`poll-container-${pollId}`)].filter(Boolean);
    list.forEach((container) => {
        if (!container) return;
        if (pollMeta?.showResults) {
            container.dataset.pollSeverity = pollSeverity(severity || pollMeta.severity);
            renderPollResultsInto(container, pollId, pollMeta, optionKey, severity, optionKey);
        } else {
            container.innerHTML = buildPollThanksHtml();
        }
    });
}
