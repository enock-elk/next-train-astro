# Next Train — Commuter User Guide

**App:** [https://nexttrain.co.za](https://nexttrain.co.za)  
**In-app:** Options → **User Guide & Tips** (opens this guide as a sheet)  
**Also online:** `/guide.html`  
**Status:** Independent unofficial tool. Not affiliated with PRASA or Metrorail.  
**Tickets:** Buy cash tickets at the station. Next Train does not sell tickets.

This guide covers what a normal production commuter sees: **Next Train** (home board), **Trip Planner**, and **Options**. Features that are locked for pilot testing (Map tab, Community tab, ride sharing) are noted only briefly at the end.

---

## 1. First open

1. Open [nexttrain.co.za](https://nexttrain.co.za) in a mobile browser (Chrome or Safari work best).
2. Wait for **Starting Next Train…**. If it stalls, use **App stuck? Get help**.
3. Welcome screen: **Select your regular route to get started.**
4. Pick a region: **Gauteng**, **Western Cape**, **KwaZulu-Natal**, or **Eastern Cape**.
5. Pick your corridor (route card). Inactive corridors show **Coming Soon**.
6. Footnote: *You can change this later in Options.* · *Unofficial · Independent of PRASA*
7. When asked, set **Passenger Type**: Adult / Scholar / Pensioner / Military (so fares match you).

Your region and route are saved on the device. Returning visits open straight to the board.

**Tip:** Shared links (`?plan=…`, route links from Google) can skip Welcome and open Trip Planner or a timetable directly.

---

## 2. Bottom navigation

| Tab | What it does |
|-----|----------------|
| **Next Train** | Live board for your pinned corridor and station |
| **Trip Planner** | From → To multi-transfer journeys |
| **Options** | Passenger type, theme, maps, feedback, guide, What's New |

A bell may appear in the header when there is a live service notice for your region or route. Tap it to open **Alerts**, then **Close** to return.

---

## 3. Home board (Next Train)

### Header
- Brand: **Next Train**
- Day chip: e.g. `Monday · Weekday Schedule`, `Saturday Schedule`, `Public Holiday Schedule`, or a named holiday / **No Service**

### Pin and route
- Pin icon: save this corridor as your default for the region.
- Route pill: opens **Select Route** (change region and corridor).

### Station
- Dropdown placeholder: **Select Station...**
- GPS button: find nearest station on the current corridor (asks for location if needed).

### Direction boards
- Cards titled **Next train to {destination}**.
- Empty state: **Select station above**.
- Each card: departure time, countdown, train number.
- Tap a train for the upcoming list / train sheet.
- Special services may show as **Special Train**.

### Full timetable
1. Tap **VIEW FULL TIMETABLE** (subline shows **Effective from: …**).
2. Day chips: **Mon - Fri**; Gauteng / KZN / EC use **Sat / Hol**; Western Cape has **Saturday** and **Public Holiday** where sheets exist.
3. Swap direction with the direction control.
4. **Download** saves a light-mode PNG of the grid to your device.
5. **Share** shares a deep link to that grid.
6. **Close Timetable** returns to the board.

**EXPR** in a cell means an express that skips that station (tap for the note). Empty weekend grids may offer **Plan this trip**.

### Fares on the board
- Strip: **Estimated {Adult|Scholar|…} Fare** and amount.
- Tap → **Ticket Prices** sheet: Single, Return, Weekly (Mon-Fri / Mon-Sat), Monthly.
- Off-peak note: *Off-Peak Fares apply weekdays between 09:30 and 14:30.*
- Adult off-peak is about **40% off** the peak single on weekdays only (not weekends or public holidays).
- Always **confirm at the station**. Zones and shorter hops can differ.

**Important:** The board fare follows the **train you are looking at** (peak vs off-peak departure). If you compare that number to a ticket bought at another time of day, the amounts will not match.

### Offline and install
- After you have opened the app online once, schedules stay on the device for loadshedding / underground use.
- Offline chrome (**You are offline.** / **Refresh**) only appears if the app is visible and still offline for a few seconds.
- When installable: **Install Next Train (1 MB)** on the board (and planner) footer.
  - **Android:** use the install prompt or browser menu → Install app.
  - **iPhone:** Safari → Share → **Add to Home Screen**.

### Other board signals
- Yellow maintenance strip when operators publish one for your scope.
- **Commuter reports** / **View** when delay reports are enabled for that route.

---

## 4. Trip Planner

1. Open **Trip Planner**.
2. Optional tips: **Advanced Multi-Transfer Routing** → **Trip Planner Tips** → **Got it!**
3. Set **From** and **To** (swap in the middle). GPS locate works on From.
4. Choose **Travel Day** (Weekday / Saturday / Sunday; Western Cape may offer Public Holiday) and optional time.
5. Tap **Plan Trip**.

### Results (**Your Journey**)
- **Direct** vs **Transfer** options.
- Times, waits, and sometimes **Extended Layover** (very long connection wait).
- Share the trip link; open the journey on the map when offered.
- Train sheets and **Fare** / **Max. Single Fare** open the same Ticket Prices logic as the board.
- Trip fare sheet includes an experimental note. You can answer **Is this what you paid?** with **Yes** / **No**.
  - **No** asks which ticket (Single / Return / Weekly / Monthly), the amount, optional photo, then **Send**.
  - The quoted amount is always the **Single** fare for the board you viewed (peak or off-peak). Weekly/monthly amounts you send are stored for operators to review later; they do not rewrite the live Single quote by themselves.

If routing fails, you may see **Open Network Map** or **Reply** (Feedback Hub).

---

## 5. Options (side menu)

Open **Options** from the bottom nav.

| Item | Purpose |
|------|---------|
| **Passenger Type** | Adult / Scholar / Pensioner / Military |
| **Feedback Hub** | Message the team (optional email / WhatsApp) |
| **Share App** | Native share: *Say Goodbye to Waiting…* |
| **Theme & Preferences** | Colour Pack **Classic** / **Earthy**, **Dark Mode**, **Haptic feedback** |
| **GPS Network Map** | Interactive network map |
| **PRASA Route Map** | Static network image |
| **Check for Updates** | Pull the latest PWA shell |
| **About & Legal** | Story, contact, Terms, Privacy, version |
| **User Guide & Tips** | This guide |
| **What's New** | Short public release notes (open from Options; does not auto-pop over Welcome) |

Account / notifications rows appear when signed in or when pilot surfaces are unlocked.

---

## 6. Holidays, Sundays, and “no service”

- Many corridors have **no Sunday** service.
- Public holidays are **not always** the same as Saturday. Gauteng, KZN, and Eastern Cape sometimes use a Saturday/holiday sheet; some days have **no service**. Western Cape may use a dedicated Public Holiday sheet or Saturday. PRASA announces which.
- Western Cape holiday reference: [Western Cape public holidays](https://nexttrain.co.za/regions/western-cape-public-holidays.html)
- Some routes (e.g. parts of Hercules / Koedoespoort, Eastern Cape) have **no Saturday** sheet.
- The day chip on the home header shows which sheet the board is using.

---

## 7. Direction naming (common confusion)

**Next train to Kempton Park** names the **train’s direction / terminus**, not only your alighting stop.

Example: Pretoria → Centurion often boards a train advertised toward Kempton Park, because Centurion sits on that corridor. Pick your station; read the direction as “which way the train is going.”

---

## 8. Glossary

| Term | Meaning |
|------|---------|
| **Direct** | Stay on one train |
| **Transfer** | Change trains at a hub |
| **Extended Layover** | Very long wait between legs |
| **EXPR** | Express; skips that station |
| **Off-peak** | Weekday trains departing 09:30–14:30 (Adult ~40% off peak single) |
| **Special Train** | Operator-marked special (still shown on the board) |
| **Alerts** | In-app service notices (bell). Info / Warning / Critical |

---

## 9. Privacy and trust

- No account is required for the core board and planner.
- Feedback may include contact details you choose to send.
- Terms and Privacy: Options → **About & Legal**, or `/terms.html` and `/privacy.html`.

---

## 10. Pilot-only surfaces (most users will not see these)

Unlocked only for testers / signed-in pilots via operator grants:

- Bottom-nav **Map** (live “Trains near you”, share/follow)
- Bottom-nav **Community** (route chat)
- **I’m on it** check-in on some train sheets

Do not expect these on a fresh install.

---

## Appendix A — Making it easier for new users

These are product recommendations (not yet built). Highest leverage first:

### A1. Teach direction naming on first station pick
First time a user selects a station, show a one-shot sheet: *“Next train to X” means the direction of the train, not only your stop.* Example with their corridor. Dismiss forever.

### A2. Peak vs off-peak on the fare strip
When off-peak is active, keep the chip, but add a quiet second line: *Peak single would be R…* (or *You are viewing off-peak*). When the user opens Ticket Prices, lead with **Single · Peak** and **Single · Off-peak** side by side so R10 vs R6 is obvious before they “correct” the app.

### A3. Fare vote context (planner)
Without changing the modal layout much later: above Yes/No, one sentence: *This quote is the Single fare for the train time you selected (peak or off-peak).* That alone reduces wrong weekly/monthly “corrections.”

### A4. Three-tap first run
Welcome today asks region → route → sometimes profile. Collapse into: region → “Where do you usually board?” (station search) → auto-pick corridor. Fewer cards, less corridor jargon.

### A5. Empty board coaching
If no station is selected, replace **Select station above** with a large primary **Choose your station** and a secondary **Use my location**.

### A6. Planner tips once, then inline
Keep **Trip Planner Tips**, but also show a tiny Direct vs Transfer legend on the first results paint.

### A7. Install nudge after value
Show **Install Next Train (1 MB)** after the user has successfully viewed a next-train card or planned a trip once, not only on first paint.

### A8. Holiday clarity
When the day chip is **No Service** or a named holiday, add a one-line reason and a link to **Plan Trip** for the next working day.

### A9. In-app guide checklist
At the top of User Guide & Tips, a 5-step “Do this now” checklist (pick station → read next train → open fare → try planner → install) with deep links that close the sheet onto the right surface.

### A10. Language and literacy
Short Zulu / Afrikaans / Xhosa captions for the three hardest ideas (direction naming, off-peak, buy tickets at station) would help more than a longer English FAQ.

---

*Guide aligned to production chrome as of V9_10.05.x. For operator workflows, see `docs/ADMIN-GUIDE.md`.*
