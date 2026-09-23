#!/usr/bin/env node
/**
 * Console smoke — zero dependencies. Hits the agent API and the web console and asserts
 * each route answers 200 with a sentinel from real data.
 *
 *   node scripts/web-smoke.mjs                       # API :8787, web :3000
 *   API=https://<railway>.up.railway.app WEB=https://<vercel>.vercel.app node scripts/web-smoke.mjs
 */

const API = (process.env.API ?? 'http://localhost:8787').replace(/\/+$/, '')
const WEB = (process.env.WEB ?? 'http://localhost:3000').replace(/\/+$/, '')
const KEY = process.env.MANDATE_API_KEY

let failed = 0
const ok = (name, detail) => console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
const bad = (name, detail) => {
  failed++
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

async function get(url, text = false) {
  const res = await fetch(url, { headers: KEY ? { 'x-console-key': KEY } : {}, redirect: 'follow' })
  const body = text ? await res.text() : await res.json().catch(() => null)
  return { status: res.status, body }
}

console.log(`\nAPI ${API}`)
let head = null
try {
  const h = await get(`${API}/health`)
  h.status === 200 && h.body?.ok ? ok('/health', `${h.body.receipts} receipts · telegram ${h.body.telegram?.state ?? 'none'}`) : bad('/health', `${h.status}`)
  head = h.body?.head ?? null
  const s = await get(`${API}/stats`)
  s.status === 200 && typeof s.body?.receipts === 'number' ? ok('/stats', `${s.body.refused} refused · ${s.body.breaks} breaks`) : bad('/stats', `${s.status}`)
  const l = await get(`${API}/receipts?limit=3`)
  l.status === 200 && Array.isArray(l.body?.rows) ? ok('/receipts', `${l.body.rows.length} rows`) : bad('/receipts', `${l.status}`)
  const m = await get(`${API}/mandate`)
  m.status === 200 ? ok('/mandate', m.body.empty ? 'empty' : `${m.body.mandate.rules.length} rules · ${m.body.mandate.hash.slice(0, 12)}`) : bad('/mandate', `${m.status}`)
  const v = await get(`${API}/vaults`)
  v.status === 200 && Array.isArray(v.body?.vaults) ? ok('/vaults', `${v.body.vaults.length} vaults · ${v.body.stale ? 'STALE' : 'live'}`) : bad('/vaults', `${v.status}`)
  const x = await get(`${API}/x402`)
  x.status === 200 && x.body?.service?.price
    ? ok('/x402', `${x.body.service.price} USDC on ${x.body.service.network} · ${x.body.sales.sold} sold · identity ${x.body.identity.registered ? x.body.identity.agentId : 'not registered'}`)
    : bad('/x402', `${x.status}`)
  if (head) {
    const r = await get(`${API}/receipts/${head}`)
    r.status === 200 && r.body?.checks?.length === 7 ? ok('/receipts/:id', `${r.body.headline} · ${r.body.action.amount}`) : bad('/receipts/:id', `${r.status}`)
    const vf = await get(`${API}/receipts/${head}/verify`)
    vf.status === 200 && vf.body?.verify?.ok && vf.body?.replay?.reproduced ? ok('/receipts/:id/verify', 'verified + reproduced') : bad('/receipts/:id/verify', JSON.stringify(vf.body).slice(0, 120))
    const gated = await fetch(`${API}/receipts/${head}/report`)
    const challenge = await gated.json().catch(() => null)
    gated.status === 402 && challenge?.accepts?.[0]?.network
      ? ok('/receipts/:id/report', `402 · ${challenge.accepts[0].maxAmountRequired} base units on ${challenge.accepts[0].network}`)
      : bad('/receipts/:id/report', `expected 402, got ${gated.status}`)
    const rp = await get(`${API}/receipts/${head}/report?preview=1`, true)
    rp.status === 200 && rp.body.startsWith('# Mandate decision receipt') && rp.body.includes('over x402')
      ? ok('/receipts/:id/report?preview=1', `${rp.body.length} chars, labelled`)
      : bad('/receipts/:id/report?preview=1', `${rp.status}`)
  }
} catch (err) {
  bad('api', err.message)
}

console.log(`\nWEB ${WEB}`)
const pages = [
  ['/', 'The interesting output'],
  ['/chain', 'Receipt chain'],
  ['/mandate', 'Compiled mandate'],
  ['/vaults', 'Vault universe'],
  ...(head ? [[`/receipts/${head}`, 'RCPT'], [`/export/${head}`, 'One decision, sold as its proof']] : []),
]
for (const [path, sentinel] of pages) {
  try {
    const r = await get(`${WEB}${path}`, true)
    r.status === 200 && r.body.includes(sentinel) ? ok(path) : bad(path, `${r.status}${r.status === 200 ? ` · missing "${sentinel}"` : ''}`)
    if (r.status === 200 && /Console fault|Application error/.test(r.body)) bad(path, 'error boundary rendered')
  } catch (err) {
    bad(path, err.message)
  }
}

// The console is opened on phones. scripts/overflow-check.mjs drives Chrome over
// CDP, so it lives apart from this dependency-free smoke; point at it rather than
// let a green smoke imply the phone was checked.
console.log('\nPHONE  node scripts/overflow-check.mjs  — asserts no route scrolls sideways at 390px')

console.log(failed ? `\n${failed} failed\n` : '\nall good\n')
process.exit(failed ? 1 : 0)
