# Firebase Cloud Messaging setup

The app receives Firebase Cloud Messaging (FCM) notifications through its existing
Astro/Workbox service worker. The `nexttrain-community` Worker is the trusted
sender. Firebase Installation IDs (with legacy-token compatibility) stay in the existing RTDB
`push_subscriptions/{deviceId}` tree.

Never put a service-account private key in Astro, GitHub Pages, Cloudflare Pages,
`PUBLIC_*` variables, or browser code.

## 1. Enable Firebase Notification messages

1. Open Firebase Console → **Messaging**.
2. Choose **Create your first campaign**.
3. Select **Firebase Notification messages**, not Firebase In-App Messaging.
4. You may cancel the campaign composer. Opening it completes Messaging
   onboarding; normal sends come from Next Train's Dev Hub.

## 2. Generate the Web Push public key

1. Firebase Console → Project settings → **Cloud Messaging**.
2. Under **Web configuration** → **Web Push certificates**, copy the existing
   key pair or generate one if none exists.
3. Copy the public key.

Add that same value as `PUBLIC_FIREBASE_VAPID_KEY` in:

- GitHub repository Actions secrets.
- Cloudflare Pages project `next-train-lab`, for both Production and Preview.

The VAPID public key is safe for browser delivery, but the repo uses build
secrets/variables so each deployment channel receives it consistently.

## 3. Authorize the trusted sender

In Google Cloud Console for `metrorail-next-train`:

1. Confirm **Firebase Cloud Messaging API (HTTP v1)** is enabled.
2. IAM & Admin → IAM.
3. Give
   `nexttrain-telemetry@metrorail-next-train.iam.gserviceaccount.com`
   the **Firebase Cloud Messaging API Admin** role.

If Dev Hub **Count devices** works but send returns **Sent 0 of N** with
**removed 0 invalid tokens**, this IAM grant or the FCM API enablement is
still missing. Count only reads RTDB; send needs FCM Admin on that same
service account. Do not rotate the Worker key for this symptom.

The Worker already uses this service account for RTDB. Do not create a second key
unless the existing Worker secret is missing or has been revoked.

Check the Worker secret:

```bash
cd workers/nexttrain-community
npx -y wrangler@latest secret list
```

If `FIREBASE_PRIVATE_KEY` is missing, set the existing service account's private
key interactively:

```bash
npx -y wrangler@latest secret put FIREBASE_PRIVATE_KEY
```

Then deploy the sender:

```bash
npx -y wrangler@latest deploy --keep-vars
```

## 4. Deploy the subscription rules

Authenticate with the Firebase account that owns `metrorail-next-train`, then:

```bash
npx -y firebase-tools@latest use metrorail-next-train
npx -y firebase-tools@latest deploy --only database
```

If the CLI shows the wrong account:

```bash
npx -y firebase-tools@latest login --reauth --no-localhost
```

## 5. Build and publish the app

Run the production workflow after `PUBLIC_FIREBASE_VAPID_KEY` exists:

**Deploy production → metrorail-app**, with `confirm=DEPLOY`.

The key is inlined at build time, so adding it after a build does not repair that
already-built release.

## 6. Test delivery

1. Use HTTPS. Notifications do not work from an insecure origin.
2. Sign in as an operator.
3. Account → Notifications → enable it and accept the browser prompt.
4. Dev Hub → Notifications.
5. Start with **Lab / previews**, select an audience, and choose **Count devices**.
6. Send a short test notification.
7. Put the app in the background and confirm the system notification opens the
   selected Next Train route or region.

Operator accounts can register before commuter rollout is enabled. To enrol
commuters in production, enable **Push notifications** for the intended routes
under Dev Hub → Experimental features (`config/features/pushNotify`). Start with
the pilot routes before selecting everyone.

Android Chrome and installed PWAs support this flow. On iPhone/iPad, Web Push
requires iOS/iPadOS 16.4 or later and Next Train added to the Home Screen.

Turning Notifications off marks the stored registration disabled. Each app
startup refreshes enabled registrations, and the sender removes registrations
FCM reports as invalid.
