#!/usr/bin/env node
/**
 * Preflight — the things that must be true before a rehearsal run or a take.
 *
 * Zero dependencies, like the other scripts here. It defaults to the DEPLOYED
 * services, because that is what a run is against; point it elsewhere with API
 * and WEB. It buys nothing and writes nothing: the paywall check reads the 402
 * challenge, which costs neither money nor a ledger line.
 *
 *   MANDATE_API_KEY=… node scripts/preflight.mjs
 *   API=http://localhost:8787 WEB=http://localhost:3000 node scripts/preflight.mjs
 *   SKIP_PHONE=1 node scripts/preflight.mjs          # skip the Chrome/CDP pass
 *
 * The console key lives in .env as CONSOLE_API_KEY_RAILWAY.
 */

import { spawn } from 'node:child_process'

const API = (process.env.API ?? 'https://agent-production-d238.up.railway.app').replace(/\/+$/, '')
const WEB = (process.env.WEB ?? 'https://mandate-console-five.vercel.app').replace(/\/+$/, '')
const KEY = process.env.MANDATE_API_KEY
const FACILITATOR = (process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator').replace(/\/+$/, '')
const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'
/** Base Sepolia USDC, and the rehearsal buyer from RECON §6.15 — a burner, address only. */
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const BUYER = process.env.BUYER_ADDRESS ?? '0x20fAd5B53f16A61B86e71580D959008899fA82CE'
const PRICE = Number(process.env.X402_PRICE_USDC ?? '0.50')

let failed = 0
let warned = 0
const ok = (name, detail) => console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`)
const bad = (name, detail) => {
  failed++
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}
const warn = (name, detail) => {
  warned++
  console.log(`  warn  ${name}${detail ? ` — ${detail}` : ''}`)
}
const section = (title) => console.log(`\n${title}`)

async function get(url, { text = false, key = true, timeoutMs = 30_000 } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(url, { headers: key && KEY ? { 'x-console-key': KEY } : {}, signal: ctl.signal, redirect: 'follow' })
    const body = text ? await res.text() : await res.json().catch(() => null)
    return { status: res.status, body, ms: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

console.log(`\nPREFLIGHT\n  agent   ${API}\n  console ${WEB}`)

// ------------------------------------------------------------------- the agent
section('AGENT')
let head = null
try {
  const h = await get(`${API}/health`, { key: false })
  const health = h.body
  if (h.status !== 200 || !health?.ok) {
    bad('reachable', `${h.status}`)
  } else {
    head = health.head ?? null
    ok('reachable', `${health.receipts} receipts · up ${health.uptimeSeconds}s`)

    // A second poller anywhere in the world shows up here as a Conflict.
    const tg = health.telegram ?? {}
    const sincePoll = tg.lastPollAt ? (Date.parse(health.now) - Date.parse(tg.lastPollAt)) / 1000 : null
    if (tg.state !== 'polling') bad('telegram polling', `state ${tg.state ?? 'unknown'}`)
    else if (tg.lastError) bad('telegram polling', `lastError ${tg.lastError} — is a second serve running?`)
    else if (sincePoll !== null && sincePoll > 60) bad('telegram polling', `last poll ${Math.round(sincePoll)}s ago`)
    else ok('telegram polling', `@${tg.username} · last poll ${sincePoll === null ? '?' : Math.round(sincePoll)}s ago`)

    // Beat 5 says the report is also listed on OpenServ. That claim needs the tunnel up.
    const os = health.openserv ?? {}
    if (os.state === 'connected') ok('openserv rail', 'connected')
    else warn('openserv rail', `state ${os.state}${os.note ? ` (${os.note})` : ''} — the "also listed" line is unbacked`)

    if (!head) bad('receipt chain', 'empty — beats 3 and 4 have nothing to open')
  }
} catch (err) {
  bad('reachable', err.message)
}

// ------------------------------------------------------------------ live facts
section('FACTS')
if (!KEY) {
  warn('vault universe', 'set MANDATE_API_KEY (CONSOLE_API_KEY_RAILWAY in .env) to check staleness')
} else {
  try {
    const v = await get(`${API}/vaults`)
    if (v.status !== 200 || !Array.isArray(v.body?.vaults)) {
      bad('vault universe', `${v.status}`)
    } else {
      const { vaults, stale, source, chains } = v.body
      if (vaults.length !== 5) bad('vault universe', `${vaults.length} vaults, expected 5`)
      else ok('vault universe', `5 vaults · ${chains} chains · source ${source}`)

      // Stale facts mean whitelist_required fails closed and beat 2's ALLOW turns
      // into a REFUSE (RECON §6.17). This is the check most likely to ruin a take.
      if (stale) {
        const which = vaults.filter((x) => x.stale).map((x) => x.name).join(', ')
        bad('facts are live', `STALE (${which}) — beat 2 would refuse on "could not verify"`)
      } else {
        ok('facts are live', `fetched ${v.body.fetchedAt}`)
      }

      const rh = vaults.find((x) => x.chainId === 4663)
      if (!rh) bad('robinhood vault', 'missing — beat 6 has nothing to refuse')
      else ok('robinhood vault', `${rh.name} · ${rh.tvl ?? 'no tvl'} · ${v.body.mainnetRefusals} refusals so far`)
    }
  } catch (err) {
    bad('vault universe', err.message)
  }
}

// ------------------------------------------------------------------- the money
section('MONEY')
try {
  const f = await get(`${FACILITATOR}/supported`, { key: false, timeoutMs: 20_000 })
  const kinds = f.body?.kinds ?? []
  const net = kinds.some((k) => k.network === 'eip155:84532')
  net ? ok('facilitator', `up · ${kinds.length} kinds on Base Sepolia`) : bad('facilitator', 'Base Sepolia not offered — beat 5 cannot settle')
} catch (err) {
  bad('facilitator', `${err.message} — beat 5 cannot settle`)
}

try {
  // balanceOf(address). The buyer needs USDC and no ETH — the facilitator pays gas.
  const data = `0x70a08231${BUYER.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDC, data }, 'latest'] }),
  })
  const out = await res.json()
  if (out.error) throw new Error(out.error.message)
  const usdc = Number(BigInt(out.result)) / 1e6
  const buys = Math.floor(usdc / PRICE)
  if (usdc < PRICE) bad('buyer funded', `${usdc.toFixed(2)} USDC — cannot cover one ${PRICE.toFixed(2)} report`)
  else if (buys < 4) warn('buyer funded', `${usdc.toFixed(2)} USDC — only ${buys} purchases left`)
  else ok('buyer funded', `${usdc.toFixed(2)} USDC · ${buys} purchases`)
} catch (err) {
  warn('buyer funded', `could not read balance: ${err.message}`)
}

if (head) {
  try {
    const gated = await get(`${API}/receipts/${head}/report`)
    const accepts = gated.body?.accepts?.[0]
    if (gated.status !== 402) bad('paywall armed', `expected 402, got ${gated.status}`)
    else if (!accepts) bad('paywall armed', '402 without x402 terms')
    else ok('paywall armed', `402 · ${accepts.maxAmountRequired} base units on ${accepts.network}`)
  } catch (err) {
    bad('paywall armed', err.message)
  }
  try {
    const p = await get(`${API}/receipts/${head}/report?preview=1`, { text: true })
    p.status === 200 && p.body.startsWith('# Mandate decision receipt') ? ok('free preview', `${p.body.length} chars`) : bad('free preview', `${p.status}`)
  } catch (err) {
    bad('free preview', err.message)
  }
}

// ----------------------------------------------------------------- the console
section('CONSOLE  (these requests are also the warm-up)')
const routes = ['/', '/chain', '/mandate', '/vaults', ...(head ? [`/receipts/${head}`, `/export/${head}`] : [])]
let firstMs = null
for (const route of routes) {
  try {
    const r = await get(`${WEB}${route}`, { text: true, key: false, timeoutMs: 45_000 })
    firstMs ??= r.ms
    if (r.status !== 200) bad(route, `${r.status}`)
    else if (/Console fault|Application error/.test(r.body)) bad(route, 'error boundary rendered')
    else ok(route, `${r.ms}ms`)
  } catch (err) {
    bad(route, err.message)
  }
}
if (firstMs !== null && firstMs > 3000) console.log(`\n  note: the first request took ${firstMs}ms cold — warm every route before a take.`)

// ------------------------------------------------------------------- the phone
section('PHONE')
if (process.env.SKIP_PHONE) {
  warn('phone width', 'skipped (SKIP_PHONE set)')
} else {
  const { code, out } = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/overflow-check.mjs'], {
      env: { ...process.env, WEB },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    child.stdout.on('data', (d) => (buf += d))
    child.stderr.on('data', (d) => (buf += d))
    child.on('error', (err) => resolve({ code: -1, out: err.message }))
    child.on('close', (c) => resolve({ code: c, out: buf }))
  })
  for (const line of out.split('\n')) if (line.trim()) console.log(`    ${line.trim()}`)
  if (code === 0) ok('phone width', 'no route scrolls sideways')
  else if (code === -1) warn('phone width', `could not run it: WEB=${WEB} node scripts/overflow-check.mjs`)
  else bad('phone width', 'a route scrolls sideways — the actual-vs-limit numbers are the demo')
}

// ---------------------------------------------------------------------- verdict
console.log('')
if (failed) console.log(`NOT READY — ${failed} failed${warned ? `, ${warned} warned` : ''}\n`)
else if (warned) console.log(`READY with ${warned} warning${warned === 1 ? '' : 's'} — read them before you record\n`)
else console.log('READY\n')
process.exit(failed ? 1 : 0)
