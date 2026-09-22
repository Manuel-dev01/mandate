/**
 * The console API — what the web console reads. GET-only JSON over node:http.
 *
 * Read-only by construction: there is no route that writes. Receipts come from
 * the same store the Telegram bot appends to; vault data from the same cached
 * reads; every view model from console/view.ts. Nothing here decides anything.
 *
 * Runs in the same process as the bot (bin/serve.ts) so one Railway service with
 * one volume is the whole back end.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { receiptStore, renderReport, replayReceipt, verifyReceipt, type Receipt, type ReceiptStore } from '../audit/index.js'
import { env } from '../env.js'
import { getVaultState, listVaults, type Snapshot, type VaultUniverse } from '../ixs/index.js'
import type { VaultState } from '../ixs/schemas.js'
import type { RuleType } from '../mandate/schema.js'
import { chainRowView, mandateView, receiptView, statsView, tallyFired, vaultsView, type ChainRowView } from './view.js'

export interface ConsoleDeps {
  store: ReceiptStore & { resolve?: (prefix: string) => string | null }
  universe: () => Promise<Snapshot<VaultUniverse>>
  vaultState: (vaultId: string) => Promise<Snapshot<VaultState>>
  /** What the poller is doing, for /health. */
  telegram: () => { state: string; username: string | null; lastPollAt: string | null; lastError: string | null } | null
  apiKey?: string | undefined
  now?: () => Date
}

export function defaultConsoleDeps(): ConsoleDeps {
  return {
    store: receiptStore(),
    universe: () => listVaults(),
    vaultState: (id) => getVaultState(id),
    telegram: () => null,
    apiKey: env.CONSOLE_API_KEY,
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const MAX_LIST = 200
const STARTED = Date.now()

/** All receipts newest-first as full records. Hackathon scale: a few hundred files at most. */
function loadAll(store: ConsoleDeps['store'], opts: { verdict?: 'ALLOW' | 'REFUSE'; limit?: number } = {}): Receipt[] {
  const entries = store.list({ ...(opts.verdict ? { verdict: opts.verdict } : {}), limit: Math.min(opts.limit ?? MAX_LIST, MAX_LIST) })
  const out: Receipt[] = []
  for (const e of entries) {
    const r = store.get(e.id)
    if (r) out.push(r)
  }
  return out
}

function resolveReceipt(store: ConsoleDeps['store'], idOrPrefix: string): Receipt {
  if (!/^[0-9a-f]{6,64}$/.test(idOrPrefix)) throw new HttpError(400, 'receipt id must be 6–64 hex characters')
  const id = store.resolve ? store.resolve(idOrPrefix) : idOrPrefix
  const r = id ? store.get(id) : null
  if (!r) throw new HttpError(404, `no receipt matches ${idOrPrefix}`)
  return r
}

/** Fired counts are a walk over every receipt; memoise on the chain head so a busy console costs one walk per new receipt. */
function firedTally(store: ConsoleDeps['store'], cache: { head: string | null; fired: Record<RuleType, number> | null }): Record<RuleType, number> {
  const head = store.head()
  if (cache.fired && cache.head === head) return cache.fired
  cache.head = head
  cache.fired = tallyFired(loadAll(store))
  return cache.fired
}

export type ConsoleHandler = (req: { path: string; query: URLSearchParams }) => Promise<{ status: number; body: unknown; contentType?: string }>

/** The routing, separated from node:http so the unit tests can call it directly. */
export function createConsoleHandler(deps: ConsoleDeps): ConsoleHandler {
  const cache: { head: string | null; fired: Record<RuleType, number> | null } = { head: null, fired: null }
  const now = deps.now ?? (() => new Date())

  return async ({ path, query }) => {
    const json = (body: unknown, status = 200) => ({ status, body })

    if (path === '/health') {
      const head = deps.store.head()
      return json({
        ok: true,
        now: now().toISOString(),
        uptimeSeconds: Math.round((Date.now() - STARTED) / 1000),
        head,
        receipts: deps.store.list({ limit: MAX_LIST }).length,
        telegram: deps.telegram(),
      })
    }

    if (path === '/stats') {
      const rows = deps.store.list({ limit: MAX_LIST })
      return json(statsView(rows, deps.store.verifyChain(), deps.store.head()))
    }

    if (path === '/receipts') {
      const verdictParam = query.get('verdict')
      const verdict = verdictParam === 'ALLOW' || verdictParam === 'REFUSE' ? verdictParam : undefined
      const limitParam = Number(query.get('limit') ?? MAX_LIST)
      const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : MAX_LIST
      const rows: ChainRowView[] = loadAll(deps.store, { ...(verdict ? { verdict } : {}), limit }).map(chainRowView)
      return json({ rows, head: deps.store.head() })
    }

    const receiptMatch = /^\/receipts\/([0-9a-fA-F]+)(?:\/(verify|report))?$/.exec(path)
    if (receiptMatch) {
      const r = resolveReceipt(deps.store, receiptMatch[1]!.toLowerCase())
      const sub = receiptMatch[2]
      if (sub === 'verify') return json({ id: r.id, verify: verifyReceipt(r), replay: replayReceipt(r), checkedAt: now().toISOString() })
      if (sub === 'report') return { status: 200, body: renderReport(r), contentType: 'text/markdown; charset=utf-8' }
      return json(receiptView(r, firedTally(deps.store, cache)))
    }

    if (path === '/mandate') {
      const head = deps.store.head()
      const newest = head ? deps.store.get(head) : null
      if (!newest) return json({ empty: true, mandate: null })
      return json({ empty: false, mandate: mandateView(newest.mandate, firedTally(deps.store, cache)), receiptId: newest.id })
    }

    if (path === '/vaults') {
      const universe = await deps.universe()
      const states = new Map<string, Snapshot<VaultState> | Error>()
      const results = await Promise.allSettled(universe.data.vaults.map((v) => deps.vaultState(v.id)))
      universe.data.vaults.forEach((v, i) => {
        const res = results[i]!
        states.set(v.id, res.status === 'fulfilled' ? res.value : res.reason instanceof Error ? res.reason : new Error(String(res.reason)))
      })
      const view = vaultsView(universe, states)
      // Mainnet refusals, so the vaults page can say "always refused" with a real count.
      const mainnetRefusals = loadAll(deps.store, { verdict: 'REFUSE' }).filter((r) => r.environment.chainId === 4663).length
      return json({ ...view, mainnetRefusals, price: env.X402_PRICE_USDC })
    }

    if (path === '/') return json({ name: 'mandate console api', routes: ['/health', '/stats', '/receipts', '/receipts/:id', '/receipts/:id/verify', '/receipts/:id/report', '/mandate', '/vaults'] })

    throw new HttpError(404, `no route ${path}`)
  }
}

export function createConsoleServer(deps: ConsoleDeps = defaultConsoleDeps(), log: (line: string) => void = (l) => console.log(l)): Server {
  const handle = createConsoleHandler(deps)

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const send = (status: number, body: string, contentType = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(body)
      log(`${req.method} ${url.pathname} ${status} ${Date.now() - started}ms`)
    }
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'read-only: GET only')
      if (deps.apiKey && url.pathname !== '/health' && req.headers['x-console-key'] !== deps.apiKey) throw new HttpError(401, 'x-console-key required')
      const out = await handle({ path: url.pathname.replace(/\/+$/, '') || '/', query: url.searchParams })
      if (out.contentType) send(out.status, String(out.body), out.contentType)
      else send(out.status, JSON.stringify(out.body))
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      const message = err instanceof Error ? err.message : String(err)
      send(status, JSON.stringify({ error: message, status }))
    }
  })
}
