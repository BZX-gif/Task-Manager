/**
 * A browser environment for the UI integration tests.
 *
 * The DOM is installed as a side effect of importing this module, and must be
 * imported before React DOM, which is why the tests import the app lazily.
 */
import { JSDOM } from 'jsdom'

export const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://voicebill.test/',
  pretendToBeVisual: true,
})

const { window } = dom

const assign = (key: string, value: unknown) => {
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  } catch {
    // Some Node globals are read-only; the app does not need them replaced.
  }
}

assign('window', window)
assign('document', window.document)
assign('navigator', window.navigator)
assign('location', window.location)
assign('history', window.history)
assign('localStorage', window.localStorage)
assign('HTMLElement', window.HTMLElement)
assign('HTMLInputElement', window.HTMLInputElement)
assign('HTMLTextAreaElement', window.HTMLTextAreaElement)
assign('HTMLSelectElement', window.HTMLSelectElement)
assign('Element', window.Element)
assign('Node', window.Node)
assign('Event', window.Event)
assign('CustomEvent', window.CustomEvent)
assign('HashChangeEvent', window.HashChangeEvent)
assign('MouseEvent', window.MouseEvent)
assign('KeyboardEvent', window.KeyboardEvent)
assign('FocusEvent', window.FocusEvent)
assign('Blob', window.Blob)
assign('getComputedStyle', window.getComputedStyle.bind(window))
assign('scrollTo', () => undefined)
window.scrollTo = () => undefined
assign('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0))
assign('cancelAnimationFrame', (handle: number) => clearTimeout(handle))

// React's act() needs to know it is running in a test environment.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
