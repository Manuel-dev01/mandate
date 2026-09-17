/**
 * Audit — receipts.
 *
 *   receipt.ts  build / hash / verify / replay
 *   store.ts    append-only, hash-linked, file or memory
 *   report.ts   the human-readable audit report, byte-stable
 *
 * record() is the one call the CLI (and later Telegram + the console) make.
 */

import { buildReceipt, type Receipt } from './receipt.js'
import { FileReceiptStore, type ReceiptStore } from './store.js'
import type { Decision } from '../mandate/types.js'
import type { RuleSet } from '../mandate/schema.js'

export * from './receipt.js'
export * from './store.js'
export { renderReport } from './report.js'

let defaultStore: FileReceiptStore | null = null

export function receiptStore(): FileReceiptStore {
  defaultStore ??= new FileReceiptStore()
  return defaultStore
}

/** Issue a receipt for a decision and append it to the chain. */
export function record(input: { ruleSet: RuleSet; decision: Decision }, store: ReceiptStore = receiptStore()): Receipt {
  const receipt = buildReceipt({ ruleSet: input.ruleSet, decision: input.decision, previousId: store.head() })
  store.append(receipt)
  return receipt
}
