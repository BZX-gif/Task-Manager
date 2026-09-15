/* -------------------------------------------------------------------------
   TINY EVENT BUS — lets UI modules talk without circular imports
   Events: 'store:change' | 'focus:tick' | 'view:changed' | 'reminder'
   ------------------------------------------------------------------------- */

const handlers = new Map()

export function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, new Set())
  handlers.get(event).add(handler)
  return () => handlers.get(event)?.delete(handler)
}

export function emit(event, detail) {
  const set = handlers.get(event)
  if (!set) return
  for (const handler of set) {
    try {
      handler(detail)
    } catch (error) {
      console.error(`[bus] handler for "${event}" failed`, error)
    }
  }
}
