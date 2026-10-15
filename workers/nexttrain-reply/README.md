# nexttrain-reply — suggest a reply

Operator-only drafts for Dev Hub feedback. The worker calls Gemini Flash-Lite and returns either a plain-text draft or a halt. It does not send the reply and it does not read `inbox.json`.

Allowlisted emails: `enockelk@gmail.com`, `thandeka05nxumalo@gmail.com`.

## Deploy

```bash
cd workers/nexttrain-reply
npx wrangler kv namespace create REPLY_CONTEXT
```

Paste the printed id over `REPLACE_ME` in `wrangler.jsonc`, then:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

Use a paid Gemini key. Set a budget alert in AI Studio. The free tier is used to improve Google's products, and commuter complaints should not go out on it.

The GitHub workflow deploys on `main` once the KV id is real and `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are set. `GEMINI_API_KEY` stays a Worker secret, not a GitHub secret in the workflow file.

## App

The composer calls `https://nexttrain-reply.enock.workers.dev` unless `PUBLIC_REPLY_WORKER_URL` is set at build time.
