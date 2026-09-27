/* -------------------------------------------------------------------------
   DEFAULTS — seed data, categories, settings and copy.
   Kept separate from the store so tests and migrations can import them alone.
   ------------------------------------------------------------------------- */

export const STATE_VERSION = 5

export const DEFAULT_CATEGORIES = [
  { id: 'body', name: 'Body & Recovery', color: '#34d399' },
  { id: 'upsc', name: 'UPSC Core', color: '#3b82f6' },
  { id: 'ssc', name: 'SSC · News · CA', color: '#f59e0b' },
  { id: 'ras', name: 'RAS Core', color: '#c084fc' },
  { id: 'meals', name: 'Meals & Rest', color: '#94a3b8' },
]

/**
 * The original pre-v5 schedule — the user's historical UPSC-oriented day.
 * ids are generated at load time (see store.ensureIds).
 * Preserved verbatim as the UPSC CSE 2028 mission's timetable: never replace
 * or restyle these blocks, they are real historical schedule data.
 */
export const DEFAULT_TIMETABLE = [
  { time: '05:00', title: 'Wake up · 500ml water · no phone', cat: 'body', duration: 15 },
  { time: '05:15', title: 'WORKOUT — 45 min (Mon/Wed/Fri strength · Tue/Thu/Sat cardio)', cat: 'body', duration: 45 },
  { time: '06:00', title: 'Cold-ish shower + high-protein breakfast', cat: 'meals', duration: 30 },
  { time: '06:30', title: 'DEEP STUDY BLOCK 1 — hardest subject (2h)', cat: 'upsc', duration: 120 },
  { time: '08:30', title: 'News — The Hindu / Indian Express (45 min)', cat: 'ssc', duration: 45 },
  { time: '09:15', title: 'Bath + light lunch prep + break', cat: 'meals', duration: 45 },
  { time: '10:00', title: 'CLASS 1 (2h) + 10-min instant recall', cat: 'upsc', duration: 130 },
  { time: '12:15', title: 'Lunch (light!) + 20-min power nap', cat: 'meals', duration: 75 },
  { time: '13:30', title: 'CLASS 2 (2h) + 10-min instant recall', cat: 'upsc', duration: 130 },
  { time: '15:45', title: 'Tea + 15-min walk (snack: sprouts/peanuts)', cat: 'meals', duration: 30 },
  { time: '16:15', title: 'CLASS 3 (2h) + 10-min instant recall', cat: 'upsc', duration: 130 },
  { time: '18:30', title: 'REVISION of all 3 classes (90 min)', cat: 'upsc', duration: 90 },
  { time: '20:00', title: 'Dinner — lightest meal, high protein', cat: 'meals', duration: 45 },
  { time: '20:45', title: 'SSC batch (1h) — Maths/Reasoning drill', cat: 'ssc', duration: 60 },
  { time: '21:45', title: 'Current affairs consolidation + PYQ (45 min)', cat: 'ssc', duration: 45 },
  { time: '22:30', title: 'Walk out / stretch 10 min · plan tomorrow\'s 3 tasks', cat: 'body', duration: 30 },
  { time: '23:00', title: 'SLEEP — non-negotiable 6h minimum', cat: 'body', duration: 360 },
]

/**
 * v5 starter timetables. `DEFAULT_TIMETABLE` above is the UPSC-era day and is
 * reused verbatim for the UPSC CSE mission. SSC and RAS get genuinely
 * exam-oriented starter days (still fully editable in the timetable screen):
 * the same realistic routine skeleton — wake, workout, meals, recovery — with
 * study blocks that match what each exam actually demands.
 */
export const SSC_STARTER_TIMETABLE = [
  { time: '05:00', title: 'Wake up · 500ml water · no phone', cat: 'body', duration: 15 },
  { time: '05:15', title: 'WORKOUT — 45 min (Mon/Wed/Fri strength · Tue/Thu/Sat cardio)', cat: 'body', duration: 45 },
  { time: '06:00', title: 'Cold-ish shower + high-protein breakfast', cat: 'meals', duration: 30 },
  { time: '06:30', title: 'QUANTITATIVE APTITUDE — hardest topic first (2h)', cat: 'ssc', duration: 120 },
  { time: '08:30', title: 'Calculation practice — speed maths drill (30 min)', cat: 'ssc', duration: 30 },
  { time: '09:00', title: 'REASONING — topic drill + shortcuts (75 min)', cat: 'ssc', duration: 75 },
  { time: '10:15', title: 'Break — light snack + 10-min walk', cat: 'meals', duration: 15 },
  { time: '10:30', title: 'ENGLISH — Grammar, Vocabulary & Reading Comprehension (75 min)', cat: 'ssc', duration: 75 },
  { time: '11:45', title: 'STATIC GK / GS — Polity · History · Geography · Science (75 min)', cat: 'ssc', duration: 75 },
  { time: '13:00', title: 'Lunch (light!) + 20-min power nap', cat: 'meals', duration: 60 },
  { time: '14:00', title: 'PYQ PRACTICE — previous-year questions, timed (90 min)', cat: 'ssc', duration: 90 },
  { time: '15:30', title: 'Tea + 15-min walk (snack: sprouts/peanuts)', cat: 'meals', duration: 30 },
  { time: '16:00', title: 'SECTIONAL / MOCK PRACTICE — timed test + analysis (105 min)', cat: 'ssc', duration: 105 },
  { time: '17:45', title: 'REVISION — error log & weak areas (60 min)', cat: 'ssc', duration: 60 },
  { time: '18:45', title: 'Current affairs — daily news + CA notes (45 min)', cat: 'ssc', duration: 45 },
  { time: '19:30', title: 'Dinner — lightest meal, high protein', cat: 'meals', duration: 45 },
  { time: '20:15', title: 'Formula recap + flashcards (45 min)', cat: 'ssc', duration: 45 },
  { time: '21:00', title: 'Walk out / stretch 10 min · plan tomorrow\'s 3 tasks', cat: 'body', duration: 30 },
  { time: '21:45', title: 'Wind-down — no phone, tomorrow\'s material ready', cat: 'body', duration: 30 },
  { time: '22:30', title: 'SLEEP — non-negotiable 6h minimum', cat: 'body', duration: 390 },
]

export const RAS_STARTER_TIMETABLE = [
  { time: '05:00', title: 'Wake up · 500ml water · no phone', cat: 'body', duration: 15 },
  { time: '05:15', title: 'WORKOUT — 45 min (strength · cardio mix)', cat: 'body', duration: 45 },
  { time: '06:00', title: 'Cold-ish shower + high-protein breakfast', cat: 'meals', duration: 30 },
  { time: '06:30', title: 'RAJASTHAN GK — History · Culture · Art & Heritage (2h)', cat: 'ras', duration: 120 },
  { time: '08:30', title: 'RAJASTHAN GEOGRAPHY — land, rivers, climate, agriculture (75 min)', cat: 'ras', duration: 75 },
  { time: '09:45', title: 'Break — light snack + 10-min walk', cat: 'meals', duration: 15 },
  { time: '10:00', title: 'POLITY — Indian Constitution + Rajasthan polity (75 min)', cat: 'ras', duration: 75 },
  { time: '11:15', title: 'GENERAL SCIENCE — Physics · Chemistry · Biology basics (60 min)', cat: 'ras', duration: 60 },
  { time: '12:15', title: 'Lunch (light!) + 20-min power nap', cat: 'meals', duration: 60 },
  { time: '13:15', title: 'QUANTITATIVE APTITUDE + REASONING — prelims drill (75 min)', cat: 'ras', duration: 75 },
  { time: '14:30', title: 'PYQ PRACTICE — RPSC previous-year papers, timed (75 min)', cat: 'ras', duration: 75 },
  { time: '15:45', title: 'Tea + 15-min walk (snack: sprouts/peanuts)', cat: 'meals', duration: 30 },
  { time: '16:15', title: 'MOCK / SECTIONAL TEST — timed paper + analysis (90 min)', cat: 'ras', duration: 90 },
  { time: '17:45', title: 'ANSWER WRITING — mains-style answers (60 min)', cat: 'ras', duration: 60 },
  { time: '18:45', title: 'REVISION — Rajasthan notes recap + error log (45 min)', cat: 'ras', duration: 45 },
  { time: '19:30', title: 'Dinner — lightest meal, high protein', cat: 'meals', duration: 45 },
  { time: '20:15', title: 'Rajasthan current affairs — news, schemes & government policies (45 min)', cat: 'ras', duration: 45 },
  { time: '21:00', title: 'English / Hindi comprehension + vocabulary (30 min)', cat: 'ras', duration: 30 },
  { time: '21:45', title: 'Walk out / stretch 10 min · plan tomorrow\'s 3 tasks', cat: 'body', duration: 30 },
  { time: '22:30', title: 'SLEEP — non-negotiable 6h minimum', cat: 'body', duration: 390 },
]

/** Which starter day each mission begins (and migrates) with. */
export const MISSION_STARTER_TIMETABLES = {
  ssc_cgl_2027: SSC_STARTER_TIMETABLE,
  ras_2028: RAS_STARTER_TIMETABLE,
  upsc_cse_2028: DEFAULT_TIMETABLE,
}

export function starterTimetableFor(missionId) {
  return MISSION_STARTER_TIMETABLES[missionId] || DEFAULT_TIMETABLE
}

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  userName: 'Kulshresth',
  /** weekly review + analytics start Monday */
  weekStart: 1,
  /** day boundary used by the recovery planner / focus day rollover */
  dayEnd: '23:30',
  focus: {
    defaultMinutes: 25,
    breakMinutes: 5,
    /** minutes of deep focus that count as a "full" focus day (daily score) */
    targetMinutes: 180,
    autoCompleteTask: true,
  },
  reminders: {
    enabled: true,
    /** minutes before a timetable block starts */
    beforeMinutes: 10,
    timetable: true,
    taskDue: true,
    overdue: true,
    /** evening nudge when the Top 3 is not finished (empty string disables) */
    top3NudgeAt: '20:30',
    desktopNotifications: false,
    respectProtectedTime: true,
  },
  /** optional protected / sleep windows the scheduler must avoid */
  protectedTime: [],
  /** one-time flags */
  onboarding: { seen: false },
}

export const FOCUS_PRESETS = [25, 50, 90]
export const BREAK_PRESETS = [5, 10, 15]

export const MOTIVATIONAL_QUOTES = [
  'Discipline is choosing between what you want now and what you want most.',
  'The pain of discipline weighs ounces; the pain of regret weighs tons.',
  "You don't have to be great to start, but you have to start to be great.",
  'Every hour you waste today is an hour someone else uses to beat you tomorrow.',
  'Success is the sum of small efforts repeated day in and day out.',
  "The exam doesn't test what you know. It tests what you do when you don't know.",
  'Dream big. Start small. Act now.',
  'Your future is created by what you do today, not tomorrow.',
  'Consistency beats intensity. Show up every single day.',
  'There is no elevator to success — you have to take the stairs.',
  "It always seems impossible until it's done.",
  'The comeback is always stronger than the setback.',
  'Small daily improvements lead to staggering long-term results.',
  "Don't stop when you're tired. Stop when you're done.",
  "The difference between ordinary and extraordinary is that little 'extra'.",
  'You are your only limit.',
  'Push yourself, because no one else is going to do it for you.',
  'Great things never came from comfort zones.',
  'Wake up with determination, go to bed with satisfaction.',
  'Focus on being productive instead of busy.',
  "One more page, one more question, one more rep — that's how legends are built.",
  'The crown belongs to those who out-work everyone else, quietly.',
  'Champions keep playing until they get it right.',
  'Your only competition is who you were yesterday.',
  'Hard days build strong toppers.',
]

export const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }
export const PRIORITY_COLORS = { high: '#fb7185', medium: '#fbbf24', low: '#60a5fa' }
