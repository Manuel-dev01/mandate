import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const b = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] })
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage()
p.on('pageerror', e => console.error('PAGE ERROR:', e.message))
await p.goto(pathToFileURL(resolve('studio.html')).href, { waitUntil: 'load' })
await p.waitForFunction(() => typeof window.drawAt === 'function')
await p.evaluate(async () => { const u=[...new Set(window.__TIMELINE__.scenes.filter(s=>s.plate).map(s=>'assets/'+s.plate))]; await Promise.all(u.map(x=>new Promise(r=>{const i=new Image();i.onload=i.onerror=r;i.src=x}))) })
for (const t of process.argv.slice(2).map(Number)) {
  await p.evaluate(tt => window.drawAt(tt), t)
  await p.waitForTimeout(260)
  await p.screenshot({ path: `still-${String(t).padStart(3,'0')}.png` })
  console.log('still at', t + 's')
}
await b.close()
