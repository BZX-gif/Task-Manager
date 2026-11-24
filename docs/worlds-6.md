# PAPER 6.0 — one product, eight worlds

The Command Center's villa was already the right idea: a full-screen original
photograph, editorial type laid over it, and glass panels that carry real data.
The rest of the application now uses the same language — with a different room
for every chapter.

---

## 1 · The rooms

| Route | Scene | Original photograph |
|---|---|---|
| `dashboard` | villa | the three existing villa frames (morning / afternoon / night) |
| `day`, `hyb`, `routines` | day | sunrise penthouse above a quiet city |
| `tasks` | missions | mountain executive workspace |
| `goals` | goals | coastal villa, infinity pool and open horizon |
| `projects` | projects | glass-and-oak creative studio |
| `calendar`, `schedule`, `forecast` | terrace | resort terrace above the valley |
| `focus` | study | private study at night, one warm lamp |
| `paper`, `progress`, `settings` | lounge | morning hotel lounge |
| `journal`, `review` | writing | private writing room in late afternoon |

Nine rooms, nine distinct frames. The villa's three photographs are unchanged;
no photograph is used by two named sections. Secondary routes inherit the room
of the work they belong to, so navigation never jumps to an unrelated world.

The images were generated for this project from detailed architectural prompts
in `public/assets/atmospheres/<room>/`, with no text, logos or interface in the
frame. The image generator caps output at 1376 × 768, so each frame is shipped
both at its native detail (1280 px first-paint WebP) and as a 2560 × 1429 WebP
upscale with Lanczos resampling and a gentle unsharp pass. The upscale meets the
layout's resolution target; it does not invent detail the generator did not
produce. Both files stay under the existing asset budget (full < 420 kB, small
< 160 kB). PNG generation masters are kept out of the repository.

## 2 · The stage

`public/static/worlds.css` is the final cascade layer, loaded after the PAPER
paper system. It does four things:

1. paints one fixed photographic stage (`#scene`) with a per-room tonal grade;
2. re-points PAPER's palette tokens to warm dark glass (or luminous cream glass
   in the light theme) so every existing component inherits the new material;
3. restyles the **same** persistent shell — sidebar, top bar, command strip,
   mobile drawer and dock — as translucent dark glass with bronze active marks;
4. gives each view its own composition, rather than repeating one grid.

The static frame is in the shell and keyed off `data-scene`, which the inline
bootstrap writes before first paint. The client then creates one crossfading
layer per room, paints the small file first, decodes the full file before
swapping, and warms neighbouring rooms off the critical path.

## 3 · The navigation is a room too

The sidebar has its own commissioned portrait: a quiet hotel gallery corridor
with a central vanishing point, generated for the rail and shipped at
`public/assets/atmospheres/navigation/gallery-corridor*.webp`. It sits behind
the same dark glass as the rest of the shell, so the index reads as part of the
property rather than a generic admin panel. The mobile drawer uses the same
artwork.

A small glass card in both navigation surfaces shows the room currently
selected — its photograph, name and place — and follows the selected atmosphere
when the villa changes time of day. The card is generated from the same scene
registry as the page and the photograph layers, so the index cannot disagree
with the environment it points to.

## 4 · The chapter opening

`sceneHero()` in `src/client/ui/scenes.js` is now the single source of the
opening for every view (`paperHeader` and `pageHeading` both delegate to it).
It supplies the chapter number, a line written for that room, and two or three
figures read from the same store the page renders — open missions, overdue
work, milestones, scheduled blocks, focus minutes, journal entries. Nothing is
mocked. The caller still owns the title, lede and action buttons.

The eight named sections then arrange the shared components differently:

- **My Day** — the widest heading, a two-column morning page and a full-width
  reflection desk.
- **Missions** — a floating filter bar above one long executive ledger.
- **Goals** — an uneven horizon of chapter cards with a lifted middle column.
- **Projects** — figures in the margin, then a table, board or timeline.
- **Calendar** — a shorter hero so the month grid gets the room; toolbar,
  layer chips and grid sit on separate glass planes.
- **Focus** — the hero withdraws to one line, the timer becomes the largest
  object in the room, and fullscreen keeps the study rather than a flat fill.
- **Briefing / PAPER** — a private letter: the executive briefing in a wide
  glass column, recommendations and alerts in the right margin.
- **Journal** — a narrower reading measure on the writing room.

The daily briefing overlay itself takes the lounge photograph behind its
letter, so the environment is continuous when `B` opens the briefing.

## 5 · What was deliberately preserved

- Every route, `data-*` hook, modal, form and keyboard shortcut.
- The villa's three-layer atmosphere engine, its local-time boundaries and its
  Auto / Morning / Afternoon / Evening selector in both the hero and Settings.
- The local-first store (schema v8), the PAPER intelligence engine, offline
  service worker, themes, editions and accessibility affordances.
- The `data-atmosphere-view` attribute and the existing component class names,
  so behavioural tests still exercise the real application.

## 6 · Verification

- `npm run verify` — 482 tests, including the new world map, room-routing and
  navigation-portrait suites; lint, both typechecks and a production build.
- `npm run qa:contrast` — 0 failures in 144 region × atmosphere samples, worst
  5.53:1 for the villa (unchanged).
- `npm run qa:fit` — 16 routes × 10 widths, no guaranteed horizontal overflow.
- `node scripts/smoke-render.mjs` — every dialog, capture path and calendar
  mode still drives the real bundle with no console errors.
- `node scripts/qa-sweep.mjs` — 0 errors, 0 warnings across all probes.
