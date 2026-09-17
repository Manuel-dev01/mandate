/**
 * The receipt — the product's spine.
 *
 * One document per decision: the whole rule set, the whole Decision (inputs
 * included), the honesty labels, and a link to the previous receipt. Hashed
 * over everything except its own timestamp, so:
 *
 *   - verifyReceipt() proves nothing in it was altered after issue
 *   - replayReceipt() re-runs the pure evaluator on the stored inputs and
 *     must reproduce the identical decision hash (demo beat 4)
 *
 * There is no execution block. IXS vaults are not open to outside deposits
 * during the build window (RECON §6.10); the product is decide + prove.
 */

import { createHash } from 'node:crypto'
import { decisionHashInput, evaluate, verifyDecisionHash } from '../mandate/evaluate.js'
import { RuleSetSchema, canonicalJson, verifyRuleSetHash, type RuleSet } from '../mandate/schema.js'
import {
  deserializeAction,
  deserializeFacts,
  deserializePortfolio,
  type Decision,
  type PortfolioSource,
  type RationaleSource,
} from '../mandate/types.js'

export const RECEIPT_SCHEMA = 'mandate.receipt/1' as const
export const AGENT_VERSION = '0.1.0'

export interface ReceiptEnvironment {
  readonly portfolioSource: PortfolioSource
  readonly factsStale: boolean
  readonly rationaleSource: RationaleSource
  readonly network: string
  readonly chainId: number
  readonly agentVersion: string
}

export interface Receipt {
  readonly schema: typeof RECEIPT_SCHEMA
  /** Equal to `hash`. */
  readonly id: string
  readonly createdAt: string
  readonly mandate: RuleSet
  readonly decision: Decision
  readonly environment: ReceiptEnvironment
  /** The receipt before this one in the store, or null for the first. */
  readonly previousId: string | null
  /** sha256 over everything except `hash`, `id` and `createdAt`. */
  readonly hash: string
}

export type ReceiptContent = Omit<Receipt, 'hash' | 'id' | 'createdAt'>

export function hashReceipt(content: ReceiptContent): string {
  const { schema, mandate, decision, environment, previousId } = content
  return createHash('sha256').update(canonicalJson({ schema, mandate, decision, environment, previousId })).digest('hex')
}

export function buildReceipt(input: {
  ruleSet: RuleSet
  decision: Decision
  previousId: string | null
  createdAt?: string
}): Receipt {
  const { ruleSet, decision } = input
  if (decision.ruleSetHash !== ruleSet.hash) {
    throw new Error(`decision ${decision.hash.slice(0, 12)} was made under rule set ${decision.ruleSetHash.slice(0, 12)}, not ${ruleSet.hash.slice(0, 12)}`)
  }
  const content: ReceiptContent = {
    schema: RECEIPT_SCHEMA,
    mandate: ruleSet,
    decision,
    environment: {
      portfolioSource: decision.inputs.portfolio.source,
      factsStale: decision.inputs.facts.stale,
      rationaleSource: decision.rationaleSource,
      network: decision.inputs.facts.network,
      chainId: decision.inputs.facts.chainId,
      agentVersion: AGENT_VERSION,
    },
    previousId: input.previousId,
  }
  const hash = hashReceipt(content)
  return Object.freeze({ ...content, id: hash, hash, createdAt: input.createdAt ?? new Date().toISOString() })
}

// ---------------------------------------------------------------- verify

export interface VerifyResult {
  readonly ok: boolean
  readonly checks: ReadonlyArray<{ name: string; ok: boolean; detail: string }>
}

/** Re-derives every hash the receipt carries. Pure; no I/O. */
export function verifyReceipt(receipt: Receipt): VerifyResult {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

  push('schema', receipt.schema === RECEIPT_SCHEMA, receipt.schema)
  push('id equals hash', receipt.id === receipt.hash, receipt.id.slice(0, 12))

  const recomputed = hashReceipt(receipt)
  push('receipt hash', recomputed === receipt.hash, `${recomputed.slice(0, 12)} vs ${receipt.hash.slice(0, 12)}`)

  const ruleSetParsed = RuleSetSchema.safeParse(receipt.mandate)
  push('rule set schema', ruleSetParsed.success, ruleSetParsed.success ? 'valid' : ruleSetParsed.error.issues.map((i) => i.message).join('; '))
  push('rule set hash', ruleSetParsed.success && verifyRuleSetHash(ruleSetParsed.data), receipt.mandate.hash.slice(0, 12))

  push('decision hash', verifyDecisionHash(receipt.decision), receipt.decision.hash.slice(0, 12))
  push(
    'decision cites this rule set',
    receipt.decision.ruleSetHash === receipt.mandate.hash,
    `${receipt.decision.ruleSetHash.slice(0, 12)} vs ${receipt.mandate.hash.slice(0, 12)}`,
  )
  push(
    'labels match inputs',
    receipt.environment.portfolioSource === receipt.decision.inputs.portfolio.source &&
      receipt.environment.factsStale === receipt.decision.inputs.facts.stale &&
      receipt.environment.rationaleSource === receipt.decision.rationaleSource,
    `${receipt.environment.portfolioSource}, stale=${receipt.environment.factsStale}, ${receipt.environment.rationaleSource}`,
  )

  return Object.freeze({ ok: checks.every((c) => c.ok), checks: Object.freeze(checks) })
}

// ---------------------------------------------------------------- replay

export interface ReplayResult {
  readonly reproduced: boolean
  readonly originalHash: string
  readonly replayHash: string
  readonly verdict: Decision['verdict']
  readonly replayVerdict: Decision['verdict']
  /** First differing top-level field of the hash input, when not reproduced. */
  readonly diff: string | null
}

/**
 * Runs the pure evaluator again on exactly the inputs the receipt stored.
 * Same inputs, same verdict, same numbers, same hash — or a named difference.
 */
export function replayReceipt(receipt: Receipt): ReplayResult {
  const ruleSet = RuleSetSchema.parse(receipt.mandate)
  const portfolio = deserializePortfolio(receipt.decision.inputs.portfolio)
  const facts = deserializeFacts(receipt.decision.inputs.facts)
  const action = deserializeAction(receipt.decision.inputs.action)
  const replay = evaluate(ruleSet, portfolio, facts, action)

  let diff: string | null = null
  if (replay.hash !== receipt.decision.hash) {
    const a = JSON.parse(decisionHashInput(receipt.decision)) as Record<string, unknown>
    const b = JSON.parse(decisionHashInput(replay)) as Record<string, unknown>
    diff = Object.keys(a).find((k) => canonicalJson(a[k]) !== canonicalJson(b[k])) ?? 'unknown'
  }
  return Object.freeze({
    reproduced: replay.hash === receipt.decision.hash,
    originalHash: receipt.decision.hash,
    replayHash: replay.hash,
    verdict: receipt.decision.verdict,
    replayVerdict: replay.verdict,
    diff,
  })
}
