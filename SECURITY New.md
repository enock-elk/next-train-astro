# Security Policy
This policy covers **Next Train** (`nexttrain.co.za`) and this repository (`next-train-astro`).
## Supported versions
Security fixes ship in the **current production app** only — the latest `V8_…` release on `https://nexttrain.co.za`.
Older preview, lab, or local builds are not patched separately. Update or reinstall the live app after a production deploy.
The `5.1.x` / `4.0.x` table GitHub suggests does not apply here. Next Train is a commuter web app, not a numbered library.
## Reporting a vulnerability
**Do not** open a public GitHub issue, pull request, or discussion for a security problem.
Email **[admin@nexttrain.co.za](mailto:admin@nexttrain.co.za)** with:
- What you found, and where (URL or screen)
- Steps to reproduce
- What you expected vs what happened
- Impact, if you know it (e.g. other people’s data, account takeover)
You can also use **Send Feedback** in the app, but email is better for anything sensitive — do not attach secrets, tokens, or other people’s personal data.
## What happens next
- We aim to acknowledge the report within **3 business days**.
- If we can reproduce it, we will say so and work on a fix for production.
- If it is out of scope, a duplicate, or not a vulnerability, we will say so and close it.
- Please give us a reasonable window to ship a fix before you publish details.
We do not run a paid bug-bounty programme.
## Out of scope (please do not report these as vulnerabilities)
- Missing or outdated train times, fares, or notices (use Feedback)
- Third-party ads, analytics, or hosting outages
- Issues that only appear after you ignore the browser’s security warnings
- Automated scanner output with no working proof of impact
