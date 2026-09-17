/**
 * Append-only receipt store.
 *
 *   <dir>/<id>.json      one file per receipt, pretty JSON
 *   <dir>/chain.jsonl    one line per receipt, in order — the index and the chain
 *
 * Each receipt commits to the id of the one before it. `append` refuses a
 * receipt whose previousId is not the current head, so the chain can never
 * silently fork; `verifyChain` walks the index and re-verifies every file.
 *
 * Files, not a database: a 14-day build, and the console can read files.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { env } from '../env.js'
import { verifyReceipt, type Receipt } from './receipt.js'

export const ChainEntrySchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  previousId: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  createdAt: z.string(),
  verdict: z.enum(['ALLOW', 'REFUSE']),
  kind: z.enum(['deposit', 'redeem']),
  vaultId: z.string(),
  amount: z.string(),
  network: z.string(),
  portfolioSource: z.enum(['onchain', 'declared']),
})
export type ChainEntry = z.infer<typeof ChainEntrySchema>

export interface ListOptions {
  limit?: number
  verdict?: 'ALLOW' | 'REFUSE'
  vaultId?: string
}

export interface ChainVerification {
  readonly ok: boolean
  readonly count: number
  readonly problems: ReadonlyArray<{ id: string; problem: string }>
}

export interface ReceiptStore {
  append(receipt: Receipt): void
  get(id: string): Receipt | null
  head(): string | null
  list(opts?: ListOptions): ChainEntry[]
  verifyChain(): ChainVerification
}

export function entryOf(r: Receipt): ChainEntry {
  return {
    id: r.id,
    previousId: r.previousId,
    createdAt: r.createdAt,
    verdict: r.decision.verdict,
    kind: r.decision.inputs.action.kind,
    vaultId: r.decision.inputs.action.vaultId,
    amount: r.decision.inputs.action.amount,
    network: r.environment.network,
    portfolioSource: r.environment.portfolioSource,
  }
}

export class ChainLinkError extends Error {
  constructor(expected: string | null, got: string | null) {
    super(`receipt links to ${got ?? 'null'} but the chain head is ${expected ?? 'null'}`)
    this.name = 'ChainLinkError'
  }
}

// --------------------------------------------------------------- in-memory

export class MemoryReceiptStore implements ReceiptStore {
  private readonly receipts = new Map<string, Receipt>()
  private readonly chain: ChainEntry[] = []

  append(receipt: Receipt): void {
    const head = this.head()
    if (receipt.previousId !== head) throw new ChainLinkError(head, receipt.previousId)
    this.receipts.set(receipt.id, receipt)
    this.chain.push(entryOf(receipt))
  }
  get(id: string): Receipt | null {
    return this.receipts.get(id) ?? null
  }
  head(): string | null {
    return this.chain.at(-1)?.id ?? null
  }
  list(opts: ListOptions = {}): ChainEntry[] {
    return filterEntries(this.chain, opts)
  }
  verifyChain(): ChainVerification {
    return verifyEntries(this.chain, (id) => this.get(id))
  }
}

// -------------------------------------------------------------------- file

export class FileReceiptStore implements ReceiptStore {
  readonly dir: string
  private readonly indexPath: string

  constructor(dir: string = env.RECEIPTS_DIR) {
    this.dir = dir
    this.indexPath = join(dir, 'chain.jsonl')
    mkdirSync(dir, { recursive: true })
  }

  private readIndex(): ChainEntry[] {
    if (!existsSync(this.indexPath)) return []
    return readFileSync(this.indexPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => ChainEntrySchema.parse(JSON.parse(l)))
  }

  append(receipt: Receipt): void {
    const head = this.head()
    if (receipt.previousId !== head) throw new ChainLinkError(head, receipt.previousId)
    const path = join(this.dir, `${receipt.id}.json`)
    if (existsSync(path)) throw new Error(`receipt ${receipt.id.slice(0, 12)} already exists`)
    writeFileSync(path, JSON.stringify(receipt, null, 2))
    appendFileSync(this.indexPath, `${JSON.stringify(entryOf(receipt))}\n`)
  }

  get(id: string): Receipt | null {
    if (!/^[0-9a-f]{64}$/.test(id)) return null
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as Receipt
  }

  /** Resolve an abbreviated id (any unique prefix) to the full one. */
  resolve(prefix: string): string | null {
    if (/^[0-9a-f]{64}$/.test(prefix)) return prefix
    const matches = readdirSync(this.dir)
      .filter((f) => f.endsWith('.json') && f.startsWith(prefix))
      .map((f) => f.slice(0, -5))
    return matches.length === 1 ? (matches[0] ?? null) : null
  }

  head(): string | null {
    return this.readIndex().at(-1)?.id ?? null
  }

  list(opts: ListOptions = {}): ChainEntry[] {
    return filterEntries(this.readIndex(), opts)
  }

  verifyChain(): ChainVerification {
    return verifyEntries(this.readIndex(), (id) => this.get(id))
  }
}

// ------------------------------------------------------------------ shared

function filterEntries(entries: readonly ChainEntry[], opts: ListOptions): ChainEntry[] {
  let out = [...entries].reverse()
  if (opts.verdict) out = out.filter((e) => e.verdict === opts.verdict)
  if (opts.vaultId) out = out.filter((e) => e.vaultId === opts.vaultId)
  return out.slice(0, opts.limit ?? 50)
}

function verifyEntries(entries: readonly ChainEntry[], load: (id: string) => Receipt | null): ChainVerification {
  const problems: Array<{ id: string; problem: string }> = []
  let previous: string | null = null
  for (const entry of entries) {
    if (entry.previousId !== previous) problems.push({ id: entry.id, problem: `links to ${entry.previousId ?? 'null'}, expected ${previous ?? 'null'}` })
    const receipt = load(entry.id)
    if (!receipt) {
      problems.push({ id: entry.id, problem: 'file missing' })
    } else {
      if (receipt.id !== entry.id) problems.push({ id: entry.id, problem: 'file id differs from index' })
      const v = verifyReceipt(receipt)
      for (const c of v.checks) if (!c.ok) problems.push({ id: entry.id, problem: `${c.name}: ${c.detail}` })
    }
    previous = entry.id
  }
  return Object.freeze({ ok: problems.length === 0, count: entries.length, problems: Object.freeze(problems) })
}
