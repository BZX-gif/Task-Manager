# COMMAND 2.0 — Product & Architecture Audit (Phase 1)

**Codename: PAPER.** This document is the Phase 1 deliverable of the COMMAND 2.0
rebirth: an inventory of what exists, an assessment of what must change, the
target architecture, and the data-migration / data-safety plan. It is the
reference for every later phase.

---

## 1. Existing architecture map

| Layer | What exists today |
|---|---|
| Edge | Cloudflare Worker + Hono (`src/index.tsx`, `src/worker.ts`, `src/ai.ts` — optional Gemini proxy) |
| Shell | Server-rendered HTML (`src/shell.ts`) with sidebar nav, topbar, command strip, mobile dock |
| Client | Vanilla JS ES modules, no UI framework (`src/client/**` — ~14k lines) |
| State | Single `localStorage` store, key `kcc_state_v1`, schema **v8**, additive migrations (`lib/state.js`, `core/store.js`) |
| Domain logic | Pure modules in `src/client/lib/` (planner, briefing, score, top3, recurrence, focus, forecast, recovery, quickparse, journal, insights, relationships, backup, …) |
| UI | `src/client/ui/` (chrome, router, briefing overlay, focus overlay, quick capture, onboarding, PWA) + `src/client/views/` (16 views) |
| Styling | Hand-written token system in `public/static/style.css` ("MERIDIAN"), plus `studio.css`, `system.css`, compiled Tailwind |
| Build | esbuild client bundle + Tailwind compile (`scripts/build-client.mjs`), Vite Worker build |
| Tests | `node --test` — 21 unit suites + 7 integration suites (jsdom against the real bundle) |
| QA | Custom zero-dependency lint (`scripts/lint.mjs`), typecheck (2 tsconfigs), fuzzers, render smoke tests |

**Verdict:** the engineering spine is sound — pure domain modules, one store,
additive migrations, safety copies around every destructive action, offline PWA,
no external runtime dependencies for the core. COMMAND 2.0 must be built *on*
this spine, not beside it.

## 2. Feature inventory (what genuinely works)

- **Briefing** — deterministic next-move engine (`lib/briefing.js`), command strip, spoken briefing, daily intention.
- **Missions** — 7 statuses, subtasks, deadlines, recurrence with series, horizons, history, inbox, quick capture with natural-language parsing (`lib/quickparse.js`).
- **Goals → milestones → projects → missions → blocks** — linked chains with progress (`lib/relationships.js`).
- **Schedule / Calendar** — time blocks, protected windows, conflict detection, drag + keyboard rescheduling, month/week/agenda layers.
- **Planning** — `proposeDay` / `planRecovery` deterministic planners; Top 3; day plans per mission.
- **Focus** — timestamp-based Pomodoro/stopwatch, breaks, attribution, history.
- **HYB** — lightweight "plan" layer (lanes, quick-capture grammar, studio) + Routines + Forecast + Weekly Review + Journal + Analytics (score, categories, streaks).
- **Settings** — profile, themes/accents, working hours, categories, protected time, export/import/reset with safety copies.
- **Assistant** — optional server-side Gemini proxy (`src/ai.ts`) + local planning tools. Client never holds a key.
- **PWA** — offline shell, manifest, reminders.

## 3. Data inventory (all user data — **never to be deleted silently**)

| Location | Contents |
|---|---|
| `localStorage[kcc_state_v1]` | everything: settings, missions, goals, projects, routines, HYB plans, timetables, day plans, top3, completion log, score history, focus sessions, journal, reviews, reminders, chat history, briefing intentions, achievements |
| `kcc_backup_pre_v2`, `kcc_backup_pre_v6`, `kcc_backup_before_change`, `kcc_backup_before_reset`, `kcc_backup_pre_import`, `kcc_backup_unreadable` | safety copies written around migrations/imports/resets |
| Export files (user-held) | full JSON exports via `lib/backup.js` with validation on import |

**Migration rules adopted for COMMAND 2.0** (satisfied by the existing
machinery, re-affirmed here):

1. Every change to the payload is **additive** — new fields (e.g. `state.paper`)
   are normalized with defaults when absent; existing records are never
   rewritten destructively.
2. Pre-import / pre-reset / pre-migration safety copies stay mandatory.
3. Import validates the whole file before replacing anything.
4. Reset requires two explicit confirmations and keeps a safety copy.
5. Development/testing uses fixture states (`tests/helpers/fixtures.js`), never
   real data.
6. Corrupt payloads are parked under `kcc_backup_unreadable`, never overwritten.

## 4. Technical debt assessment

| Debt | Severity | Plan |
|---|---|---|
| The "Assistant" is a chat UI around an optional cloud LLM; the real intelligence (briefing, planner, next-action, recovery, forecast) is scattered across `lib/` with no unifying engine | High | Consolidate into the **PAPER** engine (`src/client/lib/paper/`) with one honest contract: facts / calculations / inferences / recommendations / missing information |
| 16 flat nav items; Forecast, Review, HYB, Routines sit at the same level as core domains | Medium | Reorganize navigation around the 10 COMMAND domains; secondary surfaces keep their routes but live inside their domain |
| Two competing "assistant context" systems (`lib/ai-context.js`, `lib/insights.js`) and duplicated mission helpers (`lib/mission.js` vs `lib/missions.js`) | Medium | PAPER has exactly one context builder; legacy modules stay where tested code depends on them, and are documented as internals |
| `views/timetable.js` is a legacy study-plan surface reachable only from Schedule | Low | Keep (it is tested and used) but present as "Study plans" inside the Schedule domain |
| Visual identity ("MERIDIAN") is cool-ink with blue-tinted atmosphere gradients | Medium | Re-tokenize to the COMMAND 2.0 identity: warm near-black, charcoal surfaces, warm white ink, one sophisticated orange — no blue-tinted darks |
| `chatHistory` is a free-form transcript of the old assistant | Low | Preserved in schema and export; PAPER keeps its own local history (`state.paper.history`) |

## 5. Proposed COMMAND 2.0 architecture

**Product domains** (navigation is organized around them; every route stays alive):

| Domain | Route(s) | Role |
|---|---|---|
| Command Center | `dashboard` | executive overview: briefing, objectives, alerts, goal health, PAPER recommendations |
| My Day | `day`, `hyb`, `routines` | daily execution, lightweight plans, routines |
| Missions | `tasks` | operational task system |
| Goals | `goals` | ambitions, milestones, health |
| Projects | `projects` | execution layer between goals and missions |
| Calendar & Schedule | `calendar`, `schedule` | time environment |
| Focus | `focus` | concentration environment |
| Journal | `journal` | reflection & knowledge |
| Analytics | `progress`, `forecast`, `review` | performance, forward load, weekly review |
| PAPER | `paper` (alias `assistant`) | executive intelligence workspace |
| Settings & Data | `settings` | preferences, backup/restore, reset |

**PAPER engine** — pure, deterministic, offline, in `src/client/lib/paper/`:

```
core.js           shared vocabulary: evidence types (fact/calculation/inference/
                  recommendation/missing), finding builders, priority model
context.js        workspace snapshot from real state (the single context builder)
priorities.js     mission scoring & today's objective ranking (with reasons)
scheduling.js     available time, workload, conflicts, realistic allocation
reasoning.js      goal/project intelligence: health, stagnation, dependencies
history.js        pattern intelligence over recorded data (gated by data sufficiency)
recommendations.js the recommendation + alert generators (every rec carries evidence)
intent.js         local intent parser for "Ask PAPER" with a supported-command catalog
actions.js        prepared actions (create/reschedule mission, plan tomorrow, …) —
                  executed only after explicit confirmation
recovery.js       recovery intelligence (restore control, no guilt)
briefing.js       the executive briefing assembler
memory.js         local interaction history (state.paper — additive schema)
engine.js         askPaper(): intent → module → structured, honest answer
```

Contract for every PAPER output: `{ type, text, findings[], actions[] }` where
each finding is `{ kind: 'fact'|'calculation'|'inference'|'recommendation'|'missing',
text, source }`. PAPER never fabricates; when data is missing it says so.

## 6. Visual identity (Phase 2 brief)

- Backgrounds: deep warm near-black → rich charcoal → subtle elevated dark grey.
- Text: warm white primary, muted warm grey secondary. **No blue-tinted darks.**
- One signature accent: sophisticated orange, used sparingly for actions, active
  states and meaningful indicators. No decorative gradients or glow.
- Type: editorial serif for major headings (self-hosted system serif stack),
  highly readable sans for UI, monospace for numbers/metadata.
- Motion: subtle entrances, refined hover, animated progress; full
  `prefers-reduced-motion` support.

## 7. Implementation roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | This audit | done |
| 2 | Design system + shell reorganization + PAPER identity | next |
| 3 | PAPER core engine + unit tests | |
| 4 | Command Center wired to PAPER | |
| 5 | Daily operations (My Day, Missions, Goals, Projects, Calendar) integration | |
| 6 | PAPER × Focus / Journal / Analytics (patterns, time intelligence) | |
| 7 | Onboarding, settings & data, responsive/a11y polish | |
| 8 | QA: lint, typecheck, unit + integration tests, migration/backup tests | |

## 8. Risks

1. **Scope** — the full brief is a multi-week product. Mitigation: staged
   delivery on the existing spine, honest reporting of what is genuinely
   working vs limited at each stage.
2. **Test coupling** — integration tests assert the old assistant surface.
   Mitigation: they are updated alongside the product, never deleted to hide
   breakage; core domain tests (planner, briefing, missions, backup) stay green.
3. **Data safety** — any new persisted field (`state.paper`) must be additive.
   Mitigation: follow the existing `briefing`-style normalization; covered by
   migration tests.
4. **Honesty of intelligence** — rule-based reasoning must never pose as an LLM.
   Mitigation: the evidence-kind contract above, visible in the UI, plus tests
   asserting PAPER refuses when data is insufficient.
