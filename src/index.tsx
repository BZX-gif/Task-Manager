import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Kulshresth's Command Center | Timetable & Progress Tracker</title>
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
<meta name="description" content="Personal productivity command center for Kulshresth — timetable, tasks, progress analytics and AI assistant." />

<!-- Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">

<!-- Tailwind -->
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        fontFamily: {
          display: ['Sora', 'sans-serif'],
          body: ['Manrope', 'sans-serif'],
        },
        colors: {
          base: {
            950: '#05070d',
            900: '#0a0e1a',
            850: '#0e1424',
            800: '#131a2e',
            700: '#1b2440',
          },
          accent: {
            DEFAULT: '#7c5cff',
            2: '#22d3ee',
            3: '#34d399',
            4: '#fbbf24',
            5: '#fb7185',
          }
        },
        boxShadow: {
          glow: '0 0 0 1px rgba(124,92,255,0.15), 0 8px 30px -6px rgba(124,92,255,0.35)',
          card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 20px 40px -20px rgba(0,0,0,0.6)',
        },
        animation: {
          'float': 'float 6s ease-in-out infinite',
          'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          'shimmer': 'shimmer 2.5s linear infinite',
        },
        keyframes: {
          float: { '0%,100%': { transform: 'translateY(0px)' }, '50%': { transform: 'translateY(-8px)' } },
          shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        }
      }
    }
  }
</script>

<!-- Icons -->
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.1/css/all.min.css" rel="stylesheet">

<!-- Charts -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>

<!-- Utils -->
<script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/plugin/weekOfYear.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/plugin/isoWeek.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/plugin/isSameOrBefore.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/plugin/isSameOrAfter.js"></script>

<link href="/static/style.css" rel="stylesheet" />
</head>
<body class="font-body bg-base-950 text-slate-200 antialiased selection:bg-accent/40 selection:text-white">

<div id="bg-fx" aria-hidden="true">
  <div class="bg-orb orb-1"></div>
  <div class="bg-orb orb-2"></div>
  <div class="bg-orb orb-3"></div>
  <div class="bg-grid"></div>
</div>

<div id="app" class="relative z-10 min-h-screen flex">

  <!-- Sidebar -->
  <aside id="sidebar" class="hidden lg:flex flex-col w-[248px] shrink-0 border-r border-white/5 bg-base-900/60 backdrop-blur-xl px-4 py-6 gap-1">
    <div class="flex items-center gap-3 px-2 mb-8">
      <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-accent to-accent-2 grid place-items-center shadow-glow shrink-0">
        <i class="fa-solid fa-bolt text-white text-sm"></i>
      </div>
      <div>
        <p class="font-display font-bold text-white text-sm leading-tight">Command Center</p>
        <p class="text-[11px] text-slate-500 leading-tight">Kulshresth's HQ</p>
      </div>
    </div>

    <nav class="flex flex-col gap-1" id="nav-list">
      <button data-view="dashboard" class="nav-item active-nav"><i class="fa-solid fa-gauge-high w-5"></i><span>Dashboard</span></button>
      <button data-view="timetable" class="nav-item"><i class="fa-solid fa-table-cells-large w-5"></i><span>Timetable</span></button>
      <button data-view="tasks" class="nav-item"><i class="fa-solid fa-list-check w-5"></i><span>Tasks</span></button>
      <button data-view="progress" class="nav-item"><i class="fa-solid fa-chart-line w-5"></i><span>Progress</span></button>
      <button data-view="assistant" class="nav-item"><i class="fa-solid fa-robot w-5"></i><span>AI Assistant</span></button>
      <button data-view="settings" class="nav-item"><i class="fa-solid fa-gear w-5"></i><span>Settings</span></button>
    </nav>

    <div class="mt-auto pt-6 border-t border-white/5">
      <div id="streak-mini" class="rounded-2xl bg-gradient-to-br from-base-800 to-base-850 border border-white/5 p-3.5">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Streak</span>
          <i class="fa-solid fa-fire text-accent-4 text-xs"></i>
        </div>
        <p class="text-2xl font-display font-extrabold text-white" id="streak-count">0</p>
        <p class="text-[11px] text-slate-500">days in a row</p>
      </div>
    </div>
  </aside>

  <!-- Main -->
  <div class="flex-1 flex flex-col min-w-0">

    <!-- Topbar -->
    <header class="sticky top-0 z-30 border-b border-white/5 bg-base-950/70 backdrop-blur-xl">
      <div class="px-4 sm:px-6 lg:px-8 py-3.5 flex items-center gap-3">
        <button id="mobile-menu-btn" class="lg:hidden w-9 h-9 rounded-xl bg-base-800/80 grid place-items-center border border-white/5">
          <i class="fa-solid fa-bars text-slate-300"></i>
        </button>

        <div class="flex-1 min-w-0">
          <h1 id="greeting-text" class="font-display font-bold text-white text-base sm:text-lg truncate">Loading…</h1>
          <p id="quote-text" class="text-[12px] sm:text-[13px] text-slate-400 italic truncate">"Discipline is choosing between what you want now and what you want most."</p>
        </div>

        <div class="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-base-800/70 border border-white/5 text-[13px] text-slate-300 font-medium">
          <i class="fa-regular fa-clock text-accent-2 text-xs"></i>
          <span id="live-clock">--:--:--</span>
        </div>

        <button id="quick-add-btn" class="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-accent to-violet-500 hover:brightness-110 transition px-3.5 py-2 text-[13px] font-semibold text-white shadow-glow">
          <i class="fa-solid fa-plus text-xs"></i>
          <span class="hidden sm:inline">Add Task</span>
        </button>

        <div class="w-9 h-9 rounded-full bg-gradient-to-br from-accent-2 to-accent grid place-items-center text-white font-display font-bold text-sm shrink-0">K</div>
      </div>

      <!-- Mobile nav -->
      <nav id="mobile-nav" class="lg:hidden hidden px-4 pb-3 flex gap-2 overflow-x-auto">
        <button data-view="dashboard" class="nav-pill active-pill"><i class="fa-solid fa-gauge-high"></i> Dashboard</button>
        <button data-view="timetable" class="nav-pill"><i class="fa-solid fa-table-cells-large"></i> Timetable</button>
        <button data-view="tasks" class="nav-pill"><i class="fa-solid fa-list-check"></i> Tasks</button>
        <button data-view="progress" class="nav-pill"><i class="fa-solid fa-chart-line"></i> Progress</button>
        <button data-view="assistant" class="nav-pill"><i class="fa-solid fa-robot"></i> Assistant</button>
        <button data-view="settings" class="nav-pill"><i class="fa-solid fa-gear"></i> Settings</button>
      </nav>
    </header>

    <!-- Views -->
    <main class="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] w-full mx-auto">

      <!-- DASHBOARD -->
      <section id="view-dashboard" class="view-section space-y-6"></section>

      <!-- TIMETABLE -->
      <section id="view-timetable" class="view-section hidden space-y-5"></section>

      <!-- TASKS -->
      <section id="view-tasks" class="view-section hidden space-y-5"></section>

      <!-- PROGRESS -->
      <section id="view-progress" class="view-section hidden space-y-6"></section>

      <!-- ASSISTANT -->
      <section id="view-assistant" class="view-section hidden"></section>

      <!-- SETTINGS -->
      <section id="view-settings" class="view-section hidden space-y-6"></section>

    </main>

    <footer class="text-center text-[11px] text-slate-600 py-4">
      Built for Kulshresth · Data stored 100% locally in your browser · v1.0
    </footer>
  </div>
</div>

<!-- Modals mount point -->
<div id="modal-root"></div>

<!-- Toast container -->
<div id="toast-container" class="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end"></div>

<script src="/static/app.js"></script>
</body>
</html>`)
})

export default app
