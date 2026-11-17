/* -------------------------------------------------------------------------
   STARTERS — a good first day, without a blank screen
   -------------------------------------------------------------------------
   A new workspace is honest but lifeless. These are optional starting points:
   a small, real set of goals, projects, missions and routines that shows how
   the system fits together. Nothing is applied until the person chooses, every
   record is ordinary data they can edit or delete, and "start empty" is always
   the first option.

   `buildDemoWorkspace` is the same idea at full size — a fortnight of real
   history used by the "explore with example data" path and by the product QA
   suite. It is generated relative to *today*, so it never goes stale.
   ------------------------------------------------------------------------- */

import { addDays } from './dates.js'

const pad = (n) => String(n).padStart(2, '0')
const keyFromDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const STARTER_PRESETS = [
  {
    id: 'founder',
    label: 'Founder · operator',
    icon: 'bolt',
    blurb: 'A company to grow, a team to build, and the focus to do both.',
    promise: 'Two goals, two projects and a calm first day.',
  },
  {
    id: 'student',
    label: 'Student · learner',
    icon: 'journal',
    blurb: 'Deep study blocks, revision rhythm and a real margin before exams.',
    promise: 'Built for retention, not for grinding.',
  },
  {
    id: 'creator',
    label: 'Creator · maker',
    icon: 'sparkle',
    blurb: 'Publish consistently without letting the craft eat the week.',
    promise: 'Ship small, learn fast, keep the streak.',
  },
  {
    id: 'balanced',
    label: 'A calmer week',
    icon: 'leaf',
    blurb: 'Work that fits inside life — training, family and one meaningful project.',
    promise: 'Space is the plan, not the leftover.',
  },
]

/** Shared helper: an id factory that is stable given the injected uid(). */
function makeIds(uid) {
  const used = new Set()
  return (prefix) => {
    let id = `${prefix}_${uid()}`
    while (used.has(id)) id = `${prefix}_${uid()}x`
    used.add(id)
    return id
  }
}

const CONTENT = {
  founder: {
    goals: [
      {
        title: 'Reach $10M ARR with product-led growth',
        description: 'A growth engine that compounds instead of a bigger sales team every quarter.',
        category: 'work',
        days: 210,
        milestones: ['Self-serve funnel shipped', 'Enterprise tier launched', '120% net revenue retention'],
      },
      {
        title: 'Build a team that does the best work of their careers',
        description: 'Fewer, stronger, clearer.',
        category: 'work',
        days: 150,
        milestones: ['Leadership bench complete', 'Career framework shipped'],
      },
    ],
    projects: [
      { title: 'Board narrative · Q4', goal: 0, days: 12, status: 'active', color: '#7ba7ea' },
      { title: 'Onboarding revamp', goal: 1, days: 24, status: 'active', color: '#a99af1' },
    ],
    missions: [
      { title: 'Write the one-page story of the quarter', project: 0, goal: 0, time: '09:30', minutes: 60, priority: 'high', today: true },
      { title: 'Review the onboarding funnel data', project: 1, goal: 1, time: '11:30', minutes: 45, priority: 'high', today: true },
      { title: 'Deep work: the one decision that matters this week', project: 0, goal: 0, time: '14:00', minutes: 90, priority: 'high', today: true },
      { title: 'Interview: senior product designer', project: null, goal: 1, day: 1, minutes: 60, priority: 'medium' },
      { title: 'Draft next quarter’s hiring plan', project: 1, goal: 1, day: 2, minutes: 60, priority: 'medium' },
      { title: 'Close the loop with the board on metrics', project: 0, goal: 0, day: -1, done: true, minutes: 45, priority: 'high' },
    ],
    routines: [
      { title: 'Morning start', activities: ['Water + daylight', 'One page of thinking', 'Choose the one thing'] },
      { title: 'Evening shutdown', activities: ['Inbox to zero', 'Tomorrow’s Top 3', 'Close the laptop'] },
    ],
    blocks: [
      { title: 'The one thing', time: '09:30', minutes: 90, mission: 0 },
      { title: 'Onboarding review', time: '11:30', minutes: 45, mission: 1 },
      { title: 'Deep work · no meetings', time: '14:00', minutes: 90, mission: 2 },
    ],
  },
  student: {
    goals: [
      {
        title: 'Pass the exam with real margin',
        description: 'Understand the material deeply enough to explain it.',
        category: 'learning',
        days: 120,
        milestones: ['Finish the syllabus once', 'Second pass with notes', 'Ten timed mock papers'],
      },
      {
        title: 'Train the body as well as the mind',
        description: 'Sleep, movement and food are part of the study plan.',
        category: 'wellbeing',
        days: 90,
        milestones: ['Five sessions a week for a month'],
      },
    ],
    projects: [
      { title: 'Syllabus · first pass', goal: 0, days: 40, status: 'active', color: '#79bca5' },
      { title: 'Mock test log', goal: 0, days: 60, status: 'planning', color: '#d3b17c' },
    ],
    missions: [
      { title: 'Hardest topic first — 90 minutes, no phone', project: 0, goal: 0, time: '07:00', minutes: 90, priority: 'high', today: true },
      { title: 'Active recall on yesterday’s notes', project: 0, goal: 0, time: '11:00', minutes: 30, priority: 'high', today: true },
      { title: 'Twenty practice questions, timed', project: 1, goal: 0, time: '16:00', minutes: 45, priority: 'medium', today: true },
      { title: 'Walk 30 minutes without headphones', project: null, goal: 1, time: '18:30', minutes: 30, priority: 'low', today: true },
      { title: 'Review the error log from last week', project: 1, goal: 0, day: 1, minutes: 30, priority: 'medium' },
      { title: 'Finish chapter 4 and summarise it', project: 0, goal: 0, day: -1, done: true, minutes: 60, priority: 'high' },
    ],
    routines: [
      { title: 'Study start', activities: ['Phone away', 'One page of recall', 'Set the timer'] },
      { title: 'Wind-down', activities: ['Walk', 'Tomorrow’s first topic', 'Sleep by 23:00'] },
    ],
    blocks: [
      { title: 'Deep study · hardest topic', time: '07:00', minutes: 90, mission: 0 },
      { title: 'Recall + notes', time: '11:00', minutes: 30, mission: 1 },
      { title: 'Practice questions', time: '16:00', minutes: 45, mission: 2 },
    ],
  },
  creator: {
    goals: [
      {
        title: 'Publish something real every week for a year',
        description: 'Consistency is the strategy. Quality follows volume.',
        category: 'personal',
        days: 300,
        milestones: ['Twelve weeks unbroken', 'Find the signature format', 'Ship the first long piece'],
      },
      {
        title: 'Build an audience of 10,000 people who care',
        description: 'Fewer, deeper, more useful.',
        category: 'personal',
        days: 220,
        milestones: ['First 1,000 readers', 'A weekly letter people reply to'],
      },
    ],
    projects: [
      { title: 'This week’s essay', goal: 0, days: 5, status: 'active', color: '#f0783e' },
      { title: 'Weekly letter', goal: 1, days: 7, status: 'active', color: '#a99af1' },
    ],
    missions: [
      { title: 'Draft: the argument in one paragraph', project: 0, goal: 0, time: '09:00', minutes: 45, priority: 'high', today: true },
      { title: 'Write 800 words without editing', project: 0, goal: 0, time: '10:30', minutes: 90, priority: 'high', today: true },
      { title: 'Edit and ship this week’s essay', project: 0, goal: 0, time: '15:00', minutes: 60, priority: 'high', today: true },
      { title: 'Reply to every letter reader', project: 1, goal: 1, time: '17:00', minutes: 30, priority: 'medium', today: true },
      { title: 'Outline next week’s idea', project: 0, goal: 0, day: 1, minutes: 30, priority: 'medium' },
      { title: 'Shipped week 6’s essay', project: 0, goal: 0, day: -1, done: true, minutes: 90, priority: 'high' },
    ],
    routines: [
      { title: 'Morning pages', activities: ['Three pages by hand', 'One idea to keep'] },
      { title: 'Publish day', activities: ['Final read aloud', 'Ship it', 'Share one idea'] },
    ],
    blocks: [
      { title: 'Draft · one paragraph at a time', time: '09:00', minutes: 90, mission: 0 },
      { title: 'Edit and ship', time: '15:00', minutes: 60, mission: 2 },
      { title: 'Reader replies', time: '17:00', minutes: 30, mission: 3 },
    ],
  },
  balanced: {
    goals: [
      {
        title: 'Be strong and rested at forty',
        description: 'Train like it matters. Sleep like it is part of the plan.',
        category: 'wellbeing',
        days: 240,
        milestones: ['Five sessions a week for six weeks', 'Run a sub-25 5k'],
      },
      {
        title: 'Finish the one project that keeps calling',
        description: 'Small, consistent, unglamorous progress.',
        category: 'personal',
        days: 120,
        milestones: ['Outline complete', 'First draft', 'Show one person'],
      },
    ],
    projects: [
      { title: 'The long project', goal: 1, days: 60, status: 'active', color: '#a99af1' },
      { title: 'Training block · autumn', goal: 0, days: 30, status: 'active', color: '#79bca5' },
    ],
    missions: [
      { title: 'Morning training session', project: 1, goal: 0, time: '07:00', minutes: 45, priority: 'high', today: true },
      { title: 'One focused hour on the project', project: 0, goal: 1, time: '10:00', minutes: 60, priority: 'high', today: true },
      { title: 'Walk with family, phones away', project: null, goal: 0, time: '18:00', minutes: 45, priority: 'medium', today: true },
      { title: 'Read twenty pages', project: null, goal: 1, time: '21:00', minutes: 30, priority: 'low', today: true },
      { title: 'Plan the weekend properly', project: null, goal: 0, day: 2, minutes: 20, priority: 'low' },
      { title: 'Training session · legs', project: 1, goal: 0, day: -1, done: true, minutes: 45, priority: 'medium' },
    ],
    routines: [
      { title: 'Morning ritual', activities: ['Water and daylight', 'Mobility 10 minutes', 'One page'] },
      { title: 'Evening shutdown', activities: ['Kitchen closed', 'Tomorrow’s three', 'Read, not scroll'] },
    ],
    blocks: [
      { title: 'Training', time: '07:00', minutes: 45, mission: 0 },
      { title: 'Project · one focused hour', time: '10:00', minutes: 60, mission: 1 },
      { title: 'Family walk', time: '18:00', minutes: 45, mission: 2 },
    ],
  },
}

/**
 * Build a starter payload relative to `today`.
 * Nothing here touches live state; the caller decides what to apply.
 */
export function buildStarter(presetId, { today, now = Date.now(), uid }) {
  const content = CONTENT[presetId]
  if (!content) return null
  const id = makeIds(uid)
  const goals = content.goals.map((goal) => ({
    id: id('goal'),
    title: goal.title,
    description: goal.description,
    category: goal.category,
    horizon: 'long_term',
    targetDate: addDays(today, goal.days),
    progressMode: 'derived',
    status: 'active',
    createdAt: now,
    milestones: goal.milestones.map((title, index) => ({ id: id('mile'), title, done: index === 0 && goal.milestones.length > 2 })),
  }))
  const projects = content.projects.map((project) => ({
    id: id('proj'),
    title: project.title,
    description: '',
    goalId: goals[project.goal]?.id || null,
    status: project.status,
    dueDate: addDays(today, project.days),
    color: project.color,
    createdAt: now,
  }))
  const tasks = content.missions.map((mission) => ({
    id: id('task'),
    title: mission.title,
    date: mission.done ? addDays(today, mission.day ?? -1) : mission.today ? today : mission.day ? addDays(today, mission.day) : null,
    time: mission.time || null,
    estimateMinutes: mission.minutes,
    priority: mission.priority,
    cat: content.goals[mission.goal]?.category || 'work',
    goalId: goals[mission.goal]?.id || null,
    projectId: mission.project != null ? projects[mission.project]?.id || null : null,
    milestoneId: null,
    horizon: mission.today ? 'daily' : mission.done ? 'daily' : 'weekly',
    status: mission.done ? 'completed' : 'ready',
    done: !!mission.done,
    completedAt: mission.done ? now - 86400000 : null,
    subtasks: [],
    notes: '',
    description: '',
    inbox: false,
    protected: false,
    flexible: true,
    createdAt: now,
  }))
  const todayBlocks = content.blocks.map((block) => ({
    id: id('block'),
    title: block.title,
    time: block.time,
    duration: block.minutes,
    cat: content.goals[0]?.category || 'work',
    taskId: tasks[block.mission]?.id || null,
    missionId: tasks[block.mission]?.id || null,
    goalId: tasks[block.mission]?.goalId || null,
    projectId: tasks[block.mission]?.projectId || null,
    protected: false,
    flexible: true,
    priority: tasks[block.mission]?.priority || 'medium',
    status: 'planned',
  }))
  const routines = content.routines.map((routine) => ({
    id: id('routine'),
    title: routine.title,
    description: '',
    activities: routine.activities.map((title) => ({ id: id('act'), title, minutes: 10 })),
    days: [1, 2, 3, 4, 5],
    createdAt: now,
  }))
  return {
    presetId,
    goals,
    projects,
    tasks,
    routines,
    scheduleDays: { [today]: todayBlocks },
    top3: tasks.filter((t) => t.date === today).slice(0, 3).map((t) => t.id),
    focus: { goalId: goals[0]?.id || null, taskId: tasks.find((t) => t.date === today)?.id || null },
    counts: { goals: goals.length, projects: projects.length, missions: tasks.length, routines: routines.length, blocks: todayBlocks.length },
  }
}

/** Copy a starter payload into a live state object (mutates `state`). */
export function applyStarter(state, starter) {
  if (!starter) return { applied: false }
  state.goals.push(...starter.goals)
  state.projects.push(...starter.projects)
  state.tasks.push(...starter.tasks)
  state.routines.push(...starter.routines)
  for (const [day, blocks] of Object.entries(starter.scheduleDays)) {
    state.schedule.days[day] = [...(state.schedule.days[day] || []), ...blocks]
  }
  const today = Object.keys(starter.scheduleDays)[0]
  state.top3[today] = starter.top3
  state.onboarding = { ...(state.onboarding || {}), seen: true, completed: true, preset: starter.presetId, completedAt: Date.now() }
  state.settings.onboarding = { ...(state.settings.onboarding || {}), seen: true }
  return { applied: true, counts: starter.counts }
}

/* ------------------------------------------------------------------ demo */

/**
 * A full, realistic workspace with a fortnight of history. Every number in the
 * demo is generated from these records — nothing is faked in the UI.
 */
export function buildDemoWorkspace({ today, now = Date.now(), uid }) {
  const id = makeIds(uid)
  const d = (offset) => addDays(today, offset)
  const mission = (title, extra = {}) => ({
    id: id('task'),
    title,
    date: null,
    time: null,
    estimateMinutes: 30,
    priority: 'medium',
    cat: 'work',
    notes: '',
    description: '',
    done: false,
    status: 'ready',
    deadline: null,
    goalId: null,
    projectId: null,
    milestoneId: null,
    horizon: 'daily',
    subtasks: [],
    progress: null,
    history: [],
    protected: false,
    flexible: true,
    inbox: false,
    createdAt: now,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    ...extra,
  })

  const goals = [
    {
      id: id('goal'),
      title: 'Grow ARR to $50M with durable, product-led growth',
      description: 'Build a growth engine that compounds — not one that needs a bigger sales team every quarter.',
      category: 'work',
      horizon: 'long_term',
      targetDate: d(180),
      progressMode: 'derived',
      status: 'active',
      createdAt: now - 90 * 86400000,
      milestones: [
        { id: id('mile'), title: 'Nail the self-serve funnel', done: true },
        { id: id('mile'), title: 'Launch the enterprise tier', done: false },
        { id: id('mile'), title: 'Reach 120% net revenue retention', done: false },
      ],
    },
    {
      id: id('goal'),
      title: 'Build a team that does the best work of their careers',
      description: 'Hiring, clarity and craft. Fewer, stronger.',
      category: 'work',
      horizon: 'long_term',
      targetDate: d(120),
      progressMode: 'derived',
      status: 'active',
      createdAt: now - 80 * 86400000,
      milestones: [
        { id: id('mile'), title: 'Complete the leadership bench', done: true },
        { id: id('mile'), title: 'Ship the career framework', done: false },
      ],
    },
    {
      id: id('goal'),
      title: 'Master the craft of product leadership',
      description: 'Read, write and practise deliberately — one hour most days.',
      category: 'learning',
      horizon: 'long_term',
      targetDate: null,
      progressMode: 'manual',
      manualProgress: 38,
      status: 'active',
      createdAt: now - 60 * 86400000,
      milestones: [],
    },
    {
      id: id('goal'),
      title: 'Be strong at 40 — train like it matters',
      description: 'Consistency over intensity.',
      category: 'wellbeing',
      horizon: 'long_term',
      targetDate: d(200),
      progressMode: 'derived',
      status: 'active',
      createdAt: now - 45 * 86400000,
      milestones: [{ id: id('mile'), title: 'Run a sub-25 5k', done: false }],
    },
  ]
  const projects = [
    { id: id('proj'), title: 'Board deck · Q4', description: 'The one document that sets the next six months.', goalId: goals[0].id, status: 'active', dueDate: d(1), color: '#7ba7ea', createdAt: now - 14 * 86400000 },
    { id: id('proj'), title: 'Onboarding revamp', description: 'Cut time-to-value from 9 days to 3.', goalId: goals[1].id, status: 'active', dueDate: d(3), color: '#a99af1', createdAt: now - 20 * 86400000 },
    { id: id('proj'), title: 'Team offsite · Jaipur', description: 'Three days, one plan, zero slides.', goalId: goals[1].id, status: 'planning', dueDate: d(21), color: '#d3b17c', createdAt: now - 10 * 86400000 },
  ]
  const [g1, g2, g3, g4] = goals
  const [p1, p2, p3] = projects
  const tasks = [
    mission('Finalise the Q4 growth narrative for the board deck', {
      id: id('task'),
      date: today,
      time: '09:30',
      estimateMinutes: 90,
      priority: 'high',
      goalId: g1.id,
      projectId: p1.id,
      status: 'in_progress',
      notes: 'Anchor on retention + expansion revenue. Bring the two cohort charts.',
      subtasks: [
        { id: id('sub'), title: 'Pull retention cohort data', done: true },
        { id: id('sub'), title: 'Draft the narrative arc', done: true },
        { id: id('sub'), title: 'Design the three key slides', done: false },
      ],
    }),
    mission('Review the onboarding revamp proposal', { id: id('task'), date: today, time: '11:30', estimateMinutes: 45, priority: 'high', goalId: g2.id, projectId: p2.id }),
    mission('Deep work: the ruthless scope cut for v2', { id: id('task'), date: today, time: '14:00', estimateMinutes: 120, priority: 'medium', goalId: g1.id, projectId: p1.id }),
    mission('Run 5k easy + mobility', { id: id('task'), date: today, estimateMinutes: 35, priority: 'medium', cat: 'wellbeing', goalId: g4.id }),
    mission('Read 20 pages — The Making of a Manager', { id: id('task'), date: today, time: '20:30', estimateMinutes: 30, priority: 'low', cat: 'learning', goalId: g3.id }),
    mission('Reply to Ananya about the pricing experiment', { id: id('task'), date: today, estimateMinutes: 15, priority: 'high' }),
    mission('Approve design system tokens v2', { id: id('task'), date: d(-1), estimateMinutes: 30, priority: 'high', cat: 'work', goalId: g2.id, done: true, status: 'completed', completedAt: now - 86400000 }),
    mission('Interview: senior product designer', { id: id('task'), date: d(-1), time: '15:00', estimateMinutes: 60, priority: 'high', goalId: g2.id, done: true, status: 'completed', completedAt: now - 82000000 }),
    mission('Weekly metrics review with finance', { id: id('task'), date: d(-2), estimateMinutes: 45, done: true, status: 'completed', completedAt: now - 2 * 86400000 }),
    mission('Write the “why now” memo', { id: id('task'), date: d(-3), estimateMinutes: 60, priority: 'high', goalId: g1.id, done: true, status: 'completed', completedAt: now - 3 * 86400000 }),
    mission('Ship the accessibility audit fixes', { id: id('task'), date: d(-4), estimateMinutes: 90, goalId: g2.id, done: true, status: 'completed', completedAt: now - 4 * 86400000 }),
    mission('Long ride — 40km', { id: id('task'), date: d(-5), estimateMinutes: 120, priority: 'low', cat: 'wellbeing', goalId: g4.id, done: true, status: 'completed', completedAt: now - 5 * 86400000 }),
    mission('Plan the Jaipur offsite', { id: id('task'), date: d(2), estimateMinutes: 60, goalId: g2.id, projectId: p3.id, horizon: 'weekly' }),
    mission('Draft the hiring plan for H1', { id: id('task'), date: d(3), estimateMinutes: 90, priority: 'high', goalId: g2.id, horizon: 'weekly' }),
    mission('Book the offsite venue', { id: id('task'), date: d(-2), estimateMinutes: 20, cat: 'life', horizon: 'weekly', deadline: d(1) }),
    mission('Idea: a weekly no-slide strategy hour', { id: id('task'), horizon: 'quick', status: 'not_started', inbox: true }),
    mission('Ask legal about the data-retention policy', { id: id('task'), horizon: 'quick', status: 'not_started', inbox: true, cat: 'work' }),
    mission('Ship v2 of the design system', { id: id('task'), estimateMinutes: 240, priority: 'high', goalId: g3.id, horizon: 'long_term', status: 'in_progress' }),
  ]
  const [t1, t2, t3, , t5, t6] = tasks
  const routines = [
    {
      id: id('routine'),
      title: 'Morning ritual',
      description: 'Water, light, movement, one page.',
      activities: [
        { id: id('act'), title: '500ml water + daylight', minutes: 5 },
        { id: id('act'), title: 'Mobility 10 min', minutes: 10 },
        { id: id('act'), title: 'One page of notes', minutes: 10 },
      ],
      days: [1, 2, 3, 4, 5],
      createdAt: now - 40 * 86400000,
    },
    {
      id: id('routine'),
      title: 'Evening shutdown',
      description: 'Close the loop so tomorrow starts clean.',
      activities: [
        { id: id('act'), title: 'Clear the inbox', minutes: 10 },
        { id: id('act'), title: 'Choose tomorrow’s Top 3', minutes: 5 },
      ],
      days: [1, 2, 3, 4, 5],
      createdAt: now - 40 * 86400000,
    },
  ]
  const scheduleDays = {
    [today]: [
      { id: id('block'), title: 'Board deck — narrative and numbers', time: '09:30', duration: 90, cat: 'work', taskId: t1.id, goalId: g1.id, projectId: p1.id, protected: false, flexible: false, priority: 'high', status: 'planned' },
      { id: id('block'), title: 'Onboarding proposal review', time: '11:30', duration: 45, cat: 'work', taskId: t2.id, goalId: g2.id, projectId: p2.id, protected: false, flexible: true, priority: 'high', status: 'planned' },
      { id: id('block'), title: 'Deep work — scope cut', time: '14:00', duration: 120, cat: 'work', taskId: t3.id, goalId: g1.id, projectId: p1.id, protected: false, flexible: true, priority: 'medium', status: 'planned' },
      { id: id('block'), title: 'Reading', time: '20:30', duration: 30, cat: 'learning', taskId: t5.id, goalId: g3.id, protected: false, flexible: true, priority: 'low', status: 'planned' },
    ],
  }
  const sessions = []
  for (let i = 0; i < 14; i++) {
    const minutes = [50, 25, 40, 50, 25, 50][i % 6]
    sessions.push({
      id: id('focus'),
      taskId: i % 3 === 0 ? t1.id : null,
      categoryId: i % 4 === 0 ? 'learning' : 'work',
      mode: 'focus',
      goalId: i % 4 === 0 ? g3.id : g1.id,
      taskTitle: i % 3 === 0 ? 'Board narrative' : 'Deep work',
      plannedMinutes: minutes,
      focusedSeconds: minutes * 60,
      startedAt: now - i * 86400000 - 3600000,
      endedAt: now - i * 86400000 - 600000,
      status: 'completed',
      date: d(-i),
    })
  }
  const journal = {
    [d(-1)]: {
      note: 'The board narrative finally clicked once I stopped polishing slides and wrote the argument first.',
      win: 'Cut the deck from 24 slides to 9.',
      next: 'Get the review booked before noon.',
      mood: 'good',
      energy: 'high',
      updatedAt: now - 86400000,
    },
    [d(-2)]: {
      note: 'Slow start. Two meetings I did not need, but the metrics review went fine.',
      win: 'Cleared the finance questions.',
      next: 'Protect the morning block.',
      mood: 'steady',
      energy: 'medium',
      updatedAt: now - 2 * 86400000,
    },
    [d(-3)]: {
      note: 'Wrote the “why now” memo in one sitting. This is the kind of work I should do more of.',
      win: 'Memo shipped.',
      next: 'Share it with the leads.',
      mood: 'bright',
      energy: 'high',
      updatedAt: now - 3 * 86400000,
    },
  }
  return {
    goals,
    projects,
    tasks,
    routines,
    scheduleDays,
    focusSessions: sessions,
    journal,
    top3: [t1.id, t6.id, t2.id],
    scoreHistory: Object.fromEntries(
      [d(-6), d(-5), d(-4), d(-3), d(-2), d(-1), today].map((key, i) => [key, [42, 58, 51, 74, 66, 81, 68][i]]),
    ),
    completionLog: { [d(-1)]: 3, [d(-2)]: 2, [d(-3)]: 4, [d(-4)]: 2 },
    settings: {
      userName: 'Aarav Mehta',
      salutation: 'Sir',
      workingHours: { start: '09:00', end: '18:00' },
      focus: { defaultMinutes: 50, breakMinutes: 10, targetMinutes: 180, longBreakMinutes: 20, longBreakEvery: 4, autoCompleteTask: false, autoStartBreaks: false },
    },
    intention: 'Ship the narrative before lunch. Everything else can wait.',
    counts: { goals: goals.length, projects: projects.length, missions: tasks.length, routines: routines.length },
  }
}

/** Copy the demo into a live state object (mutates `state`). */
export function applyDemo(state, demo, { today }) {
  state.goals.push(...demo.goals)
  state.projects.push(...demo.projects)
  state.tasks.push(...demo.tasks)
  state.routines.push(...demo.routines)
  for (const [day, blocks] of Object.entries(demo.scheduleDays)) state.schedule.days[day] = [...(state.schedule.days[day] || []), ...blocks]
  state.focus.sessions.push(...demo.focusSessions)
  for (const [day, entry] of Object.entries(demo.journal)) state.journal[day] = entry
  state.top3[today] = demo.top3
  state.scoreHistory = { ...state.scoreHistory, ...demo.scoreHistory }
  state.completionLog = { ...state.completionLog, ...demo.completionLog }
  state.briefing.intentions[today] = demo.intention
  state.onboarding = { ...(state.onboarding || {}), seen: true, completed: true, preset: 'demo', completedAt: Date.now() }
  state.settings.onboarding = { ...(state.settings.onboarding || {}), seen: true }
  return { applied: true, counts: demo.counts }
}

/** Is this workspace still untouched? Used to decide whether to offer a start. */
export function isFreshWorkspace(state) {
  return (
    !state.tasks.length &&
    !state.goals.length &&
    !state.projects.length &&
    !state.routines.length &&
    !state.focus.sessions.length &&
    !Object.keys(state.completionLog || {}).length &&
    !Object.keys(state.schedule?.days || {}).length
  )
}

export { keyFromDate }
