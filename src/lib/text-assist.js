/**
 * Operator writing assist. The worker calls Gemini. The browser only
 * sends the text already in the field and puts the result back on Replace.
 */

export const TEXT_ASSIST_MAX = 4000;

export const TEXT_ASSIST_ACTIONS = [
    { id: 'grammar', label: 'Grammar' },
    { id: 'summarise', label: 'Summarise' },
    { id: 'bullets', label: 'Bullet points' },
    { id: 'professional', label: 'Professional' },
    { id: 'calm', label: 'Calm' },
    { id: 'friendly', label: 'Friendly' },
    { id: 'direct', label: 'Direct' },
    { id: 'compose', label: 'Compose' },
];

const ACTION_IDS = new Set(TEXT_ASSIST_ACTIONS.map((action) => action.id));

export function sanitizeTextAssist(input) {
    const source = input && typeof input === 'object' ? input : {};
    const action = ACTION_IDS.has(source.action) ? source.action : '';
    const text = String(source.text || '').replace(/\r\n/g, '\n').trim().slice(0, TEXT_ASSIST_MAX);
    return { action, text };
}

const READABLE_LAYOUT = [
    'Lay it out so it is comfortable to read. Do not return one long block.',
    'When the note has a subject, put a short title on the first line, then a blank line.',
    'Use short paragraphs. One or two sentences in each. Leave a blank line between paragraphs.',
].join(' ');

function actionJob(action) {
    if (action === 'summarise') return `Make it shorter. Keep every fact that is already in the text. ${READABLE_LAYOUT}`;
    if (action === 'bullets') return 'Turn it into short bullet lines. One fact on each line. Start each line with "- ". A short title may sit on the first line, then a blank line, then the bullets.';
    if (action === 'professional') return `Rewrite it in a professional tone. Keep the same facts. ${READABLE_LAYOUT}`;
    if (action === 'calm') return `Rewrite it in a calm tone. Keep the same facts. ${READABLE_LAYOUT}`;
    if (action === 'friendly') return `Rewrite it in a friendly tone. Keep the same facts. ${READABLE_LAYOUT}`;
    if (action === 'direct') return `Rewrite it so it is direct and easy to scan. Keep the same facts. ${READABLE_LAYOUT}`;
    if (action === 'compose') return `Turn this note into a short notice a commuter can read. Use only facts that are already in the note. ${READABLE_LAYOUT}`;
    return `Fix spelling and grammar. Keep the same meaning, names, numbers, and order. ${READABLE_LAYOUT}`;
}

export function textAssistRules(action) {
    return [
        'You edit text for an operator at Metrorail Next Train. Return JSON only.',
        actionJob(action),
        'Do not invent a date, time, train number, station, fare, cause, or reopening that is not in the text.',
        'South African English. No em dashes.',
        'The text field is the whole result, ready to paste back.',
    ].join('\n');
}

export function buildTextAssistRequest({ text, action } = {}) {
    const clean = sanitizeTextAssist({ text, action });
    if (!clean.action) throw new Error('Pick a writing action.');
    if (!clean.text) throw new Error('Select or type some text first.');
    return {
        systemInstruction: { parts: [{ text: textAssistRules(clean.action) }] },
        contents: [{ role: 'user', parts: [{ text: clean.text }] }],
        generationConfig: {
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
            },
            thinkingConfig: { thinkingLevel: 'MINIMAL' },
        },
    };
}

/** Break a single block into a title and short paragraphs when the model did not. */
export function comfortAssistText(text) {
    let value = String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!value) return '';
    if (/\n\s*\n/.test(value) || /^\s*[-*] /m.test(value)) return value;
    const sentences = value
        .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
        .map((part) => part.trim())
        .filter(Boolean);
    if (sentences.length < 2) return value;
    const blocks = [];
    let buf = '';
    sentences.forEach((sentence) => {
        if (buf && buf.length >= 48) {
            blocks.push(buf);
            buf = sentence;
            return;
        }
        buf = buf ? `${buf} ${sentence}` : sentence;
    });
    if (buf) blocks.push(buf);
    if (blocks.length < 2) return blocks.join('\n\n') || value;
    const labelled = blocks[0].match(/^([^:\n]{3,42}):\s+([\s\S]+)$/);
    if (labelled) {
        return `${labelled[1].trim()}\n\n${labelled[2].trim()}\n\n${blocks.slice(1).join('\n\n')}`.replace(/\n{3,}/g, '\n\n').trim();
    }
    return blocks.join('\n\n');
}

function escapeAssistHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Paragraphs and a short title for the rich editor. Text is escaped. */
export function assistHtmlFromText(text) {
    const value = comfortAssistText(text);
    if (!value) return '';
    const blocks = value.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
    return blocks.map((block, index) => {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
        const bullets = lines.length > 0 && lines.every((line) => /^[-*] /.test(line));
        if (bullets) {
            return `<ul>${lines.map((line) => `<li>${escapeAssistHtml(line.replace(/^[-*] /, ''))}</li>`).join('')}</ul>`;
        }
        const title = index === 0
            && blocks.length > 1
            && lines.length === 1
            && lines[0].length <= 48
            && !/[.!?]$/.test(lines[0]);
        if (title) return `<p><strong>${escapeAssistHtml(lines[0])}</strong></p>`;
        return `<p>${lines.map(escapeAssistHtml).join('<br>')}</p>`;
    }).join('');
}

export function parseTextAssistResult(raw) {
    let data = raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        try {
            data = JSON.parse(trimmed);
        } catch {
            return '';
        }
    }
    return comfortAssistText(String(data?.text || '')
        .replace(/[\u2014\u2013]/g, ', ')
        .trim())
        .slice(0, TEXT_ASSIST_MAX);
}
