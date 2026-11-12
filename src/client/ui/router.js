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
import { renderAssistant } from '../views/assistant.js'
import { renderSettings } from '../views/settings.js'
import { setMobileNav, updateBreadcrumb } from './chrome.js'
import { icon } from './icons.js'

export const VIEWS = ['dashboard','day','schedule','tasks','goals','projects','routines','focus','progress','review','assistant','settings']
const RENDERERS = {dashboard:renderDashboard,day:renderMyDay,schedule:renderSchedule,tasks:renderTasks,goals:renderGoals,projects:renderProjects,routines:renderRoutines,focus:renderFocusRoom,progress:renderProgress,review:renderReview,assistant:renderAssistant,settings:renderSettings}
let currentView='dashboard',refreshTimer=null
export function getCurrentView(){return currentView}
export function switchView(view){
  if(!VIEWS.includes(view))return
  if(view!==currentView)destroyAllCharts()
  currentView=view
  for(const name of VIEWS)el(`view-${name}`)?.classList.toggle('hidden',name!==view)
  qsa(document,'.nav-item').forEach((button)=>{const active=button.dataset.view===view;button.classList.toggle('active-nav',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')})
  qsa(document,'.dock-item[data-view]').forEach((button)=>{const active=button.dataset.view===view;button.classList.toggle('is-active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')})
  setMobileNav(false);updateBreadcrumb(view);renderCurrentView()
  const section=el(`view-${view}`);if(section){section.style.animation='none';void section.offsetWidth;section.style.animation=''}
  try{window.scrollTo({top:0,behavior:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}catch{/* jsdom */}
  emit('view:changed',{view})
}
export function renderCurrentView(){
  const renderer=RENDERERS[currentView];if(!renderer)return
  try{renderer()}catch(error){console.error(`[router] ${currentView} failed to render`,error);const section=el(`view-${currentView}`);if(section)section.innerHTML=`<div class="card empty-state">${icon('info')}<p>This view couldn’t be opened.</p><p>Your saved data is safe. Try another section, or export a backup from Settings.</p><button class="btn-ghost" data-retry-view>Try again</button></div>`;section?.querySelector('[data-retry-view]')?.addEventListener('click',()=>renderCurrentView())}
}
export function refreshCurrentView(delay=0){if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{refreshTimer=null;renderCurrentView()},delay)}
export function initRouter(){qsa(document,'[data-view]').forEach((button)=>button.addEventListener('click',()=>switchView(button.dataset.view)));on('store:change',()=>refreshCurrentView())}
