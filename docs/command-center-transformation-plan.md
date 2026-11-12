# Personal Command Center — implementation plan

## Baseline audit (before implementation)

- Hono Cloudflare Worker serves an HTML shell and a locally bundled vanilla-JS client; Vite builds the Worker, esbuild the client, Tailwind the utilities. `/api/ai` keeps the Gemini credential server-side. No database or account is required.
- `kcc_state_v1` contains schema v5. Tasks, independent legacy study-plan timetables, per-day snapshots, Top 3 task IDs, completion logs, focus sessions, reminders, score history and private achievements are persisted. Migration and corrupt-data rescue already have coverage.
- Working: task CRUD/filtering/recurrence/inbox; protected-time-aware recovery proposals; timestamp-based persistent focus with pause/resume/extend/link; score/category analytics and weekly review; optional AI; notification fallback; settings, backup/import/reset, PWA.
- Gaps: exam-specific starter records appear as user data; no connected goals/projects/milestones/routines; mission statuses/subtasks/deadlines are missing; calendar is a daily list, not dated visual planning; focus has no dedicated room/stopwatch/goal attribution; light theme and personalization are incomplete; shell and mobile navigation need a complete redesign.
- Performance: entire Chart.js registry, unused dayjs wrapper, nine webfont files and all Font Awesome styles are shipped; charts are recreated on view changes; a timer commit performs unnecessary daily bookkeeping every second. Preserve correctness while reducing these costs.
- Baseline `npm run verify`: PASS (lint, both typechecks, production build, 204/204 tests). No baseline failures to hide.

## Implementation sequence

1. Add schema v6 additively: goals/milestones, projects, routines/history, mission fields, dated schedule overrides, personalization. Keep the storage key, existing IDs and history; take a pre-v6 rescue copy. Fresh workspaces start empty; legacy schedules remain available as explicitly labeled study plans.
2. Add pure planning/relationship/recovery helpers and unit tests before wiring the UI. Approval-only schedule changes, conflict detection, flexible-block propagation, protected windows and honest empty metrics.
3. Replace the shell and design system: original graphite/porcelain identity, system typography, local SVG icons, collapsible desktop rail, mobile dock/drawer, accessible dialogs, restrained motion and reduced-motion support.
4. Rebuild Overview and My Day around the current commitment, three priorities, upcoming timeline and real execution metrics. Keep quick capture and recovery one action away.
5. Upgrade Missions and the dated Schedule: full task editor, subtasks/status/progress/deadline, recurrence, list filters, day/week timelines, pointer and keyboard rescheduling, editable Plan My Day proposals.
6. Implement Goals → milestones → Projects → Missions → time blocks, project list/board/timeline views, and non-punitive routines with ordered activities and history.
7. Add Focus Room and timestamp-based stopwatch while preserving the tested focus overlay/session lifecycle; improve refresh/background reconciliation and link attribution.
8. Upgrade Analytics/Weekly Review, local planning assistant and secure AI suggestions, reminders and settings/import/export.
9. Trim unused runtime/build assets, optimize chart registration and timer persistence, update offline caching and preview configuration without changing the Worker AI security boundary.
10. Run the full existing suite plus new domain/browser tests, production build, viewport/interaction checks and a documented feature audit. Report actual limitations rather than claiming untested integrations work.

## Non-negotiables

No fabricated user records or metrics. No silent AI scheduling. No removal of existing data/history. No paid client dependency. Every visible action must have a working implementation. Keep all work on the current Arena branch.
