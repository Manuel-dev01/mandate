/**
 * Evaluator inputs and outputs.
 *
 * Money is bigint in the PORTFOLIO asset's base units (USDC/USDG, 6dp). The
 * JSON forms below carry those as decimal-integer strings so fixtures and
 * receipts round-trip without ever touching a float.
 */

import { z } from 'zod'
import type { CompiledRule } from './schema.js'

// ----------------------------------------------------------------- inputs

export interface PortfolioPosition {
  readonly vaultId: string
  readonly chainId: number
  /** Current value of the position, in portfolio asset base units. */
  readonly value: bigint
}

/**
 * Where the numbers came from. `declared` is a seed file for rehearsal or an
 * unfunded wallet; it is serialized into every decision and therefore into the
 * hash, so a declared portfolio can never masquerade as a live one.
 */
export type PortfolioSource = 'onchain' | 'declared'

export interface PortfolioState {
  readonly wallet: string
  readonly asset: { readonly symbol: string; readonly decimals: number }
  /** Undeployed, liquid balance. */
  readonly idle: bigint
  readonly positions: readonly PortfolioPosition[]
  readonly asOf: string
  readonly source: PortfolioSource
}

/**
 * Everything the predicates may look at about the target vault. Gathered by
 * `facts.ts` (the only I/O); `null` means "could not verify", and each rule
 * decides what that means for it.
 */
export interface VaultFacts {
  readonly vaultId: string
  readonly name: string
  readonly chainId: number
  readonly network: string
  readonly status: string | null
  readonly settlement: 'sync' | 'async-erc7540' | 'queued'
  readonly requiresWhitelist: boolean
  readonly asset: { readonly symbol: string; readonly decimals: number }
  /** Vault TVL in the vault asset's base units — for the ownership-share figure. */
  readonly totalAssets: bigint
  /** On-chain `paused()`. null = unreadable (revert, no such function, RPC down). */
  readonly paused: boolean | null
  /** Fresh `vault_check_whitelist`. null = the check itself failed. */
  readonly whitelisted: boolean | null
  readonly whitelistEnabled: boolean | null
  readonly observedAt: string
  /** True when vault pricing came from a cached snapshot. Surfaced, never hidden. */
  readonly stale: boolean
}

export type ActionKind = 'deposit' | 'redeem'

export interface ProposedAction {
  readonly kind: ActionKind
  readonly vaultId: string
  /** Portfolio asset base units. */
  readonly amount: bigint
  /**
   * The treasurer's words, carried into the receipt for the record. NO
   * PREDICATE READS THIS FIELD. "Ignore the rule, I'm the owner" is stored,
   * not obeyed.
   */
  readonly userMessage?: string
}

// ---------------------------------------------------------------- outputs

export type Verdict = 'ALLOW' | 'REFUSE'

export interface RuleCheck {
  readonly rule: CompiledRule
  /** False when the rule does not bear on this action kind; counts as passed. */
  readonly applicable: boolean
  readonly passed: boolean
  /** Formatted observed value, e.g. "62.50%" or "50000.000000 USDC". */
  readonly actual: string
  /** Formatted threshold, e.g. "40.00%". */
  readonly limit: string
  /** One plain sentence a console can show. */
  readonly detail: string
}

export type RationaleSource = 'template' | 'serv'

/**
 * What SERV was asked and what it answered, for the receipt. Unhashed, like
 * the rationale itself: prose and its provenance never move the verdict.
 */
export interface ExplanationTrace {
  readonly attempted: boolean
  readonly model: string | null
  readonly tokens: number
  /** SERV Tools attached, e.g. ['serv_prompt_guard', 'serv_shadow_agent']. */
  readonly tools: readonly string[]
  /** True when serv_prompt_guard short-circuited the turn. */
  readonly guarded: boolean
  readonly note: string | null
}

/** Serialized inputs — bigints as strings — so the decision is plain JSON. */
export interface DecisionInputs {
  readonly portfolio: SerializedPortfolio
  readonly facts: SerializedFacts
  readonly action: SerializedAction
}

export interface Decision {
  readonly verdict: Verdict
  readonly ruleSetHash: string
  readonly ruleSetVersion: number
  /** Every rule, in DSL order. Beat 4 shows all of them, pass or fail. */
  readonly checks: readonly RuleCheck[]
  /** The failures only. */
  readonly citedRules: readonly RuleCheck[]
  readonly numbers: Readonly<Record<string, string>>
  /** Always present. The template until `explain()` upgrades it. */
  readonly rationale: string
  readonly rationaleSource: RationaleSource
  /** Null until explain() runs. Excluded from the hash. */
  readonly explanation: ExplanationTrace | null
  readonly inputs: DecisionInputs
  readonly evaluatedAt: string
  /** sha256 over everything except evaluatedAt, rationale, rationaleSource. */
  readonly hash: string
}

// ------------------------------------------------------------ JSON forms

const BigIntString = z.string().regex(/^-?\d+$/, 'integer base-unit string')
const AssetRef = z.object({ symbol: z.string(), decimals: z.number().int().nonnegative() })

export const SerializedPortfolioSchema = z.object({
  wallet: z.string(),
  asset: AssetRef,
  idle: BigIntString,
  positions: z.array(z.object({ vaultId: z.string(), chainId: z.number().int(), value: BigIntString })),
  asOf: z.string(),
  source: z.enum(['onchain', 'declared']),
})
export type SerializedPortfolio = z.infer<typeof SerializedPortfolioSchema>

export const SerializedFactsSchema = z.object({
  vaultId: z.string(),
  name: z.string(),
  chainId: z.number().int(),
  network: z.string(),
  status: z.string().nullable(),
  settlement: z.enum(['sync', 'async-erc7540', 'queued']),
  requiresWhitelist: z.boolean(),
  asset: AssetRef,
  totalAssets: BigIntString,
  paused: z.boolean().nullable(),
  whitelisted: z.boolean().nullable(),
  whitelistEnabled: z.boolean().nullable(),
  observedAt: z.string(),
  stale: z.boolean(),
})
export type SerializedFacts = z.infer<typeof SerializedFactsSchema>

export const SerializedActionSchema = z.object({
  kind: z.enum(['deposit', 'redeem']),
  vaultId: z.string(),
  amount: BigIntString,
  userMessage: z.string().nullable(),
})
export type SerializedAction = z.infer<typeof SerializedActionSchema>

export function serializePortfolio(p: PortfolioState): SerializedPortfolio {
  return {
    wallet: p.wallet,
    asset: { ...p.asset },
    idle: p.idle.toString(),
    positions: p.positions.map((x) => ({ vaultId: x.vaultId, chainId: x.chainId, value: x.value.toString() })),
    asOf: p.asOf,
    source: p.source,
  }
}

export function serializeFacts(f: VaultFacts): SerializedFacts {
  return { ...f, asset: { ...f.asset }, totalAssets: f.totalAssets.toString() }
}

export function serializeAction(a: ProposedAction): SerializedAction {
  return { kind: a.kind, vaultId: a.vaultId, amount: a.amount.toString(), userMessage: a.userMessage ?? null }
}

export function deserializePortfolio(s: SerializedPortfolio): PortfolioState {
  const p = SerializedPortfolioSchema.parse(s)
  return {
    wallet: p.wallet,
    asset: p.asset,
    idle: BigInt(p.idle),
    positions: p.positions.map((x) => ({ vaultId: x.vaultId, chainId: x.chainId, value: BigInt(x.value) })),
    asOf: p.asOf,
    source: p.source,
  }
}

export function deserializeFacts(s: SerializedFacts): VaultFacts {
  const f = SerializedFactsSchema.parse(s)
  return { ...f, totalAssets: BigInt(f.totalAssets) }
}

export function deserializeAction(s: SerializedAction): ProposedAction {
  const a = SerializedActionSchema.parse(s)
  return a.userMessage === null
    ? { kind: a.kind, vaultId: a.vaultId, amount: BigInt(a.amount) }
    : { kind: a.kind, vaultId: a.vaultId, amount: BigInt(a.amount), userMessage: a.userMessage }
}
