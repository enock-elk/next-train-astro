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

function actionJob(action) {
    if (action === 'summarise') return 'Make it shorter. Keep every fact that is already in the text.';
    if (action === 'bullets') return 'Turn it into short bullet lines. One fact on each line. Start each line with "- ".';
    if (action === 'professional') return 'Rewrite it in a professional tone. Keep the same facts.';
    if (action === 'calm') return 'Rewrite it in a calm tone. Keep the same facts.';
    if (action === 'friendly') return 'Rewrite it in a friendly tone. Keep the same facts.';
    if (action === 'direct') return 'Rewrite it so it is direct and easy to scan. Keep the same facts.';
    if (action === 'compose') return 'Turn this note into a short notice a commuter can read. Use only facts that are already in the note.';
    return 'Fix spelling and grammar. Keep the same meaning, names, numbers, and order.';
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
    return String(data?.text || '')
        .replace(/[\u2014\u2013]/g, ', ')
        .trim()
        .slice(0, TEXT_ASSIST_MAX);
}
