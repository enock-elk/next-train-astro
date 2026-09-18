/**
 * Firebase Messaging background handler bridge.
 * Imported into the Workbox service worker via importScripts.
 * Keep config in sync with src/lib/firebase-boot.js.
 *
 * Notification-payload FCM (Dev Hub) is displayed by Chrome using
 * webpush.notification.icon/badge from the Worker. Data-only payloads
 * (Firebase Console custom data, no Notification title) hit
 * onBackgroundMessage so we can still attach the Next Train icon.
 */
/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js');

function ntPushAsset(name) {
  try {
    return new URL(`icons/${name}`, self.registration.scope).href;
  } catch (e) {
    return `https://nexttrain.co.za/icons/${name}`;
  }
}

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
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const n = payload && payload.notification ? payload.notification : {};
    const d = payload && payload.data ? payload.data : {};
    const title = String(n.title || d.title || 'Next Train');
    const body = String(n.body || d.body || '');
    return self.registration.showNotification(title, {
      body,
      icon: ntPushAsset('loading-logo.png'),
      badge: ntPushAsset('loading-logo.png'),
      data: d,
    });
  });
} catch (e) {
  // Already initialized or offline — ignore
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification && event.notification.data && event.notification.data.link;
  const url = typeof link === 'string' && /^https:\/\/(www\.)?nexttrain\.co\.za\b/.test(link)
    ? link
    : self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
