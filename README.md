# VoiceBill

**Just speak. Get your bill.**

VoiceBill is a voice-first billing app for Indian kirana shops, general stores and small retailers. The shopkeeper taps the mic, speaks the items in Hindi, Hinglish or English, checks what was heard, and prints a receipt — no typing, no account, no API key.

> “3 kilo chini, 2 kilo aata aur 3 litre soybean oil” → Sugar 3 kg × ₹45 = ₹135, Aata 2 kg × ₹40 = ₹80, Soybean Oil 3 L × ₹130 = ₹390 → **₹605**

It is a standalone static app: `npm install && npm run dev`, then deploy the `dist/` folder anywhere (Vercel preset: Vite).

---

## What it does

| Screen | What the shopkeeper gets |
| --- | --- |
| **Dashboard** | Greeting with shop name, today’s sales and bill count (computed from saved bills), a large “speak a bill” action, recent bills, setup checklist, quick links. |
| **New bill** | The centrepiece. Big mic, Hindi/English switch, live interim transcript, final-utterance log, auto-matched items with prices, quantity steppers, editable prices, product swap, discount (₹ or %), review-before-save, manual add, frequently-billed chips. |
| **Products** | Add / edit / delete products with price, unit and spoken aliases; search; sample-data badges; validation. |
| **Bill history** | Every saved bill with search, day grouping, date presets and a custom range, totals, and one tap to reprint. |
| **Settings** | Shop name/address/phone, currency symbol, receipt width (58 mm / 80 mm / A4), thank-you message, recognition language, backup export/import, erase-all, storage footprint. |
| **Receipt** | Thermal-style receipt, print / Save-as-PDF through the browser dialog, copy summary, reprint from history. |

Voice input is feature-detected. When it is unavailable (Firefox, older WebViews, blocked mic, no microphone), the screen says so plainly and the manual path keeps working.

## Technology

- **React 19 + TypeScript** (strict) — component UI, typed domain model.
- **Vite 8** — dev server and static production build.
- **Tailwind CSS 3** — utility layer plus a hand-built design system in `src/styles.css` (warm off-white canvas, charcoal ink, green accent, self-hosted DM Sans + Instrument Serif).
- **Browser Web Speech API** — speech recognition, wrapped in `src/lib/speech.ts`.
- **localStorage** — persistence, versioned keys, sanitised on every read.
- **Browser print** — receipts, with `@page` sizing per width and a print stylesheet.

No backend, no database, no authentication, no paid API, no API key, no CDN and no network requests from the app. The whole build is static and deploys to Vercel (or any static host) as-is.

**Why Vite rather than Next.js?** VoiceBill has no server-side requirements at all: no API routes, no secrets, no SSR data. A static React build is faster to load on a ₹6,000 Android phone, works offline after the first load, and deploys identically to Vercel, Cloudflare Pages or a local folder. Next.js would add a server runtime and a framework dependency without adding a feature.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build:

```bash
npm run build        # type-checks, then emits dist/
npm run preview      # serve dist/ locally
```

### Deploy to Vercel

1. Import the repository in Vercel.
2. Framework preset: **Vite**. Build command `npm run build`, output directory `dist`.
3. Deploy. No environment variables are needed.

Because routing is hash-based (`/#/products`, `/#/bill/<id>`), no rewrite rules are required. The `base: './'` setting also makes the build portable to a sub-folder or a USB stick.

## Testing

```bash
npm test              # 91 unit tests (Node test runner, TypeScript stripped natively)
npm run test:integration   # 12 end-to-end UI tests in jsdom against the real app
npm run typecheck     # app + tests, strict
npm run lint          # secrets, CDN/network, storage namespaces, assets, routes, fallbacks
npm run build         # production build
npm run verify        # everything above, in order
```

What is covered:

- product creation, validation, editing, deletion, duplicate names, sample data
- alias matching, custom aliases, typo handling, ambiguity, refusing unrelated products
- Devanagari transliteration, Hindi/English number words, mixed Hinglish, decimals and fractions
- multiple products in one utterance, product-first and quantity-first phrasing, unit conversion
- unknown products, missing prices, unit mismatches, empty bills, discounts and paise rounding
- bill numbers per day, history, draft persistence across a reload, corrupted/invalid saved data
- receipt model and print CSS, 58/80/A4 widths
- speech: final-results-only, duplicate-event suppression, permission denial, unsupported browsers
- UI journeys: onboarding → products → pick/voice items → review → save → receipt → history; draft restore; discount; product swap; unrecognised-item blocking

### The 20 required cases, and where they run

Every row below is a test that actually runs under `npm test` or `npm run test:integration`; the numbers are the test’s position in the run output, so a reader can confirm them without trusting this table.

| # | Required case | Test(s) that cover it | Result |
| --- | --- | --- | --- |
| 1 | Product CRUD | unit 13–19 (catalog), 73–74 (store); UI 2–3 | pass |
| 2 | Alias matching (`chini`, `aata`, `sarson ka tel`, custom aliases) | unit 29, 30, 90 | pass |
| 3 | Hindi normalisation / transliteration | unit 39, 86, 87 | pass |
| 4 | English sentence parsing | unit 36, 88 | pass |
| 5 | Hinglish parsing | unit 37, 38, 89 | pass |
| 6 | Multi-product utterance | unit 36, 37, 41; UI 10 | pass |
| 7 | Units (kg/g/litre/ml/piece/packet/dozen, conversion, mismatch) | unit 3, 4, 43 | pass |
| 8 | Decimal and fractional quantities | unit 42, 89 | pass |
| 9 | Unknown product is never invented | unit 32, 76; UI 8 | pass |
| 10 | Missing price blocks the bill | unit 8, 81 | pass |
| 11 | Calculations and paise rounding | unit 1, 2, 5 | pass |
| 12 | Discounts (₹ and %) | unit 5, 78; UI 7 | pass |
| 13 | Bill history, numbering, reprint link | unit 10, 79; UI 4 | pass |
| 14 | Persistence across refresh | unit 64, 68, 80; UI 6 | pass |
| 15 | Receipt renders every required field | unit 50–53 | pass |
| 16 | Print layout per paper width | unit 21–23, 26–27 (CSS-source assertions) | pass* |
| 17 | Microphone permission failure | unit 59, 60; UI 11 | pass |
| 18 | Unsupported-browser fallback | unit 54, 62; UI 12 | pass |
| 19 | Duplicate/interim recognition events | unit 56, 57, 58; UI 9 | pass |
| 20 | Empty bill cannot be finalised | unit 6 (+ review gate in `NewBill`) | pass |

\* Print coverage is a CSS-source assertion (the `@page` rule exists per width, the print block hides the app chrome and keeps only the receipt). No physical thermal printer and no browser binary was available in this environment, so no pixel-level or paper-level print test was run.

## Architecture

```
src/
  lib/                 pure, testable domain logic (no React, no DOM)
    types.ts           Product, Bill, Draft, Settings, ParsedItem…
    text.ts            Devanagari → Latin, numbers, normalisation, distances
    units.ts           unit synonyms, labels, conversions (gram ↔ kg, ml ↔ litre)
    parser.ts          transcript → { name, quantity, unit }[]
    matcher.ts         spoken name → catalogue product, with confidence rules
    billing.ts         draft lines, readiness rules, bill numbering, finalisation
    money.ts           integer-paise arithmetic, discounts, rounding
    catalog.ts         product validation + CRUD helpers + optional samples
    storage.ts         versioned localStorage, sanitising, backup import/export
    receipt.ts         receipt document model
    speech.ts          Web Speech wrapper: feature detection, dedupe, errors
    format.ts          money/date/quantity formatting
  state/
    store.ts           observable store: actions + persistence + safety rules
    react.tsx          StoreProvider / useAppState
    useSpeech.ts       React binding for the recogniser
  ui/                  icons, dialogs, toasts, product form/picker, onboarding
  views/               Dashboard, NewBill, Products, Bills, Receipt, Settings
  App.tsx              shell, navigation, routing, onboarding gate
  styles.css           design tokens, components, responsive + print rules
tests/unit             pure logic + speech + layout tests
tests/integration      jsdom tests driving the real React app
```

### The voice pipeline

1. **Normalise** (`text.ts`): transliterate Devanagari, map Hindi numerals, fold punctuation, split `3kg` → `3 kg`.
2. **Parse** (`parser.ts`): split on “aur/and/,”, find quantity groups, read Hindi/English words (`teen`, `aadha`, `twenty five`, `do point five`), attach units, keep the product words.
3. **Match** (`matcher.ts`): exact name → alias → token containment → typo tolerance, with a hard threshold and an ambiguity margin. Below that, the item stays **unmatched** with suggestions — a wrong price is worse than a correction step.
4. **Price** (`billing.ts`): use the catalogue price, convert compatible units (500 gram → 0.5 kg), flag incompatible ones (2 kg of a per-packet product).
5. **Review** (`NewBill`): totals, discount, and a blocking issue list. **Save** freezes a bill and clears the draft.
6. **Print** (`Receipt`): receipt model → thermal-style page → browser print dialog.

Final speech results are used for billing; interim text is display-only. Repeated result events are ignored by result index, and speaking the same product twice updates the existing line instead of duplicating it.

## Data, privacy and limits

- Everything is stored **on this device** under `voicebill.products.v1`, `voicebill.bills.v1`, `voicebill.settings.v1`, `voicebill.draft.v1`, `voicebill.meta.v1`.
- VoiceBill asks for the microphone only when the mic is tapped. Audio is handled by the browser’s speech engine; the app never records, stores or uploads it.
- There is no account, no server and no analytics.
- **Clearing the browser’s site data deletes the shop’s bills.** Export a backup before changing phones or clearing data (Settings → Download backup).
- Speech recognition availability and quality vary by browser, phone and accent. Hindi/English switching, aliases, editing and manual entry exist precisely because recognition is not perfect. Hinglish is supported through aliases and transliteration, not guaranteed.
- Chrome/Edge implement the Web Speech API; Firefox does not. Some browsers require a network connection for recognition and some require HTTPS.
- Sample products are optional, marked “Sample”, and never replace the shopkeeper’s catalogue.
- Thermal printing requires the printer’s driver and the right paper size; VoiceBill supplies the 58 mm / 80 mm layout and page size, not the driver.
- Not implemented: GST invoices, multiple shops/users, cloud sync, product stock, barcode scanning.

## Manual acceptance walkthrough

1. Open the app → enter a shop name → keep “Add sample products” → **Start billing**.
2. Dashboard shows the shop name, ₹0 sales, no bills, and a setup/quick-action card.
3. Go to **Products** → edit a sample price → add your own product with aliases.
4. Go to **New bill** → tap the mic → say “3 kilo chini aur 2 kilo aata” (allow the microphone).
5. The items appear with catalogue prices and quantities; change a quantity, change a price, swap a product.
6. Speak “sarson ka tel 2 litre” → Mustard Oil appears.
7. Say something not in the catalogue (e.g. “sabun”) → the line is flagged **Needs product**; picking a product prices it.
8. Tap **Review bill** → confirm the total and save → the receipt appears.
9. Tap **Print receipt** → choose a printer, or **Save as PDF**.
10. Open **Bill history** → find the bill, search for it, filter by date, reprint it. Reload the page — everything is still there.

---

_VoiceBill v1.0 — speak, review, bill._
