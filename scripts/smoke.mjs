#!/usr/bin/env node
/**
 * Mandate — integration smoke test.
 *
 * Zero dependencies. Run before installing anything:
 *     node scripts/smoke.mjs
 *
 * Verifies every external surface the build depends on. If this passes, the
 * integration risk is retired. If a check fails, fix it here before writing
 * feature code — a red smoke test on D1 is a go/no-go signal, not a nuisance.
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- env loading
// Tiny .env reader so the smoke test runs with no dependencies installed.
function loadEnv() {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, k, raw] = m
    if (process.env[k]) continue
    process.env[k] = raw.replace(/^["']|["']$/g, '')
  }
}
loadEnv()

const IXS_API = process.env.IXS_API_BASE_URL || 'https://api-dev-v2.ixs.finance'
const IXS_MCP = process.env.IXS_MCP_URL || `${IXS_API}/mcp`
const SERV_BASE = process.env.SERV_BASE_URL || 'https://inference-api.openserv.ai'
const SERV_KEY = process.env.SERV_API_KEY || ''
const SERV_MODEL = process.env.SERV_MODEL_DEV || 'gpt-5.4-mini'

const FUJI_RPC = process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc'
const RH_RPC = process.env.ROBINHOOD_CHAIN_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'

// Verified 13 Sep 2026 — see docs/RECON.md
const KNOWN_VAULTS = {
  '6a952683732c2b84b55ce89b': 'IXHYB - Avalanche',
  '6a278b40a7d16b245d665479': 'IXHYB - BSC',
  '6a8832299e7fddf1f49e6f6c': 'IXHYB - Arc',
  '6a8ebe8e732c2b84b55ce88c': 't_ix7540v1 (whitelist)',
  '6a8832289e7fddf1f49e6f51': 'IXHYB - Robinhood (MAINNET)',
}
const DEV_VAULT = process.env.IXS_VAULT_ID || '6a952683732c2b84b55ce89b'
const FUJI_VAULT_ADDR = '0x648c66E8791B1Ea20f01db549B49dE7FBa3f2a53'
const RH_VAULT_ADDR = '0x4a8B74A9d246082b671540492222e89c9A866498'

const SEL = { totalAssets: '0x01e1d114', asset: '0x38d52e0f', decimals: '0x313ce567' }

// ------------------------------------------------------------------- reporting
const results = []
const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
}

async function check(name, fn) {
  process.stdout.write(`  ${name} ... `)
  try {
    const detail = await fn()
    console.log(c.g('PASS') + (detail ? c.d(`  ${detail}`) : ''))
    results.push({ name, ok: true })
  } catch (err) {
    const msg = err?.message || String(err)
    if (err?.skip) {
      console.log(c.y('SKIP') + c.d(`  ${msg}`))
      results.push({ name, ok: true, skipped: true })
    } else {
      console.log(c.r('FAIL') + `  ${msg}`)
      results.push({ name, ok: false, msg })
    }
  }
}

const skip = (msg) => Object.assign(new Error(msg), { skip: true })

function timeout(ms) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  return { signal: ctl.signal, done: () => clearTimeout(t) }
}

// ------------------------------------------------------------------- rpc + mcp
async function rpc(url, method, params = []) {
  const t = timeout(20000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: t.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = await res.json()
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error))
    return j.result
  } finally {
    t.done()
  }
}

/** IXS MCP speaks SSE: "event: message\ndata: {...}". Strip the prefix. */
async function mcp(method, params = {}) {
  const t = timeout(30000)
  try {
    const res = await fetch(IXS_MCP, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: t.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const line = text.split('\n').find((l) => l.startsWith('data: '))
    const payload = JSON.parse(line ? line.slice(6) : text)
    if (payload.error) throw new Error(payload.error.message || 'mcp error')
    // tools/call results are DOUBLE-ENCODED: result.content[0].text is itself
    // a JSON string. tools/list is not. Unwrap when present.
    // EXCEPT on isError: the text is then PLAIN ("Unknown vaultId"), not JSON.
    const inner = payload.result?.content?.[0]?.text
    if (payload.result?.isError) throw new Error(`tool error: ${inner || 'no message'}`)
    return inner ? JSON.parse(inner) : payload.result
  } finally {
    t.done()
  }
}

const hexToBig = (h) => BigInt(h)
const fmtUnits = (v, d) => {
  const s = v.toString().padStart(d + 1, '0')
  return `${s.slice(0, -d)}.${s.slice(-d).slice(0, 4)}`
}

// ----------------------------------------------------------------------- main
console.log(c.b('\n  Mandate — integration smoke test'))
console.log(c.d(`  ${new Date().toISOString()}\n`))

console.log(c.b('  SERV Reasoning'))

await check('SERV_API_KEY present', () => {
  if (!SERV_KEY) throw skip('not set — add it to .env (blocks D1)')
  return `${SERV_KEY.slice(0, 6)}…`
})

await check('POST /v1/chat/completions', async () => {
  if (!SERV_KEY) throw skip('no key')
  const t = timeout(45000)
  try {
    const res = await fetch(`${SERV_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERV_KEY}`,
      },
      // Two rules: a system prompt is MANDATORY (400 without one), and newer
      // models reject `max_tokens` — use `max_completion_tokens`.
      body: JSON.stringify({
        model: SERV_MODEL,
        messages: [
          { role: 'system', content: 'You reply with exactly one word.' },
          { role: 'user', content: 'Say OK.' },
        ],
        max_completion_tokens: 16,
      }),
      signal: t.signal,
    })
    const body = await res.text()
    if (res.status === 401) throw new Error('401 — invalid key')
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`)
    const j = JSON.parse(body)
    return `${SERV_MODEL} -> "${(j.choices?.[0]?.message?.content || '').trim().slice(0, 24)}"`
  } finally {
    t.done()
  }
})

await check('system-prompt rule (expect 400)', async () => {
  if (!SERV_KEY) throw skip('no key')
  const res = await fetch(`${SERV_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERV_KEY}` },
    body: JSON.stringify({ model: SERV_MODEL, messages: [{ role: 'user', content: 'hi' }] }),
  })
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`)
  const body = await res.text()
  if (!/system/i.test(body)) throw new Error(`400 for the wrong reason: ${body.slice(0, 120)}`)
  return 'rejected as documented'
})

console.log(c.b('\n  IXS'))

await check('GET /vaults', async () => {
  const res = await fetch(`${IXS_API}/vaults`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = await res.json()
  const items = j.items || j
  const ids = new Set(items.map((v) => v.id))
  const missing = Object.keys(KNOWN_VAULTS).filter((id) => !ids.has(id))
  if (missing.length) {
    throw new Error(`vault set CHANGED — missing ${missing.join(', ')}. Update docs/RECON.md`)
  }
  return `${items.length} vaults, all 5 known ids present`
})

await check('MCP tools/list', async () => {
  const r = await mcp('tools/list')
  const names = (r.tools || []).map((t) => t.name)
  const required = ['vaults_list', 'vault_get', 'vault_check_whitelist', 'vault_request_status']
  const missing = required.filter((n) => !names.includes(n))
  if (missing.length) throw new Error(`missing tools: ${missing.join(', ')}`)
  return `${names.length} tools, unauthenticated`
})

await check('MCP vault_get (dev vault)', async () => {
  const r = await mcp('tools/call', { name: 'vault_get', arguments: { vaultId: DEV_VAULT } })
  if (!r.settlement) throw new Error(`no settlement field: ${JSON.stringify(r).slice(0, 160)}`)
  if (r.settlement !== 'async-erc7540') {
    throw new Error(`expected async-erc7540, got ${r.settlement} — recon outdated`)
  }
  return `${r.vault.name}, ${r.settlement}, pps=${r.pricing?.pricePerShare}`
})

await check('stale Base Sepolia id still 404s', async () => {
  const res = await fetch(`${IXS_API}/vaults/ixs-tokenized-vault-base-sepolia`)
  if (res.status !== 404) throw new Error(`expected 404, got ${res.status} — recon may be outdated`)
  return 'confirmed dead (do not use skills-repo .env.example)'
})

console.log(c.b('\n  Chains'))

await check('Avalanche Fuji RPC', async () => {
  const id = await rpc(FUJI_RPC, 'eth_chainId')
  if (BigInt(id) !== 43113n) throw new Error(`chainId ${BigInt(id)}, expected 43113`)
  const bn = await rpc(FUJI_RPC, 'eth_blockNumber')
  return `chain 43113, block ${BigInt(bn)}`
})

await check('Fuji IXHYB vault reads', async () => {
  const [ta, dec] = await Promise.all([
    rpc(FUJI_RPC, 'eth_call', [{ to: FUJI_VAULT_ADDR, data: SEL.totalAssets }, 'latest']),
    rpc(FUJI_RPC, 'eth_call', [{ to: FUJI_VAULT_ADDR, data: SEL.decimals }, 'latest']),
  ])
  return `totalAssets=${fmtUnits(hexToBig(ta), 6)} USDC, shares ${hexToBig(dec)}dp`
})

await check('Robinhood Chain RPC', async () => {
  const id = await rpc(RH_RPC, 'eth_chainId')
  if (BigInt(id) !== 4663n) throw new Error(`chainId ${BigInt(id)}, expected 4663`)
  const bn = await rpc(RH_RPC, 'eth_blockNumber')
  return `chain 4663, block ${BigInt(bn)} — public, no brokerage auth`
})

await check('Robinhood IXHYB vault reads', async () => {
  const ta = await rpc(RH_RPC, 'eth_call', [{ to: RH_VAULT_ADDR, data: SEL.totalAssets }, 'latest'])
  return `totalAssets=${fmtUnits(hexToBig(ta), 6)} USDG  ${c.y('(MAINNET — read only)')}`
})

// ---------------------------------------------------------------------- summary
const failed = results.filter((r) => !r.ok)
const skipped = results.filter((r) => r.skipped)

console.log(c.b('\n  ─────────────────────────────────────────────'))
console.log(
  `  ${results.length - failed.length}/${results.length} passed` +
    (skipped.length ? c.y(`, ${skipped.length} skipped`) : '') +
    (failed.length ? c.r(`, ${failed.length} FAILED`) : '')
)

if (failed.length) {
  console.log(c.r('\n  Failures:'))
  for (const f of failed) console.log(`    - ${f.name}: ${f.msg}`)
  console.log(c.d('\n  Re-run the probes in docs/RECON.md before assuming the code is wrong.\n'))
  process.exit(1)
}

if (!SERV_KEY) {
  console.log(c.y('\n  SERV_API_KEY is not set.'))
  console.log(c.d('  Get one at https://console.openserv.ai and add it to .env.'))
  console.log(c.d('  Confirm in the OpenServ Telegram whether participants get free credits.\n'))
} else {
  console.log(c.g('\n  All integrations live. Clear to build.\n'))
}
