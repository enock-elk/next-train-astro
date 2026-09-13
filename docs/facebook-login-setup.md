# Facebook login — copy these URLs, then click through

You do not write any code. You paste three addresses into Facebook and Firebase.
Google login already works. This only adds Facebook.

Do this on a laptop, signed into facebook.com as yourself.

**Paused 13 Sep 2026 at Login Review.** Resume at [Step H](#step-h--submit-for-login-review-email). You were on **App Review submissions**, **Not submitted**, with **email** and **public_profile** listed. Click **Next** when you come back. Do not switch to Live yet.

---

## The three addresses (copy exactly)

Facebook and Google open these as **web pages**. A hash like `#privacy` is never sent to their servers, so `https://nexttrain.co.za/#privacy` will always look like the home page to them.

| What Facebook asks for | Paste this |
| --- | --- |
| **Privacy Policy URL** | `https://nexttrain.co.za/privacy.html` |
| **User data deletion** / deletion instructions | `https://nexttrain.co.za/account-delete.html` |
| **Valid OAuth Redirect URI** | `https://metrorail-next-train.firebaseapp.com/__/auth/handler` |

Check the first two in a new browser tab **after production is deployed**. You should see a real article, not the live board.

Do **not** use:

- `https://nexttrain.co.za/#privacy`
- `https://nexttrain.co.za/#terms`
- a Google Doc, unless you have nothing else yet (the two `.html` pages are the ones to use)

There is one privacy policy, not a second “accounts only” policy. `/privacy.html` already covers Google, Facebook, route rooms, and how to delete.

---

## Step A — Create the Facebook app (about 5 minutes)

1. Open [https://developers.facebook.com](https://developers.facebook.com)
2. Top right: **My Apps** → **Create app**
3. If it asks for a use case, pick **Authenticate and request data from users with Facebook Login** (sometimes **Consumer**)
4. App name: `Next Train`
5. Contact email: `admin@nexttrain.co.za`
6. Create the app

You are now inside the app dashboard.

---

## Step B — Privacy and deletion (the part you asked about)

1. Left menu: **App settings** → **Basic** (sometimes **Settings** → **Basic**)
2. Find **Privacy Policy URL**. Paste:

   `https://nexttrain.co.za/privacy.html`

3. Find **User data deletion** (or **Data deletion instructions URL**). Paste:

   `https://nexttrain.co.za/account-delete.html`

4. **App Domains**: add `nexttrain.co.za` then `metrorail-next-train.firebaseapp.com`
5. Scroll to the bottom. Click **Save changes**

If Facebook says the privacy URL is invalid, the new pages are not on production yet. Run **Deploy production → metrorail-app**, wait a few minutes, open the two URLs yourself, then save again.

---

## Step C — Facebook Login product

1. Left menu: **Use cases** → **Authentication** → **Go to settings**  
   or **Products** → **Facebook Login** → **Settings**
2. Turn **Client OAuth login** ON
3. Turn **Web OAuth login** ON
4. **Valid OAuth Redirect URIs**. Paste exactly one line:

   `https://metrorail-next-train.firebaseapp.com/__/auth/handler`

5. Save

That handler belongs to Firebase. Do not invent a `nexttrain.co.za/...` redirect unless Firebase shows you one.

---

## Step D — App ID and App Secret

Still in **App settings** → **Basic**:

1. Copy **App ID** (a number)
2. Click **Show** next to **App Secret**. Copy it. This is a password. Do not put it in GitHub or Discord.

---

## Step E — Turn Facebook on in Firebase

1. Open [https://console.firebase.google.com](https://console.firebase.google.com)
2. Project **metrorail-next-train**
3. Left: **Build** → **Authentication** → **Sign-in method**
4. Click **Facebook**
5. Enable
6. Paste App ID and App Secret
7. Copy the redirect URI Firebase shows. It must match Step C.
8. Save
9. **Authentication** → **Settings** → **Authorized domains**. These must already be there. Add any that are missing:
   - `nexttrain.co.za`
   - `metrorail-next-train.firebaseapp.com`
   - `lab.nexttrain.co.za` (only if you test on lab)
   - `enock-elk.github.io` (only if you test github.io)

---

## Step F — Testers first

A new Facebook app is **Development**. Only testers can sign in.

1. Facebook developer dashboard → **App roles** → **Roles**
2. Add Thandeka as a tester if she will use a different Facebook account
3. On your phone, open `https://nexttrain.co.za` → Options → Account → **Continue with Facebook**
4. If the button still says **Not available yet**, do Step G

When testers work: Facebook dashboard → switch the app to **Live**. Live needs the privacy URL from Step B. Without Live, random commuters see “app not set up”.

---

## Step G — Show the button in Next Train

1. Sign in as an operator
2. Open Dev Hub → **System Controls** → **Sign-in options**
3. Tick **Facebook** → **Save sign-in options**

The button stays off in code until you tick that box, so a missing setup cannot advertise a broken login.

---

## Step H — Submit for Login Review (email)

Paused here on 13 Sep 2026. App code is already on `main` (`V9_09.13.3`). Come back to this section. You do not need to redo Steps A–G unless something is missing.

### Where you left off

You already:

- Created **Metrorail Next Train**
- Added **email** (status was **Ready for testing**)
- Left **public_profile** on (default)
- Did **not** add age, birthday, or friends
- Opened **email → Actions → Go to App Review**
- Landed on **App Review** → **App Review submissions**
- Status was **Not submitted**
- New requests listed: **email** and **public_profile**
- The next button on that page is **Next** (bottom right)

You have **not** finished the wizard. You have **not** switched the app to **Live**. Leave it **Unpublished**.

### What “open email” means

It is **not** Gmail. It is the **email** row on Meta’s **Permissions and features** page (Use cases → Facebook Login).

On that row, **Actions** can show **Go to App Review** or **Remove**. You already used **Go to App Review**. When you return, skip that click if you are already on **App Review submissions**.

### Before you click Next again

1. Production is deployed. Open these yourself and confirm they are articles, not the train board:
   - `https://nexttrain.co.za/privacy.html`
   - `https://nexttrain.co.za/account-delete.html`
2. **App settings → Basic** still has those two URLs
3. Permissions list has only **public_profile** and **email**. Do not add friends, birthday, or age

### How to finish the submit (when you resume)

1. Open [https://developers.facebook.com](https://developers.facebook.com) on a laptop
2. Open **Metrorail Next Train**
3. Left: **App Review** → **App Review submissions**  
   or **Use cases** → **Facebook Login** → **Permissions and features** → **email** → **Actions** → **Go to App Review**
4. Keep **email**. **public_profile** can stay. Do not add anything else
5. Click **Next**
6. When it asks why you need email, paste:

   Next Train is a commuter timetable app. Email is only used to create the optional account and to process a delete request. We do not post on Facebook.

7. If it asks for a screen recording: Options → Account → Continue with Facebook → Continue as Enock. Keep it under one minute
8. If it asks for a test user / instructions: “Sign in as the app administrator. Open nexttrain.co.za, Options, Account, Continue with Facebook.”
9. Submit. Wait for Facebook’s email. Do **not** switch the app to **Live** until email is approved

You do **not** need another tester. Skip Thandeka unless she will use a different Facebook account.

In Development, you (the Administrator) can still tap **Continue as Enock**. Random commuters cannot, until the app is **Live** and **email** is approved.

### After approval

1. Facebook dashboard → switch the app to **Live**
2. Confirm **Continue with Facebook** on a phone that is **not** listed under App roles
3. Only then leave Facebook ticked in Dev Hub

The grey banner on the Facebook consent screen is normal until this review finishes. You can still finish a tester/admin login with **Continue as Enock**.

If Account still says **Not available yet**, Facebook is off in Dev Hub (Step G) or the phone is on an old cached build. Pull to refresh after you save sign-in options.

---

## If something fails

| What you see | What to do |
| --- | --- |
| `#privacy` opens the home board | Use `/privacy.html`. That was the old hash. It is also fixed in the app after this deploy. |
| Facebook: “invalid privacy URL” | Open `https://nexttrain.co.za/privacy.html` yourself. If it 404s, production is not deployed yet. |
| `auth/operation-not-allowed` | Facebook is still off in the Firebase console (Step E) |
| “URL blocked” | Redirect URI in Step C does not match Firebase |
| “App not set up” | App is still Development and the person is not a tester, or it is not Live |
| Account row missing for a signed-in commuter | Fixed in this release. Signed-in people keep Account even if Map/Community are hidden. |
| You only see Sign out, no Delete | You are on an operator email (`enockelk@gmail.com`). Operator logins cannot self-delete. Commuters see **Delete account**. Everyone can open `https://nexttrain.co.za/account-delete.html`. |
| Submit for Login Review banner | Expected until **email** is approved (Step H). Admins can still continue. |
| Continue with Facebook works, then Account says Not available yet | You signed out. Tick Facebook in Dev Hub again (Step G), or the phone cached an old page. |

---

## What you do not do

- Do not put the App Secret in this repo
- Do not tick Facebook in Dev Hub before a tester can finish a real Facebook login
- Do not mention Facebook login in What’s New
