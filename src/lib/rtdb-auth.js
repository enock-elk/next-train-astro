/**
 * Anonymous-or-signed-in ID token for RTDB REST writes.
 * Guests already use this path for polls, feedback, and planner telemetry.
 * Never required on the live board read path.
 */
export async function rtdbAuthQuery() {
    if (typeof window === 'undefined') return '';
    try {
        if (!window.firebaseAuth) {
            const { bootFirebase } = await import('./firebase-boot.js');
            await bootFirebase();
        }
        if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
            await window.firebaseSignInAnonymously(window.firebaseAuth);
        }
        if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
            const token = await window.firebaseGetIdToken(window.firebaseAuth.currentUser, false);
            return token ? `?auth=${encodeURIComponent(token)}` : '';
        }
    } catch {
        /* caller decides whether a missing token is fatal */
    }
    return '';
}
