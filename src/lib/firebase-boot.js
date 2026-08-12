/**
 * Firebase Auth + Storage + RTDB bootstrap (admin / feedback / passenger accounts).
 * Exposes SPA-compatible window.firebase* globals, then fires `firebase-auth-ready`.
 */
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    onIdTokenChanged,
    getIdToken,
    signInAnonymously,
    setPersistence,
    browserLocalPersistence,
    GoogleAuthProvider,
    signInWithPopup,
    updateProfile,
} from 'firebase/auth';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import {
    getDatabase,
    ref as dbRef,
    set,
    update,
    get,
    onValue,
    onChildAdded,
    onChildChanged,
    onChildRemoved,
    onDisconnect,
    remove,
    query,
    orderByChild,
    equalTo,
    limitToLast,
} from 'firebase/database';
import { getMessaging, getToken, onMessage, isSupported as isMessagingSupported } from 'firebase/messaging';

const firebaseConfig = {
    apiKey: 'AIzaSyAU303BRMrH3A5n5zbJH4MVwWdkfznqxMY',
    authDomain: 'metrorail-next-train.firebaseapp.com',
    databaseURL: 'https://metrorail-next-train-default-rtdb.firebaseio.com/',
    projectId: 'metrorail-next-train',
    storageBucket: 'metrorail-next-train.firebasestorage.app',
    messagingSenderId: '449872137774',
    appId: '1:449872137774:web:4a23055a6f6a9bfd14d9bf',
    measurementId: 'G-JM5DH6ERVX'
};

let _ready = false;

export async function bootFirebase() {
    if (typeof window === 'undefined') return;
    if (_ready) {
        window.dispatchEvent(new Event('firebase-auth-ready'));
        return;
    }

    try {
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        try {
            await setPersistence(auth, browserLocalPersistence);
        } catch (e) {
            console.warn('Firebase persistence unavailable', e);
        }

        window.firebaseAuth = auth;
        window.firebaseSignIn = signInWithEmailAndPassword;
        window.firebaseCreateUser = createUserWithEmailAndPassword;
        window.firebaseSignOut = signOut;
        window.firebaseOnAuthStateChanged = onAuthStateChanged;
        window.firebaseOnIdTokenChanged = onIdTokenChanged;
        window.firebaseGetIdToken = getIdToken;
        window.firebaseSignInAnonymously = signInAnonymously;
        window.firebaseSignInWithPopup = signInWithPopup;
        window.firebaseGoogleProvider = GoogleAuthProvider;
        window.firebaseUpdateProfile = updateProfile;

        window.firebaseStorage = getStorage(app);
        window.firebaseStorageRef = ref;
        window.firebaseUploadBytesResumable = uploadBytesResumable;
        window.firebaseGetDownloadURL = getDownloadURL;

        window.firebaseDb = getDatabase(app);
        window.firebaseDbRef = dbRef;
        window.firebaseDbSet = set;
        window.firebaseDbUpdate = update;
        window.firebaseDbGet = get;
        window.firebaseDbOnValue = onValue;
        window.firebaseDbOnChildAdded = onChildAdded;
        window.firebaseDbOnChildChanged = onChildChanged;
        window.firebaseDbOnChildRemoved = onChildRemoved;
        window.firebaseDbQuery = query;
        window.firebaseDbOrderByChild = orderByChild;
        window.firebaseDbEqualTo = equalTo;
        window.firebaseDbLimitToLast = limitToLast;
        window.firebaseDbOnDisconnect = onDisconnect;
        window.firebaseDbRemove = remove;

        // FCM is optional (Safari / insecure contexts / missing SW)
        try {
            const messagingOk = await isMessagingSupported();
            if (messagingOk) {
                window.firebaseMessaging = getMessaging(app);
                window.firebaseGetToken = getToken;
                window.firebaseOnMessage = onMessage;
            }
        } catch (msgErr) {
            console.warn('Firebase Messaging unavailable', msgErr);
        }

        _ready = true;
    } catch (e) {
        console.warn('🛡️ Guardian: Firebase failed to load (Offline Mode). Cloud features restricted.', e);
    } finally {
        window.dispatchEvent(new Event('firebase-auth-ready'));
    }
}
