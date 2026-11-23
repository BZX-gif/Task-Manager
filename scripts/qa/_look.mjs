import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { parseCss, computed, resolveVars, setViewport } from './css.mjs'
const width = Number(process.argv[2] || 1440)
setViewport(width)
const html = await readFile(process.argv[3], 'utf8')
const which = process.argv[4]
const css = parseCss(await readFile('public/static/paper.css','utf8'))
const dom = new JSDOM(html)
const doc = dom.window.document
const el = doc.querySelector(which)
if (!el) { console.log('NOT FOUND', which); process.exit(1) }
const pathOf = (n) => { const p=[]; let x=n; while(x&&x.nodeType===1){p.unshift({tag:x.tagName.toLowerCase(),id:x.id||'',classes:Array.from(x.classList||[]),attrs:Object.fromEntries(Array.from(x.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]))});x=x.parentElement} return p }
const rootPath = [{tag:'html',id:'',classes:Array.from(doc.documentElement.classList||[]),attrs:Object.fromEntries(Array.from(doc.documentElement.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]))}]
const rootDecls = resolveVars(computed(css, rootPath), null, width)
const c = resolveVars(computed(css, pathOf(el)), rootDecls, width)
const keep = ['font-family','font-size','font-style','color','background','background-color','border','border-radius','padding','letter-spacing','text-transform','box-shadow']
for (const k of keep) if (c[k]) console.log(k.padEnd(15), String(c[k]).slice(0,84))
