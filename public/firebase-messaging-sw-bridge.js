/**
 * Firebase Messaging background handler bridge.
 * Imported into the Workbox service worker via importScripts.
 * Keep config in sync with src/lib/firebase-boot.js.
 */
/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js');

try {
  firebase.initializeApp({
    apiKey: 'AIzaSyAU303BRMrH3A5n5zbJH4MVwWdkfznqxMY',
    authDomain: 'metrorail-next-train.firebaseapp.com',
    databaseURL: 'https://metrorail-next-train-default-rtdb.firebaseio.com/',
    projectId: 'metrorail-next-train',
    storageBucket: 'metrorail-next-train.firebasestorage.app',
    messagingSenderId: '449872137774',
    appId: '1:449872137774:web:4a23055a6f6a9bfd14d9bf',
    measurementId: 'G-JM5DH6ERVX',
  });
  firebase.messaging();
} catch (e) {
  // Already initialized or offline — ignore
}
