/* -------------------------------------------------------------------------
   SCENES — one original environment for each part of PAPER

   The Command Center keeps its villa (and its three times of day). Everywhere
   else the application opens into a different room of the same house: the
   penthouse at sunrise, the mountain study, the coast, the studio, the terrace,
   the night study, the hotel lounge and the writing room.

   This module is pure: it maps a route to a photograph and supplies the
   editorial copy for that room. Nothing here writes to the store, so the same
   answers can be used by the shell before paint, the renderer and the tests.
   ------------------------------------------------------------------------- */

/** The eight commissioned environments, in the order they appear in PAPER. */
export const SCENES = [
  {
    id: 'villa',
    index: '01',
    view: 'dashboard',
    name: 'Command Center',
    place: 'The villa · above the infinity pool',
    light: 'Morning, afternoon & night',
    welcome: 'A quiet room, a clear view, and everything that needs you today.',
    image: '/images/atmosphere-morning.webp',
    imageSmall: '/images/atmosphere-morning-sm.webp',
  },
  {
    id: 'day',
    index: '02',
    view: 'day',
    name: 'My Day',
    place: 'The penthouse · first light over the city',
    light: 'Sunrise',
    welcome: 'A fresh beginning. Choose three things and let the morning do the rest.',
    image: '/assets/atmospheres/myday/penthouse-sunrise.webp',
    imageSmall: '/assets/atmospheres/myday/penthouse-sunrise-sm.webp',
  },
  {
    id: 'missions',
    index: '03',
    view: 'tasks',
    name: 'Missions',
    place: 'The mountain workspace · above the clouds',
    light: 'Warm morning light',
    welcome: 'Ambition has a view. Every mission here is one deliberate step toward it.',
    image: '/assets/atmospheres/missions/mountain-workspace.webp',
    imageSmall: '/assets/atmospheres/missions/mountain-workspace-sm.webp',
  },
  {
    id: 'goals',
    index: '04',
    view: 'goals',
    name: 'Goals',
    place: 'The coastal villa · horizon over the sea',
    light: 'Open daylight',
    welcome: 'The horizon is the point. Name what you are becoming, then give it a shape.',
    image: '/assets/atmospheres/goals/coastal-villa.webp',
    imageSmall: '/assets/atmospheres/goals/coastal-villa-sm.webp',
  },
  {
    id: 'projects',
    index: '05',
    view: 'projects',
    name: 'Projects',
    place: 'The creative studio · glass and oak',
    light: 'Studio daylight',
    welcome: 'A place for work in progress. Enough structure to move, enough space to think.',
    image: '/assets/atmospheres/projects/creative-studio.webp',
    imageSmall: '/assets/atmospheres/projects/creative-studio-sm.webp',
  },
  {
    id: 'terrace',
    index: '06',
    view: 'calendar',
    name: 'Calendar & Schedule',
    place: 'The resort terrace · above the valley',
    light: 'Soft afternoon light',
    welcome: 'Time, seen from a quieter place. Everything committed, in one composed view.',
    image: '/assets/atmospheres/calendar/resort-terrace.webp',
    imageSmall: '/assets/atmospheres/calendar/resort-terrace-sm.webp',
  },
  {
    id: 'study',
    index: '07',
    view: 'focus',
    name: 'Focus',
    place: 'The private study · one lamp, one task',
    light: 'Lamplight after dark',
    welcome: 'The room is quiet. One thing is enough. Everything else can wait outside.',
    image: '/assets/atmospheres/focus/private-study-night.webp',
    imageSmall: '/assets/atmospheres/focus/private-study-night-sm.webp',
  },
  {
    id: 'lounge',
    index: '08',
    view: 'paper',
    name: 'Daily Briefing',
    place: 'The hotel lounge · morning service',
    light: 'Early sunlight',
    welcome: 'Your private briefing, prepared from your own work. Nothing invented, nothing hidden.',
    image: '/assets/atmospheres/briefing/hotel-lounge-morning.webp',
    imageSmall: '/assets/atmospheres/briefing/hotel-lounge-morning-sm.webp',
  },
  {
    id: 'writing',
    index: '09',
    view: 'journal',
    name: 'Journal',
    place: 'The writing room · late afternoon',
    light: 'Amber afternoon',
    welcome: 'One honest page at the end of the day. What happened, what mattered, what comes next.',
    image: '/assets/atmospheres/journal/writing-room.webp',
    imageSmall: '/assets/atmospheres/journal/writing-room-sm.webp',
  },
]

/** Secondary routes inherit the environment of the room they belong to. */
export const VIEW_SCENE = {
  dashboard: 'villa',
  day: 'day',
  hyb: 'day',
  routines: 'day',
  tasks: 'missions',
  goals: 'goals',
  projects: 'projects',
  calendar: 'terrace',
  schedule: 'terrace',
  focus: 'study',
  paper: 'lounge',
  journal: 'writing',
  review: 'writing',
  progress: 'lounge',
  forecast: 'terrace',
  settings: 'villa',
}

/** The photographic rooms, in the order the layers are preloaded. */
export const SCENE_IDS = SCENES.filter((scene) => scene.id !== 'villa').map((scene) => scene.id)

export function isSceneId(id) {
  return SCENES.some((scene) => scene.id === id)
}

export function sceneForView(view) {
  return VIEW_SCENE[view] || 'villa'
}

export function sceneInfo(id) {
  return SCENES.find((scene) => scene.id === id) || SCENES[0]
}

/**
 * The photograph that belongs to a route. The villa is three photographs at
 * three hours; it is resolved by the atmosphere engine, never by this map.
 */
export function sceneImage(id, atmosphere = 'morning') {
  if (id === 'villa') {
    const file = atmosphere === 'afternoon' ? 'afternoon' : atmosphere === 'evening' ? 'night' : 'morning'
    return {
      image: `/images/atmosphere-${file}.webp`,
      imageSmall: `/images/atmosphere-${file}-sm.webp`,
    }
  }
  const scene = sceneInfo(id)
  return { image: scene.image, imageSmall: scene.imageSmall }
}
