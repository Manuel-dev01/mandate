/**
 * Re-capture the console plates AND record, for each, the on-screen box of the thing
 * the camera should look at. Boxes are in the plate's own 1920x1080 logical space, so
 * the compositor can frame them exactly instead of me guessing coordinates.
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
const WEB='https://mandate-console-five.vercel.app', API='https://agent-production-d238.up.railway.app'
const KEY=process.env.MANDATE_API_KEY
const OUT='./studio/assets'; mkdirSync(OUT,{recursive:true})

const rows=await fetch(`${API}/receipts?limit=50`,{headers:{'x-console-key':KEY},signal:AbortSignal.timeout(40000)}).then(r=>r.json())
const hero=rows.rows.filter(r=>r.verdict==='REFUSE'&&r.hasMessage).sort((a,b)=>b.cited.length-a.cited.length)[0]
const net=rows.rows.find(r=>(r.cited??[]).includes('NET-06'))

const PLAN=[
  {n:'p-landing',      u:'/',                        y:0,    focus:['The interesting output','REFUSED']},
  {n:'p-stats',        u:'/',                        y:980,  focus:['Receipts','Refused','Reports sold']},
  {n:'p-mandate',      u:'/mandate',                 y:760,  focus:['CON-01','LIQ-03']},
  {n:'p-refusal-head', u:`/receipts/${hero.id}`,     y:0,    focus:['Refused on','REFUSED']},
  {n:'p-refusal-checks',u:`/receipts/${hero.id}`,    y:640,  focus:['ACTUAL / LIMIT','CON-01','LIQ-03']},
  {n:'p-refusal-why',  u:`/receipts/${hero.id}`,     y:1340, focus:["Treasurer's message",'Why']},
  {n:'p-verified',     u:`/receipts/${hero.id}`,     y:0,    focus:['VERIFY'], click:'VERIFY', after:['VERIFIED']},
  {n:'p-replayed',     u:`/receipts/${hero.id}`,     y:0,    focus:['REPLAY'], click2:true, after:['REPRODUCED']},
  {n:'p-export',       u:`/export/${hero.id}`,       y:520,  focus:['USDC per report','Payee']},
  {n:'p-mainnet',      u:`/receipts/${net.id}`,      y:640,  focus:['NET-06','Allowed networks']},
  {n:'p-vaults',       u:'/vaults',                  y:0,    focus:['Five vaults','IXHYB - Robinhood']},
]

const b=await chromium.launch({channel:'chrome'})
const ctx=await b.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:2})
const p=await ctx.newPage()
const go=async u=>{for(let i=0;i<3;i++){try{await p.goto(WEB+u,{waitUntil:'domcontentloaded',timeout:120000});await p.waitForLoadState('networkidle',{timeout:60000}).catch(()=>{});return}catch{await p.waitForTimeout(4000)}}throw new Error(u)}

const boxOf = (texts) => p.evaluate((tt)=>{
  const out={}
  for(const t of tt){
    let best=null
    for(const el of document.querySelectorAll('body *')){
      if(el.children.length>3) continue
      const s=(el.textContent||'').trim()
      if(!s.includes(t)) continue
      const r=el.getBoundingClientRect()
      if(r.width<8||r.height<8) continue
      if(r.bottom<0||r.top>window.innerHeight) continue
      if(!best||r.width*r.height<best.w*best.h) best={x:r.x,y:r.y,w:r.width,h:r.height}
    }
    if(best) out[t]=best
  }
  return out
}, texts)

const manifest={capturedAt:new Date().toISOString(),hero:hero.id,net:net?.id,plates:{}}
for(const s of PLAN){
  await go(s.u); await p.waitForTimeout(5200)
  if(s.y) { await p.evaluate(v=>window.scrollTo({top:v,behavior:'instant'}),s.y); await p.waitForTimeout(1800) }
  if(s.click){ await p.locator(`button:has-text("${s.click}")`).first().click(); await p.waitForTimeout(5200) }
  if(s.click2){ await p.locator('button:has-text("VERIFY")').first().click(); await p.waitForTimeout(4200)
                await p.locator('button:has-text("REPLAY")').first().click(); await p.waitForTimeout(5200) }
  await p.waitForTimeout(900)
  await p.screenshot({path:`${OUT}/${s.n}.png`})
  const focus=await boxOf([...(s.focus||[]),...(s.after||[])])
  manifest.plates[s.n]={url:s.u,scrollY:s.y,focus}
  console.log(s.n, Object.entries(focus).map(([k,v])=>`${k}@${Math.round(v.x)},${Math.round(v.y)} ${Math.round(v.w)}x${Math.round(v.h)}`).join(' | ')||'(no boxes)')
}
await b.close()
writeFileSync('./studio/plates.json',JSON.stringify(manifest,null,2))
console.log('\nhero',hero.short,hero.amount,hero.cited.join(','),'| net',net?.short)
