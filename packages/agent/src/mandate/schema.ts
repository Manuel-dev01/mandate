/**
 * The Mandate DSL — SEVEN rule types. Hard cap.
 *
 * docs/MANDATE_DSL.md is the spec. An eighth rule type is a D15 feature and
 * D15 does not exist. If English implies a rule we cannot express, it goes in
 * `unmappable` — surfaced, never silently dropped.
 *
 * Every rule is a deterministic predicate with a numeric threshold and the
 * verbatim phrase it came from. Evaluation (D3) happens in TypeScript; the
 * model only ever compiles and explains.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'

// ------------------------------------------------------------------ networks

/** The live vault universe's chains — docs/RECON.md §2. */
export const KNOWN_NETWORKS = Object.freeze({
  'avalanche-testnet': 43113,
  'bsc-testnet': 97,
  'arc-testnet': 5042002,
  'robinhood-mainnet': 4663,
} as const)

export type KnownNetwork = keyof typeof KNOWN_NETWORKS

export const TESTNET_CHAIN_IDS: readonly number[] = Object.freeze([43113, 97, 5042002])
export const MAINNET_CHAIN_IDS: readonly number[] = Object.freeze([4663])
export const ALL_CHAIN_IDS: readonly number[] = Object.freeze([...TESTNET_CHAIN_IDS, ...MAINNET_CHAIN_IDS])

// --------------------------------------------------------------------- rules

/** Percentage points, (0, 100]. A threshold of 0 or >100 is never a policy. */
const Pct = z.number().gt(0).lte(100)

/** Asset units as a decimal string (USDC/USDG are 6dp). Never a float. */
const AssetDecimal = z.string().regex(/^\d+(\.\d{1,6})?$/, 'decimal string with at most 6dp')

export const RULE_TYPES = [
  'max_vault_concentration',
  'max_chain_concentration',
  'min_liquidity_buffer',
  'max_single_action_size',
  'paused_vault_prohibition',
  'allowed_networks',
  'whitelist_required',
] as const

export type RuleType = (typeof RULE_TYPES)[number]

/** Sorted ascending so two lists with the same chains hash identically. */
const ChainIds = z
  .array(z.number().int().positive())
  .min(1)
  .transform((ids) => Object.freeze([...new Set(ids)].sort((a, b) => a - b)))

/** The seven shapes. Each is listed once; both unions below derive from them. */
const M = {
  /** 1. Ceiling on the share of portfolio value in any single vault. */
  max_vault_concentration: z.object({ type: z.literal('max_vault_concentration'), maxPct: Pct }),
  /** 2. Ceiling on exposure to any one chain. */
  max_chain_concentration: z.object({ type: z.literal('max_chain_concentration'), maxPct: Pct }),
  /** 3. Floor on unallocated assets held back. */
  min_liquidity_buffer: z.object({ type: z.literal('min_liquidity_buffer'), minPct: Pct }),
  /** 4. Blast-radius limit on any one action — either bound may be null, not both. */
  max_single_action_size: z.object({
    type: z.literal('max_single_action_size'),
    maxPct: Pct.nullable(),
    maxAbsolute: AssetDecimal.nullable(),
  }),
  /** 5. Never interact with a paused / non-active vault. Read live, never cached. */
  paused_vault_prohibition: z.object({ type: z.literal('paused_vault_prohibition'), enabled: z.literal(true) }),
  /** 6. Chain allowlist. Mainnet is opt-in. */
  allowed_networks: z.object({ type: z.literal('allowed_networks'), chainIds: ChainIds }),
  /** 7. Refuse vaults this wallet is not cleared for (vault_check_whitelist). */
  whitelist_required: z.object({ type: z.literal('whitelist_required'), enforce: z.literal(true) }),
} as const

/** Compile-time guard: M must cover exactly RULE_TYPES, no more, no fewer. */
type _Covers = [keyof typeof M] extends [RuleType] ? ([RuleType] extends [keyof typeof M] ? true : never) : never
const _covers: _Covers = true
void _covers

const RuleUnion = z.discriminatedUnion('type', [
  M.max_vault_concentration.strict(),
  M.max_chain_concentration.strict(),
  M.min_liquidity_buffer.strict(),
  M.max_single_action_size.strict(),
  M.paused_vault_prohibition.strict(),
  M.allowed_networks.strict(),
  M.whitelist_required.strict(),
])

function needsOneBound(r: { type: string; maxPct?: number | null; maxAbsolute?: string | null }, ctx: z.RefinementCtx): void {
  if (r.type === 'max_single_action_size' && r.maxPct === null && r.maxAbsolute === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'max_single_action_size needs maxPct or maxAbsolute' })
  }
}

/** discriminatedUnion cannot carry a refine on a member, so the cross-field check sits here. */
export const RuleSchema = RuleUnion.superRefine(needsOneBound)

export type Rule = z.infer<typeof RuleUnion>

const provenance = {
  /** The clause in the user's English this rule came from. Verbatim. */
  sourcePhrase: z.string().min(1),
  /**
   * True when the compiler supplied a threshold the user did not state, or
   * had to substitute a sentence because the model paraphrased the quote.
   * The three number-less types can only be inferred by the second route.
   */
  inferred: z.boolean(),
}

const CompiledRuleUnion = z.discriminatedUnion('type', [
  M.max_vault_concentration.extend(provenance).strict(),
  M.max_chain_concentration.extend(provenance).strict(),
  M.min_liquidity_buffer.extend(provenance).strict(),
  M.max_single_action_size.extend(provenance).strict(),
  M.paused_vault_prohibition.extend(provenance).strict(),
  M.allowed_networks.extend(provenance).strict(),
  M.whitelist_required.extend(provenance).strict(),
])

export const CompiledRuleSchema = CompiledRuleUnion.superRefine(needsOneBound)
export type CompiledRule = z.infer<typeof CompiledRuleUnion>

// ------------------------------------------------------------------ rule set

export const RuleSetSchema = z
  .object({
    version: z.number().int().positive(),
    /** sha256 of the canonical content — receipts cite the exact version that ran. */
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    /** The user's original English, preserved verbatim. */
    sourceText: z.string().min(1),
    rules: z
      .array(CompiledRuleSchema)
      // A mandate with no rules would cite nothing and therefore ALLOW everything --
      // the exact opposite of the product. An unenforceable policy is a compile
      // failure, never an empty rule set.
      .min(1)
      .max(RULE_TYPES.length)
      .refine((rules) => new Set(rules.map((r) => r.type)).size === rules.length, {
        message: 'one rule per type',
      }),
    /** Clauses we could NOT express — a feature, not an error path. */
    unmappable: z.array(z.string()),
    compiledAt: z.string().datetime(),
    /** Which SERV model compiled it. Provenance for the receipt. */
    model: z.string(),
  })
  .strict()

export type RuleSet = z.infer<typeof RuleSetSchema>

/** The fields the hash commits to. Timestamps and model are provenance, not content. */
export type RuleSetContent = Pick<RuleSet, 'version' | 'sourceText' | 'rules' | 'unmappable'>

/**
 * Deterministic JSON: keys sorted at every level, no whitespace. Two rule sets
 * with the same content hash identically regardless of construction order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

export function hashRuleSet(content: RuleSetContent): string {
  const { version, sourceText, rules, unmappable } = content
  return createHash('sha256').update(canonicalJson({ version, sourceText, rules, unmappable })).digest('hex')
}

export function buildRuleSet(input: RuleSetContent & { model: string; compiledAt?: string }): RuleSet {
  const rules = input.rules.map((r) => CompiledRuleSchema.parse(r))
  const content: RuleSetContent = {
    version: input.version,
    sourceText: input.sourceText,
    rules,
    unmappable: [...input.unmappable],
  }
  return RuleSetSchema.parse({
    ...content,
    hash: hashRuleSet(content),
    compiledAt: input.compiledAt ?? new Date().toISOString(),
    model: input.model,
  })
}

/** Re-derives the hash. A receipt that cites a rule set can prove it unchanged. */
export function verifyRuleSetHash(ruleSet: RuleSet): boolean {
  return hashRuleSet(ruleSet) === ruleSet.hash
}

// -------------------------------------------------------------------- merging

/**
 * Two rules of the same type collapse to the STRICTER one. Conservative by
 * construction: a mandate that says "40%" and "no more than 30%" means 30%.
 */
export function stricter(a: CompiledRule, b: CompiledRule): CompiledRule {
  if (a.type !== b.type) throw new Error(`cannot merge ${a.type} with ${b.type}`)
  switch (a.type) {
    case 'max_vault_concentration':
    case 'max_chain_concentration':
      return a.maxPct <= (b as typeof a).maxPct ? a : b
    case 'min_liquidity_buffer':
      return a.minPct >= (b as typeof a).minPct ? a : b
    case 'max_single_action_size': {
      const o = b as typeof a
      const maxPct = minNullable(a.maxPct, o.maxPct)
      const maxAbsolute = minDecimal(a.maxAbsolute, o.maxAbsolute)
      return { ...a, maxPct, maxAbsolute, inferred: a.inferred && o.inferred }
    }
    case 'allowed_networks': {
      const o = b as typeof a
      const common = a.chainIds.filter((id) => o.chainIds.includes(id))
      // An empty intersection is a contradiction; keep the narrower list rather
      // than allow nothing, and flag it as inferred so the user sees it.
      const chainIds = common.length > 0 ? common : a.chainIds.length <= o.chainIds.length ? a.chainIds : o.chainIds
      return { ...a, chainIds: Object.freeze([...chainIds]), inferred: common.length === 0 || (a.inferred && o.inferred) }
    }
    case 'paused_vault_prohibition':
    case 'whitelist_required':
      return a.inferred ? b : a
    default: {
      const exhaustive: never = a
      throw new Error(`unhandled rule type ${String((exhaustive as { type?: unknown }).type)}`)
    }
  }
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}

/** Compare decimal strings without floats: pad to 6dp and compare as bigint. */
function minDecimal(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return toMicro(a) <= toMicro(b) ? a : b
}

function toMicro(decimal: string): bigint {
  const [whole = '0', frac = ''] = decimal.split('.')
  return BigInt(whole + frac.padEnd(6, '0').slice(0, 6))
}
