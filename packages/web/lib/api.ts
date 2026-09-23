/**
 * The console's only data source: the agent's read-only API (packages/agent/src/console/api.ts).
 *
 * Never throws. Every page gets `{ ok: true, data }` or `{ ok: false, reason }` and renders a
 * degraded panel for the latter — the console must never show a raw error.
 */

import 'server-only'

export const API_URL = (process.env['MANDATE_API_URL'] ?? 'http://localhost:8787').replace(/\/+$/, '')
const API_KEY = process.env['MANDATE_API_KEY']

export type ApiResult<T> = { ok: true; data: T; checkedAt: string } | { ok: false; reason: string; status: number | null; checkedAt: string }

export async function api<T>(path: string, init: { timeoutMs?: number } = {}): Promise<ApiResult<T>> {
  const checkedAt = new Date().toISOString()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 12_000)
  try {
    const res = await fetch(`${API_URL}${path}`, {
      cache: 'no-store',
      signal: ctrl.signal,
      headers: API_KEY ? { 'x-console-key': API_KEY } : {},
    })
    if (!res.ok) {
      let reason = `${res.status}`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) reason = body.error
      } catch {
        // non-JSON error body
      }
      return { ok: false, reason, status: res.status, checkedAt }
    }
    return { ok: true, data: (await res.json()) as T, checkedAt }
  } catch (err) {
    const reason = err instanceof Error ? (err.name === 'AbortError' ? 'timed out' : err.message) : String(err)
    return { ok: false, reason, status: null, checkedAt }
  } finally {
    clearTimeout(timer)
  }
}

export async function apiText(path: string, init: { timeoutMs?: number } = {}): Promise<ApiResult<string>> {
  const checkedAt = new Date().toISOString()
  // Bounded like api(): without this, a hung agent hung the page that renders the
  // report preview, with no error state to fall back to.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 12_000)
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store', signal: ctrl.signal, headers: API_KEY ? { 'x-console-key': API_KEY } : {} })
    if (!res.ok) return { ok: false, reason: `${res.status}`, status: res.status, checkedAt }
    return { ok: true, data: await res.text(), checkedAt }
  } catch (err) {
    const reason = err instanceof Error ? (err.name === 'AbortError' ? 'timed out' : err.message) : String(err)
    return { ok: false, reason, status: null, checkedAt }
  } finally {
    clearTimeout(timer)
  }
}

// ------------------------------------------------------------ wire types
// Mirrors packages/agent/src/console/view.ts. The web is a renderer of this JSON.

export type Verdict = 'ALLOW' | 'REFUSE'

export interface CheckView {
  code: string
  type: string
  label: string
  applicable: boolean
  passed: boolean
  actual: string
  limit: string
  phrase: string
  clause: string
  inferred: boolean
  detail: string
}

export interface MandateRuleView {
  n: number
  code: string
  type: string
  label: string
  threshold: string
  clause: string
  inferred: boolean
  clauseIndex: number | null
  fired: number | null
}

export interface MandateSegment {
  text: string
  rule: string | null
}

export interface MandateView {
  version: number
  hash: string
  compiledAt: string
  model: string
  sourceText: string
  clauses: number
  rules: MandateRuleView[]
  unmappable: string[]
  segments: MandateSegment[]
}

export interface ReceiptView {
  id: string
  short: string
  createdAt: string
  verdict: Verdict
  headline: string
  action: { kind: 'deposit' | 'redeem'; amount: string; vaultName: string; vaultId: string; network: string; chainId: number; mainnet: boolean }
  checks: CheckView[]
  cited: string[]
  breached: number
  applicable: number
  numbers: Record<string, string>
  context: string | null
  userMessage: string | null
  why: string
  explanation: { source: 'template' | 'serv'; model: string | null; tokens: number; tools: string[]; guarded: boolean; note: string | null }
  inputs: {
    portfolio: { source: 'onchain' | 'declared'; wallet: string; asset: string; total: string; idle: string; positions: { vaultId: string; chainId: number; value: string }[]; asOf: string }
    facts: {
      name: string
      vaultId: string
      status: string | null
      paused: boolean | null
      pausedSource: string
      settlement: string
      tvl: string
      requiresWhitelist: boolean
      whitelistEnabled: boolean | null
      whitelisted: boolean | null
      observedAt: string
      stale: boolean
    }
  }
  hashes: { mandate: string; decision: string; receipt: string; previous: string | null }
  mandate: MandateView
}

export interface ChainRowView {
  id: string
  short: string
  createdAt: string
  verdict: Verdict
  kind: 'deposit' | 'redeem'
  amount: string
  vaultName: string
  vaultId: string
  network: string
  chainId: number
  mainnet: boolean
  cited: string[]
  portfolioSource: 'onchain' | 'declared'
  factsStale: boolean
  hasMessage: boolean
}

export interface HistoryBucket {
  at: string
  allowed: number
  refused: number
}

export interface HistoryView {
  grain: 'hour' | 'day'
  buckets: HistoryBucket[]
  total: number
  allowed: number
  refused: number
  firstAt: string | null
  lastAt: string | null
  byRule: { code: string; type: string; label: string; fired: number }[]
}

export interface StatsView {
  receipts: number
  refused: number
  allowed: number
  breaks: number
  head: string | null
  signedTxns: 0
  sold: number
  earned: string
  history: HistoryView
}

export interface VaultRowView {
  id: string
  name: string
  network: string
  chainId: number
  mainnet: boolean
  asset: string
  requiresWhitelist: boolean
  status: string | null
  settlement: string | null
  tvl: string | null
  stale: boolean
  fetchedAt: string | null
  error: string | null
}

export interface VaultsView {
  stale: boolean
  fetchedAt: string
  source: 'live' | 'memory' | 'disk'
  chains: number
  vaults: VaultRowView[]
  mainnetRefusals: number
  price: string
}

export interface VerifyView {
  id: string
  verify: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] }
  replay: { reproduced: boolean; originalHash: string; replayHash: string; verdict: Verdict; replayVerdict: Verdict; diff: string | null }
  checkedAt: string
}

export interface ServiceFacts {
  price: string
  currency: 'USDC'
  network: string
  testnet: boolean
  payTo: string
  payToUrl: string | null
  asset: string
  facilitator: string
  openserv: { listed: boolean; triggerUrl: string | null; paywallUrl: string | null; workflowId: string | null; name: string | null; price: string | null; active: boolean | null; checkedAt: string | null }
}

export interface IdentityFacts {
  registered: boolean
  agentId: string | null
  chainId: number | null
  txHash: string | null
  txUrl: string | null
  cardUrl: string | null
  scanUrl: string | null
}

export interface SalesView {
  sold: number
  earned: string
  currency: 'USDC'
  recent: { at: string; receiptId: string; short: string; rail: string; txHash: string; txUrl: string | null; payer: string; price: string }[]
}

export interface X402View {
  service: ServiceFacts
  identity: IdentityFacts
  sales: SalesView
}

export interface HealthView {
  ok: boolean
  now: string
  uptimeSeconds: number
  head: string | null
  receipts: number
  telegram: { state: string; username: string | null; lastPollAt: string | null; lastError: string | null } | null
}
