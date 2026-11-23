import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'
const root=process.cwd()
const worker=(await import(path.join(root,'dist','index.js'))).default
const shell=await(await worker.request('/')).text()
const bundle=await readFile(path.join(root,'public','static','js','app.js'),'utf8')
const vc=new VirtualConsole(); vc.on('jsdomError',e=>console.log('ERR',e.message))
const dom=new JSDOM(shell,{url:'https://command-center.test/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc})
const {window}=dom
window.fetch=async()=>new Response('{"text":"ok"}',{status:200})
window.matchMedia=window.matchMedia||((q)=>({matches:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}))
window.scrollTo=()=>{}; window.HTMLCanvasElement.prototype.getContext=()=>null
window.eval(bundle); await new Promise(r=>setTimeout(r,600))
window.CC.openTaskModal()
await new Promise(r=>setTimeout(r,300))
const d=window.document
// find whatever container appeared
for (const sel of ['.modal-backdrop','#modal','.modal-root','[class*="modal"]','[class*="overlay"]']) {
  const els=d.querySelectorAll(sel)
  if(els.length) console.log(sel, els.length, els[0].className)
}
const form=d.querySelector('#task-form')
console.log('task-form:', !!form)
if(form){
  console.log('label count:', form.querySelectorAll('.field-label').length)
  console.log('inputs:', form.querySelectorAll('input,select,textarea').length)
  const labs=[...form.querySelectorAll('.field-label')].map(l=>l.textContent.trim()).filter(Boolean)
  console.log('fields:', labs.join(' · '))
}
