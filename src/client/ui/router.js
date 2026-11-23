import { el, qsa, escapeHtml } from '../core/dom.js'
import { emit, on } from '../core/bus.js'
import { destroyAllCharts } from '../core/charts.js'
import { renderDashboard, renderMyDay } from '../views/dashboard.js'
import { renderSchedule } from '../views/schedule.js'
import { renderTasks } from '../views/tasks.js'
import { renderGoals } from '../views/goals.js'
import { renderProjects } from '../views/projects.js'
import { renderRoutines } from '../views/routines.js'
import { renderFocusRoom } from '../views/focus-room.js'
import { renderProgress } from '../views/progress.js'
import { renderReview } from '../views/review.js'
import { renderPaper } from '../views/paper.js'
import { renderSettings } from '../views/settings.js'
import { renderForecast } from '../views/forecast.js'
import { renderJournal } from '../views/journal.js'
import { renderCalendar } from '../views/calendar.js'
import { renderHyb } from '../views/hyb.js'
import { setMobileNav, updateBreadcrumb } from './chrome.js'
import { setAtmosphereScope } from './atmosphere.js'
import { icon } from './icons.js'

/**
 * The chapter named by the current URL.
 *
 * The URL is written by setAtmosphereScope on every navigation (so /calendar is
 * a real, shareable address), which means it must also be readable: a deep link
 * or a reload on /goals has to open Goals rather than dropping the reader back
 * on the dashboard.
 */
export function viewFromPath(pathname) {
  const raw = pathname ?? (typeof location !== 'undefined' ? location.pathname : '/')
  const segment = String(raw).split('/').filter(Boolean).pop() || ''
  const name = segment.toLowerCase()
  const view = VIEW_ALIASES[name] || name
  return VIEWS.includes(view) ? view : 'dashboard'
}

export const VIEWS = ['dashboard','day','calendar','schedule','hyb','tasks','goals','projects','routines','focus','progress','review','journal','forecast','paper','settings']
const RENDERERS = {dashboard:renderDashboard,day:renderMyDay,calendar:renderCalendar,schedule:renderSchedule,hyb:renderHyb,tasks:renderTasks,goals:renderGoals,projects:renderProjects,routines:renderRoutines,focus:renderFocusRoom,progress:renderProgress,review:renderReview,journal:renderJournal,forecast:renderForecast,paper:renderPaper,settings:renderSettings}
/** Legacy route names kept alive so old links and habits never 404. */
const VIEW_ALIASES = { assistant: 'paper', overview: 'dashboard', tasks: 'tasks' }
let currentView='dashboard';const enterTimers={};let booted=false
export function getCurrentView(){return currentView}
export function switchView(view){
  if (VIEW_ALIASES[view]) view = VIEW_ALIASES[view]
  if(!VIEWS.includes(view))return
  if(view!==currentView)destroyAllCharts()
  currentView=view
  for(const name of VIEWS)el(`view-${name}`)?.classList.toggle('hidden',name!==view)
  const CHAPTER_PARENT={schedule:'calendar',hyb:'day',routines:'day',review:'progress',forecast:'progress'}
  const chapter=CHAPTER_PARENT[view]||view
  qsa(document,'.nav-item').forEach((button)=>{const active=button.dataset.view===chapter;button.classList.toggle('active-nav',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')})
  qsa(document,'.dock-item[data-view]').forEach((button)=>{const active=button.dataset.view===view;button.classList.toggle('is-active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')})
  setMobileNav(false);updateBreadcrumb(view);setAtmosphereScope(view);renderCurrentView()
  const section=el(`view-${view}`);if(section&&booted){section.style.animation='none';void section.offsetWidth;section.style.animation='';section.classList.add('view-enter');if(enterTimers[section.id])clearTimeout(enterTimers[section.id]);enterTimers[section.id]=setTimeout(()=>section.classList.remove('view-enter'),1200)}booted=true
  try{window.scrollTo({top:0,behavior:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}catch{/* jsdom */}
  emit('view:changed',{view})
}
export function renderCurrentView(){
  const renderer=RENDERERS[currentView];if(!renderer)return
  try{renderer()}catch(error){console.error(`[router] ${currentView} failed to render`,error);const section=el(`view-${currentView}`);if(section)section.innerHTML=`<div class="card empty-state">${icon('info')}<p>This view couldn’t be opened.</p><p>Your saved data is safe. Try another section, or export a backup from Settings.</p><button class="btn-ghost" data-retry-view>Try again</button></div>`;section?.querySelector('[data-retry-view]')?.addEventListener('click',()=>renderCurrentView())}
}
let timer = null
let lastPaint = 0
const FRAME = 16

/**
 * Paint the active view at most once per frame while always landing on the
 * final state.
 *
 * Commits are frequent and often bursty: a keyboard reschedule is several
 * commits, a drag commits on drop, ticking a checkbox re-renders Top 3 *and*
 * the day. Rendering synchronously for each one forced repeated layout of the
 * whole section. Updates now coalesce into a single trailing paint.
 *
 * `after` (ms) defers the pending paint — used after a dialog closes so the
 * exit animation keeps its own frames.
 */
export function refreshCurrentView(after = 0) {
  if (timer != null) {
    // a deferred paint outranks an already-pending immediate one
    if (after <= 0) return
    clearTimeout(timer)
  }
  const wait = after > 0 ? after : Math.max(0, FRAME - (Date.now() - lastPaint))
  timer = setTimeout(() => {
    timer = null
    lastPaint = Date.now()
    renderCurrentView()
  }, wait)
}
export function initRouter(){
  qsa(document,'[data-view]').forEach((button)=>button.addEventListener('click',()=>switchView(button.dataset.view)))
  on('store:change',()=>refreshCurrentView())
  // the browser's back button moves between chapters, since each has a URL
  if (typeof window !== 'undefined') window.addEventListener('popstate',()=>switchView(viewFromPath()))
}
