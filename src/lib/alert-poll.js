/**
 * Alert poll chrome — feed, notice modal, and live percentages.
 * Percentages always. Optional raw counts in brackets. Vote lists stay on Firebase polls/{id}.
 * Results stay hidden until this device has voted, unless the poll is already closed.
 * A closed poll shows the tally to everyone, including people who never voted.
 * poll.active means this notice has a poll. Voting window is poll.closesAt
 * (missing inherits notice.expiresAt, or stays open).
 * allowMultiple (off by default) lets one uid pick several options before submit.
 */
import { DYNAMIC_BASE_URL } from './config.js';
import { escapeHTML, safeStorage } from './utils.js';

export function pollSeverity(value) {
    const s = String(value || 'info').toLowerCase();
    if (s === 'critical' || s === 'warning') return s;
    return 'info';
}

export function noticeHasPoll(node) {
    const poll = node?.poll;
    return !!(poll && typeof poll === 'object' && (poll.active || poll.question || poll.optionA || poll.optionB));
}

export function withPollTiming(poll, notice = null) {
    if (!poll || typeof poll !== 'object') return poll;
    return {
        ...poll,
        closesAt: Number(poll.closesAt) || 0,
        expiresAt: Number(notice?.expiresAt || poll.expiresAt) || 0,
        allowMultiple: !!poll.allowMultiple,
    };
}

/** Dedicated poll close. Missing closesAt inherits alert expiry, else stays open. */
export function pollClosesAt(poll) {
    const explicit = Number(poll?.closesAt);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const inherited = Number(poll?.expiresAt);
    if (Number.isFinite(inherited) && inherited > 0) return inherited;
    return 0;
}

export function isPollOpen(poll, now = Date.now()) {
    if (!poll) return false;
    const until = pollClosesAt(poll);
    if (!until) return true;
    return until > now;
}

export function pollAllowsMultiple(poll) {
    return !!(poll && poll.allowMultiple);
}

/** Normalize stored vote marker ("A" or "A,B") into unique A/B/C keys. */
export function parseVotedPollKeys(raw) {
    if (Array.isArray(raw)) {
        return [...new Set(raw.map((k) => String(k || '').toUpperCase()).filter((k) => k === 'A' || k === 'B' || k === 'C'))];
    }
    const text = String(raw || '').trim();
    if (!text) return [];
    return [...new Set(
        text.split(/[,|]/).map((k) => k.trim().toUpperCase()).filter((k) => k === 'A' || k === 'B' || k === 'C')
    )];
}

export function formatVotedPollKeys(keys) {
    return parseVotedPollKeys(keys).join(',');
}

export function tallyPollVotes(pollData) {
    let A = 0;
    let B = 0;
    let C = 0;
    if (pollData && typeof pollData === 'object') {
        Object.entries(pollData).forEach(([key, vote]) => {
            if (key === '_meta' || String(key || '').startsWith('_')) return;
            if (!vote || typeof vote !== 'object') return;
            const keys = parseVotedPollKeys(vote.optionKeys || vote.optionKey);
            if (!keys.length) return;
            keys.forEach((k) => {
                if (k === 'A') A += 1;
                else if (k === 'B') B += 1;
                else if (k === 'C') C += 1;
            });
        });
    }
    return { A, B, C, total: A + B + C };
}

export function readVotedPollOption(pollId) {
    if (!pollId) return '';
    try {
        return formatVotedPollKeys(safeStorage.getItem('poll_voted_' + pollId) || '');
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
    parseVotedPollKeys(seedVote).forEach((key) => {
        if (key === 'A' && next.A === 0) next.A = 1;
        else if (key === 'B' && next.B === 0) next.B = 1;
        else if (key === 'C' && next.C === 0) next.C = 1;
    });
    next.total = next.A + next.B + next.C;
    return next;
}

export function pollShowsRawCounts(poll) {
    return !!(poll && (poll.showRawCounts || poll.showParticipantCount));
}

/** Stack Yes/No/Maybe in one row; long answer text gets a full-width column. */
export function pollChoicesNeedStack(poll) {
    if (!poll) return false;
    return [poll.optionA, poll.optionB, poll.optionC]
        .filter(Boolean)
        .some((text) => String(text).trim().length > 18);
}

/** Green pulse while open, red static when closed. Text is NEXT TRAIN [dot] ACTIVE/INACTIVE POLL. */
export function buildPollLiveLabelHtml({ open = true } = {}) {
    const on = !!open;
    return `<p class="nt-poll-foot">
        <span class="nt-poll-live">
            <span class="nt-poll-live-text">NEXT TRAIN</span>
            <span class="nt-poll-live-dot${on ? ' is-on' : ' is-off'}" aria-hidden="true"></span>
            <span class="nt-poll-live-text">${on ? 'ACTIVE POLL' : 'INACTIVE POLL'}</span>
        </span>
    </p>`;
}

function pollViewResultsButton() {
    return `<button type="button" class="nt-poll-view-results" data-poll-view-results>View Poll Results</button>`;
}

function pollMultiSubmitButton() {
    return `<button type="button" class="nt-poll-submit" data-poll-submit disabled>Submit vote</button>`;
}

export function buildPollResultsHtml({
    poll,
    counts = { A: 0, B: 0, C: 0, total: 0 },
    votedOption = '',
    includeQuestion = true,
} = {}) {
    if (!poll) return '';
    const votedKeys = parseVotedPollKeys(votedOption);
    const total = Number(counts.total || ((counts.A || 0) + (counts.B || 0) + (counts.C || 0)));
    const pct = (n) => (total > 0 ? Math.round((Number(n) || 0) / total * 100) : 0);
    const raw = pollShowsRawCounts(poll);
    const row = (key, label, n) => {
        if (!label) return '';
        const p = pct(n);
        const mine = votedKeys.includes(key);
        const value = raw ? `${p}% (${Number(n) || 0})` : `${p}%`;
        return `
            <div class="nt-poll-row${mine ? ' is-mine' : ''}">
                <div class="nt-poll-row-head">
                    <span class="nt-poll-label">${escapeHTML(label)}${mine ? '<span class="nt-poll-yours">Your vote</span>' : ''}</span>
                    <span class="nt-poll-pct">${escapeHTML(value)}</span>
                </div>
                <div class="nt-poll-track" aria-hidden="true">
                    <div class="nt-poll-fill" style="width:${p}%"></div>
                </div>
            </div>`;
    };
    const liveMark = buildPollLiveLabelHtml({ open: isPollOpen(poll) });
    const question = includeQuestion && poll.question
        ? `<p class="nt-poll-q">${escapeHTML(poll.question)}</p>`
        : '';
    return `${liveMark}
        ${question}
        ${row('A', poll.optionA, counts.A)}
        ${row('B', poll.optionB, counts.B)}
        ${poll.optionC ? row('C', poll.optionC, counts.C) : ''}`;
}

export function buildPollThanksHtml(poll = null) {
    return `${buildPollLiveLabelHtml({ open: isPollOpen(poll) })}
        <p class="nt-poll-thanks">Thanks for voting!</p>`;
}

function pollChoiceButtons(pollId, poll) {
    const btn = (key, text) => text
        ? `<button type="button" data-poll-id="${escapeHTML(pollId)}" data-poll-opt="${key}" data-poll-text="${escapeHTML(text)}" class="nt-poll-vote">${escapeHTML(text)}</button>`
        : '';
    const stack = pollChoicesNeedStack(poll) ? ' nt-poll-choices--stack' : '';
    const multi = pollAllowsMultiple(poll) ? ' data-poll-multi="1"' : '';
    return `<div class="nt-poll-choices${stack}"${multi}>${btn('A', poll.optionA)}${btn('B', poll.optionB)}${btn('C', poll.optionC)}</div>`;
}

function pollMetaJson(poll, severity) {
    return JSON.stringify({
        question: poll.question || '',
        optionA: poll.optionA || '',
        optionB: poll.optionB || '',
        optionC: poll.optionC || '',
        showResults: !!poll.showResults,
        showRawCounts: pollShowsRawCounts(poll),
        allowMultiple: pollAllowsMultiple(poll),
        active: poll.active !== false,
        closesAt: Number(poll.closesAt) || 0,
        expiresAt: Number(poll.expiresAt) || 0,
        severity,
    });
}

export function buildPollShellHtml(notice, { mode = 'live' } = {}) {
    if (!notice?.poll?.active) return '';
    const poll = withPollTiming(notice.poll, notice);
    const pollId = String(notice.id || 'preview');
    const severity = pollSeverity(notice.severity || poll.severity);
    const showResults = !!poll.showResults;
    const open = isPollOpen(poll);
    const multi = pollAllowsMultiple(poll);
    const voted = mode === 'live' ? readVotedPollOption(pollId) : '';
    const idAttr = escapeHTML(pollId);
    const metaAttr = escapeHTML(pollMetaJson(poll, severity));
    const attrs = `id="poll-container-${idAttr}" data-poll-shell="${idAttr}" data-poll-meta="${metaAttr}" data-poll-severity="${escapeHTML(severity)}" data-poll-open="${open ? '1' : '0'}"${multi ? ' data-poll-multi="1"' : ''} class="nt-poll"`;
    const liveMark = buildPollLiveLabelHtml({ open });

    if (!open) {
        return `<div ${attrs}><div class="nt-poll-results" data-poll-hydrate="1" data-poll-id="${idAttr}" data-poll-voted="${escapeHTML(voted)}" data-poll-closed="1">${buildPollResultsHtml({
            poll,
            counts: { A: 0, B: 0, C: 0, total: 0 },
            votedOption: voted,
            includeQuestion: true,
        })}</div></div>`;
    }

    if (voted && !showResults) {
        return `<div ${attrs}>${buildPollThanksHtml(poll)}</div>`;
    }

    // Results stay off until this device has voted. Preview is unvoted.
    if (voted && showResults) {
        return `<div ${attrs}><div class="nt-poll-results" data-poll-hydrate="1" data-poll-id="${idAttr}" data-poll-voted="${escapeHTML(voted)}">${buildPollResultsHtml({
            poll,
            counts: { A: 0, B: 0, C: 0, total: 0 },
            votedOption: voted,
            includeQuestion: true,
        })}</div></div>`;
    }

    return `<div ${attrs}>
        ${liveMark}
        <p class="nt-poll-q">${escapeHTML(poll.question || '')}</p>
        ${pollChoiceButtons(pollId, poll)}
        ${multi ? pollMultiSubmitButton() : ''}
        ${pollViewResultsButton()}
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
        const closed = container.getAttribute('data-poll-closed') === '1';
        container.innerHTML = buildPollResultsHtml({
            poll,
            counts,
            votedOption,
            includeQuestion: closed || !nested || !!votedOption,
        });
        if (nested) container.classList.add('nt-poll-results');
    } catch {
        if (nested && !votedOption) {
            container.innerHTML = `<p class="nt-poll-foot">Results are not available right now.</p>`;
            return;
        }
        container.innerHTML = buildPollThanksHtml(poll);
    }
}

export function hydratePollResults(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('[data-poll-hydrate="1"]').forEach((el) => {
        const pollId = el.getAttribute('data-poll-id') || '';
        if (!pollId || pollId === 'preview') return;
        const voted = el.getAttribute('data-poll-voted') || '';
        const closed = el.getAttribute('data-poll-closed') === '1';
        if (!voted && !closed) return;
        const shell = el.closest('[data-poll-shell]');
        let poll = null;
        try {
            poll = JSON.parse(shell?.dataset?.pollMeta || 'null');
        } catch {
            poll = null;
        }
        if (!poll) return;
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
            container.innerHTML = buildPollThanksHtml(pollMeta);
        }
    });
}

/** Shake vote buttons the same way the empty board shakes Select station. */
export function shakePollVoteButtons(wrap) {
    if (!wrap || typeof wrap.querySelectorAll !== 'function') return;
    wrap.querySelectorAll('.nt-poll-vote').forEach((btn) => {
        btn.classList.add('animate-shake', 'ring-4', 'ring-blue-300');
        setTimeout(() => btn.classList.remove('animate-shake', 'ring-4', 'ring-blue-300'), 500);
    });
}

export function syncPollMultiSubmitState(wrap) {
    if (!wrap) return;
    const submit = wrap.querySelector('[data-poll-submit]');
    if (!submit) return;
    const selected = wrap.querySelectorAll('.nt-poll-vote.is-selected').length;
    submit.disabled = selected < 1;
}
