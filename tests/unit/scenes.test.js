/**
 * The world map is a contract: eight named sections, eight different original
 * photographs, one persistent navigation. These are the exact assertions —
 * the ones that can be decided without a browser.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  SCENES, SCENE_IDS, VIEW_SCENE, isSceneId, sceneForView, sceneImage, sceneInfo,
} from '../../src/client/lib/scenes.js'

const root = process.cwd()
const shell = await readFile(path.join(root, 'src', 'shell.ts'), 'utf8')
const sw = await readFile(path.join(root, 'public', 'sw.js'), 'utf8')
const css = await readFile(path.join(root, 'public', 'static', 'worlds.css'), 'utf8')

test('every named environment exists and has a distinct original photograph', () => {
  const named = SCENES.filter((scene) => scene.id !== 'villa')
  assert.equal(named.length, 8)
  const images = named.map((scene) => scene.image)
  assert.equal(new Set(images).size, images.length, 'no photograph is reused between sections')
  const smalls = named.map((scene) => scene.imageSmall)
  assert.equal(new Set(smalls).size, smalls.length, 'the first-paint files are distinct too')
  for (const scene of named) {
    assert.match(scene.image, /^\/assets\/atmospheres\/[\w-]+\/[\w-]+\.webp$/)
    assert.ok(scene.place.length > 12, `${scene.id} names its room`)
    assert.ok(scene.welcome.length > 30, `${scene.id} has contextual copy`)
    assert.ok(scene.light.length > 5, `${scene.id} names its light`)
    assert.equal(isSceneId(scene.id), true)
  }
  assert.equal(isSceneId('not-a-room'), false)
})

test('the eight photographs ship in two optimised WebP widths', async () => {
  for (const scene of SCENES.filter((entry) => entry.id !== 'villa')) {
    for (const file of [scene.image, scene.imageSmall]) {
      const info = await stat(path.join(root, 'public', file)).catch(() => null)
      assert.ok(info && info.size > 30_000, `${file} is a real photograph`)
    }
    const full = (await stat(path.join(root, 'public', scene.image))).size
    const small = (await stat(path.join(root, 'public', scene.imageSmall))).size
    assert.ok(full < 420_000, `${scene.id} full frame stays under 420 kB (${Math.round(full / 1024)} kB)`)
    assert.ok(small < 160_000, `${scene.id} first frame stays under 160 kB`)
    assert.ok(small < full, 'and the small frame is genuinely smaller')
    assert.ok(sw.includes(scene.imageSmall), `${scene.id} is available offline`)
  }
})

test('all sixteen routes resolve to a room, with the villa kept for the Command Center', () => {
  const named = ['day', 'tasks', 'goals', 'projects', 'calendar', 'focus', 'paper']
  for (const route of named) {
    assert.equal(isSceneId(sceneForView(route)), true, `${route} has a commissioned room`)
    assert.notEqual(sceneForView(route), 'villa', `${route} does not reuse the villa`)
  }
  assert.equal(sceneForView('dashboard'), 'villa')
  assert.equal(sceneForView('nonsense'), 'villa')
  assert.equal(Object.keys(VIEW_SCENE).length, 16, 'every CLIENT route is mapped')
  assert.equal(sceneInfo('nope').id, 'villa', 'an unknown room falls back safely')
  const villa = sceneImage('villa', 'evening')
  assert.match(villa.image, /atmosphere-night\.webp$/, 'the villa still honours its time of day')
  assert.match(sceneImage('villa', 'afternoon').image, /atmosphere-afternoon\.webp$/)
})

test('the shell selects and preloads the room before the first paint', () => {
  const head = shell.slice(shell.indexOf('<head>'), shell.indexOf('</head>'))
  assert.match(head, /dataset\.scene=/, 'the room is on the root element before CSS paints')
  assert.match(head, /SCENE=\{/, 'the route-to-room map is in the inline bootstrap')
  assert.match(head, /penthouse-sunrise-sm\.webp/, 'the sunrise penthouse is preloaded')
  assert.match(head, /private-study-night-sm\.webp/, 'the night study is preloaded')
  assert.doesNotMatch(head, /fonts\.(googleapis|gstatic)\.com/, 'no remote type')
  const links = [...shell.matchAll(/href="\/static\/([\w-]+)\.css"/g)].map((m) => m[1])
  assert.equal(links[links.length - 1], 'worlds', 'the world sheet is the final word in the cascade')
  assert.ok(sw.includes('/static/worlds.css'), 'and it is precached for offline use')
})

test('the world sheet is a glass system, not eight copies of a card grid', () => {
  assert.match(css, /backdrop-filter:blur\(var\(--glass-blur\)\)/, 'panels blur the photograph')
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/, 'reduced motion is honoured')
  assert.match(css, /@media \(max-width:767px\)/, 'the composition is rebuilt on phones')
  for (const scene of SCENE_IDS) {
    assert.ok(css.includes(`data-scene=${scene}`), `${scene} has its own grade / first frame`)
  }
  for (const route of ['view-day', 'view-tasks', 'view-goals', 'view-projects', 'view-calendar', 'view-focus', 'view-paper']) {
    assert.ok(css.includes(`#${route} `), `${route} has its own composition`)
  }
  assert.doesNotMatch(css, /background-image:url\('\/images\/atmosphere/, 'the villa is never duplicated into the scene layers')
})
