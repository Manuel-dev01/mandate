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
import { gzipSync } from 'node:zlib'
import { exportLedger, receiptStore, renderReport, replayReceipt, verifyReceipt, type ExportLedger, type Receipt, type ReceiptStore } from '../audit/index.js'
import { env } from '../env.js'
import { getVaultState, listVaults, type Snapshot, type VaultUniverse } from '../ixs/index.js'
import type { VaultState } from '../ixs/schemas.js'
import type { RuleType } from '../mandate/schema.js'
import { agentCard } from '../monetize/agent-card.js'
import { identityFacts, paywallPage, serviceFacts } from '../monetize/service.js'
import { paymentResponseHeader, reportRequirements, settlementOf, X402_VERSION, type Settlement } from '../monetize/x402.js'
import { chainRowView, historyView, mandateView, receiptView, salesView, statsView, tallyFired, vaultsView, type ChainRowView } from './view.js'

export interface ConsoleDeps {
  store: ReceiptStore & { resolve?: (prefix: string) => string | null }
  universe: () => Promise<Snapshot<VaultUniverse>>
  vaultState: (vaultId: string) => Promise<Snapshot<VaultState>>
  /** What the poller is doing, for /health. */
  telegram: () => { state: string; username: string | null; lastPollAt: string | null; lastError: string | null } | null
  /** The business facts. Injectable so unit tests never read ambient env or hit the platform. */
  service?: (() => Promise<import('../monetize/service.js').ServiceFacts>) | undefined
  identity?: (() => import('../monetize/service.js').IdentityFacts) | undefined
  /** Whether the OpenServ agent (which serves the paid workflow) is connected. */
  openserv?: (() => { state: string; note: string | null }) | undefined
  /** Sales, written only after a settlement the facilitator confirmed. */
  ledger: ExportLedger
  /** Public base URL of this API, so an x402 `resource` is the URL actually paid for. */
  origin: string
  /** Header -> settlement. Injected so the unit tests never touch a facilitator. */
  settle?: (header: string, receiptId: string, origin: string) => Promise<Settlement>
  apiKey?: string | undefined
  now?: () => Date
}

export function defaultConsoleDeps(): ConsoleDeps {
  return {
    store: receiptStore(),
    ledger: exportLedger(),
    origin: env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`,
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

export type ConsoleHandler = (req: {
  path: string
  query: URLSearchParams
  /** The x402 payment header, when the buyer sent one. */
  payment?: string | undefined
  /** True when a browser asked for the page, so the paywall can be HTML. */
  wantsHtml?: boolean | undefined
}) => Promise<{ status: number; body: unknown; contentType?: string; headers?: Record<string, string> }>

/** Free, and labelled as free: enough of the report to judge it, never the whole file. */
const PREVIEW_LINES = 40
function previewOf(markdown: string, price: string): string {
  const lines = markdown.split('\n')
  const shown = lines.slice(0, PREVIEW_LINES).join('\n')
  return `${shown}\n\n---\n\n_Preview: ${PREVIEW_LINES} of ${lines.length} lines. The full report is ${price} USDC over x402._\n`
}

/** The routing, separated from node:http so the unit tests can call it directly. */
export function createConsoleHandler(deps: ConsoleDeps): ConsoleHandler {
  const cache: { head: string | null; fired: Record<RuleType, number> | null } = { head: null, fired: null }
  const now = deps.now ?? (() => new Date())

  return async ({ path, query, payment, wantsHtml }) => {
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
        openserv: deps.openserv?.() ?? { state: 'disabled', note: null },
      })
    }

    if (path === '/stats') {
      const rows = deps.store.list({ limit: MAX_LIST })
      return json({
        ...statsView(rows, deps.store.verifyChain(), deps.store.head()),
        ...salesView(deps.ledger),
        history: historyView(loadAll(deps.store), now()),
      })
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
      if (sub === 'report') {
        const markdown = renderReport(r)
        // The preview is free and says so. The console shows exactly this.
        if (query.get('preview') === '1') return { status: 200, body: previewOf(markdown, env.X402_PRICE_USDC), contentType: 'text/markdown; charset=utf-8' }

        const requirements = reportRequirements(r.id, deps.origin)
        if (!payment) {
          // A browser gets the x402 pay page; a machine gets the challenge.
          if (wantsHtml) return { status: 402, body: paywallPage(requirements), contentType: 'text/html; charset=utf-8' }
          return { status: 402, body: { x402Version: X402_VERSION, accepts: [requirements], error: 'payment required' } }
        }

        const settlement = deps.settle ? await deps.settle(payment, r.id, deps.origin) : await settlementOf(payment, requirements)
        if (settlement.kind === 'facilitator-down') {
          // Never hand over the file on a maybe, and never blame the buyer for our outage.
          // We may only say "nothing was charged" when the failure happened during verify;
          // a settle we stopped waiting for may still have been broadcast, and claiming
          // otherwise would be exactly the unbacked assertion this product exists to refuse.
          throw new HttpError(
            503,
            settlement.phase === 'verify'
              ? `could not reach the x402 facilitator to check the payment (${settlement.reason}) — nothing was charged; please retry`
              : `the x402 facilitator did not confirm the settlement in time (${settlement.reason}) — the report was not released. Your payment may or may not have gone through: check the payer address on the block explorer before paying again`,
          )
        }
        if (settlement.kind === 'invalid') {
          return { status: 402, body: { x402Version: X402_VERSION, accepts: [requirements], error: settlement.reason } }
        }
        deps.ledger.record({
          receiptId: r.id,
          rail: requirements.network === 'base' ? 'x402-base' : 'x402-sepolia',
          txHash: settlement.txHash,
          payer: settlement.payer,
          price: env.X402_PRICE_USDC,
          network: settlement.network,
        })
        return {
          status: 200,
          body: markdown,
          contentType: 'text/markdown; charset=utf-8',
          headers: { 'X-PAYMENT-RESPONSE': paymentResponseHeader(settlement) },
        }
      }
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

    // The ERC-8004 token URI points here: the identity is checkable against a running agent.
    if (path === '/.well-known/agent-card.json') return json(agentCard(deps.origin))

    if (path === '/x402') {
      return json({ service: await (deps.service ?? serviceFacts)(), identity: (deps.identity ?? identityFacts)(), sales: salesView(deps.ledger) })
    }

    if (path === '/') return json({ name: 'mandate console api', routes: ['/health', '/stats', '/receipts', '/receipts/:id', '/receipts/:id/verify', '/receipts/:id/report', '/mandate', '/vaults', '/x402', '/.well-known/agent-card.json'] })

    throw new HttpError(404, `no route ${path}`)
  }
}

export function createConsoleServer(deps: ConsoleDeps = defaultConsoleDeps(), log: (line: string) => void = (l) => console.log(l)): Server {
  const handle = createConsoleHandler(deps)

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const send = (status: number, body: string, contentType = 'application/json; charset=utf-8', extra: Record<string, string> = {}) => {
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE',
        ...extra,
      }
      // The x402 pay page is ~1.8 MB of bundled wallet SDK. Uncompressed over a long
      // link that took over a minute to arrive, which is longer than beat 5 exists for
      // (RECON §6.19). Gzip anything big enough to be worth it.
      let payload: string | Buffer = body
      const wantsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
      if (wantsGzip && Buffer.byteLength(body) > 1024) {
        payload = gzipSync(body)
        headers['Content-Encoding'] = 'gzip'
        headers['Vary'] = 'Accept-Encoding'
      }
      headers['Content-Length'] = String(Buffer.byteLength(payload))
      res.writeHead(status, headers)
      res.end(req.method === 'HEAD' ? undefined : payload)
      log(`${req.method} ${url.pathname} ${status} ${Date.now() - started}ms`)
    }
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'read-only: GET only')
      // The paid report is public on purpose: anyone with USDC can buy one, console key or not.
      // Public by design: the paid report (anyone with USDC) and the agent card (the ERC-8004 token URI).
      const isPublic = /^\/receipts\/[0-9a-fA-F]+\/report$/.test(url.pathname) || url.pathname === '/.well-known/agent-card.json'
      if (deps.apiKey && url.pathname !== '/health' && !isPublic && req.headers['x-console-key'] !== deps.apiKey) throw new HttpError(401, 'x-console-key required')
      const paymentHeader = req.headers['x-payment']
      const accept = String(req.headers['accept'] ?? '')
      const out = await handle({
        path: url.pathname.replace(/\/+$/, '') || '/',
        query: url.searchParams,
        payment: typeof paymentHeader === 'string' && paymentHeader.length > 0 ? paymentHeader : undefined,
        wantsHtml: accept.includes('text/html'),
      })
      if (out.contentType) send(out.status, String(out.body), out.contentType, out.headers ?? {})
      else send(out.status, JSON.stringify(out.body), 'application/json; charset=utf-8', out.headers ?? {})
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      const message = err instanceof Error ? err.message : String(err)
      send(status, JSON.stringify({ error: message, status }))
    }
  })
}
