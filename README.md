# Command · Personal Command Center

A local-first personal productivity workspace: **what matters today, where your time goes, and how the week is really going**.

Command is an original, Apple-inspired interface — graphite dark mode by default, a porcelain light theme, system typography, local SVG icons, restrained motion, and a dedicated mobile dock/drawer. It is a working product, not a landing page: missions, goals, projects, routines, scheduling, focus, analytics, review, reminders, backup/restore and optional AI are all wired to real browser-local data.

## Quick start

```bash
npm install
npm run dev          # builds the client, then starts the Hono/Vite dev server
npm run verify       # lint + both typechecks + production build + full test suite
npm run build        # clean production build → dist/
npm run preview      # Wrangler local preview of the Worker
npm run deploy       # build + deploy to Cloudflare Workers
```

No account, database, paid client dependency or API key is required for the core app. A fresh workspace starts empty; legacy study-plan data is migrated and preserved.

## What works

- **Forecast** — the only forward-looking view: committed load for the next 7/14/30 days from the same schedule the planner uses, capacity line, load status per day, clashes, category balance and carried-over work. Rest blocks are never counted as commitments.
- **Journal** — one honest entry a day: what happened, one win, the next step, mood and energy. Thirty-day mood/streak metrics, a gentle summary line and a timeline of recent entries. Local only.
- **Natural-language capture** — quick capture reads “Pay the bill tomorrow at 6pm for 15m !high #work” and shows each detected field as a chip before saving; repetition becomes a real series.
- **Briefing** — opening the app greets you as **“Sir”** (editable), names the one mission that needs you now, and shows the honest shape of the day: score, Top 3, focus minutes, overdue work, the next blocks, tomorrow’s first move and one written intention. An always-visible command strip keeps that next move in sight on every screen; `B` opens the full briefing at any time.
- **Overview / My Day** — time-aware greeting, live clock, today’s command, transparent daily score, Top 3 priorities, upcoming timeline, real weekly chart and quick actions.
- **Schedule** — day/week/list calendars, dated time blocks, protected windows, conflict warnings, pointer drag, keyboard rescheduling (`Alt + ↑/↓`), task extension that moves only flexible blocks, and legacy study-plan templates.
- **Plan My Day / Recover My Day** — deterministic proposals from real available time. Existing commitments and protected windows stay put; excess work is explicitly deferred. Every row is editable and nothing applies until you accept.
- **Missions** — daily/weekly/long-term/quick horizons, seven statuses, subtasks, deadlines, recurrence, search/filter, quick capture, inbox, reschedule/skip history and goal/project/milestone links.
- **Goals → milestones → projects → missions → time blocks** — connected progress, editable checkpoints, goal detail chains and project list/board/timeline views.
- **Focus Room** — Pomodoro, custom durations, stopwatch, short/long breaks, mission/goal attribution, fullscreen/minimal overlay, daily target and real history. Timer math is timestamp-based and survives pause, tab switches, refresh and reopen.
- **Routines** — ordered activities, weekday schedules, check-ins, consistency history and non-punitive momentum. Missed days are not debts.
- **Analytics / Weekly Review** — completion, focus time, planned vs completed, categories, productive days, adherence and consistency from recorded data only; private reflections and next-week planning.
- **Assistant** — optional Cloudflare Worker AI plus useful offline planning tools. AI can suggest; it cannot modify missions or accept a schedule.
- **Settings** — profile, theme/accent, week start, time format, working hours, focus/break preferences, reminders, categories, protected time, export/import/reset and safety copies.
- **Close the day** — the evening half of the loop: an honest summary, chosen carry-over into tomorrow, tomorrow’s three priorities and one honest line in the journal. Nothing is applied until you confirm, and every closing can be reopened.
- **Workspace search** — one ranked, grouped index across missions, notes, subtasks, goals, milestones, projects, routines and journal entries. Word-start hits, token matching and ordered subsequences; results are highlighted and keyboard-first.
- **Calendar & paper** — export real commitments as a standards-compliant `.ics` (Google/Apple/Outlook) or print a quiet one-page day sheet. Recovery blocks are left out of both.
- **Recently deleted** — deleting a mission is reversible for 30 days, including its scheduled blocks and priority slot. Focus history is never rewritten.
- **PWA** — installable shell, offline navigation/assets, local data, responsible notification permissions and in-app reminder fallback.

## The forward view

The workspace answers four questions in order: **what needs me now** (the briefing), **what does the next fortnight look like** (Forecast), **what happened** (Journal), and **what comes with me tomorrow** (Close the day). Forecast counts only real commitments from your schedule — sleep and protected windows are excluded — and reports clashes and carried-over work without blame. The Journal stores one entry per day (note, win, next step, mood, energy) inside state schema **v8**, with additive migrations and no change to existing records; the closing ritual writes to the same entry. Quick capture understands dates, times, durations, priorities, categories and repetition, and mirrors every parsed field into the visible controls before anything is saved. See `docs/workspace-4.3.md` and `docs/command-5.md` for the full behaviour tables and recorded verification.

## The briefing

The briefing is the first thing you see and the fastest way back into the day. It is deterministic: the same records always produce the same next move.

| Surface | What it does |
|---|---|
| Startup briefing | Greets you by your salutation, then names the current mission. Opens once a day by default; configurable to every load or only on request. |
| Command strip | A one-line “At your command, Sir.” under the top bar that always names the next mission, its reason and its time. Updates on every change. |
| Next-move order | Running time block → unfinished Top 3 → most overdue → highest-priority mission today → next scheduled block → newest inbox capture → an honest clear day. |
| Intention | One short sentence per day, saved locally, shown in the greeting, the briefing and the assistant’s context. |
| Spoken briefing | Optional browser-voice reading of the same summary. No audio leaves the device; unsupported browsers simply show the text. |
| Recovery | When earlier work is still open, the briefing offers *Recover my day* without blame. |

Nothing in the briefing is invented and nothing is written except your intention and the “last shown” day. Settings → **Briefing** controls the salutation, when it opens and whether it speaks. The pure model lives in `src/client/lib/briefing.js` and is covered by unit and jsdom integration tests.

## Architecture

| Layer | Choice |
|---|---|
| Edge | Cloudflare Worker + Hono (`src/index.tsx`, `src/worker.ts`, `src/ai.ts`) |
| Client | Vanilla JS ES modules, no UI framework |
| Build | esbuild client bundle, compiled Tailwind, Vite Worker build |
| Charts | locally bundled Chart.js |
| Storage | browser `localStorage`, key `kcc_state_v1`, schema **v8** |
| Typography/icons | system font stack + inline local SVG |

```text
src/client/lib/      pure planning, briefing, shutdown, search, calendar export, trash,
                     score, focus, recurrence, relationships, routines, backup…
src/client/core/     store, actions, DOM/dialogs, charts, event bus
src/client/ui/       shell chrome, router, focus overlay, capture, reminders, PWA
src/client/views/    Overview, My Day, Schedule, Missions, Goals, Projects, Routines,
                     Focus Room, Analytics, Weekly Review, Assistant, Settings
public/sw.js         versioned offline shell
tests/unit/          pure-domain tests
tests/integration/   real Worker routes + real client bundle in jsdom + AI contract
```

## AI configuration (optional)

The browser only calls `/api/ai`. The Worker adds the credential server-side and returns a sanitized response.

```bash
npx wrangler secret put GEMINI_API_KEY     # production
# local-only alternative: .dev.vars (git-ignored)
```

Without a key or network, the assistant reports the failure honestly and the built-in planner/recovery/next-action/review tools keep working.

## Data safety

- Additive migrations preserve existing IDs, tasks, timetables, completion logs, focus history and preferences.
- Pre-upgrade, pre-import, pre-reset and unreadable-data rescue copies are kept when storage permits.
- Import validates the whole file before replacing anything; a safety copy is written first.
- Storage denial/quota failure is reported visibly; the current tab keeps working and export remains available.
- Clearing browser data still erases local data — export backups regularly.

## Keyboard

`B` briefing · `E` close the day · `?` keyboard shortcut sheet · `Ctrl/⌘ + K` quick capture · `Ctrl/⌘ + Shift + K` workspace search · `F` Focus Room · `N` capture · `J` Journal · `O` Forecast · `1–9` main views · `Esc` close/minimise · calendar `Alt + ↑/↓` reschedule · assistant `Enter` send / `Shift + Enter` newline.

## Verification

`npm run verify` runs the project lint, Worker/client typechecks, clean production build and the full Node test suite (319 tests, including real-bundle jsdom flows for the closing ritual, search, recoverable deletes and export). The 4.x transformation additionally received headless Chromium interaction/viewport/offline QA (recorded in `docs/command-center-final-report.md`); Command 5.0 was verified through the real-bundle jsdom flows above plus a full fourteen-view smoke pass, lint, typecheck and production build. See `docs/command-5.md` for the design and feature dossier.
