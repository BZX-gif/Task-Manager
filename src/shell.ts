/**
 * App shell HTML. Kept as a plain string so the Worker can stream it instantly
 * and so the dom-based integration tests can reuse it.
 *
 * v2.3 markup rule: layout classes here are custom (defined in style.css),
 * not Tailwind utilities — the Tailwind build does not scan this file, so any
 * utility used only in the shell would silently not exist.
 */
export const APP_VERSION = '2.3'
export const USER_NAME = 'Kulshresth'

export function renderShell(): string {
  const items: Array<[string, string, string]> = [
    ['dashboard', 'fa-gauge-high', 'Dashboard'],
    ['timetable', 'fa-table-cells-large', 'Timetable'],
    ['tasks', 'fa-list-check', 'Tasks'],
    ['focus', 'fa-stopwatch', 'Focus Mode'],
    ['progress', 'fa-chart-line', 'Progress'],
    ['assistant', 'fa-robot', 'AI Assistant'],
    ['settings', 'fa-gear', 'Settings'],
  ]
  const navItems = items
    .map(
      ([view, icon, label]) =>
        `<button data-view="${view}" class="nav-item${view === 'dashboard' ? ' active-nav' : ''}"${view === 'dashboard' ? ' aria-current="page"' : ''}><i class="fa-solid ${icon}"></i><span>${label}</span></button>`,
    )
    .join('')
  const mobileItems = items
    .map(([view, icon, label]) => `<button data-view="${view}" class="nav-pill${view === 'dashboard' ? ' active-pill' : ''}"><i class="fa-solid ${icon}"></i> ${label.replace('Focus Mode', 'Focus').replace('AI Assistant', 'Assistant')}</button>`)
    .join('')
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
<meta name="theme-color" content="#0b0d11" />
<meta name="color-scheme" content="dark" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Command Center" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

<!-- Self-hosted fonts (latin subset) — no third-party CDN, works offline -->
<link rel="preload" href="/static/fonts/manrope-latin-400.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/static/fonts/sora-latin-700.woff2" as="font" type="font/woff2" crossorigin />
<link href="/static/fonts.css" rel="stylesheet" />

<!-- Compiled Tailwind (build step, no CDN runtime) + design system -->
<link href="/static/tailwind.css" rel="stylesheet" />
<link href="/static/vendor/fontawesome/css/all.min.css" rel="stylesheet" />
<link href="/static/style.css" rel="stylesheet" />
</head>
<body>
<a href="#view-dashboard" class="skip-link">Skip to content</a>
<div id="app" class="app-shell">
<aside id="sidebar" class="app-sidebar">
<div class="shell-brand"><span class="brand-mark" aria-hidden="true"><i class="fa-solid fa-bolt"></i></span><div><p class="brand-name">Command Center</p><p class="brand-sub">${USER_NAME}'s HQ · v${APP_VERSION}</p></div></div>
<nav class="nav-list" id="nav-list" aria-label="Primary">${navItems}</nav>
<div class="sidebar-foot">
<div class="mini-stat" id="streak-mini">
<div class="mini-label"><span>Streak</span><i class="fa-solid fa-fire" style="color:var(--color-warning-text)" aria-hidden="true"></i></div>
<p class="mini-value" id="streak-count">0</p>
<p class="mini-sub" id="streak-sub">days in a row</p>
<div class="flex gap-1.5 mt-2" id="streak-dots" title="Last 7 days of meaningful productivity"></div>
</div>
<div class="mini-stat" id="focus-mini">
<div class="mini-label"><span>Focus today</span><i class="fa-solid fa-stopwatch" style="color:var(--color-accent-strong)" aria-hidden="true"></i></div>
<p class="mini-value" id="focus-mini-time">0m</p>
<button id="focus-mini-start" class="mini-start" title="Start a focus session (F)"><i class="fa-solid fa-play" aria-hidden="true"></i>Start Focus</button>
</div>
</div>
</aside>
<div class="app-main-col">
<header class="app-header">
<div class="header-row">
<button id="mobile-menu-btn" class="header-menu-btn" aria-label="Open navigation menu" aria-expanded="false"><i class="fa-solid fa-bars"></i></button>
<div class="header-titles">
<h1 id="greeting-text">Loading…</h1>
<p id="quote-text">"Discipline is choosing between what you want now and what you want most."</p>
</div>
<button id="active-timer-chip" class="hidden" title="Return to your running focus session"><span class="chip-run-dot" aria-hidden="true"></span><i class="fa-solid fa-stopwatch" aria-hidden="true"></i><span id="active-timer-chip-text">25:00</span></button>
<div class="header-chip chip-clock" title="Local time"><i class="fa-regular fa-clock" aria-hidden="true"></i><span id="live-clock">--:--:--</span></div>
<button id="quick-add-btn" title="Quick capture (Ctrl + K)"><i class="fa-solid fa-plus" aria-hidden="true"></i><span class="qa-label">Add Task</span></button>
<div class="avatar-chip" title="${USER_NAME}">K</div>
</div>
<nav id="mobile-nav" class="hidden" aria-label="Mobile">${mobileItems}</nav>
</header>
<main class="shell-main">
<section id="view-dashboard" class="view-section space-y-6"></section>
<section id="view-timetable" class="view-section hidden space-y-5"></section>
<section id="view-tasks" class="view-section hidden space-y-5"></section>
<section id="view-progress" class="view-section hidden space-y-6"></section>
<section id="view-assistant" class="view-section hidden"></section>
<section id="view-settings" class="view-section hidden space-y-6"></section>
</main>
<footer class="app-footer">Built for ${USER_NAME} · Data stored 100% locally in your browser · v${APP_VERSION}</footer>
</div>
</div>
<div id="modal-root"></div>
<div id="focus-root"></div>
<div id="toast-container" aria-live="polite" aria-atomic="false"></div>
<script defer src="/static/js/app.js"></script>
</body></html>`
}
