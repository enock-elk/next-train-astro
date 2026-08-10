# Virality interceptor (Open Graph / WhatsApp)

Cloudflare Worker that serves rich Open Graph HTML stubs to **social crawlers** for share deep-links (`?rt=`, `?plan=`, legacy `?action=route|planner`), while letting real browsers (including WhatsApp’s in-app WebView) load the Astro SPA.

## Why V2 exists

V1 matched `/whatsapp/i` and returned a white “Redirecting to Next Train…” page that `location.replace`’d to the **same** URL. WhatsApp’s in-app browser includes `WhatsApp` in the UA, so taps looped on the stub for ~15s (or forever).

V2:

- Treats only crawlers as bots (pure `WhatsApp/…` preview fetcher, `facebookexternalhit`, etc.).
- Passes through UAs that look like a real browser + WhatsApp.
- Supports modern `rt` / `plan` params.
- Uses `__nt=1` bypass on any stub redirect (never self-intercepts).

## Deploy (ops)

Source of truth for the fix lives in this folder. Production today still runs the copy from `metrorail-app` until you publish this worker to the apex route on `nexttrain.co.za`.

1. Cloudflare Dashboard → Workers → the worker bound to `nexttrain.co.za` (or create one).
2. Paste / sync [`worker.js`](./worker.js) (module Worker, `export default { fetch }`).
3. Ensure the route covers `nexttrain.co.za/*` (or at least `/` with query strings).
4. Verify:

```bash
# Crawler — expect OG stub HTML (title Schedule: …)
curl -sS -A 'WhatsApp/2.24.0' 'https://nexttrain.co.za/?rt=pta-pien&v=g&d=wd' | head -40

# Human WhatsApp WebView — expect full Astro document (Starting Next Train / app shell)
curl -sS -A 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.24' \
  'https://nexttrain.co.za/?action=route&route=pta-pien&view=grid' | head -5

# Bypass always passes through
curl -sS -A 'WhatsApp/2.24.0' 'https://nexttrain.co.za/?rt=pta-pien&__nt=1' | head -5
```

After deploy, old WhatsApp chats with `?action=route` links open the app instead of the white stub. Optional: share a fresh `?rt=` link so preview caches refresh.
