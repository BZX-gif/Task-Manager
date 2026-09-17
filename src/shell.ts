/**
 * App shell HTML. Kept as a plain string so the Worker can stream it instantly
 * and so the dom-based integration tests can reuse it.
 */
export const APP_VERSION = '2.0'
export const USER_NAME = 'Kulshresth'

export function renderShell(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>${USER_NAME}'s Command Center | Timetable &amp; Progress Tracker</title>
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
<meta name="description" content="Personal productivity command center for ${USER_NAME} — timetable, tasks, focus mode, progress analytics and AI assistant." />

<!-- PWA -->
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#05070d" />
<meta name="color-scheme" content="dark" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Command Center" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

<!-- Self-hosted fonts (latin subset) — no third-party CDN, works offline -->
<link rel="preload" href="/static/fonts/manrope-latin-400.woff2" as="font" type="font/woff2" crossorigin />
<link href="/static/fonts.css" rel="stylesheet" />

<!-- Compiled Tailwind (build step, no CDN runtime) -->
<link href="/static/tailwind.css" rel="stylesheet" />
<link href="/static/vendor/fontawesome/css/all.min.css" rel="stylesheet" />
<link href="/static/style.css" rel="stylesheet" />
</head>
<body class="font-body bg-base-950 text-slate-200 antialiased selection:bg-accent/40 selection:text-white">
<a href="#view-dashboard" class="skip-link">Skip to content</a>
<div id="bg-fx" aria-hidden="true"><div class="bg-orb orb-1"></div><div class="bg-orb orb-2"></div><div class="bg-orb orb-3"></div><div class="bg-grid"></div></div>
<div id="app" class="relative z-10 min-h-screen flex">
<aside id="sidebar" class="hidden lg:flex flex-col w-[248px] shrink-0 border-r border-white/5 bg-base-900/60 backdrop-blur-xl px-4 py-6 gap-1">
<div class="flex items-center gap-3 px-2 mb-8"><div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-accent to-accent-2 grid place-items-center shadow-glow shrink-0"><i class="fa-solid fa-bolt text-white text-sm"></i></div><div><p class="font-display font-bold text-white text-sm leading-tight">Command Center</p><p class="text-[11px] text-slate-500 leading-tight">${USER_NAME}'s HQ</p></div></div>
<nav class="flex flex-col gap-1" id="nav-list" aria-label="Primary">
<button data-view="dashboard" class="nav-item active-nav"><i class="fa-solid fa-gauge-high w-5"></i><span>Dashboard</span></button>
<button data-view="timetable" class="nav-item"><i class="fa-solid fa-table-cells-large w-5"></i><span>Timetable</span></button>
<button data-view="tasks" class="nav-item"><i class="fa-solid fa-list-check w-5"></i><span>Tasks</span></button>
<button data-view="focus" class="nav-item"><i class="fa-solid fa-stopwatch w-5"></i><span>Focus Mode</span></button>
<button data-view="progress" class="nav-item"><i class="fa-solid fa-chart-line w-5"></i><span>Progress</span></button>
<button data-view="profile" class="nav-item"><i class="fa-solid fa-id-badge w-5"></i><span>Profile</span></button>
<button data-view="assistant" class="nav-item"><i class="fa-solid fa-robot w-5"></i><span>AI Assistant</span></button>
<button data-view="settings" class="nav-item"><i class="fa-solid fa-gear w-5"></i><span>Settings</span></button>
</nav>
<div class="mt-auto pt-6 border-t border-white/5 space-y-3">
<div class="rounded-2xl bg-gradient-to-br from-base-800 to-base-850 border border-white/5 p-3.5" id="streak-mini">
<div class="flex items-center justify-between mb-1.5"><span class="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Streak</span><i class="fa-solid fa-fire text-accent-4 text-xs"></i></div>
<p class="text-2xl font-display font-extrabold text-white" id="streak-count">0</p>
<p class="text-[11px] text-slate-500" id="streak-sub">days in a row</p>
<div class="mt-2.5 flex gap-1" id="streak-dots" title="Last 7 days of meaningful productivity"></div>
</div>
<div class="rounded-2xl bg-gradient-to-br from-base-800 to-base-850 border border-white/5 p-3.5" id="focus-mini">
<div class="flex items-center justify-between mb-1.5"><span class="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Focus today</span><i class="fa-solid fa-stopwatch text-accent-2 text-xs"></i></div>
<p class="text-lg font-display font-extrabold text-white" id="focus-mini-time">0m</p>
<button id="focus-mini-start" class="btn-ghost w-full mt-2 !py-1.5 !text-xs" title="Start a focus session (F)"><i class="fa-solid fa-play mr-1.5"></i>Start Focus</button>
</div>
</div>
</aside>
<div class="flex-1 flex flex-col min-w-0">
<header class="sticky top-0 z-30 border-b border-white/5 bg-base-950/70 backdrop-blur-xl"><div class="px-4 sm:px-6 lg:px-8 py-3.5 flex items-center gap-3"><button id="mobile-menu-btn" class="lg:hidden w-9 h-9 rounded-xl bg-base-800/80 grid place-items-center border border-white/5" aria-label="Open navigation menu" aria-expanded="false"><i class="fa-solid fa-bars text-slate-300"></i></button><div class="flex-1 min-w-0"><h1 id="greeting-text" class="font-display font-bold text-white text-base sm:text-lg truncate">Loading…</h1><p id="quote-text" class="text-[12px] sm:text-[13px] text-slate-400 italic truncate">"Discipline is choosing between what you want now and what you want most."</p></div><button id="active-timer-chip" class="hidden items-center gap-2 px-3 py-1.5 rounded-full bg-accent/15 border border-accent/30 text-[13px] text-white font-semibold" title="Return to your running focus session"><i class="fa-solid fa-stopwatch text-accent-2 text-xs"></i><span id="active-timer-chip-text">25:00</span></button><div class="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-base-800/70 border border-white/5 text-[13px] text-slate-300 font-medium" title="Local time"><i class="fa-regular fa-clock text-accent-2 text-xs"></i><span id="live-clock">--:--:--</span></div><button id="quick-add-btn" class="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-accent to-violet-500 hover:brightness-110 transition px-3.5 py-2 text-[13px] font-semibold text-white shadow-glow" title="Quick capture (Ctrl + K)"><i class="fa-solid fa-plus text-xs"></i><span class="hidden sm:inline">Add Task</span></button><div class="w-9 h-9 rounded-full bg-gradient-to-br from-accent-2 to-accent grid place-items-center text-white font-display font-bold text-sm shrink-0" title="${USER_NAME}">K</div></div><nav id="mobile-nav" class="lg:hidden hidden px-4 pb-3 flex gap-2 overflow-x-auto" aria-label="Mobile"><button data-view="dashboard" class="nav-pill active-pill"><i class="fa-solid fa-gauge-high"></i> Dashboard</button><button data-view="timetable" class="nav-pill"><i class="fa-solid fa-table-cells-large"></i> Timetable</button><button data-view="tasks" class="nav-pill"><i class="fa-solid fa-list-check"></i> Tasks</button><button data-view="focus" class="nav-pill"><i class="fa-solid fa-stopwatch"></i> Focus</button><button data-view="progress" class="nav-pill"><i class="fa-solid fa-chart-line"></i> Progress</button><button data-view="profile" class="nav-pill"><i class="fa-solid fa-id-badge"></i> Profile</button><button data-view="assistant" class="nav-pill"><i class="fa-solid fa-robot"></i> Assistant</button><button data-view="settings" class="nav-pill"><i class="fa-solid fa-gear"></i> Settings</button></nav></header>
<main class="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] w-full mx-auto"><section id="view-dashboard" class="view-section space-y-6"></section><section id="view-timetable" class="view-section hidden space-y-5"></section><section id="view-tasks" class="view-section hidden space-y-5"></section><section id="view-progress" class="view-section hidden space-y-6"></section><section id="view-profile" class="view-section hidden space-y-6"></section><section id="view-assistant" class="view-section hidden"></section><section id="view-settings" class="view-section hidden space-y-6"></section></main><footer class="text-center text-[11px] text-slate-600 py-4">Built for ${USER_NAME} · Data stored 100% locally in your browser · v${APP_VERSION}</footer></div></div>
<div id="modal-root"></div>
<div id="focus-root"></div>
<div id="toast-container" class="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end" aria-live="polite" aria-atomic="false"></div>
<script defer src="/static/js/app.js"></script>
</body></html>`
}
