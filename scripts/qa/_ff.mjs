import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { parseCss, computed, resolveVars, setViewport } from './css.mjs'
setViewport(1440)
const [file, ...sels] = process.argv.slice(2)
const sheets = ['tailwind','style','studio','system','atmosphere','paper']
const all = []
for (const s of sheets) { try { all.push(...parseCss(await readFile(`public/static/${s}.css`,'utf8'))) } catch {} }
const dom = new JSDOM(await readFile(file,'utf8'))
const doc = dom.window.document
const pathOf = (n) => { const p=[]; let x=n; while(x&&x.nodeType===1){p.unshift({tag:x.tagName.toLowerCase(),id:x.id||'',classes:Array.from(x.classList||[]),attrs:Object.fromEntries(Array.from(x.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]))});x=x.parentElement} return p }
const rootPath = [{tag:'html',id:'',classes:Array.from(doc.documentElement.classList||[]),attrs:Object.fromEntries(Array.from(doc.documentElement.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]))}]
const rootDecls = resolveVars(computed(all, rootPath), null, 1440)
for (const sel of sels) {
  const el = doc.querySelector(sel)
  if (!el) { console.log(sel.padEnd(28), 'NOT FOUND'); continue }
  const c = resolveVars(computed(all, pathOf(el)), rootDecls, 1440)
  const fam = String(c['font-family']||'?').replace(/'/g,'')
  console.log(sel.padEnd(28), String(c['font-size']||'-').padEnd(7), fam.slice(0,46))
}
