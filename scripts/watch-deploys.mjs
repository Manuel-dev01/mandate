#!/usr/bin/env node
/**
 * Watch both deployments and print one line whenever something changes state.
 * Zero dependencies. Prints only transitions and failures, so a quiet run is silence.
 *
 *   node scripts/watch-deploys.mjs                 # runs until stopped
 *   INTERVAL=30 node scripts/watch-deploys.mjs     # seconds between checks (default 60)
 */

const API = (process.env.API ?? 'https://agent-production-d238.up.railway.app').replace(/\/+$/, '')
const WEB = (process.env.WEB ?? 'https://mandate-console-five.vercel.app').replace(/\/+$/, '')
const INTERVAL = Number(process.env.INTERVAL ?? 60) * 1000
// /stats is behind the console key when the agent sets one; /health never is.
const KEY = process.env.MANDATE_API_KEY
const stamp = () => new Date().toISOString().slice(11, 19) + 'Z'

async function probe(name, url, check) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 20_000)
    const res = await fetch(url, { signal: ctrl.signal, headers: KEY ? { 'x-console-key': KEY } : {} }).finally(() => clearTimeout(t))
    return await check(res)
  } catch (err) {
    return { ok: false, detail: err.name === 'AbortError' ? 'timed out' : err.message }
  }
}

const agent = () =>
  probe('agent', `${API}/health`, async (res) => {
    if (!res.ok) return { ok: false, detail: `health ${res.status}` }
    const j = await res.json()
    const tg = j.telegram?.state ?? 'none'
    return { ok: tg === 'polling', detail: `telegram ${tg} · ${j.receipts} receipts · up ${j.uptimeSeconds}s${j.telegram?.lastError ? ` · ${j.telegram.lastError.slice(0, 60)}` : ''}` }
  })

const console_ = () =>
  probe('console', `${WEB}/`, async (res) => ({ ok: res.ok, detail: `${res.status}` }))

const paywall = () =>
  probe('paywall', `${API}/stats`, async (res) => {
    if (res.status === 401) return { ok: true, detail: 'stats need MANDATE_API_KEY — skipping the ledger check' }
    if (!res.ok) return { ok: false, detail: `stats ${res.status}` }
    const j = await res.json()
    return { ok: true, detail: `${j.receipts} receipts · ${j.sold} sold · ${j.breaks} chain breaks` }
  })

const last = new Map()
async function tick() {
  for (const [name, fn] of [['agent', agent], ['console', console_], ['ledger', paywall]]) {
    const r = await fn()
    const key = `${r.ok}|${r.detail}`
    if (last.get(name) !== key) {
      console.log(`${stamp()} ${r.ok ? '✓' : '✗'} ${name.padEnd(8)} ${r.detail}`)
      last.set(name, key)
    }
  }
}

console.log(`${stamp()} watching ${API} and ${WEB} every ${INTERVAL / 1000}s — only changes are printed`)
await tick()
setInterval(tick, INTERVAL)
