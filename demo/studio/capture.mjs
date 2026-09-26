/**
 * Capture real footage of the DEPLOYED console for the product demo.
 *
 * 1920x1080 viewport at deviceScaleFactor 2 -> 3840x2160 stills, so the edit can
 * push in to 2x and stay sharp at 1080p. Every frame is the live product; the only
 * interactions driven here (VERIFY, REPLAY, the chain filters) are real clicks
 * against the real API.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const WEB = process.env.WEB ?? 'https://mandate-console-five.vercel.app'
const API = process.env.API ?? 'https://agent-production-d238.up.railway.app'
const OUT = process.env.OUT ?? './footage'
mkdirSync(OUT, { recursive: true })

let head = null
for (let i = 0; i < 3 && !head; i++) {
  head = await fetch(`${API}/health`, { signal: AbortSignal.timeout(25_000) }).then((r) => r.json()).then((h) => h.head).catch(() => null)
  if (!head) await new Promise((r) => setTimeout(r, 3000))
}
if (!head) throw new Error('no head from /health — cannot capture receipt shots')
console.log('head receipt:', head.slice(0, 12))

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const log = []

async function go(url) {
  for (let a = 0; a < 3; a++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
      return
    } catch { await page.waitForTimeout(4000) }
  }
  throw new Error(`could not load ${url}`)
}

async function shot(name, { scrollTo = 0, settle = 2600 } = {}) {
  if (scrollTo) await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), scrollTo)
  await page.waitForTimeout(settle)
  const file = `${OUT}/${name}.png`
  await page.screenshot({ path: file })
  log.push({ name, url: page.url(), scrollTo })
  console.log('  shot', name)
}

// ---- landing: let the paper receipt finish printing before the first frame
await go(WEB + '/')
await page.waitForTimeout(6000)
await shot('01-landing-hero', { settle: 1200 })
await shot('02-landing-stats', { scrollTo: 900 })
await shot('03-landing-telegram', { scrollTo: 1750 })
await shot('04-landing-mandate', { scrollTo: 2700 })
await shot('05-landing-foot', { scrollTo: 3600 })

// ---- chain
await go(WEB + '/chain')
await page.waitForTimeout(5000)
await shot('10-chain-top', { settle: 1200 })
await shot('11-chain-rules', { scrollTo: 700 })
await shot('12-chain-rows', { scrollTo: 1400 })

// ---- receipt: the seven checks, then two REAL interactions
await go(WEB + `/receipts/${head}`)
await page.waitForTimeout(5000)
await shot('20-receipt-head', { settle: 1200 })
await shot('21-receipt-checks', { scrollTo: 780 })
await shot('22-receipt-inputs', { scrollTo: 1500 })
await shot('23-receipt-hashes', { scrollTo: 2300 })

await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
await page.waitForTimeout(800)
const verify = page.locator('button:has-text("VERIFY")').first()
if (await verify.count()) {
  await verify.click()
  await page.waitForTimeout(5000)
  await shot('24-receipt-VERIFIED', { settle: 800 })
} else console.log('  !! VERIFY button not found')

const replay = page.locator('button:has-text("REPLAY")').first()
if (await replay.count()) {
  await replay.click()
  await page.waitForTimeout(5000)
  await shot('25-receipt-REPRODUCED', { settle: 800 })
} else console.log('  !! REPLAY button not found')

// ---- mandate provenance
await go(WEB + '/mandate')
await page.waitForTimeout(5000)
await shot('30-mandate-top', { settle: 1200 })
await shot('31-mandate-rules', { scrollTo: 800 })

// ---- vaults
await go(WEB + '/vaults')
await page.waitForTimeout(5000)
await shot('40-vaults', { settle: 1200 })
await shot('41-vaults-foot', { scrollTo: 600 })

// ---- the paywall page
await go(WEB + `/export/${head}`)
await page.waitForTimeout(5000)
await shot('50-export-top', { settle: 1200 })
await shot('51-export-price', { scrollTo: 700 })
await shot('52-export-sales', { scrollTo: 1400 })

await browser.close()
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ capturedAt: new Date().toISOString(), web: WEB, head, shots: log }, null, 2))
console.log(`\n${log.length} frames -> ${OUT}`)
