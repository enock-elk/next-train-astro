# Core Web Vitals — what shipped, what is next

Read this before any performance work on the app shell. `AGENTS.md` → **Core Web Vitals** has the short rules. This file has the measurements and the two follow-ups that were deliberately **not** shipped because they carry real risk.

## Where we started (Search Console, mobile field p75, 12 Nov 2026)

| Metric | Field p75 | Good |
| --- | --- | --- |
| INP | 729 ms | ≤ 200 ms |
| LCP | 2.8 s | ≤ 2.5 s |
| CLS | 0.11 | ≤ 0.1 |

Field data is a 28-day CrUX window. After a production deploy, use Search Console **Validate fix** and expect the chart to move over about four weeks, not overnight.

## Already shipped (do not undo)

**V10_11.12.1**

- Board placeholders reserve the departure card height (96px), and `nav-bottom` / `chrome-compact` are set by an inline body-start script in `Layout.astro`, not by `prefs.js` after first paint. Lab start-up CLS is now about 0.01.
- CleverAds observer scans once per mutation batch, not once per record (advert gold hash updated in `GOLD.json`).
- `applyFittedLabel` / `applyFittedLabels` (memoised, batched) and the header day-label fit (memoised, 8 search steps) no longer force layouts on every clock tick.
- Focusout viewport recovery keeps the cached safe-area inset.
- Lab boot blocking time fell about 57%; boot-tap INP p75 about 192 ms (8x CPU, ads and analytics blocked).

**V10_11.12.2**

- **First-visit killswitch restart removed.** A brand-new visitor used to load the app, then get NUKEd and reloaded about 4–7 s later because `config/killswitch.json` was newer than their (missing) applied marker. Every Google visitor paid two cold loads. `Layout.astro` now snapshots `window.__ntFreshProfile` in `<head>` before the service worker registers or the device id is written. `runKillswitchCheck` (`logic.js`) records the current killswitch as applied on a fresh profile via `shouldSeedFreshKillswitch` (`utils.js`). Returning profiles, interrupted NUKEs, and a newer killswitch in the same session still run the full cleanup. Gated by `verify:safe-nuke`.
- **Critical Alerts auto-open waits for idle.** The uninvited auto-open in `checkServiceAlerts` (`hub.js`) now uses `whenIdleForAutoNotices` (`session-stability.js`): settled, then an idle callback, then no tap or key for 1 s, capped at 8 s. Opening the overlay is about 160 ms of main thread with a forced layout at 8x and used to land around 3.5 s into boot, exactly when commuters first tap. Shared `#alerts` links still open through `whenSettledForAutoNotices` as before. Gated by `verify:home-polish` and `verify:alerts`.

## Next step A — Firebase Auth popup resolver (medium risk, needs an iPhone)

**Cost.** About 110 ms of main thread at 8x CPU during boot on phones, plus a hidden iframe and `gapi` network requests.

**Cause.** `bootFirebase()` (`src/lib/firebase-boot.js`) calls `getAuth(app)`. In the browser build that is `initializeAuth(app, { popupRedirectResolver: browserPopupRedirectResolver, persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] })`. During auth init Firebase checks `resolver._shouldInitProactively`, which is `_isMobileBrowser() || _isSafari() || _isIOS()`. On every phone it then awaits `resolver._initialize(auth)`, which loads `gapi` and the `__/auth/iframe` from `authDomain` (`auth.nexttrain.co.za`). `bootFirebase()` runs early because many modules await it (`hub.js`, `account.js`, `community.js`, `ride-pings.js`, `trust.js`, …).

**Why it was not shipped.** `signInWithPopup` runs `await this.resolver._initialize(this.auth)` and then `await _getRedirectUrl(...)` before `window.open`. If the resolver is not initialised when the commuter taps **Google**, the popup opens after async work and iOS Safari can block it. A broken Google sign-in is worse than a slow boot.

**Safe shape.**

1. In `firebase-boot.js`, build auth with `initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] })` and **no** `popupRedirectResolver`. Keep the same persistence hierarchy and keep the existing `setPersistence(auth, browserLocalPersistence)` call so stored users are found exactly as today. Expose `window.firebasePopupResolver = browserPopupRedirectResolver`.
2. Pass the resolver explicitly at the two popup calls in `src/lib/account.js` (Google and Facebook, `window.firebaseSignInWithPopup(window.firebaseAuth, provider)`): `signInWithPopup(auth, provider, resolver)`.
3. Pre-initialise when sign-in becomes reachable: `openAccountModal()` / `openAccountProfile()` in `account.js`, and any other surface that shows a Google button. The only hook is the private `resolver._initialize(auth)`. Wrap it, pin the Firebase version (currently `firebase` 12.15.0), and add a verify assertion so an upgrade that renames it fails loudly instead of silently re-blocking popups.
4. Until the warm-up promise resolves, show the Google button as busy instead of letting a tap start a cold popup.
5. Grep for any other `signInWithPopup`, `signInWithRedirect`, `getRedirectResult`, `linkWithPopup`, or `reauthenticateWithPopup` before shipping. Each needs the resolver passed explicitly or it throws `auth/argument-error`.

**Must test before shipping (real devices, not emulation).**

- iPhone Safari tab and iPhone home-screen PWA: cold open, open Account, tap Google **immediately**, then again after a few seconds. The popup must open and sign-in must complete.
- Android Chrome tab and the Play Store TWA: same.
- A signed-in user stays signed in across the upgrade (persistence unchanged).
- Admin sign-in (Dev Hub) and passenger accounts both still work. Thandeka's and Enock's operator accounts must still reach admin.

**Rollback.** Revert to `getAuth(app)`; nothing else depends on the change.

## Next step B — split index and Welcome module evaluation (higher risk)

**Cost.** In the first ~1.5 s, the index page module graph takes about 300 ms and the `WelcomeModal` script about 210 ms to evaluate at 8x CPU. Any tap in that window waits behind it (INP input delay). This is now the largest remaining boot cost in the lab.

**Shape.**

1. Inventory first. For each top-level import of the `src/pages/index.astro` client script and of `WelcomeModal.astro`, record whether it is needed before the board paints. Modules used only on interaction (planner UI, community, alerts channel, account, admin bridges, ride pings, map tab) can move to `import()` at first use. `switchTab` in `ui.js` already does this for `community.js` and `map-tab.js`.
2. `WelcomeModal` script: returning commuters (`welcomeSeen === 'true'`) never see Welcome. Import it only when Welcome will show (check every path that can reopen it before deferring).
3. Break the remaining boot into chunks with `scheduler.yield()` (fallback `setTimeout(0)`) between phases, so a tap can be handled between them.

**Why it was not shipped.**

- Many modules assign `window.*` hooks at evaluation time (`window.checkServiceAlerts`, `window.performHardCacheClear`, `window.openAlertsChannel`, `window.maybeShowHolidayNotice`, …). Callers use optional chaining, so moving a module behind `import()` fails **silently**. For example, the killswitch says "performHardCacheClear is not ready" and retries forever. Grep every `window.X =` in a module before deferring it, and make each caller import on demand.
- Order-sensitive behaviour listed in `AGENTS.md` → Do not break (alert expiry, union scoping, park-home on Close, hold-to-react, region swap not reopening Select Route, no WORKING OFFLINE flash on screen lock) must be re-proved by hand.
- Do **not** touch `manualChunks` in `astro.config.mjs`. Re-chunking is a FOUC-flagged change (see `AGENTS.md` → FOUC). Dynamic imports create new chunks under the existing rules, which is fine. Run `verify:update-fouc` and the CSS-404 drill.

## How it was measured (repeat this, the probes were not committed)

- Build `dist/` with `npm run build`, serve it with a static server that applies `public/_headers`.
- `puppeteer-core` driving Chrome with phone emulation (412×915, DPR about 2.6, touch, mobile UA), CPU throttled 4x and 8x, slow-4G network.
- Block third parties (`cleverwebserver.com`, `googletagmanager.com`, `clarity.ms`) to isolate app cost; do one run unblocked for reality.
- Old builds: seed `localStorage.last_killswitch_timestamp = '9999999999999'` before navigation, or the first-visit NUKE reload splits the run into two documents. From V10_11.12.2 a fresh profile no longer reloads, so a fresh-profile run is the real Google-visitor path.
- Observers: `long-animation-frame` (with `scripts[].forcedStyleAndLayoutDuration` for attribution), `event` with `durationThreshold: 16` (INP), `layout-shift` (ignore `hadRecentInput`), `largest-contentful-paint`.
- Boot-tap probe: tap a real control (route selector, a departure card) at fixed offsets (1, 2, 3, 4 s after load) across about 10 runs; report p75 of event duration.
- Compare against the previous commit's `dist/` served on another port, same harness, same throttle.
