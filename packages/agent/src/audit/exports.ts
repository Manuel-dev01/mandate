/**
 * The sales ledger — one line per audit report actually sold.
 *
 * A line is written only after a settlement the facilitator confirmed, so the
 * "reports sold" and "earned" on the console are as real as the receipts
 * themselves. Money is summed in base units and formatted once, never floated.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { env } from '../env.js'
import { formatBaseUnits, parseDecimalAmount } from '../ixs/schemas.js'

export const SaleSchema = z.object({
  at: z.string(),
  receiptId: z.string().regex(/^[0-9a-f]{64}$/),
  /** Which rail settled it: our x402 on Base Sepolia, or a paid OpenServ workflow. */
  rail: z.enum(['x402-sepolia', 'x402-base', 'openserv']),
  txHash: z.string(),
  payer: z.string(),
  /** Decimal USDC, e.g. "0.50". */
  price: z.string(),
  currency: z.literal('USDC'),
  network: z.string(),
})
export type Sale = z.infer<typeof SaleSchema>

export interface ExportLedger {
  record(sale: Omit<Sale, 'at' | 'currency'> & { at?: string }): Sale
  list(limit?: number): Sale[]
  count(): number
  /** Total earned, as a decimal USDC string. */
  earned(): string
}

const total = (sales: readonly Sale[]): string => formatBaseUnits(sales.reduce((a, s) => a + parseDecimalAmount(s.price, 6), 0n), 6)

export class MemoryExportLedger implements ExportLedger {
  private readonly sales: Sale[] = []
  record(sale: Omit<Sale, 'at' | 'currency'> & { at?: string }): Sale {
    const full: Sale = SaleSchema.parse({ ...sale, at: sale.at ?? new Date().toISOString(), currency: 'USDC' })
    this.sales.push(full)
    return full
  }
  list(limit = 50): Sale[] {
    return [...this.sales].reverse().slice(0, limit)
  }
  count(): number {
    return this.sales.length
  }
  earned(): string {
    return total(this.sales)
  }
}

/** Append-only `exports.jsonl`, next to the receipts (the Railway volume in production). */
export class FileExportLedger implements ExportLedger {
  readonly path: string
  constructor(path: string = join(env.RECEIPTS_DIR, 'exports.jsonl')) {
    this.path = path
    mkdirSync(dirname(path), { recursive: true })
  }
  private read(): Sale[] {
    if (!existsSync(this.path)) return []
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .flatMap((l) => {
        // The safeParse was guarded but the JSON.parse was not, so one torn line took
        // out /x402, the export page's price block and the sales counter in beat 5.
        try {
          const parsed = SaleSchema.safeParse(JSON.parse(l))
          return parsed.success ? [parsed.data] : []
        } catch {
          return []
        }
      })
  }
  record(sale: Omit<Sale, 'at' | 'currency'> & { at?: string }): Sale {
    const full: Sale = SaleSchema.parse({ ...sale, at: sale.at ?? new Date().toISOString(), currency: 'USDC' })
    appendFileSync(this.path, `${JSON.stringify(full)}\n`)
    return full
  }
  list(limit = 50): Sale[] {
    return this.read().reverse().slice(0, limit)
  }
  count(): number {
    return this.read().length
  }
  earned(): string {
    return total(this.read())
  }
}

let ledger: FileExportLedger | null = null
export function exportLedger(): FileExportLedger {
  ledger ??= new FileExportLedger()
  return ledger
}
