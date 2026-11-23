import { state, commit, currentDayKey } from '../core/store.js'
import { closeModal, confirmDialog, escapeHtml, openModal, toast, qs, qsa } from '../core/dom.js'
import { uid } from '../lib/state.js'
import { goalProgress, projectProgress, unlinkDeleted } from '../lib/relationships.js'
import { formatKeyLabel } from '../lib/dates.js'
import { icon, empty, ring, bindCommon } from '../ui/common.js'
import { paperHeader, paperCard, sectionTitle, divider, progress as paperProgress, priorityMarker, chapterCard, absent, figure, noteField } from '../ui/paper.js'

let search='', filter='active', readingGoalId=null
const categories=['Personal','Academic','Career','Financial','Fitness','Learning','Custom']
export function renderGoals() {
  const section=document.getElementById('view-goals');if(!section)return
  const goals=state.goals.filter((g)=>(filter==='all'||(filter==='active'?g.status==='active':g.status===filter))&&`${g.title} ${g.description}`.toLowerCase().includes(search.toLowerCase()))
  if (readingGoalId && !state.goals.some((g)=>g.id===readingGoalId)) readingGoalId=null
  const reading = readingGoalId ? state.goals.find((g)=>g.id===readingGoalId) : null

  const header = paperHeader({
    eyebrow: reading ? 'A chapter of your vision' : 'The vision',
    title: reading ? escapeHtml(reading.title) : 'What you are becoming.',
    lede: reading
      ? (reading.description || 'One intentional step at a time.')
      : 'Every goal is a page in the same book. Name the outcome, then give it a shape.',
    actions: reading
      ? `<button class="btn-ghost" data-goal-back>${icon('left')}All goals</button><button class="btn-primary" data-goal-edit="${escapeHtml(reading.id)}">${icon('edit')}Edit goal</button>`
      : `<button class="btn-primary" data-common="goal">${icon('plus')}New goal</button>`,
  })

  const filterBar = reading ? '' : `<div class="filter-row"><div class="segmented">${[['active','In progress'],['completed','Achieved'],['paused','Paused'],['all','All goals']].map(([v,l])=>`<button data-goal-filter="${v}" class="${filter===v?'seg-active':''}">${l}</button>`).join('')}</div><div class="toolbar-search">${icon('search')}<input class="input-field" data-goal-search placeholder="Find a goal…" value="${escapeHtml(search)}" aria-label="Search goals"></div></div>`

  section.innerHTML = `${header}${filterBar}${reading ? goalReading(reading) : goalChapters(goals)}`
  bindCommon(section)
  qsa(section, '[data-goal-filter]').forEach((b)=>b.addEventListener('click',()=>{filter=b.dataset.goalFilter;renderGoals()}))
  qs(section, '[data-goal-search]')?.addEventListener('input',(e)=>{search=e.target.value;const pos=e.target.selectionStart;renderGoals();const input=qs(section, '[data-goal-search]');if(input){input.focus();input.setSelectionRange(pos,pos)}})
  qsa(section, '[data-goal-edit]').forEach((b)=>b.addEventListener('click',()=>openGoalModal(b.dataset.goalEdit)))
  qsa(section, '[data-goal-detail]').forEach((b)=>b.addEventListener('click',()=>{readingGoalId=b.dataset.goalDetail;renderGoals();try{window.scrollTo({top:0,behavior:'smooth'})}catch{}}))
  qsa(section, '[data-goal-back]').forEach((b)=>b.addEventListener('click',()=>{readingGoalId=null;renderGoals();try{window.scrollTo({top:0,behavior:'smooth'})}catch{}}))
  // the in-page reading surface carries the same actions the dialog did
  qsa(section, '[data-milestone-toggle]').forEach((b)=>b.addEventListener('click',()=>{const goalId=readingGoalId;commit((s)=>{const m=s.goals.find((g)=>g.id===goalId)?.milestones.find((m)=>m.id===b.dataset.milestoneToggle);if(m)m.done=!m.done});renderGoals()}))
  qsa(section, '[data-detail-edit]').forEach((b)=>b.addEventListener('click',()=>openGoalModal(readingGoalId)))
  qsa(section, '[data-goal-project]').forEach((b)=>b.addEventListener('click',()=>window.CC.openProjectModal(null,{goalId:readingGoalId,milestoneId:null})))
  qsa(section, '[data-goal-task]').forEach((b)=>b.addEventListener('click',()=>window.CC.openTaskModal(null,{goalId:readingGoalId,milestoneId:null})))
  qsa(section, '[data-milestone-project]').forEach((b)=>b.addEventListener('click',()=>window.CC.openProjectModal(null,{goalId:readingGoalId,milestoneId:b.dataset.milestoneProject})))
  qsa(section, '[data-milestone-task]').forEach((b)=>b.addEventListener('click',()=>window.CC.openTaskModal(null,{goalId:readingGoalId,milestoneId:b.dataset.milestoneTask})))
  qsa(section, '[data-linked-project]').forEach((b)=>b.addEventListener('click',()=>window.CC.openProjectDetail(b.dataset.linkedProject)))
  qsa(section, '[data-linked-task]').forEach((b)=>b.addEventListener('click',()=>window.CC.openTaskModal(b.dataset.linkedTask)))
}

export function milestoneEditor(items=[]) { return `<div data-milestone-editor>${items.map((m)=>milestoneEditRow(m)).join('')}</div><button type="button" class="text-button" data-add-milestone>${icon('plus')}Add a milestone</button>` }
function milestoneEditRow(m={id:uid(),title:'',targetDate:null}) {return `<div class="activity-editor-row" data-milestone-row="${escapeHtml(m.id)}"><input class="input-field" data-milestone-title maxlength="200" placeholder="A measurable milestone" aria-label="Milestone title" value="${escapeHtml(m.title)}"><input class="input-field" type="date" data-milestone-date aria-label="Milestone target date" value="${m.targetDate||''}"><button type="button" class="icon-btn" data-remove-row aria-label="Remove milestone">${icon('close')}</button></div>`}
export function bindMilestoneEditor(box) {
  box.querySelector('[data-add-milestone]')?.addEventListener('click',()=>{box.querySelector('[data-milestone-editor]').insertAdjacentHTML('beforeend',milestoneEditRow());box.querySelector('[data-milestone-editor]').lastElementChild.querySelector('input').focus()})
  box.querySelectorAll('[data-remove-row]').forEach((b)=>b.onclick=()=>b.closest('[data-milestone-row]').remove())
}
export function readMilestones(box,previous=[]) {return [...box.querySelectorAll('[data-milestone-row]')].map((row)=>({id:row.dataset.milestoneRow,title:row.querySelector('[data-milestone-title]').value.trim(),targetDate:row.querySelector('[data-milestone-date]').value||null,done:previous.find((m)=>m.id===row.dataset.milestoneRow)?.done||false})).filter((m)=>m.title)}

export function openGoalModal(id=null) {
  const goal=state.goals.find((g)=>g.id===id)
  openModal({title:goal?'Edit your goal':'Give your ambition a name.',size:'modal-wide',body:`<form id="goal-form" class="form-stack"><div><label class="field-label" for="goal-title">Goal title</label><input id="goal-title" class="input-field" required maxlength="200" placeholder="What would you like to achieve?" value="${escapeHtml(goal?.title||'')}"></div><div><label class="field-label" for="goal-description">Why it matters</label><textarea id="goal-description" class="input-field" rows="2" placeholder="A little clarity about the outcome…">${escapeHtml(goal?.description||'')}</textarea></div><div class="form-grid"><div><label class="field-label" for="goal-category">Area of life</label><select id="goal-category" class="input-field">${categories.map((c)=>`<option ${goal?.category===c?'selected':''}>${c}</option>`).join('')}</select></div><div><label class="field-label" for="goal-target">Target date · optional</label><input id="goal-target" class="input-field" type="date" value="${goal?.targetDate||''}"></div></div><div class="form-grid"><div><label class="field-label" for="goal-status">Status</label><select id="goal-status" class="input-field">${['active','paused','completed','cancelled'].map((s)=>`<option value="${s}" ${goal?.status===s?'selected':''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select></div><div><label class="field-label" for="goal-progress-mode">Progress tracking</label><select id="goal-progress-mode" class="input-field"><option value="auto">From milestones & connected work</option><option value="manual" ${goal?.progressMode==='manual'?'selected':''}>Manual estimate</option></select></div></div><div data-manual-goal-progress class="${goal?.progressMode==='manual'?'':'hidden'}"><label class="field-label" for="goal-manual">Self-assessed progress · %</label><input id="goal-manual" type="number" min="0" max="100" class="input-field" value="${goal?.manualProgress||0}"></div><div><p class="field-label">Milestones</p><p class="form-hint" style="margin-bottom:12px">Make the outcome tangible. Connect projects and missions to each milestone.</p>${milestoneEditor(goal?.milestones||[])}</div><div><label class="field-label" for="goal-notes">Private notes</label><textarea id="goal-notes" class="input-field" rows="2">${escapeHtml(goal?.notes||'')}</textarea></div><div class="form-footer">${goal?`<button type="button" class="btn-danger" data-goal-delete>${icon('trash')}Delete</button>`:''}<button type="button" class="btn-ghost" data-modal-close>Cancel</button><button type="submit" class="btn-primary">${goal?'Save goal':'Create goal'}</button></div></form>`,onMount:(box)=>{
    bindMilestoneEditor(box)
    box.querySelector('#goal-progress-mode').addEventListener('change',(e)=>box.querySelector('[data-manual-goal-progress]').classList.toggle('hidden',e.target.value!=='manual'))
    box.querySelector('form').addEventListener('submit',(e)=>{e.preventDefault();const title=box.querySelector('#goal-title').value.trim();if(!title)return;const payload={title,description:box.querySelector('#goal-description').value,category:box.querySelector('#goal-category').value,targetDate:box.querySelector('#goal-target').value||null,status:box.querySelector('#goal-status').value,progressMode:box.querySelector('#goal-progress-mode').value,manualProgress:Number(box.querySelector('#goal-manual').value),notes:box.querySelector('#goal-notes').value,milestones:readMilestones(box,goal?.milestones||[])};commit((s)=>{if(goal)Object.assign(s.goals.find((g)=>g.id===id),payload);else s.goals.push({id:uid(),...payload,createdAt:Date.now(),priority:'medium',deadline:null})});closeModal();toast(goal?'Goal updated.':'A meaningful direction, made clear.','success')})
    box.querySelector('[data-goal-delete]')?.addEventListener('click',async()=>{if(await confirmDialog({title:'Delete this goal?',message:'Connected projects and missions stay safe. Their goal link is removed; focus history is preserved.',confirmText:'Delete goal',danger:true})){commit((s)=>{s.goals=s.goals.filter((g)=>g.id!==id);unlinkDeleted(s,'goal',id)});closeModal();toast('Goal removed. Your work is preserved.','info')}})
  }})
}

/**
 * The chapter grid. Each goal reads as the opening of a chapter: an eyebrow,
 * a title set in the display face, its own honest progress, and a way in.
 */
function goalChapters(goals) {
  if (!goals.length) {
    return paperCard({ body: absent({
      icon: 'target',
      title: search ? 'No matching goals.' : filter === 'completed' ? 'Meaningful things take time.' : 'What are you working toward?',
      body: search ? 'Try another word, or widen the filter.'
        : filter === 'completed' ? 'Goals you have achieved will be kept here, with the work that carried them.'
        : 'A career move. A new skill. A healthier rhythm. Give your ambition a name, then break it into small steps.',
      action: `<button class="btn-primary" data-common="goal">${icon('plus')}Create a goal</button>`,
    }) })
  }
  const chapters = goals.map((g, index) => {
    const progress = goalProgress(state, g)
    const projects = state.projects.filter((p) => p.goalId === g.id)
    const tasks = state.tasks.filter((t) => t.goalId === g.id)
    const doneTasks = tasks.filter((t) => t.done).length
    const milestones = g.milestones || []
    const doneMilestones = milestones.filter((m) => m.done).length
    return chapterCard({
      kind: 'goal',
      eyebrow: `${String(index + 1).padStart(2, '0')} · ${g.category || 'Personal'}`,
      title: escapeHtml(g.title),
      body: `<p class="paper-lede">${escapeHtml(g.description || 'Every meaningful outcome begins with a small, intentional step.')}</p>
        <div class="paper-figure-row paper-figure-row--compact">
          ${figure(`${doneMilestones}<small>/${milestones.length || 0}</small>`, 'Milestones')}
          ${figure(String(projects.length), projects.length === 1 ? 'Project' : 'Projects')}
          ${figure(`${doneTasks}<small>/${tasks.length}</small>`, 'Missions')}
        </div>`,
      progressValue: progress,
      progressLabel: g.progressMode === 'manual' ? 'Self-assessed' : 'From your work',
      foot: `<span>${g.targetDate ? `Target · ${formatKeyLabel(g.targetDate)}` : 'No target date'}</span>
        <span class="paper-chapter-links">
          <button class="text-button" data-goal-edit="${escapeHtml(g.id)}" aria-label="Edit ${escapeHtml(g.title)}">${icon('edit')}</button>
          <button class="text-button" data-goal-detail="${escapeHtml(g.id)}">Read ${icon('arrow')}</button>
        </span>`,
      attrs: `data-goal-chapter="${escapeHtml(g.id)}"`,
    })
  }).join('')
  return `<div class="paper-chapter-grid">${chapters}</div>`
}

/**
 * The goal as a page you read, not a dialog you dismiss. Everything the modal
 * showed is here, laid out in the journal's own columns, and every action is
 * the original handler — this is a different surface, not a different feature.
 */
function goalReading(goal) {
  const projects = state.projects.filter((p) => p.goalId === goal.id)
  const tasks = state.tasks.filter((t) => t.goalId === goal.id)
  const milestones = goal.milestones || []
  const progress = goalProgress(state, goal)
  const doneMilestones = milestones.filter((m) => m.done).length

  const marginCol = `
    <aside class="paper-stack paper-reading-margin">
      ${paperCard({
        title: 'The shape of it',
        body: `<div class="paper-reading-figures">
          ${figure(`${progress}<small>%</small>`, goal.progressMode === 'manual' ? 'Self-assessed' : 'From your work')}
          ${figure(`${doneMilestones}<small>/${milestones.length}</small>`, 'Milestones reached')}
          ${figure(String(projects.length), 'Projects', { note: projects.length ? projects.map((p) => p.title).join(' · ') : 'None yet' })}
          ${figure(String(tasks.filter((t) => t.done).length) + '<small>/' + tasks.length + '</small>', 'Missions done')}
        </div>`,
      })}
      ${paperCard({
        title: 'The particulars',
        body: `<dl class="paper-facts">
          <div><dt>Area of life</dt><dd>${escapeHtml(goal.category || 'Personal')}</dd></div>
          <div><dt>Target</dt><dd>${goal.targetDate ? formatKeyLabel(goal.targetDate) : 'Not set'}</dd></div>
          <div><dt>Status</dt><dd>${escapeHtml(goal.status || 'active')}</dd></div>
          <div><dt>Tracked by</dt><dd>${goal.progressMode === 'manual' ? 'Your own estimate' : 'Milestones and connected work'}</dd></div>
        </dl>`,
      })}
      ${goal.notes ? paperCard({ title: 'Private notes', body: `<p class="paper-note">${escapeHtml(goal.notes)}</p>` }) : ''}
    </aside>`

  const milestonesBlock = milestones.length
    ? milestones.map((m, i) => `<div class="paper-entry${m.done ? ' paper-entry--done' : ''}">
        <span class="paper-entry-index">${escapeHtml(String(i + 1).padStart(2, '0'))}</span>
        <div class="paper-entry-body">
          <div class="paper-entry-title">
            <button class="task-check ${m.done ? 'checked' : ''}" data-milestone-toggle="${escapeHtml(m.id)}" aria-label="${m.done ? 'Reopen' : 'Complete'} ${escapeHtml(m.title)}" aria-pressed="${m.done ? 'true' : 'false'}">${icon('check')}</button>
            <span>${escapeHtml(m.title)}</span>
          </div>
          <div class="paper-entry-meta">${m.targetDate ? formatKeyLabel(m.targetDate) : 'No date'} · ${projects.filter((p) => p.milestoneId === m.id).length} projects · ${tasks.filter((t) => t.milestoneId === m.id).length} missions</div>
        </div>
        <div class="paper-entry-trailing">
          <button class="icon-btn" data-milestone-project="${escapeHtml(m.id)}" aria-label="Create project for ${escapeHtml(m.title)}">${icon('projects')}</button>
          <button class="icon-btn" data-milestone-task="${escapeHtml(m.id)}" aria-label="Create mission for ${escapeHtml(m.title)}">${icon('plus')}</button>
        </div>
      </div>`).join('')
    : absent({ icon: 'flag', title: 'Turn ambition into a next step.', body: 'Add milestones, then connect a project or mission to each one.', action: `<button class="btn-ghost" data-detail-edit>${icon('plus')}Add milestones</button>` })

  const linkedRow = (attrs, symbol, title, meta) => `<button class="linked-work-row paper-linked-row" ${attrs}>${icon(symbol)}<strong>${escapeHtml(title)}</strong><span>${meta}</span></button>`

  const mainCol = `
    <div class="paper-stack">
      ${paperCard({
        title: 'The path forward',
        note: milestones.length ? `${doneMilestones} of ${milestones.length} reached` : 'No milestones yet',
        action: `<button class="text-button" data-detail-edit>${icon('edit')}Edit goal</button>`,
        body: `<div class="paper-ledger">${milestonesBlock}</div>`,
      })}
      ${paperCard({
        title: 'Projects that give it a place',
        action: `<button class="text-button" data-goal-project>${icon('plus')}New project</button>`,
        body: projects.length
          ? projects.map((p) => linkedRow(`data-linked-project="${escapeHtml(p.id)}"`, 'projects', p.title, `${projectProgress(state, p)}%`)).join('')
          : `<p class="paper-lede paper-lede--quiet">A project gives your goal somewhere to take shape.</p>`,
      })}
      ${paperCard({
        title: 'Missions that move it forward',
        action: `<button class="text-button" data-goal-task>${icon('plus')}Add mission</button>`,
        body: tasks.length
          ? tasks.slice(0, 12).map((t) => linkedRow(`data-linked-task="${escapeHtml(t.id)}"`, t.done ? 'check' : 'missions', t.title, t.done ? 'Complete' : t.date ? formatKeyLabel(t.date) : 'Unscheduled')).join('')
          : `<p class="paper-lede paper-lede--quiet">The connection appears here when you link a mission to this goal.</p>`,
      })}
    </div>`

  return `<div class="paper-columns paper-reading">${mainCol}${marginCol}</div>
    <div class="paper-reading-foot"><button class="btn-ghost" data-goal-back>${icon('left')}All goals</button></div>`
}

export function openGoalDetail(id) {
  const goal=state.goals.find((g)=>g.id===id);if(!goal)return
  const projects=state.projects.filter((p)=>p.goalId===id), tasks=state.tasks.filter((t)=>t.goalId===id)
  openModal({title:escapeHtml(goal.title),size:'modal-wide',body:`<div class="goal-detail-summary">${ring(goalProgress(state,goal),'progress')}<div><span class="chip chip-accent">${escapeHtml(goal.category)}</span><p class="section-sub" style="margin-top:8px">${escapeHtml(goal.description||'One intentional step at a time.')}</p><p class="meta" style="margin-top:6px">${goal.targetDate?'Target · '+formatKeyLabel(goal.targetDate):'No target date set'}${goal.progressMode==='manual'?' · Self-assessed progress':''}</p></div></div><div class="section-heading"><h3 class="section-title">The path forward</h3><button class="text-button" data-detail-edit>${icon('edit')}Edit goal</button></div>${goal.milestones.length?goal.milestones.map((m)=>`<div class="milestone-row ${m.done?'is-done':''}"><button class="task-check ${m.done?'checked':''}" data-milestone-toggle="${escapeHtml(m.id)}" aria-label="${m.done?'Reopen':'Complete'} ${escapeHtml(m.title)}">${icon('check')}</button><div style="flex:1"><strong>${escapeHtml(m.title)}</strong><p>${m.targetDate?formatKeyLabel(m.targetDate):'No date'} · ${projects.filter((p)=>p.milestoneId===m.id).length} projects · ${tasks.filter((t)=>t.milestoneId===m.id).length} missions</p></div><button class="icon-btn" data-milestone-project="${escapeHtml(m.id)}" aria-label="Create project for ${escapeHtml(m.title)}">${icon('projects')}</button><button class="icon-btn" data-milestone-task="${escapeHtml(m.id)}" aria-label="Create mission for ${escapeHtml(m.title)}">${icon('plus')}</button></div>`).join(''):empty('flag','Turn ambition into a next step.','Add milestones, then connect a project or mission to each one.',`<button class="btn-ghost" data-detail-edit>${icon('plus')}Add milestones</button>`) }<div class="detail-section"><div class="section-heading"><h4>Connected projects</h4><button class="text-button" data-goal-project>${icon('plus')}New project</button></div>${projects.map((p)=>`<button class="linked-work-row" data-linked-project="${escapeHtml(p.id)}">${icon('projects')}<strong>${escapeHtml(p.title)}</strong><span>${projectProgress(state,p)}%</span></button>`).join('')||'<p class="form-hint">A project gives your goal a place to take shape.</p>'}</div><div class="detail-section"><div class="section-heading"><h4>Missions that move this forward</h4><button class="text-button" data-goal-task>${icon('plus')}Add mission</button></div>${tasks.slice(0,12).map((t)=>`<button class="linked-work-row" data-linked-task="${escapeHtml(t.id)}">${icon(t.done?'check':'missions')}<strong>${escapeHtml(t.title)}</strong><span>${t.done?'Complete':t.date?formatKeyLabel(t.date):'Unscheduled'}</span></button>`).join('')||'<p class="form-hint">The connection appears here when you link a mission to this goal.</p>'}</div>${goal.notes?`<div class="detail-section"><h4>Private notes</h4><p class="form-hint" style="white-space:pre-wrap">${escapeHtml(goal.notes)}</p></div>`:''}<div class="form-footer"><button class="btn-primary" data-modal-close>Keep moving forward</button></div>`,onMount:(box)=>{
    box.querySelectorAll('[data-detail-edit]').forEach((b)=>b.addEventListener('click',()=>openGoalModal(id)))
    box.querySelectorAll('[data-milestone-toggle]').forEach((b)=>b.addEventListener('click',()=>{commit((s)=>{const m=s.goals.find((g)=>g.id===id).milestones.find((m)=>m.id===b.dataset.milestoneToggle);m.done=!m.done});openGoalDetail(id)}))
    const newProject=(milestoneId)=>window.CC.openProjectModal(null,{goalId:id,milestoneId})
    const newTask=(milestoneId)=>window.CC.openTaskModal(null,{goalId:id,milestoneId})
    box.querySelector('[data-goal-project]').addEventListener('click',()=>newProject(null));box.querySelector('[data-goal-task]').addEventListener('click',()=>newTask(null))
    box.querySelectorAll('[data-milestone-project]').forEach((b)=>b.addEventListener('click',()=>newProject(b.dataset.milestoneProject)))
    box.querySelectorAll('[data-milestone-task]').forEach((b)=>b.addEventListener('click',()=>newTask(b.dataset.milestoneTask)))
    box.querySelectorAll('[data-linked-project]').forEach((b)=>b.addEventListener('click',()=>window.CC.openProjectDetail(b.dataset.linkedProject)))
    box.querySelectorAll('[data-linked-task]').forEach((b)=>b.addEventListener('click',()=>window.CC.openTaskModal(b.dataset.linkedTask)))
  }})
}
