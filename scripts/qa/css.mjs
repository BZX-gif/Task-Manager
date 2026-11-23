
/** Split a selector list on top-level commas only, so :is(a, b) survives. */
function splitTopLevel(sel) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) { out.push(sel.slice(start, i)); start = i + 1 }
  }
  out.push(sel.slice(start))
  return out
}

export function parseCss(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  const ORDER = []
  function parseBlock(body, media) {
    let i = 0
    while (i < body.length) {
      const open = body.indexOf('{', i)
      if (open < 0) break
      const close = body.indexOf('}', i)
      const sel = body.slice(i, open).trim()
      if (sel.startsWith('@font-face') || sel.startsWith('@keyframes')) {
        let depth = 1, j = open + 1
        while (j < body.length && depth) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; j++ }
        i = j; continue
      }
      if (sel.startsWith('@media')) {
        let depth = 1, j = open + 1
        while (j < body.length && depth) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; j++ }
        parseBlock(body.slice(open + 1, j - 1), sel.replace('@media', '').trim())
        i = j; continue
      }
      if (sel.startsWith('@')) { let depth = 1, j = open + 1; while (j < body.length && depth) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; j++ } i = j; continue }
      const close2 = body.indexOf('}', open)
      const block = body.slice(open + 1, close2)
      const decls = block.split(';').map((d) => d.trim()).filter((d) => d.includes(':'))
      for (const selector of splitTopLevel(sel)) {
        const s = selector.trim()
        if (!s) continue
        const specificity = [0, 0, 0]
        let rest = s
        const ids = (rest.match(/#[\w-]+/g) || []).length; specificity[0] += ids
        const classes = (rest.match(/\.[\w-]+/g) || []).length
        const attrs = (rest.match(/\[[^\]]+\]/g) || []).length
        const pseudos = (rest.match(/:(?!:)[\w-]+(\([^)]*\))?/g) || []).length
        specificity[1] += classes + attrs + pseudos
        rest = rest.replace(/#[\w-]+/g, '').replace(/\.[\w-]+/g, '').replace(/\[[^\]]+\]/g, '').replace(/:[\w-]+(\([^)]*\))?/g, '')
        specificity[2] += (rest.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length
        rules.push({ sel: s, decls, media, specificity })
      }
      i = close2 + 1
    }
  }
  parseBlock(clean, '')
  return rules
}

const MEDIA_WIDTH = { }

function mediaMatches(media) {
  if (!media) return true
  const w = MEDIA_WIDTH.value ?? 1440
  const min = media.match(/min-width:\s*(\d+)px/)
  const max = media.match(/max-width:\s*(\d+)px/)
  let ok = true
  if (min) ok = ok && w >= Number(min[1])
  if (max) ok = ok && w <= Number(max[1])
  if (/prefers-reduced-motion/.test(media)) ok = false
  if (/hover:\s*hover/.test(media)) ok = true
  if (/pointer:\s*coarse/.test(media)) ok = false
  if (/prefers-reduced-transparency/.test(media)) ok = false
  return ok
}

export function setViewport(w) { MEDIA_WIDTH.value = w }

// A tiny matcher for descendant/child/compound selectors against a path array.
function matchesSimple(el, part) {
  if (!el) return false
  const classes = part.match(/\.[\w-]+/g)?.map((c) => c.slice(1)) || []
  const ids = part.match(/#[\w-]+/g)?.map((c) => c.slice(1)) || []
  const attrs = [...part.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]/g)]
  const tag = part.match(/^[a-zA-Z][\w-]*/)?.[0]
  if (tag && el.tag !== tag) return false
  // `:root` matches only the document element. Without this, every element in
  // the path "matched" :root and inherited its declarations, so the audit read
  // the dark tokens on every node and the parchment theme looked broken.
  if (/:root(?![-\w])/.test(part) && !el.isRoot) return false
  for (const id of ids) if (el.id !== id) return false
  for (const c of classes) if (!(el.classes || []).includes(c)) return false
  for (const [, name, value] of attrs) {
    const v = el.attrs?.[name]
    if (v === undefined) return false
    if (value && !String(v).includes(value)) return false
  }
  if (/:not\(/.test(part) && el.classes?.some((c) => part.includes(`.${c}`))) return false
  return true
}

function expandIs(selector) {
  // :is(a, b) is a specificity-neutral list: for matching we test any branch,
  // so expand it into the alternatives and try each.
  let out = [selector]
  for (let guard = 0; guard < 8; guard++) {
    const current = out.find((s) => s.includes(':is('))
    if (!current) break
    const start = current.indexOf(':is(')
    let depth = 0
    let end = -1
    for (let i = start + 3; i < current.length; i++) {
      if (current[i] === '(') depth++
      else if (current[i] === ')') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) break
    const inner = current.slice(start + 4, end)
    const head = current.slice(0, start)
    const tail = current.slice(end + 1)
    out = out.filter((s) => s !== current)
    for (const branch of inner.split(',')) out.push(`${head}${branch.trim()}${tail}`)
  }
  return out
}

function pathMatches(el, path) {
  // path = array from root to element
  const parts = el.selector.split(/\s*>\s*|\s+/).filter(Boolean)
  const combinators = el.selector.split(/\s*([>~+])\s*|\s+/).filter((t) => t && t !== ' ')
  let index = path.length - 1
  for (let i = parts.length - 1; i >= 0; i--) {
    if (i === parts.length - 1) {
      if (!matchesSimple(path[index], parts[i])) return false
      index--
      continue
    }
    // find an ancestor matching parts[i] (descendant semantics; direct `>` is stricter but rare here)
    while (index >= 0 && !matchesSimple(path[index], parts[i])) index--
    if (index < 0) return false
    index--
  }
  return true
}

/** Resolve var()/clamp() tokens against the root declarations. */
export function resolveVars(decls, rootDecls, viewport = 1440, depth = 0) {
  const out = {}
  const lookup = (name, seen) => {
    if (seen.includes(name)) return ''
    if (decls[name] != null && decls[name] !== '') return decls[name]
    if (rootDecls && rootDecls[name] != null && rootDecls[name] !== '') return rootDecls[name]
    return ''
  }
  const sub = (value, seen) => String(value).replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (m, name, fallback) => {
    const v = lookup(name, seen)
    return v === '' ? (fallback ?? '') : sub(v, [...seen, name])
  })
  for (const [k, v] of Object.entries(decls)) {
    let value = sub(v, [])
    if (!value || /var\(/.test(value)) { if (value === '') continue }
    if (value.startsWith('clamp(')) {
      const inner = value.slice(6, -1)
      const parts = inner.split(',')
      const ev = (expr) => {
        const e = String(expr).trim().replace(/(\d*\.?\d+)px/g, '$1').replace(/(\d*\.?\d+)vw/g, (m2, n) => String((Number(n) * viewport) / 100))
        if (!/^[-+*/(). \d]+$/.test(e)) return NaN
        try { return Function(`return (${e})`)() } catch { return NaN }
      }
      const nums = parts.map(ev)
      if (nums.every(Number.isFinite)) value = String(Math.min(Math.max(nums[1], Math.min(nums[0], nums[2])), Math.max(nums[0], nums[2])) ) + 'px'
    }
    out[k] = value
  }
  return out
}

export function computed(rules, path, pseudo = '') {
  const winner = new Map()
  for (const rule of rules) {
    if (!mediaMatches(rule.media)) continue
    const target = { selector: rule.sel.replace(/::?[\w-]+(\([^)]*\))?/g, '').trim(), classes: [], attrs: {} }
    void target
    const el = { selector: rule.sel, ...path[path.length - 1] }
    // state/decoration pseudos never apply to the static frame; :root and
    // :not() do
    const stateful = /:(hover|focus|focus-visible|focus-within|active|first-child|last-child|nth-child\([^)]*\)|disabled|checked|placeholder)/.test(rule.sel) || /::(before|after|placeholder)/.test(rule.sel)
    if (stateful) continue
    const branches = expandIs(rule.sel)
    if (!branches.some((sel) => pathMatches({ ...el, selector: sel }, path))) continue
    for (const decl of rule.decls) {
      const [prop, ...rest] = decl.split(':')
      const value = rest.join(':').trim()
      const prev = winner.get(prop.trim())
      const key = rule.specificity.join(',')
      if (!prev || key >= prev.key) winner.set(prop.trim(), { value, key })
    }
  }
  const out = {}
  for (const [k, v] of winner) out[k] = v.value
  return out
}
