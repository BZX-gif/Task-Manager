# Kulshresth's Command Center 🚀

A high-level, all-in-one personal productivity command center — timetable, task manager, progress analytics, and a personal AI assistant — built specifically for Kulshresth's UPSC/SSC exam preparation.

## Project Overview
- **Name**: Kulshresth's Command Center
- **Goal**: Replace scattered notes/timetables with one polished dashboard that tracks a fixed daily schedule, ad-hoc tasks, and long-term progress — plus an AI assistant that knows the day's context and always addresses the user as "sir".
- **Tech Stack**: Hono (Cloudflare Workers) for the shell + a 100% client-side SPA (vanilla JS, Tailwind CDN, Chart.js, Day.js, Font Awesome).

## ✅ Currently Completed Features
1. **Dashboard** — today's completion %, timetable/task counters, current streak, "Right Now / Up Next" live block indicator, 7-day trend chart, category legend, rotating motivational quote.
2. **Timetable** — your full UPSC/SSC daily schedule pre-loaded (05:00 wake-up → 23:00 sleep) exactly as designed, color-coded by category (Body & Recovery / UPSC Core / SSC·News·CA / Meals & Rest). Tap any block to mark it done, edit time/title/duration/category, add new custom blocks, or reset today's progress.
3. **Tasks** — full CRUD task manager independent of the fixed timetable: title, date, priority (High/Medium/Low), category, notes. Filter by Today / Upcoming / All / Completed.
4. **Progress Analytics** — Week / Month / Year toggle with a bar chart of completion %, a summary card (average, best day, active days, streak), a category-breakdown donut chart, and a 12-week GitHub-style activity heatmap.
5. **Streak Engine** — automatically computed from daily completion history (≥50% completion counts as a "successful" day) and shown in the sidebar and dashboard.
6. **Time-based Greeting** — "Good morning / afternoon / evening / night, Kulshresth sir 👋" that updates live, plus a live clock and a quote that rotates every 15 seconds.
7. **AI Assistant** — chat interface wired directly to the **Google Gemini API** (`gemini-flash-latest`, currently resolving to `gemini-3.8-flash`) called straight from the browser using `x-goog-api-key`. The system prompt injects your live context (today's schedule, tasks, streak) and instructs the model to always address you as "sir". Includes quick-prompt shortcuts ("How am I doing?", "Motivate me", "Prioritize tasks").
8. **Settings** — manage/replace/test your Gemini API key (masked input, show/hide toggle, "Test Connection" button), recolor categories, export/import a full JSON backup, and a "Reset Everything" wipe.
9. **100% localStorage persistence** — no backend database. Every task, timetable edit, completion log, chat history, and your API key lives only in your browser (`localStorage` key `kcc_state_v1`).
10. Fully responsive (desktop sidebar nav + mobile pill nav), dark glassmorphism UI with animated background orbs, toasts, and modals.

## 🔗 Entry Points / Routes
| Route | Description |
|---|---|
| `GET /` | Single-page app shell (all views are client-side, no server routing) |
| `GET /static/app.js` | Application logic |
| `GET /static/style.css` | Custom styles |
| `GET /static/favicon.svg` | Favicon |

There is no server-side API — the only outbound network call the app makes is directly from your browser to `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent` using your own Gemini API key (never sent anywhere else).

## 🗄️ Data Architecture
- **Storage**: Browser `localStorage` only (key: `kcc_state_v1`). No Cloudflare D1/KV/R2 — this app has no server-side data at all.
- **Data model** (see `public/static/app.js`):
  - `categories`: `{ id, name, color }[]`
  - `timetable`: `{ id, time, title, duration, cat }[]` (pre-seeded with your daily schedule)
  - `tasks`: `{ id, title, date, priority, cat, notes, done, createdAt }[]`
  - `completionLog`: `{ "YYYY-MM-DD": { ttDone: [ids], taskDone: [] } }` — daily record of which timetable blocks were completed, used to compute streaks and progress charts
  - `settings`: `{ geminiApiKey, theme }`
  - `chatHistory`: `{ role, text }[]` — assistant conversation, trimmed to last 16 turns before each API call

## 👤 User Guide
1. Open the app — it greets you by name based on the time of day.
2. **Timetable tab**: tap any block once you finish it. Colors show category; the currently-active time block is highlighted "LIVE".
3. **Tasks tab**: click "New Task" to add anything outside the fixed schedule (assignments, errands, extra revision). Check it off when done.
4. **Progress tab**: switch between Week / Month / Year to see your completion trend, a category breakdown donut, and a 12-week heatmap.
5. **AI Assistant tab**: type anything — it knows your current schedule/progress and will always call you "sir". Your Gemini key (pre-filled for local use) can be changed anytime in Settings.
6. **Settings tab**: update your API key, recolor categories, or export a JSON backup of everything (recommended periodically, since it's all local to this browser/device).

⚠️ **Important**: Because everything is stored in `localStorage`, your data is tied to this specific browser on this specific device. Clearing browser data will erase it — use **Settings → Export JSON** to back up regularly.

## 🚧 Features Not Yet Implemented
- Cross-device sync (would require a backend — currently intentionally local-only per request)
- Push/browser notifications for upcoming timetable blocks
- Drag-and-drop timetable reordering
- Multi-user / login support

## 🔜 Recommended Next Steps
- If cross-device access becomes important, add Cloudflare D1 + a simple auth layer and migrate the storage layer from `localStorage` to API calls (the code is structured so `loadState`/`saveState` are the only functions that would need to change).
- Add a "streak freeze" or rest-day toggle for planned off-days.
- Add push notifications for timetable transitions using the Notifications API (works even without a backend).

## 🌐 Deployment
- **Platform**: Cloudflare Pages (via Hono + Vite)
- **Status**: Running locally in sandbox via PM2 + Wrangler Pages dev (`npm run build && pm2 start ecosystem.config.cjs`)
- **Tech Stack**: Hono (edge shell) · Vanilla JS/CSS (frontend logic) · Tailwind CDN · Chart.js · Day.js · Font Awesome
- **Last Updated**: 2026-09-13
