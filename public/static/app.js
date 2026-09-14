/* =========================================================================
   KULSHRESTH'S COMMAND CENTER
   Personal Timetable + Task + Progress + AI Assistant
   100% client-side. Data persisted in localStorage.
   ========================================================================= */

dayjs.extend(window.dayjs_plugin_weekOfYear);
dayjs.extend(window.dayjs_plugin_isoWeek);
dayjs.extend(window.dayjs_plugin_isSameOrBefore);
dayjs.extend(window.dayjs_plugin_isSameOrAfter);

const USER_NAME = "Kulshresth";
const HONORIFIC = "sir";

/* -------------------------------------------------------------------------
   1. STORAGE LAYER
   ------------------------------------------------------------------------- */
const STORE_KEY = "kcc_state_v1";

const DEFAULT_CATEGORIES = [
  { id: "body",   name: "Body & Recovery",     color: "#34d399" },
  { id: "upsc",   name: "UPSC Core",           color: "#3b82f6" },
  { id: "ssc",    name: "SSC · News · CA",     color: "#f59e0b" },
  { id: "meals",  name: "Meals & Rest",        color: "#94a3b8" },
];

const DEFAULT_TIMETABLE = [
  { time: "05:00", title: "Wake up · 500ml water · no phone", cat: "body", duration: 15 },
  { time: "05:15", title: "WORKOUT — 45 min (Mon/Wed/Fri strength · Tue/Thu/Sat cardio)", cat: "body", duration: 45 },
  { time: "06:00", title: "Cold-ish shower + high-protein breakfast", cat: "meals", duration: 30 },
  { time: "06:30", title: "DEEP STUDY BLOCK 1 — hardest subject (2h)", cat: "upsc", duration: 120 },
  { time: "08:30", title: "News — The Hindu / Indian Express (45 min)", cat: "ssc", duration: 45 },
  { time: "09:15", title: "Bath + light lunch prep + break", cat: "meals", duration: 45 },
  { time: "10:00", title: "CLASS 1 (2h) + 10-min instant recall", cat: "upsc", duration: 130 },
  { time: "12:15", title: "Lunch (light!) + 20-min power nap", cat: "meals", duration: 75 },
  { time: "13:30", title: "CLASS 2 (2h) + 10-min instant recall", cat: "upsc", duration: 130 },
  { time: "15:45", title: "Tea + 15-min walk (snack: sprouts/peanuts)", cat: "meals", duration: 30 },
  { time: "16:15", title: "CLASS 3 (2h) + 10-min instant recall", cat: "upsc", duration: 130 },
  { time: "18:30", title: "REVISION of all 3 classes (90 min)", cat: "upsc", duration: 90 },
  { time: "20:00", title: "Dinner — lightest meal, high protein", cat: "meals", duration: 45 },
  { time: "20:45", title: "SSC batch (1h) — Maths/Reasoning drill", cat: "ssc", duration: 60 },
  { time: "21:45", title: "Current affairs consolidation + PYQ (45 min)", cat: "ssc", duration: 45 },
  { time: "22:30", title: "Walk out / stretch 10 min · plan tomorrow's 3 tasks", cat: "body", duration: 30 },
  { time: "23:00", title: "SLEEP — non-negotiable 6h minimum", cat: "body", duration: 360 },
];

const MOTIVATIONAL_QUOTES = [
  "Discipline is choosing between what you want now and what you want most.",
  "The pain of discipline weighs ounces; the pain of regret weighs tons.",
  "You don't have to be great to start, but you have to start to be great.",
  "Every hour you waste today is an hour someone else uses to beat you tomorrow.",
  "Success is the sum of small efforts repeated day in and day out.",
  "The exam doesn't test what you know. It tests what you do when you don't know.",
  "Dream big. Start small. Act now.",
  "Your future is created by what you do today, not tomorrow.",
  "Consistency beats intensity. Show up every single day.",
  "There is no elevator to success — you have to take the stairs.",
  "It always seems impossible until it's done.",
  "The comeback is always stronger than the setback.",
  "Small daily improvements lead to staggering long-term results.",
  "Don't stop when you're tired. Stop when you're done.",
  "The difference between ordinary and extraordinary is that little 'extra'.",
  "You are your only limit.",
  "Push yourself, because no one else is going to do it for you.",
  "Great things never came from comfort zones.",
  "Wake up with determination, go to bed with satisfaction.",
  "Focus on being productive instead of busy.",
  "One more page, one more question, one more rep — that's how legends are built.",
  "The UPSC crown belongs to those who out-work everyone else, quietly.",
  "Champions keep playing until they get it right.",
  "Your only competition is who you were yesterday.",
  "Hard days build strong toppers.",
];

function withIds(timetable) {
  return timetable.map(item => item.id ? item : { ...item, id: uid() });
}

function loadState() {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      // Ensure new fields exist on older saves
      parsed.categories = parsed.categories || DEFAULT_CATEGORIES;
      parsed.timetable = withIds(parsed.timetable || DEFAULT_TIMETABLE);
      parsed.tasks = parsed.tasks || [];
      parsed.completionLog = parsed.completionLog || {}; // { "YYYY-MM-DD": { doneCount, totalCount, taskIds:[], ttIds:[] } }
      parsed.settings = parsed.settings || {};
      if (!("geminiApiKey" in parsed.settings)) {
        parsed.settings.geminiApiKey = "AQ.Ab8RN6LzSpd9jHgluzQhIjnf8bdgjVyJVr2yW3hmaZvbo7njYw";
      }
      parsed.chatHistory = parsed.chatHistory || [];
      return parsed;
    } catch (e) {
      console.warn("Corrupt state, resetting.", e);
    }
  }
  return {
    categories: DEFAULT_CATEGORIES,
    timetable: withIds(DEFAULT_TIMETABLE),
    tasks: [],
    completionLog: {},
    settings: { geminiApiKey: "AQ.Ab8RN6LzSpd9jHgluzQhIjnf8bdgjVyJVr2yW3hmaZvbo7njYw", theme: "dark" },
    chatHistory: [],
  };
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

/* -------------------------------------------------------------------------
   2. UTILITIES
   ------------------------------------------------------------------------- */
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function todayKey(d = dayjs()) { return d.format("YYYY-MM-DD"); }
function catById(id) { return state.categories.find(c => c.id === id) || state.categories[0]; }
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function toast(msg, type = "info") {
  const el = document.createElement("div");
  const icon = { info: "fa-circle-info text-accent-2", success: "fa-circle-check text-emerald-400", error: "fa-circle-exclamation text-rose-400" }[type] || "fa-circle-info";
  el.className = "toast";
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(msg)}</span>`;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateX(30px)"; el.style.transition = "all .25s ease"; setTimeout(() => el.remove(), 260); }, 3200);
}

function timeToMinutes(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

/* Ensure a completion-log entry exists for a date */
function ensureLog(dateKey) {
  if (!state.completionLog[dateKey]) {
    state.completionLog[dateKey] = { ttDone: [], taskDone: [] };
  }
  return state.completionLog[dateKey];
}

/* -------------------------------------------------------------------------
   3. GREETING + CLOCK + QUOTE
   ------------------------------------------------------------------------- */
function getGreeting() {
  const h = dayjs().hour();
  let phrase;
  if (h < 5) phrase = "Burning the midnight oil";
  else if (h < 12) phrase = "Good morning";
  else if (h < 17) phrase = "Good afternoon";
  else if (h < 21) phrase = "Good evening";
  else phrase = "Good night";
  return `${phrase}, ${USER_NAME} ${HONORIFIC} 👋`;
}

function updateClockAndGreeting() {
  document.getElementById("greeting-text").textContent = getGreeting();
  document.getElementById("live-clock").textContent = dayjs().format("hh:mm:ss A");
}

function rotateQuote() {
  const idx = Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length);
  const el = document.getElementById("quote-text");
  el.style.opacity = "0";
  setTimeout(() => {
    el.textContent = `"${MOTIVATIONAL_QUOTES[idx]}"`;
    el.style.opacity = "1";
  }, 200);
}

/* -------------------------------------------------------------------------
   4. NAVIGATION
   ------------------------------------------------------------------------- */
const VIEWS = ["dashboard", "timetable", "tasks", "progress", "assistant", "settings"];
let currentView = "dashboard";

function switchView(view) {
  if (!VIEWS.includes(view)) return;
  currentView = view;
  VIEWS.forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle("hidden", v !== view);
  });
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active-nav", btn.dataset.view === view));
  document.querySelectorAll(".nav-pill").forEach(btn => btn.classList.toggle("active-pill", btn.dataset.view === view));
  document.getElementById("mobile-nav").classList.add("hidden");
  renderCurrentView();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCurrentView() {
  if (currentView === "dashboard") renderDashboard();
  else if (currentView === "timetable") renderTimetable();
  else if (currentView === "tasks") renderTasks();
  else if (currentView === "progress") renderProgress();
  else if (currentView === "assistant") renderAssistant();
  else if (currentView === "settings") renderSettings();
}

document.querySelectorAll("[data-view]").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
document.getElementById("mobile-menu-btn").addEventListener("click", () => {
  document.getElementById("mobile-nav").classList.toggle("hidden");
});
document.getElementById("quick-add-btn").addEventListener("click", () => openTaskModal());

/* -------------------------------------------------------------------------
   5. STREAK CALCULATION
   ------------------------------------------------------------------------- */
function dayCompletionRate(dateKey) {
  const log = state.completionLog[dateKey];
  const totalTT = state.timetable.length;
  const tasksForDay = state.tasks.filter(t => t.date === dateKey);
  const totalTasks = tasksForDay.length;
  const total = totalTT + totalTasks;
  if (total === 0) return 0;
  const doneTT = log ? log.ttDone.length : 0;
  const doneTasks = tasksForDay.filter(t => t.done).length;
  return (doneTT + doneTasks) / total;
}

function computeStreak() {
  let streak = 0;
  let cursor = dayjs();
  // if today has 0 completion yet, don't break streak, start check from yesterday for continuity but count today if >0
  for (let i = 0; i < 400; i++) {
    const key = todayKey(cursor);
    const rate = dayCompletionRate(key);
    if (i === 0) {
      if (rate >= 0.5) { streak++; cursor = cursor.subtract(1, "day"); continue; }
      else { cursor = cursor.subtract(1, "day"); continue; } // today not counted yet but doesn't break
    }
    if (rate >= 0.5) { streak++; cursor = cursor.subtract(1, "day"); }
    else break;
  }
  return streak;
}

function updateStreakUI() {
  const streak = computeStreak();
  document.getElementById("streak-count").textContent = streak;
}

/* -------------------------------------------------------------------------
   6. DASHBOARD VIEW
   ------------------------------------------------------------------------- */
function getCurrentTimetableItem() {
  const nowMin = dayjs().hour() * 60 + dayjs().minute();
  const sorted = [...state.timetable].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  let current = null, next = null;
  for (let i = 0; i < sorted.length; i++) {
    const startMin = timeToMinutes(sorted[i].time);
    const endMin = startMin + (sorted[i].duration || 60);
    if (nowMin >= startMin && nowMin < endMin) current = sorted[i];
    if (nowMin < startMin && !next) next = sorted[i];
  }
  return { current, next };
}

function renderDashboard() {
  const el = document.getElementById("view-dashboard");
  const todayK = todayKey();
  const log = ensureLog(todayK);
  const todayTasks = state.tasks.filter(t => t.date === todayK);
  const doneTasks = todayTasks.filter(t => t.done).length;
  const totalTT = state.timetable.length;
  const doneTT = log.ttDone.length;
  const overallPct = Math.round(dayCompletionRate(todayK) * 100);
  const { current, next } = getCurrentTimetableItem();
  const streak = computeStreak();

  const weekKey = dayjs().isoWeek();
  let weekDone = 0, weekTotal = 0;
  for (let i = 0; i < 7; i++) {
    const d = dayjs().isoWeekday(i + 1);
    const dk = todayKey(d);
    const l = state.completionLog[dk];
    const tCount = state.tasks.filter(t => t.date === dk).length;
    weekTotal += state.timetable.length + tCount;
    weekDone += (l ? l.ttDone.length : 0) + state.tasks.filter(t => t.date === dk && t.done).length;
  }
  const weekPct = weekTotal ? Math.round((weekDone / weekTotal) * 100) : 0;

  const upcoming = todayTasks.filter(t => !t.done).sort((a,b)=> (a.priority==='high'?0:a.priority==='medium'?1:2) - (b.priority==='high'?0:b.priority==='medium'?1:2)).slice(0, 5);

  el.innerHTML = `
    <!-- Hero row -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="glass-card stat-card p-5" style="--stat-glow:#7c5cff">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] uppercase tracking-wider font-bold text-slate-500">Today's Progress</span>
          <i class="fa-solid fa-chart-pie text-accent"></i>
        </div>
        <p class="text-3xl font-display font-extrabold text-white">${overallPct}%</p>
        <div class="progress-track mt-3"><div class="progress-fill" style="width:${overallPct}%"></div></div>
      </div>
      <div class="glass-card stat-card p-5" style="--stat-glow:#22d3ee">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] uppercase tracking-wider font-bold text-slate-500">Timetable Done</span>
          <i class="fa-solid fa-table-cells-large text-accent-2"></i>
        </div>
        <p class="text-3xl font-display font-extrabold text-white">${doneTT}<span class="text-lg text-slate-500">/${totalTT}</span></p>
        <p class="text-[12px] text-slate-500 mt-1">blocks completed today</p>
      </div>
      <div class="glass-card stat-card p-5" style="--stat-glow:#34d399">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] uppercase tracking-wider font-bold text-slate-500">Tasks Done</span>
          <i class="fa-solid fa-list-check text-accent-3"></i>
        </div>
        <p class="text-3xl font-display font-extrabold text-white">${doneTasks}<span class="text-lg text-slate-500">/${todayTasks.length}</span></p>
        <p class="text-[12px] text-slate-500 mt-1">custom tasks today</p>
      </div>
      <div class="glass-card stat-card p-5" style="--stat-glow:#fbbf24">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] uppercase tracking-wider font-bold text-slate-500">Current Streak</span>
          <i class="fa-solid fa-fire text-accent-4"></i>
        </div>
        <p class="text-3xl font-display font-extrabold text-white">${streak}<span class="text-lg text-slate-500"> days</span></p>
        <p class="text-[12px] text-slate-500 mt-1">this week: ${weekPct}%</p>
      </div>
    </div>

    <!-- Now / Next + Quick tasks -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="glass-card p-5 lg:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <h3 class="section-title">Right Now</h3>
          <span class="text-[11px] text-slate-500">${dayjs().format("dddd, MMM D")}</span>
        </div>
        ${current ? `
          <div class="tt-row active-now mb-3" style="--cat-color:${catById(current.cat).color}">
            <div class="tt-time">${current.time}</div>
            <div>
              <p class="tt-title">${escapeHtml(current.title)}</p>
              <p class="text-[11px] text-slate-500">${catById(current.cat).name} · ${current.duration} min</p>
            </div>
            <span class="dot bg-emerald-400 animate-pulse-slow" style="width:10px;height:10px"></span>
          </div>
        ` : `<div class="empty-state !py-6"><i class="fa-regular fa-clock"></i><p class="text-sm">No block active right now</p></div>`}
        ${next ? `
          <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2 mt-4">Up Next</p>
          <div class="tt-row" style="--cat-color:${catById(next.cat).color}">
            <div class="tt-time">${next.time}</div>
            <div><p class="tt-title">${escapeHtml(next.title)}</p><p class="text-[11px] text-slate-500">${catById(next.cat).name}</p></div>
            <i class="fa-solid fa-arrow-right text-slate-600"></i>
          </div>
        ` : ""}
      </div>

      <div class="glass-card p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="section-title text-base">Priority Tasks</h3>
          <button class="icon-btn" onclick="openTaskModal()"><i class="fa-solid fa-plus"></i></button>
        </div>
        <div class="space-y-2.5 max-h-[280px] overflow-y-auto scroll-thin pr-1">
          ${upcoming.length ? upcoming.map(t => taskRowHtml(t)).join("") : `<div class="empty-state !py-8"><i class="fa-regular fa-square-check"></i><p class="text-sm">All clear for today!</p></div>`}
        </div>
      </div>
    </div>

    <!-- Mini week chart + category breakdown -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="glass-card p-5 lg:col-span-2">
        <h3 class="section-title mb-4">This Week's Trend</h3>
        <div class="h-[220px]"><canvas id="dashWeekChart"></canvas></div>
      </div>
      <div class="glass-card p-5">
        <h3 class="section-title text-base mb-4">Categories</h3>
        <div class="space-y-3">
          ${state.categories.map(c => `
            <div class="flex items-center gap-2.5">
              <span class="legend-dot" style="background:${c.color}"></span>
              <span class="text-sm text-slate-300 flex-1">${escapeHtml(c.name)}</span>
              <span class="text-xs text-slate-500">${state.timetable.filter(t=>t.cat===c.id).length} blocks</span>
            </div>
          `).join("")}
        </div>
        <div class="mt-5 pt-4 border-t border-white/5">
          <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2">Today's Quote</p>
          <p class="text-sm text-slate-300 italic leading-relaxed" id="dash-quote">"${MOTIVATIONAL_QUOTES[Math.floor(Math.random()*MOTIVATIONAL_QUOTES.length)]}"</p>
        </div>
      </div>
    </div>
  `;

  renderDashboardWeekChart();
}

function renderDashboardWeekChart() {
  const ctx = document.getElementById("dashWeekChart");
  if (!ctx) return;
  const labels = [], data = [];
  for (let i = 6; i >= 0; i--) {
    const d = dayjs().subtract(i, "day");
    labels.push(d.format("ddd"));
    data.push(Math.round(dayCompletionRate(todayKey(d)) * 100));
  }
  if (window._dashChart) window._dashChart.destroy();
  window._dashChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Completion %",
        data,
        borderColor: "#7c5cff",
        backgroundColor: (context) => {
          const g = context.chart.ctx.createLinearGradient(0, 0, 0, 220);
          g.addColorStop(0, "rgba(124,92,255,0.35)");
          g.addColorStop(1, "rgba(124,92,255,0)");
          return g;
        },
        fill: true,
        tension: 0.4,
        pointBackgroundColor: "#7c5cff",
        pointBorderColor: "#fff",
        pointRadius: 4,
        pointHoverRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#7c8499", callback: v => v + "%" } },
        x: { grid: { display: false }, ticks: { color: "#7c8499" } }
      }
    }
  });
}

/* -------------------------------------------------------------------------
   7. TIMETABLE VIEW
   ------------------------------------------------------------------------- */
function renderTimetable() {
  const el = document.getElementById("view-timetable");
  const todayK = todayKey();
  const log = ensureLog(todayK);
  const sorted = [...state.timetable].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  const { current } = getCurrentTimetableItem();

  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-title">Daily Timetable</h2>
        <p class="section-sub">${dayjs().format("dddd, MMMM D, YYYY")} · Tap a block to mark complete</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-ghost" onclick="resetTimetableToday()"><i class="fa-solid fa-rotate-left mr-1.5"></i>Reset Today</button>
        <button class="btn-primary" onclick="openTimetableItemModal()"><i class="fa-solid fa-plus mr-1.5"></i>Add Block</button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 glass-card px-4 py-3">
      ${state.categories.map(c => `<span class="flex items-center gap-2 text-[13px] text-slate-400"><span class="legend-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</span>`).join("")}
    </div>

    <div class="glass-card p-4 sm:p-5">
      <div class="space-y-2.5">
        ${sorted.map(item => {
          const isDone = log.ttDone.includes(item.id);
          const isNow = current && current.id === item.id;
          const cat = catById(item.cat);
          return `
          <div class="tt-row ${isDone ? "tt-done" : ""} ${isNow ? "active-now" : ""}" style="--cat-color:${cat.color}" onclick="toggleTimetableDone('${item.id}')">
            <div class="tt-time">${item.time}</div>
            <div class="min-w-0">
              <p class="tt-title truncate">${escapeHtml(item.title)}</p>
              <p class="text-[11px] text-slate-500">${escapeHtml(cat.name)} · ${item.duration || 60} min</p>
            </div>
            <div class="flex items-center gap-2">
              ${isNow ? `<span class="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mr-1">Live</span>` : ""}
              <button class="icon-btn" onclick="event.stopPropagation(); openTimetableItemModal('${item.id}')"><i class="fa-solid fa-pen text-xs"></i></button>
              <button class="icon-btn" onclick="event.stopPropagation(); deleteTimetableItem('${item.id}')"><i class="fa-solid fa-trash text-xs"></i></button>
              <div class="task-check ${isDone ? "checked" : ""}"><i class="fa-solid fa-check"></i></div>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>
  `;
}

function toggleTimetableDone(id) {
  const todayK = todayKey();
  const log = ensureLog(todayK);
  const idx = log.ttDone.indexOf(id);
  if (idx > -1) log.ttDone.splice(idx, 1);
  else { log.ttDone.push(id); toast("Block marked complete! Keep going, " + HONORIFIC + ".", "success"); }
  saveState();
  renderTimetable();
  updateStreakUI();
  if (currentView === "dashboard") renderDashboard();
}

function resetTimetableToday() {
  if (!confirm("Reset today's timetable progress?")) return;
  ensureLog(todayKey()).ttDone = [];
  saveState();
  renderTimetable();
  updateStreakUI();
}

function deleteTimetableItem(id) {
  if (!confirm("Delete this timetable block?")) return;
  state.timetable = state.timetable.filter(t => t.id !== id);
  saveState();
  renderTimetable();
  toast("Block deleted", "info");
}

function openTimetableItemModal(id) {
  const item = id ? state.timetable.find(t => t.id === id) : null;
  const isEdit = !!item;
  const modalRoot = document.getElementById("modal-root");
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal-box">
        <div class="flex items-center justify-between mb-5">
          <h3 class="font-display font-bold text-lg text-white">${isEdit ? "Edit" : "Add"} Timetable Block</h3>
          <button class="icon-btn" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <form id="tt-form" class="space-y-4" onsubmit="return submitTimetableForm(event, ${isEdit ? `'${id}'` : "null"})">
          <div>
            <label class="field-label">Title</label>
            <input required class="input-field" name="title" placeholder="e.g. Revision block" value="${item ? escapeHtml(item.title) : ""}">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="field-label">Start Time</label>
              <input required type="time" class="input-field" name="time" value="${item ? item.time : "07:00"}">
            </div>
            <div>
              <label class="field-label">Duration (min)</label>
              <input required type="number" min="5" step="5" class="input-field" name="duration" value="${item ? item.duration : 60}">
            </div>
          </div>
          <div>
            <label class="field-label">Category</label>
            <select class="input-field" name="cat">
              ${state.categories.map(c => `<option value="${c.id}" ${item && item.cat === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
            </select>
          </div>
          <div class="flex gap-3 pt-2">
            <button type="button" class="btn-ghost flex-1" onclick="closeModal()">Cancel</button>
            <button type="submit" class="btn-primary flex-1">${isEdit ? "Save Changes" : "Add Block"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function submitTimetableForm(e, id) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    title: fd.get("title").trim(),
    time: fd.get("time"),
    duration: Number(fd.get("duration")),
    cat: fd.get("cat"),
  };
  if (id) {
    const item = state.timetable.find(t => t.id === id);
    Object.assign(item, payload);
    toast("Block updated", "success");
  } else {
    state.timetable.push({ id: uid(), ...payload });
    toast("Block added to timetable", "success");
  }
  saveState();
  closeModal();
  renderTimetable();
  return false;
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

/* -------------------------------------------------------------------------
   8. TASKS VIEW
   ------------------------------------------------------------------------- */
let taskFilter = "today"; // today | upcoming | all | done

function renderTasks() {
  const el = document.getElementById("view-tasks");
  const todayK = todayKey();
  let list = state.tasks.slice();

  if (taskFilter === "today") list = list.filter(t => t.date === todayK);
  else if (taskFilter === "upcoming") list = list.filter(t => t.date > todayK && !t.done);
  else if (taskFilter === "done") list = list.filter(t => t.done);

  list.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const pOrder = { high: 0, medium: 1, low: 2 };
    return (pOrder[a.priority] ?? 1) - (pOrder[b.priority] ?? 1);
  });

  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-title">Task Manager</h2>
        <p class="section-sub">Organize your goals beyond the fixed schedule</p>
      </div>
      <button class="btn-primary" onclick="openTaskModal()"><i class="fa-solid fa-plus mr-1.5"></i>New Task</button>
    </div>

    <div class="segmented" id="task-filter-seg">
      <button data-f="today" class="${taskFilter==='today'?'seg-active':''}">Today</button>
      <button data-f="upcoming" class="${taskFilter==='upcoming'?'seg-active':''}">Upcoming</button>
      <button data-f="all" class="${taskFilter==='all'?'seg-active':''}">All</button>
      <button data-f="done" class="${taskFilter==='done'?'seg-active':''}">Completed</button>
    </div>

    <div class="glass-card p-4 sm:p-5">
      <div class="space-y-2.5">
        ${list.length ? list.map(t => taskRowHtml(t, true)).join("") : `<div class="empty-state"><i class="fa-regular fa-clipboard"></i><p>No tasks here. Add one to get moving, ${HONORIFIC}.</p></div>`}
      </div>
    </div>
  `;

  document.querySelectorAll("#task-filter-seg button").forEach(b => {
    b.addEventListener("click", () => { taskFilter = b.dataset.f; renderTasks(); });
  });
}

function taskRowHtml(t, full = false) {
  const cat = state.categories.find(c => c.id === t.cat);
  const pColor = { high: "#fb7185", medium: "#fbbf24", low: "#60a5fa" }[t.priority] || "#94a3b8";
  return `
    <div class="task-row ${t.done ? "done" : ""}">
      <div class="task-check ${t.done ? "checked" : ""}" onclick="toggleTaskDone('${t.id}')"><i class="fa-solid fa-check"></i></div>
      <span class="priority-dot" style="background:${pColor}"></span>
      <div class="flex-1 min-w-0">
        <p class="task-title text-sm font-semibold text-slate-100 truncate">${escapeHtml(t.title)}</p>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-500">
          ${cat ? `<span class="flex items-center gap-1"><span class="legend-dot" style="background:${cat.color}"></span>${escapeHtml(cat.name)}</span>` : ""}
          ${t.date ? `<span><i class="fa-regular fa-calendar mr-1"></i>${dayjs(t.date).format("MMM D")}</span>` : ""}
          <span class="capitalize">${t.priority || "medium"} priority</span>
        </div>
      </div>
      ${full ? `
      <div class="flex items-center gap-1.5">
        <button class="icon-btn" onclick="openTaskModal('${t.id}')"><i class="fa-solid fa-pen text-xs"></i></button>
        <button class="icon-btn" onclick="deleteTask('${t.id}')"><i class="fa-solid fa-trash text-xs"></i></button>
      </div>` : ""}
    </div>
  `;
}

function toggleTaskDone(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  if (t.done) toast("Task completed! Great work, " + HONORIFIC + ".", "success");
  saveState();
  renderCurrentView();
  updateStreakUI();
}

function deleteTask(id) {
  if (!confirm("Delete this task?")) return;
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveState();
  renderTasks();
  toast("Task deleted", "info");
}

function openTaskModal(id) {
  const task = id ? state.tasks.find(t => t.id === id) : null;
  const isEdit = !!task;
  const modalRoot = document.getElementById("modal-root");
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal-box">
        <div class="flex items-center justify-between mb-5">
          <h3 class="font-display font-bold text-lg text-white">${isEdit ? "Edit" : "New"} Task</h3>
          <button class="icon-btn" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <form onsubmit="return submitTaskForm(event, ${isEdit ? `'${id}'` : "null"})" class="space-y-4">
          <div>
            <label class="field-label">Task Title</label>
            <input required class="input-field" name="title" placeholder="e.g. Complete Polity chapter 5" value="${task ? escapeHtml(task.title) : ""}">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="field-label">Date</label>
              <input required type="date" class="input-field" name="date" value="${task ? task.date : todayKey()}">
            </div>
            <div>
              <label class="field-label">Priority</label>
              <select class="input-field" name="priority">
                <option value="high" ${task && task.priority==='high'?"selected":""}>High</option>
                <option value="medium" ${!task || task.priority==='medium'?"selected":""}>Medium</option>
                <option value="low" ${task && task.priority==='low'?"selected":""}>Low</option>
              </select>
            </div>
          </div>
          <div>
            <label class="field-label">Category</label>
            <select class="input-field" name="cat">
              <option value="">None</option>
              ${state.categories.map(c => `<option value="${c.id}" ${task && task.cat===c.id?"selected":""}>${escapeHtml(c.name)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="field-label">Notes (optional)</label>
            <textarea class="input-field" name="notes" rows="2" placeholder="Any details...">${task ? escapeHtml(task.notes||"") : ""}</textarea>
          </div>
          <div class="flex gap-3 pt-2">
            <button type="button" class="btn-ghost flex-1" onclick="closeModal()">Cancel</button>
            <button type="submit" class="btn-primary flex-1">${isEdit ? "Save Changes" : "Add Task"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function submitTaskForm(e, id) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    title: fd.get("title").trim(),
    date: fd.get("date"),
    priority: fd.get("priority"),
    cat: fd.get("cat") || null,
    notes: fd.get("notes") || "",
  };
  if (id) {
    Object.assign(state.tasks.find(t => t.id === id), payload);
    toast("Task updated", "success");
  } else {
    state.tasks.push({ id: uid(), done: false, createdAt: Date.now(), ...payload });
    toast("Task added", "success");
  }
  saveState();
  closeModal();
  renderCurrentView();
  return false;
}

/* -------------------------------------------------------------------------
   9. PROGRESS VIEW (week/month/year)
   ------------------------------------------------------------------------- */
let progressRange = "week";

function renderProgress() {
  const el = document.getElementById("view-progress");
  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-title">Progress Analytics</h2>
        <p class="section-sub">Track your consistency over time</p>
      </div>
      <div class="segmented" id="progress-range-seg">
        <button data-r="week" class="${progressRange==='week'?'seg-active':''}">Week</button>
        <button data-r="month" class="${progressRange==='month'?'seg-active':''}">Month</button>
        <button data-r="year" class="${progressRange==='year'?'seg-active':''}">Year</button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="glass-card p-5 lg:col-span-2">
        <h3 class="section-title text-base mb-4" id="progress-chart-title">Completion Rate</h3>
        <div class="h-[260px]"><canvas id="progressMainChart"></canvas></div>
      </div>
      <div class="glass-card p-5 flex flex-col">
        <h3 class="section-title text-base mb-4">Summary</h3>
        <div id="progress-summary" class="space-y-4 flex-1"></div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div class="glass-card p-5">
        <h3 class="section-title text-base mb-4">Category Breakdown</h3>
        <div class="h-[240px]"><canvas id="progressCatChart"></canvas></div>
      </div>
      <div class="glass-card p-5">
        <h3 class="section-title text-base mb-4">Activity Heatmap — Last 12 Weeks</h3>
        <div id="progress-heatmap" class="overflow-x-auto scroll-thin pb-2"></div>
        <div class="flex items-center gap-2 mt-3 text-[11px] text-slate-500">
          <span>Less</span>
          <span class="heat-cell" style="background:rgba(124,92,255,0.15)"></span>
          <span class="heat-cell" style="background:rgba(124,92,255,0.4)"></span>
          <span class="heat-cell" style="background:rgba(124,92,255,0.65)"></span>
          <span class="heat-cell" style="background:rgba(124,92,255,0.95)"></span>
          <span>More</span>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll("#progress-range-seg button").forEach(b => {
    b.addEventListener("click", () => { progressRange = b.dataset.r; renderProgress(); });
  });

  renderProgressCharts();
  renderHeatmap();
}

function renderProgressCharts() {
  const titleEl = document.getElementById("progress-chart-title");
  let labels = [], data = [];

  if (progressRange === "week") {
    titleEl.textContent = "This Week's Completion Rate";
    for (let i = 6; i >= 0; i--) {
      const d = dayjs().subtract(i, "day");
      labels.push(d.format("ddd D"));
      data.push(Math.round(dayCompletionRate(todayKey(d)) * 100));
    }
  } else if (progressRange === "month") {
    titleEl.textContent = "This Month's Completion Rate";
    const daysInMonth = dayjs().daysInMonth();
    for (let i = 1; i <= daysInMonth; i++) {
      const d = dayjs().date(i);
      if (d.isAfter(dayjs())) break;
      labels.push(String(i));
      data.push(Math.round(dayCompletionRate(todayKey(d)) * 100));
    }
  } else {
    titleEl.textContent = "This Year's Monthly Average";
    for (let m = 0; m <= dayjs().month(); m++) {
      const start = dayjs().month(m).startOf("month");
      const end = dayjs().month(m).endOf("month").isAfter(dayjs()) ? dayjs() : dayjs().month(m).endOf("month");
      let sum = 0, count = 0;
      let cursor = start;
      while (cursor.isSameOrBefore(end, "day")) {
        sum += dayCompletionRate(todayKey(cursor)) * 100;
        count++;
        cursor = cursor.add(1, "day");
      }
      labels.push(start.format("MMM"));
      data.push(count ? Math.round(sum / count) : 0);
    }
  }

  const ctx = document.getElementById("progressMainChart");
  if (window._progMainChart) window._progMainChart.destroy();
  window._progMainChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Completion %",
        data,
        backgroundColor: data.map(v => v >= 80 ? "#34d399" : v >= 50 ? "#7c5cff" : v > 0 ? "#fbbf24" : "rgba(255,255,255,0.08)"),
        borderRadius: 6,
        maxBarThickness: progressRange === "week" ? 40 : progressRange === "month" ? 14 : 44,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#7c8499", callback: v => v + "%" } },
        x: { grid: { display: false }, ticks: { color: "#7c8499", maxRotation: 0, autoSkip: true } }
      }
    }
  });

  // Summary
  const avg = data.length ? Math.round(data.reduce((a, b) => a + b, 0) / data.length) : 0;
  const best = data.length ? Math.max(...data) : 0;
  const activeDays = data.filter(v => v > 0).length;
  document.getElementById("progress-summary").innerHTML = `
    <div class="flex items-center justify-between">
      <span class="text-sm text-slate-400">Average completion</span>
      <span class="text-lg font-display font-bold text-white">${avg}%</span>
    </div>
    <div class="flex items-center justify-between">
      <span class="text-sm text-slate-400">Best day</span>
      <span class="text-lg font-display font-bold text-emerald-400">${best}%</span>
    </div>
    <div class="flex items-center justify-between">
      <span class="text-sm text-slate-400">Active days</span>
      <span class="text-lg font-display font-bold text-accent-2">${activeDays}</span>
    </div>
    <div class="flex items-center justify-between">
      <span class="text-sm text-slate-400">Current streak</span>
      <span class="text-lg font-display font-bold text-accent-4">${computeStreak()} 🔥</span>
    </div>
    <div class="pt-3 border-t border-white/5">
      <p class="text-[11px] text-slate-500 leading-relaxed">
        ${avg >= 80 ? `Outstanding consistency, ${HONORIFIC}. Keep this momentum!` :
          avg >= 50 ? `Solid progress, ${HONORIFIC}. Push a little harder to hit 80%+.` :
          `There's room to grow, ${HONORIFIC}. Let's tighten up the schedule.`}
      </p>
    </div>
  `;

  // Category chart (based on tasks + timetable this range roughly by whole history for tasks; use timetable categories fixed distribution weighted by done count over range)
  const catCounts = {};
  state.categories.forEach(c => catCounts[c.id] = 0);
  let rangeStart, rangeEnd = dayjs();
  if (progressRange === "week") rangeStart = dayjs().subtract(6, "day");
  else if (progressRange === "month") rangeStart = dayjs().startOf("month");
  else rangeStart = dayjs().startOf("year");

  let cursor = rangeStart;
  while (cursor.isSameOrBefore(rangeEnd, "day")) {
    const key = todayKey(cursor);
    const log = state.completionLog[key];
    if (log) {
      log.ttDone.forEach(ttId => {
        const item = state.timetable.find(t => t.id === ttId);
        if (item) catCounts[item.cat] = (catCounts[item.cat] || 0) + 1;
      });
    }
    state.tasks.filter(t => t.date === key && t.done && t.cat).forEach(t => {
      catCounts[t.cat] = (catCounts[t.cat] || 0) + 1;
    });
    cursor = cursor.add(1, "day");
  }

  const catCtx = document.getElementById("progressCatChart");
  if (window._progCatChart) window._progCatChart.destroy();
  const hasData = Object.values(catCounts).some(v => v > 0);
  window._progCatChart = new Chart(catCtx, {
    type: "doughnut",
    data: {
      labels: state.categories.map(c => c.name),
      datasets: [{
        data: hasData ? state.categories.map(c => catCounts[c.id]) : state.categories.map(() => 1),
        backgroundColor: state.categories.map(c => c.color),
        borderColor: "#0a0e1a",
        borderWidth: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: { position: "bottom", labels: { color: "#9aa3ba", boxWidth: 10, font: { size: 11 }, padding: 12 } },
        tooltip: { enabled: hasData }
      }
    }
  });
}

function renderHeatmap() {
  const container = document.getElementById("progress-heatmap");
  const weeks = 12;
  const totalDays = weeks * 7;
  const start = dayjs().subtract(totalDays - 1, "day").startOf("isoWeek");
  let html = `<div class="heatmap-grid" style="grid-auto-flow: column; grid-template-rows: repeat(7, 13px);">`;
  let cursor = start;
  const today = dayjs();
  for (let i = 0; i < weeks * 7 + 7; i++) {
    if (cursor.isAfter(today)) { html += `<div class="heat-cell" style="background:transparent"></div>`; cursor = cursor.add(1, "day"); continue; }
    const key = todayKey(cursor);
    const rate = dayCompletionRate(key);
    let bg = "rgba(255,255,255,0.06)";
    if (rate > 0) {
      if (rate < 0.34) bg = "rgba(124,92,255,0.25)";
      else if (rate < 0.67) bg = "rgba(124,92,255,0.5)";
      else if (rate < 1) bg = "rgba(124,92,255,0.75)";
      else bg = "rgba(124,92,255,1)";
    }
    html += `<div class="heat-cell" title="${key}: ${Math.round(rate*100)}%" style="background:${bg}"></div>`;
    cursor = cursor.add(1, "day");
  }
  html += `</div>`;
  container.innerHTML = html;
}

/* -------------------------------------------------------------------------
   10. AI ASSISTANT VIEW (Gemini)
   ------------------------------------------------------------------------- */
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

function buildSystemContext() {
  const todayK = todayKey();
  const todayTasks = state.tasks.filter(t => t.date === todayK);
  const log = ensureLog(todayK);
  const pct = Math.round(dayCompletionRate(todayK) * 100);
  const streak = computeStreak();
  const { current, next } = getCurrentTimetableItem();

  return `You are a sharp, encouraging personal productivity assistant for a user named ${USER_NAME}, who is preparing for UPSC and SSC competitive exams in India. You must ALWAYS address the user as "${HONORIFIC}" (e.g., "Yes, ${HONORIFIC}", "Great job, ${HONORIFIC}!"). Be concise, warm, and motivating but also practical and direct — like a strict but caring mentor/coach. Use short paragraphs or bullet points. Never break character.

Current context (use it to give relevant, personalized advice, but don't just repeat the raw data back — think and analyze):
- Current date/time: ${dayjs().format("dddd, MMMM D YYYY, hh:mm A")}
- Current timetable block: ${current ? current.title : "none scheduled right now"}
- Next timetable block: ${next ? `${next.title} at ${next.time}` : "none"}
- Today's completion: ${pct}% (${log.ttDone.length}/${state.timetable.length} timetable blocks done)
- Today's tasks (${todayTasks.length}): ${todayTasks.map(t => `${t.title} [${t.done ? "done" : "pending"}, ${t.priority} priority]`).join("; ") || "none"}
- Current streak: ${streak} days
- Categories tracked: ${state.categories.map(c => c.name).join(", ")}

If asked for study/time-management advice, tailor it to UPSC/SSC prep. If asked something unrelated, still answer helpfully while keeping the "${HONORIFIC}" address.`;
}

function renderAssistant() {
  const el = document.getElementById("view-assistant");
  const hasKey = !!(state.settings.geminiApiKey && state.settings.geminiApiKey.trim());

  el.innerHTML = `
    <div class="glass-card flex flex-col h-[calc(100vh-180px)] min-h-[480px]">
      <div class="flex items-center justify-between px-5 py-4 border-b border-white/5">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-accent-2 grid place-items-center shadow-glow">
            <i class="fa-solid fa-robot text-white text-sm"></i>
          </div>
          <div>
            <p class="font-display font-bold text-white text-sm">Your AI Assistant</p>
            <p class="text-[11px] ${hasKey ? "text-emerald-400" : "text-rose-400"}">
              <i class="fa-solid fa-circle text-[6px] mr-1"></i>${hasKey ? "Connected · Gemini" : "No API key set"}
            </p>
          </div>
        </div>
        <button class="btn-ghost !py-1.5 !px-3 text-xs" onclick="clearChat()"><i class="fa-solid fa-broom mr-1.5"></i>Clear</button>
      </div>

      ${hasKey ? "" : `
        <div class="mx-5 mt-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-[12.5px] flex items-start gap-2.5">
          <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
          <span>Add your Gemini API key in <button class="underline font-semibold" onclick="switchView('settings')">Settings</button> to activate the assistant.</span>
        </div>
      `}

      <div id="chat-scroll" class="flex-1 overflow-y-auto chat-scroll px-5 py-4 flex flex-col gap-3">
        ${state.chatHistory.length ? state.chatHistory.map(m => chatBubbleHtml(m)).join("") : chatEmptyStateHtml()}
      </div>

      <div class="px-4 py-3.5 border-t border-white/5">
        <div class="flex items-end gap-2">
          <textarea id="chat-input" rows="1" class="input-field resize-none max-h-28" placeholder="Ask your assistant anything, ${HONORIFIC}..." onkeydown="handleChatKeydown(event)"></textarea>
          <button id="chat-send-btn" class="btn-primary !px-4 !py-3 shrink-0" onclick="sendChatMessage()"><i class="fa-solid fa-paper-plane"></i></button>
        </div>
        <div class="flex flex-wrap gap-2 mt-2.5">
          <button class="nav-pill" onclick="quickPrompt('How am I doing today based on my progress?')">📊 How am I doing?</button>
          <button class="nav-pill" onclick="quickPrompt('Give me a quick motivational boost for studying right now.')">🔥 Motivate me</button>
          <button class="nav-pill" onclick="quickPrompt('Suggest how I should prioritize my pending tasks today.')">🎯 Prioritize tasks</button>
        </div>
      </div>
    </div>
  `;

  const scrollEl = document.getElementById("chat-scroll");
  if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;

  const ta = document.getElementById("chat-input");
  if (ta) ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 112) + "px"; });
}

function chatEmptyStateHtml() {
  return `<div class="empty-state m-auto"><i class="fa-solid fa-comments"></i><p>Say hello to your assistant, ${HONORIFIC}!</p></div>`;
}

function chatBubbleHtml(m) {
  const cls = m.role === "user" ? "msg-user" : "msg-ai";
  return `<div class="msg-bubble ${cls}">${escapeHtml(m.text)}</div>`;
}

function clearChat() {
  if (!confirm("Clear chat history?")) return;
  state.chatHistory = [];
  saveState();
  renderAssistant();
}

function handleChatKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

function quickPrompt(text) {
  const ta = document.getElementById("chat-input");
  ta.value = text;
  sendChatMessage();
}

async function sendChatMessage() {
  const ta = document.getElementById("chat-input");
  const text = ta.value.trim();
  if (!text) return;
  const apiKey = (state.settings.geminiApiKey || "").trim();
  if (!apiKey) { toast("Please add your Gemini API key in Settings first.", "error"); switchView("settings"); return; }

  state.chatHistory.push({ role: "user", text });
  saveState();
  ta.value = "";
  ta.style.height = "auto";
  renderAssistant();

  const scrollEl = document.getElementById("chat-scroll");
  const typingEl = document.createElement("div");
  typingEl.className = "msg-bubble msg-ai flex items-center gap-1.5";
  typingEl.id = "typing-indicator";
  typingEl.innerHTML = `<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>`;
  scrollEl.appendChild(typingEl);
  scrollEl.scrollTop = scrollEl.scrollHeight;

  const sendBtn = document.getElementById("chat-send-btn");
  sendBtn.disabled = true;

  try {
    const contents = [];
    const historyForApi = state.chatHistory.slice(-16); // keep recent context, trim tokens
    historyForApi.forEach(m => {
      contents.push({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] });
    });

    const body = {
      systemInstruction: { role: "system", parts: [{ text: buildSystemContext() }] },
      contents,
      generationConfig: { temperature: 0.85, maxOutputTokens: 700 }
    };

    const res = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    document.getElementById("typing-indicator")?.remove();

    if (!res.ok) {
      const errMsg = data?.error?.message || `Request failed (${res.status})`;
      throw new Error(errMsg);
    }

    const replyText = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || `Apologies, ${HONORIFIC}, I couldn't generate a response. Please try again.`;
    state.chatHistory.push({ role: "model", text: replyText });
    saveState();
    renderAssistant();
  } catch (err) {
    document.getElementById("typing-indicator")?.remove();
    console.error(err);
    state.chatHistory.push({ role: "model", text: `Sorry, ${HONORIFIC} — I ran into an error reaching the AI service: ${err.message}. Please check your API key in Settings and try again.` });
    saveState();
    renderAssistant();
    toast("AI request failed. Check console/settings.", "error");
  } finally {
    sendBtn.disabled = false;
  }
}

/* -------------------------------------------------------------------------
   11. SETTINGS VIEW
   ------------------------------------------------------------------------- */
function renderSettings() {
  const el = document.getElementById("view-settings");
  const key = state.settings.geminiApiKey || "";
  el.innerHTML = `
    <div>
      <h2 class="section-title">Settings</h2>
      <p class="section-sub">Manage your assistant connection and categories</p>
    </div>

    <div class="glass-card p-5 space-y-4">
      <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-key text-accent"></i>Gemini API Key</h3>
      <p class="text-[13px] text-slate-500">Stored only in this browser's <code class="text-accent-2">localStorage</code> — it never leaves your device except to call Google's Gemini API directly.</p>
      <div class="flex flex-col sm:flex-row gap-2.5">
        <input id="api-key-input" type="password" class="input-field flex-1" placeholder="AQ.xxxxxxxxxxxxxxxxxxxxxxxx" value="${escapeHtml(key)}">
        <button class="icon-btn" onclick="toggleKeyVisibility()"><i class="fa-solid fa-eye" id="key-eye-icon"></i></button>
        <button class="btn-primary whitespace-nowrap" onclick="saveApiKey()"><i class="fa-solid fa-floppy-disk mr-1.5"></i>Save Key</button>
      </div>
      <div class="flex gap-2.5">
        <button class="btn-ghost text-xs !py-2" onclick="testApiKey()"><i class="fa-solid fa-plug mr-1.5"></i>Test Connection</button>
        <span id="key-test-result" class="text-xs self-center"></span>
      </div>
    </div>

    <div class="glass-card p-5 space-y-4">
      <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-tags text-accent-2"></i>Categories</h3>
      <div class="space-y-2.5">
        ${state.categories.map(c => `
          <div class="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
            <input type="color" value="${c.color}" class="w-8 h-8 rounded-lg border-none bg-transparent cursor-pointer" onchange="updateCategoryColor('${c.id}', this.value)">
            <span class="text-sm text-slate-200 flex-1">${escapeHtml(c.name)}</span>
            <span class="text-xs text-slate-500">${state.timetable.filter(t=>t.cat===c.id).length} blocks</span>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="glass-card p-5 space-y-4">
      <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-database text-accent-3"></i>Data Management</h3>
      <p class="text-[13px] text-slate-500">Your entire timetable, tasks and progress history lives in this browser. Back it up or reset if needed.</p>
      <div class="flex flex-wrap gap-2.5">
        <button class="btn-ghost" onclick="exportData()"><i class="fa-solid fa-download mr-1.5"></i>Export JSON</button>
        <label class="btn-ghost cursor-pointer">
          <i class="fa-solid fa-upload mr-1.5"></i>Import JSON
          <input type="file" accept="application/json" class="hidden" onchange="importData(event)">
        </label>
        <button class="btn-danger-ghost" onclick="resetAllData()"><i class="fa-solid fa-trash-can mr-1.5"></i>Reset Everything</button>
      </div>
    </div>

    <div class="glass-card p-5">
      <h3 class="section-title text-base flex items-center gap-2 mb-2"><i class="fa-solid fa-circle-info text-slate-400"></i>About</h3>
      <p class="text-[13px] text-slate-500 leading-relaxed">Command Center v1.0 · Built for ${USER_NAME} · Runs entirely client-side on Cloudflare Pages + Hono. No backend database — everything is stored in your browser's localStorage.</p>
    </div>
  `;
}

function toggleKeyVisibility() {
  const input = document.getElementById("api-key-input");
  const icon = document.getElementById("key-eye-icon");
  if (input.type === "password") { input.type = "text"; icon.className = "fa-solid fa-eye-slash"; }
  else { input.type = "password"; icon.className = "fa-solid fa-eye"; }
}

function saveApiKey() {
  const val = document.getElementById("api-key-input").value.trim();
  state.settings.geminiApiKey = val;
  saveState();
  toast("API key saved locally", "success");
  renderSettings();
}

async function testApiKey() {
  const resultEl = document.getElementById("key-test-result");
  const key = document.getElementById("api-key-input").value.trim();
  if (!key) { resultEl.textContent = "Enter a key first."; resultEl.className = "text-xs self-center text-rose-400"; return; }
  resultEl.textContent = "Testing...";
  resultEl.className = "text-xs self-center text-slate-400";
  try {
    const res = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with just OK." }] }], generationConfig: { maxOutputTokens: 10 } }),
    });
    const data = await res.json();
    if (res.ok) { resultEl.textContent = "✓ Connection successful!"; resultEl.className = "text-xs self-center text-emerald-400"; }
    else { resultEl.textContent = "✗ " + (data?.error?.message || "Failed"); resultEl.className = "text-xs self-center text-rose-400"; }
  } catch (err) {
    resultEl.textContent = "✗ Network error"; resultEl.className = "text-xs self-center text-rose-400";
  }
}

function updateCategoryColor(id, color) {
  const cat = state.categories.find(c => c.id === id);
  if (cat) { cat.color = color; saveState(); toast("Category color updated", "success"); }
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kulshresth-command-center-backup-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Backup exported", "success");
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const imported = JSON.parse(evt.target.result);
      if (!confirm("This will replace your current data. Continue?")) return;
      state = imported;
      saveState();
      toast("Data imported successfully", "success");
      renderCurrentView();
      updateStreakUI();
    } catch (err) {
      toast("Invalid backup file", "error");
    }
  };
  reader.readAsText(file);
}

function resetAllData() {
  if (!confirm("This will permanently delete ALL your tasks, timetable customizations and progress history. Are you absolutely sure?")) return;
  if (!confirm("Really sure? This cannot be undone.")) return;
  localStorage.removeItem(STORE_KEY);
  location.reload();
}

/* -------------------------------------------------------------------------
   12. INIT
   ------------------------------------------------------------------------- */
function init() {
  updateClockAndGreeting();
  setInterval(updateClockAndGreeting, 1000);
  rotateQuote();
  setInterval(rotateQuote, 15000);
  updateStreakUI();
  switchView("dashboard");
  // Refresh dashboard "now/next" every minute
  setInterval(() => { if (currentView === "dashboard") renderDashboard(); if (currentView === "timetable") renderTimetable(); }, 60000);
}

document.addEventListener("DOMContentLoaded", init);
