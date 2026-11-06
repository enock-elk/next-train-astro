/**
 * Firebase email-link handler for /auth-action.html.
 * Unused until the console action URL points here.
 */
import { bootFirebase } from './firebase-boot.js';
import { withBase } from './config.js';

function homeUrl(verified) {
    const url = new URL(withBase(''), location.origin);
    if (verified) url.searchParams.set('verified', '1');
    return `${url.pathname}${url.search}`;
}

export async function runAuthAction() {
    const params = new URLSearchParams(location.search);
    const mode = params.get('mode') || '';
    const code = params.get('oobCode') || '';
    const title = document.getElementById('auth-action-title');
    const copy = document.getElementById('auth-action-copy');
    const form = document.getElementById('auth-reset-form');
    const home = document.getElementById('auth-action-home');
    const password = document.getElementById('auth-reset-password');

    const showHome = (heading, message) => {
        if (title) title.textContent = heading;
        if (copy) copy.textContent = message;
        home?.classList.remove('hidden');
    };

    await bootFirebase();
    const auth = window.firebaseAuth;
    if (!auth || !code) {
        showHome('Open Next Train', 'This link is missing a step. Go back to the app and try again.');
        return;
    }
    if (mode === 'verifyEmail' && typeof window.firebaseApplyActionCode === 'function') {
        try {
            await window.firebaseApplyActionCode(auth, code);
            location.replace(homeUrl(true));
        } catch {
            showHome('Email already checked', 'If you opened the link, your email is verified. Sign in on Next Train.');
        }
        return;
    }
    if (mode === 'resetPassword' && typeof window.firebaseVerifyPasswordResetCode === 'function') {
        try {
            const email = await window.firebaseVerifyPasswordResetCode(auth, code);
            if (title) title.textContent = 'Choose a new password';
            if (copy) copy.textContent = email ? `For ${email}.` : 'Enter a new password for this account.';
            form?.classList.remove('hidden');
            form?.addEventListener('submit', async (event) => {
                event.preventDefault();
                const next = password instanceof HTMLInputElement ? password.value : '';
                if (next.length < 6) {
                    if (copy) copy.textContent = 'Use at least 6 characters.';
                    return;
                }
                try {
                    await window.firebaseConfirmPasswordReset(auth, code, next);
                    location.replace(homeUrl(false));
                } catch {
                    if (copy) copy.textContent = 'That link has expired. Ask for a new password email from Account.';
                }
            });
        } catch {
            showHome('Link expired', 'Ask for a new password email from Account, then open the new link.');
        }
        return;
    }
    if (typeof window.firebaseApplyActionCode === 'function') {
        try {
            await window.firebaseApplyActionCode(auth, code);
            location.replace(homeUrl(false));
        } catch {
            showHome('Open Next Train', 'This link could not be finished. Go back to the app.');
        }
        return;
    }
    showHome('Open Next Train', 'Go back to the app to continue.');
}
