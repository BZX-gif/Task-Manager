# Kulshresth's Command Center 🚀

One screen that answers three questions: **what should I do right now, am I actually doing it, and how is this week going?**

A personal productivity command center built around a fixed study timetable — focus timer, Top 3 priorities, a deterministic daily score, weekly review, category analytics, smart reminders, a local-first PWA shell, and an AI assistant that runs through a Cloudflare Worker (the Gemini key never reaches the browser).

---

## Tech stack

| Layer | Choice |
|---|---|
| Edge runtime | Cloudflare **Workers** (Hono) — serves the shell, static assets and `/api/ai` |
| Build | Vite + `@hono/vite-build` (Worker) · esbuild (client bundle) · Tailwind CLI (compiled CSS, **no CDN**) |
| Client | Vanilla JS ES modules in `src/client/**` — no framework, no runtime dependencies |
| Charts | Chart.js (loaded from the local bundle) |
| Data | Browser `localStorage`, key `kcc_state_v1`, schema `version: 2` |
| Fonts & icons | Self-hosted: Sora + Manrope (latin subset) and Font Awesome — the app needs no third-party CDN |

```
src/shell.ts        HTML document (meta, PWA tags, sidebar/header markup)
src/worker.ts       Hono app: page + assets + API routes
src/ai.ts           POST /api/ai → Gemini with the secret key
src/client/lib/**   17 pure, unit-tested modules (score, focus, recurrence, …)
src/client/core/**  store + persistence, event bus, DOM helpers, charts, day plan
src/client/ui/**    focus mode, chrome widgets, router, quick capture, reminders, PWA
src/client/views/** dashboard, timetable, tasks, progress, weekly review, recovery, assistant, settings
public/sw.js        Service worker (offline shell)
tests/unit/**       Pure-logic tests (node:test)
tests/integration/** Real Worker routes + the real bundle booted in jsdom
```

---

## Quick start

```bash
npm install
npm run dev          # vite dev server (rebuilds the client bundle on start)
npm run verify       # lint + typecheck + build + all tests
npm run build        # production build → dist/ (Worker + assets)
npm run preview      # wrangler dev (serves the real Worker locally)
npm run deploy       # build + wrangler deploy
```

The AI assistant needs the Gemini key as a **Worker secret** (never in the browser, never in the repo):

```bash
npx wrangler secret put GEMINI_API_KEY     # production
# or, for local development only: echo 'GEMINI_API_KEY="…"' > .dev.vars   (git-ignored)
```

---

## What it does

### Focus mode
- Start from any task, from **DO THIS NOW**, from the sidebar, or with <kbd>F</kbd> / the header chip.
- Presets 25 / 50 / 90 plus a custom length (1–600 min), optional 5-min break timer, circular progress ring, fullscreen distraction-free overlay.
- Pause · resume · complete · stop · +5 min · re-link to another task — the session survives a page refresh (it is persisted immediately, not debounced) and the header chip brings it back.
- Completing a session credits focused minutes, updates today's score, and marks the linked task done when Settings → Focus → "Completing a focus session marks its task done" is on.
- Sub-minute sessions are discarded so analytics stay meaningful.

### Today's Top 3
Exactly three priorities per day, stored as **task ids** (`state.top3[dateKey]`), never duplicated records. Each row has completion state, focus action, edit and remove. If you have fewer than three, the card offers the best candidates.

### DO THIS NOW
One card, one answer — resolved deterministically in this order: incomplete Top 3 → the block running right now → overdue task → highest-priority incomplete task → nearest upcoming block. It shows the title, category, estimated duration and a **Start Focus** button; after completing an item the card advances automatically.

### Daily score (0–100)
Deterministic and documented in `src/client/lib/score.js`:

| Component | Weight | Notes |
|---|---|---|
| Planned tasks completed | 30 | today's tasks, inbox items excluded |
| Top 3 completed | 25 | scales with the number of priorities set |
| Focused minutes | 20 | against `settings.focus.targetMinutes` (default 180) |
| Timetable adherence | 20 | blocks elapsed so far, not the whole day |
| Overdue tasks | −4 each, capped at −15 | recovered as you close them |

The dashboard shows the score plus its four parts (Tasks x/y · Top 3 x/3 · Focus time · Schedule %), so a missed task never silently tanks the number.

### Recurring tasks
Daily · selected weekdays · weekly · monthly. Occurrences are generated for the next 7 days and topped up hourly; identity is `seriesId|occurrenceDate`, which makes duplicates impossible. Completing an occurrence rolls the series forward, and analytics treat them as normal tasks.

### Smart reminders (browser only, no paid service, no spam)
Built on the Notifications API with an in-app toast fallback: upcoming timetable blocks, due/overdue tasks, and a Top-3 nudge. Settings can enable/disable each kind, choose the lead time, respect protected time, and opt into desktop notifications. Each reminder fires once per day (dedupe log), and nothing fires while the tab is hidden from you.

### Streak
🔥 **X DAY STREAK** plus a 14-dot consistency strip. A day counts as successful when **all three Top 3 items are done, or the daily score is ≥ 60, or ≥ 45 focused minutes were logged** — the rule is shown in the UI tooltip. One missed minor task cannot break it.

### Weekly review
`Review week` (or the dashboard button) opens real numbers for the last 7 days: planned vs focused time, completion rate, average daily score, best and weakest day, completed and missed tasks, consistency, per-category performance, focus-by-time-of-day, and generated recommendations that only reference actual data.

### Category analytics (Progress)
Per-category completion rate, planned time, focused time and trend, plus **Strongest / Weakest area** and a recommendation. Your own categories are used — nothing is hardcoded to a specific exam.

### AI assistant (optional, internet required)
Seven one-tap commands: **Plan My Day · What Should I Do Next? · Fix My Timetable · Review My Week · Make Tomorrow's Plan · Break Down This Task · Why Am I Falling Behind?** Each request sends a compact context block (< 1800 characters: today's tasks, Top 3, timetable, completion, focus history, score, overdue items) — never your whole state, never any key. Failures show friendly messages, no stack traces.

### Recover My Day
Shows what was missed, how much usable time is left today, and a realistic compressed plan **as a proposal** — nothing changes until you press Apply. It respects day-end and protected windows, and works without AI.

### Quick capture, inbox, protected time, PWA, backup
- <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> opens quick capture anywhere; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves. File to Today / Tomorrow / a date / the **Inbox** (no date, sorted later).
- Protected windows (e.g. 23:00–06:00) are avoided by scheduling suggestions and flagged as conflicts in the timetable.
- Installable PWA: manifest, icons, offline shell, shortcuts. Tasks and timetable keep working offline; AI needs a connection.
- Settings → Export JSON writes a versioned backup; Import validates the schema, keeps a copy of your current data first, then reloads the UI. **Reset All Data** asks for explicit confirmation and keeps the same rescue copy behaviour.

### Keyboard
<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> quick capture · <kbd>F</kbd> focus mode · <kbd>Esc</kbd> close the top overlay · <kbd>1</kbd>–<kbd>6</kbd> switch views · <kbd>Enter</kbd> send in the assistant (<kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line).

---

## Routes

| Route | Purpose |
|---|---|
| `GET /` | App shell (single page; all views are client-side) |
| `GET /static/*`, `/icons/*` | Client bundle, compiled CSS, fonts, icons |
| `GET /manifest.webmanifest`, `/sw.js` | PWA metadata + service worker |
| `GET /api/health` | `{ ok, name, ai: 'server-side', time }` |
| `POST /api/ai` | `{ system?, context?, messages[] }` → `{ text }` — 400 bad JSON · 422 blocked · 429/502 upstream · 504 timeout · 500 missing secret |

The browser never talks to Gemini. It posts to `/api/ai`; the Worker adds `GEMINI_API_KEY` (a Worker secret) and strips everything on the way back.

---

## Data & safety

- Everything lives in `localStorage` under `kcc_state_v1` — no server database, no accounts, no paid services.
- **Migrations are additive.** v1 payloads are upgraded in place and a copy is written to `kcc_backup_pre_v2` before anything changes; the old browser-side API key is deleted, not migrated.
- Unreadable payloads are never destroyed: the raw string is parked in `kcc_backup_unreadable` and the user is told.
- Clearing browser data still erases everything — use **Settings → Export JSON** regularly.

---

## Development notes

```bash
npm run lint        # secrets, no CDN/CSP regressions, shell asset refs, CC.* API coverage, syntax
npm run typecheck   # Worker (strict TS) + client JS (checkJs, 0 errors)
npm run test:unit   # 101 pure-logic tests
npm run test:integration   # builds, then drives the real Worker + bundle in jsdom
npm test            # build + both suites
```

The client bundle is generated by `scripts/build-client.mjs` (esbuild + Tailwind CLI + fonts + Font Awesome) and is intentionally git-ignored; `npm run build` always regenerates it.

## Known limitations

- Single-device, single-browser storage (by design).
- AI commands need the Worker secret configured and an internet connection.
- Desktop notifications depend on browser permission; the toast fallback is always available.
- The service worker caches the shell/asset set; a redeploy with a new version string refreshes it on the next visit.

## Deployment

Cloudflare **Workers** (not Pages):

```bash
npx wrangler secret put GEMINI_API_KEY   # once
npm run deploy                           # npm run build && wrangler deploy
```

`wrangler.jsonc` keeps `main: ./dist/index.js`, `assets: ./dist`, `nodejs_compat` and `secrets.required: ["GEMINI_API_KEY"]`.
