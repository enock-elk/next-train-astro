# Trusted Web Activity / Play Store

Next Train’s web PWA is the product surface. The Play listing is a **Trusted Web Activity** shell that opens `https://nexttrain.co.za` fullscreen when Digital Asset Links verify.

## Package identity

| Field | Value |
|-------|--------|
| Application ID | `za.co.nexttrain.app` |
| Host | `nexttrain.co.za` |
| Web manifest | `https://nexttrain.co.za/manifest.json` |
| DAL file | `https://nexttrain.co.za/.well-known/assetlinks.json` |
| Bubblewrap config | [`twa/twa-manifest.json`](../twa/twa-manifest.json) |
| Upload keystore (local only) | `twa/android-keystore/next-train-upload.jks` (gitignored) |

## One-time signing setup

The repo ships a bootstrap SHA-256 in `twa/upload-cert-sha256.txt` / `public/.well-known/assetlinks.json`. The matching `.jks` is **gitignored** (never commit keystores).

**Either:**

- Restore the bootstrap upload key to `twa/android-keystore/next-train-upload.jks` from a secure backup (agent runs leave a copy under `/opt/cursor/artifacts/twa-signing/` — change the password before Play production), **or**
- Create a fresh upload keystore and re-sync DAL before the first Play upload:

  ```bash
  TWA_STORE_PASS='choose-a-strong-password' ./scripts/setup-twa-signing.sh
  ```

Then:

1. Back up the `.jks` + password offline. Losing the upload key blocks Play updates.

2. `setup-twa-signing.sh` writes `twa/upload-cert-sha256.txt` and runs `node scripts/sync-assetlinks.mjs`, which updates:
   - `public/.well-known/assetlinks.json`
   - `twa/twa-manifest.json` → `fingerprints`

3. Deploy the site so `/.well-known/assetlinks.json` returns HTTP 200 on production.

4. After the first Play upload with **Play App Signing**, open Play Console → Setup → App integrity and copy the **App signing key certificate** SHA-256. Merge it into DAL:

   ```bash
   EXTRA_FINGERPRINTS='AB:CD:…' node scripts/sync-assetlinks.mjs
   ```

   Redeploy. Both upload and app-signing fingerprints should remain listed.

## Build the Android package (Bubblewrap)

Requires JDK 17+ and Android SDK locally.

```bash
npm i -g @bubblewrap/cli
cd twa
# First machine only — point Bubblewrap at JDK / SDK when prompted
bubblewrap update   # regenerate Android project from twa-manifest.json
# or, empty dir bootstrap:
# bubblewrap init --manifest https://nexttrain.co.za/manifest.json
bubblewrap build
```

Use the keystore path/alias in `twa-manifest.json` (`android-keystore/next-train-upload.jks`, alias `next-train`). Upload the `.aab` to an internal testing track.

## Verify Digital Asset Links

- Statement list: [Google Generators](https://developers.google.com/digital-asset-links/tools/generator) for `nexttrain.co.za` + `za.co.nexttrain.app`
- Device: `adb shell pm get-app-links za.co.nexttrain.app` after install
- Browser: open `https://nexttrain.co.za/.well-known/assetlinks.json`

Until DAL verifies, Chrome may show the URL bar inside the TWA (not a true trusted activity).

## Manifest / PWA Builder notes

Store-quality web manifest fields (`categories`, `dir`, `screenshots`) live in [`astro.config.mjs`](../astro.config.mjs). Early `navigator.serviceWorker.register(...)` in [`Layout.astro`](../src/layouts/Layout.astro) makes `/sw.js` discoverable to PWA Builder scanners; Workbox still owns update lifecycle via `virtual:pwa-register`.

Do **not** add `maskable` icons without accepting adaptive cropping for existing installs and updating `scripts/verify-url-parity.mjs`.

Skip until a Play listing exists: `related_applications` / `prefer_related_applications`.

## Play Console checklist (outside this repo)

- Store listing, screenshots, feature graphic
- Content rating questionnaire
- Privacy policy URL (site / about)
- Target API level from the generated Bubblewrap project
- Internal testing → closed → production
