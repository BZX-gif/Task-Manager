import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { parseCss, computed, resolveVars, setViewport } from './css.mjs'
const SHEETS=['style','studio','system','atmosphere','paper','worlds']
const rules=[]
for(const s of SHEETS){ try{ rules.push(...parseCss(await readFile(`public/static/${s}.css`,'utf8'))) }catch{} }
setViewport(1440)
const dom=new JSDOM(await readFile('/tmp/cl_light.html','utf8')); const doc=dom.window.document
const pathOf=(n)=>{const p=[];let x=n;while(x&&x.nodeType===1){p.unshift({tag:x.tagName.toLowerCase(),id:x.id||'',classes:Array.from(x.classList||[]),attrs:Object.fromEntries(Array.from(x.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]))});x=x.parentElement}return p}
const rp=[{tag:'html',id:'',classes:Array.from(doc.documentElement.classList||[]),attrs:Object.fromEntries(Array.from(doc.documentElement.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]))}]
const rootDecls=resolveVars(computed(rules,rp),null,1440)
console.log('theme attr:', doc.documentElement.dataset.theme)
console.log('body paper:', rootDecls['--paper'], '| ink:', rootDecls['--ink'], '| rule:', rootDecls['--rule'])
for(const sel of ['.cal-nav-label strong','.cal-cell-day','.cal-chip','.page-heading h1','.cal-month','.cal-weekdays']){
  const el=doc.querySelector(sel); if(!el){console.log(sel,'MISSING');continue}
  const c=resolveVars(computed(rules,pathOf(el)),rootDecls,1440)
  console.log(sel.padEnd(24), 'color', String(c.color).padEnd(9), 'bg', String(c['background-color']||c.background||'-').slice(0,22))
}
