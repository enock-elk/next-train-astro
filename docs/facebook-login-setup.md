# Facebook login — operator setup

The app already has the Facebook button, Firebase `FacebookAuthProvider`, and a
Dev Hub toggle. The button stays disabled (`facebook: false`) until you finish
the Meta + Firebase steps below and flip the flag. Nothing in this repo can
finish those steps for you: they happen in two websites you own.

Google and email already work. Facebook is the same pattern with one extra
vendor (Meta).

## What you already have in the app

- Account modal: **Continue with Facebook** (`#account-facebook-btn`)
- Client: `signInWithFacebook()` in `src/lib/account.js`
- Firebase SDK: `FacebookAuthProvider` in `src/lib/firebase-boot.js`
- Remote flag: RTDB `config/auth_providers.facebook` (Dev Hub → System Controls)
- Default: Facebook **off**. Do not default it on in code.

Firebase project: `metrorail-next-train`  
Auth domain: `metrorail-next-train.firebaseapp.com`

## Step 1 — Meta developer account

1. On a laptop, open [https://developers.facebook.com](https://developers.facebook.com) while logged into the Facebook account that should own the app (your personal admin account is fine to start).
2. Accept the developer terms if asked.
3. **Create app** → choose **Authenticate and request data from users with Facebook Login** (sometimes labelled **Consumer** / **Use cases → Authentication**).
4. App name: `Next Train` (or `Metrorail Next Train`). Contact email: `admin@nexttrain.co.za`.

You now have an **App ID** and, under Settings → Basic, an **App Secret**. Treat the secret like a password. It never goes in git.

## Step 2 — Configure Facebook Login

1. In the Meta app, open **Use cases** → **Authentication and account creation** → **Facebook Login** → **Settings** (or **Products → Facebook Login → Settings**).
2. Turn **Client OAuth login** and **Web OAuth login** on.
3. **Valid OAuth Redirect URIs** — add exactly:

   `https://metrorail-next-train.firebaseapp.com/__/auth/handler`

   That path is Firebase’s handler. Copy it from Firebase in the next step if you want to double-check. Do not invent a `nexttrain.co.za` redirect unless Firebase shows you one.
4. **Settings → Basic**
   - **App Domains:** `nexttrain.co.za`, `metrorail-next-train.firebaseapp.com`
   - **Privacy Policy URL:** a public page you control (the live site or a simple Notion/Google Doc you publish). Meta will not put the app **Live** without this.
   - **User data deletion:** you can point at `mailto:admin@nexttrain.co.za` or a short “email us to delete” page. You already have an in-app delete request.
5. Save.

## Step 3 — Enable Facebook in Firebase

1. Open [Firebase Console](https://console.firebase.google.com/) → project **metrorail-next-train**.
2. **Authentication** → **Sign-in method** → **Facebook**.
3. Enable it. Paste the Meta **App ID** and **App Secret**.
4. Copy the **OAuth redirect URI** Firebase shows and confirm it matches Step 2.
5. **Authentication → Settings → Authorized domains** must include:

   - `nexttrain.co.za`
   - `metrorail-next-train.firebaseapp.com`
   - `lab.nexttrain.co.za` if you test on lab
   - `enock-elk.github.io` if you test the GitHub Pages preview

   Facebook login will fail on any host that is missing here.

## Step 4 — Testers first, then Live

A brand-new Meta app is in **Development** mode. Only people listed as
**Roles → Administrators / Developers / Testers** can sign in.

1. Add Thandeka (and yourself) as testers if she will use a different Facebook account.
2. On your phone, open `https://nexttrain.co.za`, Account, Facebook. You should get the Meta popup or the Facebook app.
3. When testers can sign in, **App Review** is not required for the default `public_profile` + `email` scopes we use. Switch the Meta app to **Live** so any commuter can use it.
4. Live mode is what needs the privacy-policy URL. Without Live, random commuters see “app not set up” from Facebook.

## Step 5 — Turn the button on in Next Train

1. Sign in as an operator.
2. Dev Hub → System Controls → **Sign-in options**.
3. Tick **Facebook** → **Save sign-in options**.
4. That writes `config/auth_providers.facebook = true`. The Account button enables on the next load (or immediately after `authproviderschange`).

Leave the code default `false` so a fresh clone or a missing RTDB node does not advertise a login that Meta has not approved yet.

## What a commuter should see

1. Account → Continue with Facebook.
2. Facebook popup (or the Facebook app on a phone).
3. “Signed in” toast, same profile path as Google.

Common errors:

| Message / code | Usually means |
| --- | --- |
| `auth/operation-not-allowed` | Facebook is still off in the Firebase console |
| `auth/popup-closed-by-user` | They cancelled. Harmless. |
| `auth/unauthorized-domain` | The host is missing from Firebase authorized domains |
| Facebook “app not set up” / “URL blocked” | Redirect URI or App Domains mismatch, or the Meta app is still Development and they are not a tester |
| Popup blocked | Try again; iOS home-screen PWA sometimes needs a full Safari tab the first time |

## What you do **not** do

- Do not put the App Secret in this repo, in `firebase-boot.js`, or in a Cloudflare env var. Firebase stores it.
- Do not enable the Dev Hub flag before testers can complete a real Facebook login.
- Do not mention Facebook login in What’s New. Account / sign-in stays off the public commuter list.

## After it works

Reply to a couple of real Facebook-created accounts in Community and confirm the display name looks sane. If Facebook hides the email, Firebase still creates a uid; that is enough for posting.
