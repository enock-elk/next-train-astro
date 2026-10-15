# Suggest a reply — setup

This is the small service that writes a draft in Dev Hub. You still edit it and press Send. It never sends by itself.

You need two accounts you already use: Google (for Gemini) and Cloudflare (the same place as the other Next Train workers). The Gemini key stays on Cloudflare. It is not put in the app, and it is not saved in GitHub.

Until this is done, Feedback, Send, WhatsApp, and email keep working. Suggest reply shows an error instead of a draft.

## 1. Make a paid Gemini key

1. Open [Google AI Studio](https://aistudio.google.com/apikey) while signed in as the Google account you want to bill.
2. Choose **Create API key**, on a project that has billing turned on. A free key is the wrong one here: Google may use those prompts to improve its products, and these prompts include commuter complaints.
3. Copy the key into a note on your computer. You will paste it once in step 3. Do not email it, and do not paste it into the website code.
4. In [Google Cloud billing](https://console.cloud.google.com/billing), open the same project and add a budget alert around **R200** a month. Drafts on the cheap model sit near R20 a month at the current volume. The alert is so a mistake cannot run up a bill quietly.

The worker uses `gemini-3.5-flash-lite`. New API keys cannot call `gemini-2.5-flash-lite`. Write (grammar, summarise, tone, compose) uses the same key and the same worker.

## 2. Create the note store

On your computer, in this repo:

```bash
cd workers/nexttrain-reply
npx wrangler login
npx wrangler kv namespace create REPLY_CONTEXT
```

The browser will ask you to allow Cloudflare. The command then prints an id. Open `wrangler.jsonc` and replace `REPLACE_ME` with that id. Save the file.

That store holds the shared operator note only. One thread is still sent from the phone or laptop when you press Suggest reply.

## 3. Give the worker the key, then publish

Still inside `workers/nexttrain-reply`:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

The first command asks you to paste the key. The terminal will not show it. The second publishes the worker at `https://nexttrain-reply.enock.workers.dev`.

Commit the `wrangler.jsonc` id change and push it to `main`. After that, GitHub can publish later edits by itself, as long as the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are already set (they are the same ones the community worker uses). The Gemini key stays the Worker secret from the command above. Do not add it as a GitHub secret.

## 4. Use it

1. Open Next Train, tap the title five times, and sign in as an operator.
2. Open Feedback, then a thread.
3. Choose **Suggest reply** (in the thread menu, or the button in the reply box).
4. Read the draft. Change anything you want. Press **Send**.

If their message or email makes the first name obvious, the draft starts `Dear Enock`. If only a surname is obvious, it starts `Dear Mr Kazembe`. If the name is not clear, it stays `Hi there,`. The email address itself is not sent to Gemini.

A shared note (Instructions and images, then **Save shared note**) needs step 2. Pictures you attach are only for that one draft.

If the latest message is over a week old, the draft includes a short late-reply line. WhatsApp opens with the quote line `> Metrorail Next Train | Response`. Email uses the subject `Metrorail Next Train | Feedback Response`.
