import { chromium } from 'playwright'
const WEB = 'https://mandate-console-five.vercel.app'
const API = 'https://agent-production-d238.up.railway.app'
const KEY = process.env.MANDATE_API_KEY
const OUT = './footage'

// Pick the strongest hero: a REFUSE that breaches the most rules and was also sold.
const rows = await fetch(`${API}/receipts?limit=50`, { headers: { 'x-console-key': KEY }, signal: AbortSignal.timeout(40000) }).then(r => r.json())
const refuse = rows.rows.filter(r => r.verdict === 'REFUSE').sort((a, b) => (b.cited?.length ?? 0) - (a.cited?.length ?? 0))
const hero = refuse.find(r => r.hasMessage) ?? refuse[0]
const net = rows.rows.find(r => (r.cited ?? []).includes('NET-06'))
console.log('hero refusal :', hero.short, hero.amount, hero.cited.join(','), 'msg=' + hero.hasMessage)
console.log('mainnet refuse:', net?.short, net?.amount, net?.vaultName)

const b = await chromium.launch({ channel: 'chrome' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
const go = async (u) => { for (let i=0;i<3;i++){ try { await p.goto(u,{waitUntil:'domcontentloaded',timeout:120000}); await p.waitForLoadState('networkidle',{timeout:60000}).catch(()=>{}); return } catch { await p.waitForTimeout(4000) } } throw new Error('load '+u) }
const shot = async (n, y=0, s=2400) => { if(y) await p.evaluate(v=>window.scrollTo({top:v,behavior:'instant'}),y); await p.waitForTimeout(s); await p.screenshot({path:`${OUT}/${n}.png`}); console.log('  shot',n) }

await go(`${WEB}/receipts/${hero.id}`); await p.waitForTimeout(5000)
await shot('60-refusal-head', 0, 1400)
await shot('61-refusal-checks', 760)
await shot('62-refusal-why', 1450)
await shot('63-refusal-inputs', 2150)
await shot('64-refusal-hashes', 2900)
await p.evaluate(()=>window.scrollTo({top:0,behavior:'instant'})); await p.waitForTimeout(700)
await p.locator('button:has-text("VERIFY")').first().click(); await p.waitForTimeout(5500); await shot('65-refusal-VERIFIED',0,700)
await p.locator('button:has-text("REPLAY")').first().click(); await p.waitForTimeout(5500); await shot('66-refusal-REPRODUCED',0,700)

await go(`${WEB}/export/${hero.id}`); await p.waitForTimeout(5000)
await shot('70-export-top',0,1400); await shot('71-export-price',700); await shot('72-export-sales',1400)

if (net) { await go(`${WEB}/receipts/${net.id}`); await p.waitForTimeout(5000); await shot('80-mainnet-refusal',0,1400); await shot('81-mainnet-checks',760) }

await b.close()
console.log('\nhero id:', hero.id)
