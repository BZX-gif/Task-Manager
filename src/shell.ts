/** The local-first application shell. All application data stays in the browser. */
export const APP_VERSION = '3.0'

export const NAV_GROUPS = [
  { label: 'YOUR DAY', items: [ ['dashboard', 'Overview', 'overview'], ['day', 'My Day', 'sun'], ['schedule', 'Schedule', 'calendar'], ['tasks', 'Missions', 'missions'] ] },
  { label: 'THE BIGGER PICTURE', items: [ ['goals', 'Goals', 'target'], ['projects', 'Projects', 'projects'], ['routines', 'Routines', 'routines'] ] },
  { label: 'YOUR SPACE', items: [ ['focus', 'Focus Room', 'focus'], ['progress', 'Analytics', 'analytics'], ['review', 'Weekly Review', 'review'] ] },
]

// These paths are original SVGs embedded by the client, not a remote icon font.
const ICONS: Record<string, string> = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4m8-4v4M3 11h18"/>',
  missions: '<rect x="4" y="4" width="16" height="17" rx="3"/><path d="M9 4V2h6v2M8 12l2 2 5-5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  routines: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  focus: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6M12 2v3"/>',
  analytics: '<path d="M4 3v18h17M8 15v-4m5 4V7m5 8V4"/>',
  review: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8m-8 4h5"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3 1-1h4l1 3 3 1 3 1v4l-2 1-1 3 1 3-3 3-3-1-3 1-1 2H8l-1-3-3-1-2-1v-4l2-1 1-3-1-3 3-3Z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
}
const svg = (name: string) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.overview}</svg>`
const nav = (mobile = false) => NAV_GROUPS.map((group) => `<div class="nav-group"><p class="nav-label">${group.label}</p>${group.items.map(([view,label,icon]) => `<button data-view="${view}" class="${mobile ? 'nav-item' : 'nav-item'}" title="${label}">${svg(icon)}<span>${label}</span>${view === 'focus' ? '<span class="nav-key">F</span>' : ''}</button>`).join('')}</div>`).join('')

export function renderShell(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark" data-accent="iris">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>Command · Your Personal Command Center</title>
<meta name="description" content="A calmer place to plan your day, connect your goals and do your best work. Private, local-first and ready offline." />
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#08090b" />
<meta name="color-scheme" content="dark light" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Command" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<script>try{const s=JSON.parse(localStorage.getItem('kcc_state_v1')||'{}').settings||{};const t=s.theme==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):s.theme==='light'?'light':'dark';document.documentElement.dataset.theme=t;document.documentElement.dataset.accent=['iris','blue','sage','amber','rose'].includes(s.accent)?s.accent:'iris';if(s.sidebarCollapsed)document.documentElement.classList.add('sidebar-collapsed')}catch(e){}</script>
<link href="/static/tailwind.css" rel="stylesheet" />
<link href="/static/style.css" rel="stylesheet" />
<link href="/static/studio.css" rel="stylesheet" />
</head>
<body class="font-body antialiased">
<a href="#main-content" class="skip-link">Skip to content</a>
<div id="app" class="app-shell">
<aside id="sidebar" class="sidebar" aria-label="Workspace">
<div class="brand-lockup"><a href="/" class="brand-home" aria-label="Command overview"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span><span class="brand-name">command<span>.</span></span></a><button id="sidebar-collapse" class="icon-btn collapse-control" aria-label="Collapse sidebar" aria-expanded="true">${svg('overview')}</button></div>
<div class="workspace-label"><span class="workspace-avatar">P</span><div><strong>Personal workspace</strong><span>Designed around you</span></div></div>
<nav id="nav-list" class="sidebar-nav" aria-label="Primary">${nav()}</nav>
<div class="sidebar-bottom">
<button class="nav-item assistant-nav" data-view="assistant">${svg('review')}<span>Planning assistant</span><span class="ai-tag">AI</span></button>
<button class="nav-item" data-view="settings">${svg('settings')}<span>Settings</span></button>
<div class="sidebar-focus"><div class="sidebar-focus-top">${svg('focus')}<span>Space to focus</span><span class="status-dot"></span></div><p id="focus-mini-time">0m</p><span class="sidebar-focus-caption">of deep work today</span><button id="focus-mini-start" class="btn btn-secondary btn-small">Start a session ${svg('arrow')}</button></div>
<div class="local-note">${svg('settings')}<span>Local first. Always yours.</span></div>
<div id="streak-mini" class="sr-only"><span id="streak-count">0</span><span id="streak-sub"></span><span id="streak-dots"></span></div>
</div>
</aside>
<div class="workspace-main">
<header class="topbar">
<div class="topbar-left"><button id="mobile-menu-btn" class="icon-btn mobile-menu-toggle" aria-label="Open navigation" aria-expanded="false" aria-controls="mobile-nav">${svg('menu')}</button><span class="breadcrumb-workspace">Workspace</span><span class="breadcrumb-divider">/</span><span id="breadcrumb-current">Overview</span></div>
<div class="topbar-actions"><button id="command-search" class="search-trigger" aria-label="Search commands and your workspace"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><span>Search anything</span><kbd>⌘  K</kbd></button><span class="topbar-separator"></span><span class="local-status"><span class="status-dot"></span><span id="connection-label">On this device</span></span><button id="active-timer-chip" class="timer-chip hidden" aria-label="Return to focus session">${svg('focus')}<span id="active-timer-chip-text">25:00</span></button><button id="theme-toggle" class="icon-btn" aria-label="Switch to light theme">${svg('sun')}</button><button id="notifications-btn" class="icon-btn notification-toggle" aria-label="View reminders">${svg('bell')}<span id="notification-dot" class="notification-dot hidden"></span></button><button id="quick-add-btn" class="btn btn-primary btn-small topbar-add" aria-label="Add a mission">${svg('plus')}<span>New mission</span></button><button class="brand-avatar" data-view="settings" aria-label="Profile and settings">P</button></div>
</header>
<div class="mobile-context"><span id="greeting-text">Your personal command center</span><span id="live-clock">--:--</span></div>
<main id="main-content" tabindex="-1" class="main-content">
<section id="view-dashboard" class="view-section" aria-label="Overview"><div class="boot-skeleton"><div></div><div></div><div></div></div></section>
${['day','schedule','tasks','goals','projects','routines','focus','progress','review','assistant','settings'].map((view) => `<section id="view-${view}" class="view-section hidden" aria-label="${view}"></section>`).join('')}
</main>
<footer class="workspace-footer"><span>A little more clarity. A little more progress.</span><span>Private by design <span class="footer-dot">·</span> <span id="app-version">v${APP_VERSION}</span></span></footer>
</div>
</div>
<div id="mobile-nav" class="mobile-nav hidden" role="dialog" aria-modal="true" aria-label="Navigation"><div class="mobile-nav-head"><strong>Your workspace</strong><button id="mobile-nav-close" class="icon-btn" aria-label="Close navigation">${svg('close')}</button></div><nav>${nav(true)}<button class="nav-item" data-view="assistant">${svg('review')}<span>Planning assistant</span></button><button class="nav-item" data-view="settings">${svg('settings')}<span>Settings</span></button></nav></div>
<nav id="mobile-dock" class="mobile-dock" aria-label="Quick navigation"><button class="dock-item is-active" data-view="dashboard">${svg('overview')}<span>Overview</span></button><button class="dock-item" data-view="day">${svg('sun')}<span>My Day</span></button><button class="dock-item" data-view="tasks">${svg('missions')}<span>Missions</span></button><button class="dock-item" data-view="focus">${svg('focus')}<span>Focus</span></button><button id="mobile-more" class="dock-item" aria-label="More navigation">${svg('overview')}<span>More</span></button></nav>
<div id="modal-root"></div><div id="focus-root"></div><div id="toast-container" class="toast-container" aria-live="polite" aria-atomic="false"></div><div id="quote-text" class="sr-only"></div>
<script defer src="/static/js/app.js"></script>
</body></html>`
}
