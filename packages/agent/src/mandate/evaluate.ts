/**
 * The compliance evaluator. THIS IS THE PRODUCT.
 *
 *   evaluate(ruleSet, portfolio, facts, action) -> Decision
 *
 * Pure and synchronous. Every rule is a TypeScript predicate over bigints.
 * No model is consulted, no I/O happens, no float is ever formed. The same
 * inputs produce the same verdict, the same numbers and the same hash, every
 * time — which is why a refusal here can be shown to an auditor.
 *
 * SERV is allowed to EXPLAIN a decision afterwards (explain.ts). It never
 * gets a vote. If you find yourself passing a Decision to a model before the
 * verdict is fixed, stop.
 */

import { createHash } from 'node:crypto'
import { formatBaseUnits, parseDecimalAmount } from '../ixs/schemas.js'
import { canonicalJson, type CompiledRule, type RuleSet } from './schema.js'
import {
  serializeAction,
  serializeFacts,
  serializePortfolio,
  type Decision,
  type PortfolioState,
  type ProposedAction,
  type RuleCheck,
  type VaultFacts,
  type Verdict,
} from './types.js'

// ---------------------------------------------------------------- numbers

/**
 * num/den as a percentage with two decimals, round-half-up, no floats.
 * A zero denominator reads as 100.00% when there is a numerator and 0.00%
 * otherwise — an empty portfolio is fully concentrated by any deposit.
 */
export function formatPct(num: bigint, den: bigint): string {
  if (den === 0n) return num > 0n ? '100.00%' : '0.00%'
  const scaled = (abs(num) * 100_000n) / abs(den) // percent * 1000 (one guard digit)
  const hundredths = (scaled + 5n) / 10n
  const sign = (num < 0n) !== (den < 0n) && num !== 0n ? '-' : ''
  return `${sign}${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}%`
}

/** Percentage points (<= 2dp) -> basis points as bigint. 40 -> 4000n. */
export function pctToBps(pct: number): bigint {
  return BigInt(Math.round(pct * 100))
}

function formatMoney(value: bigint, asset: { symbol: string; decimals: number }): string {
  return `${formatBaseUnits(value, asset.decimals)} ${asset.symbol}`
}

function abs(v: bigint): bigint {
  return v < 0n ? -v : v
}

function max0(v: bigint): bigint {
  return v < 0n ? 0n : v
}

/** Rescale base units between assets of different decimals. */
function rescale(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return value
  return fromDecimals < toDecimals
    ? value * 10n ** BigInt(toDecimals - fromDecimals)
    : value / 10n ** BigInt(fromDecimals - toDecimals)
}

// ------------------------------------------------------------ projection

interface Projection {
  readonly total: bigint
  readonly currentVault: bigint
  readonly postVault: bigint
  readonly currentChain: bigint
  readonly postChain: bigint
  readonly postIdle: bigint
  /** Share of the VAULT's TVL we would own after a deposit. Context only. */
  readonly vaultShareNum: bigint
  readonly vaultShareDen: bigint
}

function project(portfolio: PortfolioState, facts: VaultFacts, action: ProposedAction): Projection {
  const total = portfolio.positions.reduce((acc, p) => acc + p.value, portfolio.idle)
  const currentVault = portfolio.positions.filter((p) => p.vaultId === action.vaultId).reduce((a, p) => a + p.value, 0n)
  const currentChain = portfolio.positions.filter((p) => p.chainId === facts.chainId).reduce((a, p) => a + p.value, 0n)
  const delta = action.kind === 'deposit' ? action.amount : -action.amount

  const postVault = max0(currentVault + delta)
  const tvl = rescale(facts.totalAssets, facts.asset.decimals, portfolio.asset.decimals)
  return {
    total,
    currentVault,
    postVault,
    currentChain,
    postChain: max0(currentChain + delta),
    postIdle: max0(portfolio.idle - delta),
    vaultShareNum: postVault,
    vaultShareDen: max0(tvl + delta),
  }
}

// ------------------------------------------------------------- predicates
// One function per rule type. Each returns actual / limit / passed / detail and
// nothing else. No predicate reads action.userMessage.

type Predicate = (rule: CompiledRule, ctx: Ctx) => Omit<RuleCheck, 'rule'>

interface Ctx {
  readonly portfolio: PortfolioState
  readonly facts: VaultFacts
  readonly action: ProposedAction
  readonly p: Projection
}

const notApplicable = (rule: CompiledRule, why: string): Omit<RuleCheck, 'rule'> => ({
  applicable: false,
  passed: true,
  actual: 'n/a',
  limit: 'n/a',
  detail: `${rule.type} does not apply to a ${why}.`,
})

const PREDICATES: Record<CompiledRule['type'], Predicate> = {
  max_vault_concentration(rule, { action, p }) {
    if (rule.type !== 'max_vault_concentration') throw new TypeError(rule.type)
    if (action.kind !== 'deposit') return notApplicable(rule, 'redeem (it reduces exposure)')
    const limitBps = pctToBps(rule.maxPct)
    const breached = p.total === 0n ? p.postVault > 0n : p.postVault * 10_000n > limitBps * p.total
    const actual = formatPct(p.postVault, p.total)
    return {
      applicable: true,
      passed: !breached,
      actual,
      limit: formatPct(limitBps, 10_000n),
      detail: `This vault would hold ${actual} of the portfolio; the mandate caps any single vault at ${formatPct(limitBps, 10_000n)}.`,
    }
  },

  max_chain_concentration(rule, { action, facts, p }) {
    if (rule.type !== 'max_chain_concentration') throw new TypeError(rule.type)
    if (action.kind !== 'deposit') return notApplicable(rule, 'redeem (it reduces exposure)')
    const limitBps = pctToBps(rule.maxPct)
    const breached = p.total === 0n ? p.postChain > 0n : p.postChain * 10_000n > limitBps * p.total
    const actual = formatPct(p.postChain, p.total)
    return {
      applicable: true,
      passed: !breached,
      actual,
      limit: formatPct(limitBps, 10_000n),
      detail: `Chain ${facts.chainId} (${facts.network}) would carry ${actual} of the portfolio; the cap per chain is ${formatPct(limitBps, 10_000n)}.`,
    }
  },

  min_liquidity_buffer(rule, { action, p }) {
    if (rule.type !== 'min_liquidity_buffer') throw new TypeError(rule.type)
    if (action.kind !== 'deposit') return notApplicable(rule, 'redeem (it adds liquidity)')
    const floorBps = pctToBps(rule.minPct)
    const breached = p.total === 0n ? true : p.postIdle * 10_000n < floorBps * p.total
    const actual = formatPct(p.postIdle, p.total)
    return {
      applicable: true,
      passed: !breached,
      actual,
      limit: formatPct(floorBps, 10_000n),
      detail: `Idle balance after the action would be ${actual} of the portfolio; the mandate keeps at least ${formatPct(floorBps, 10_000n)} liquid.`,
    }
  },

  max_single_action_size(rule, { action, portfolio, p }) {
    if (rule.type !== 'max_single_action_size') throw new TypeError(rule.type)
    const parts: string[] = []
    const limits: string[] = []
    let breached = false
    if (rule.maxPct !== null) {
      const bps = pctToBps(rule.maxPct)
      const over = p.total === 0n ? action.amount > 0n : action.amount * 10_000n > bps * p.total
      breached ||= over
      parts.push(formatPct(action.amount, p.total))
      limits.push(formatPct(bps, 10_000n))
    }
    if (rule.maxAbsolute !== null) {
      const cap = parseDecimalAmount(rule.maxAbsolute, portfolio.asset.decimals)
      breached ||= action.amount > cap
      parts.push(formatMoney(action.amount, portfolio.asset))
      limits.push(formatMoney(cap, portfolio.asset))
    }
    return {
      applicable: true,
      passed: !breached,
      actual: parts.join(' / '),
      limit: limits.join(' / '),
      detail: `This ${action.kind} is ${parts.join(' and ')}; the per-action ceiling is ${limits.join(' and ')}.`,
    }
  },

  paused_vault_prohibition(rule, { facts }) {
    if (rule.type !== 'paused_vault_prohibition') throw new TypeError(rule.type)
    const active = facts.status === 'active'
    // On-chain paused() is the primary signal. When it is unreadable, the API
    // status field decides — recorded so the receipt shows which one ran.
    const breached = facts.paused === true || (facts.paused === null && !active)
    const source = facts.paused === null ? 'status-fallback' : 'onchain'
    const actual =
      facts.paused === null ? `paused() unreadable, status=${facts.status ?? 'unknown'}` : `paused()=${facts.paused}, status=${facts.status ?? 'unknown'}`
    return {
      applicable: true,
      passed: !breached,
      actual,
      limit: 'not paused, status active',
      detail: breached
        ? `The vault is ${facts.paused === true ? 'paused on-chain' : `reported as ${facts.status ?? 'unknown'}`} (${source}); the mandate forbids touching it.`
        : `The vault is live (${source}).`,
    }
  },

  allowed_networks(rule, { action, facts }) {
    if (rule.type !== 'allowed_networks') throw new TypeError(rule.type)
    if (action.kind !== 'deposit') return notApplicable(rule, 'redeem (leaving a chain is always allowed)')
    const allowed = rule.chainIds.includes(facts.chainId)
    return {
      applicable: true,
      passed: allowed,
      actual: `chain ${facts.chainId} (${facts.network})`,
      limit: `chains ${rule.chainIds.join(', ')}`,
      detail: allowed
        ? `Chain ${facts.chainId} is on the mandate's allowlist.`
        : `Chain ${facts.chainId} (${facts.network}) is not on the mandate's allowlist [${rule.chainIds.join(', ')}].`,
    }
  },

  whitelist_required(rule, { action, facts, portfolio }) {
    if (rule.type !== 'whitelist_required') throw new TypeError(rule.type)
    if (action.kind !== 'deposit') return notApplicable(rule, 'redeem (exit needs no clearance)')
    // Fail closed: the whole point of this rule is verification, so an
    // unverifiable check is a refusal, not a pass with a warning.
    const cleared = facts.whitelisted === true
    const actual =
      facts.whitelisted === null ? 'could not verify' : facts.whitelisted ? 'whitelisted' : 'not whitelisted'
    return {
      applicable: true,
      passed: cleared,
      actual,
      limit: 'whitelisted',
      detail: cleared
        ? `Wallet ${portfolio.wallet} is cleared for this vault${facts.whitelistEnabled === false ? ' (no whitelist enforced)' : ''}.`
        : facts.whitelisted === null
          ? `Could not verify that wallet ${portfolio.wallet} is cleared for this vault; refusing rather than assuming.`
          : `Wallet ${portfolio.wallet} is not on this vault's whitelist.`,
    }
  },
}

// ---------------------------------------------------------------- evaluate

export function evaluate(ruleSet: RuleSet, portfolio: PortfolioState, facts: VaultFacts, action: ProposedAction): Decision {
  if (action.vaultId !== facts.vaultId) {
    throw new Error(`facts are for vault ${facts.vaultId} but the action targets ${action.vaultId}`)
  }
  if (action.amount <= 0n) throw new Error('action amount must be positive')

  const p = project(portfolio, facts, action)
  const ctx: Ctx = { portfolio, facts, action, p }

  // All rules always run, in the rule set's (DSL) order.
  const checks: RuleCheck[] = ruleSet.rules.map((rule) => ({ rule, ...PREDICATES[rule.type](rule, ctx) }))
  const citedRules = checks.filter((c) => !c.passed)
  const verdict: Verdict = citedRules.length === 0 ? 'ALLOW' : 'REFUSE'

  const numbers: Record<string, string> = {
    action: `${action.kind} ${formatMoney(action.amount, portfolio.asset)} into ${facts.name}`,
    totalPortfolio: formatMoney(p.total, portfolio.asset),
    idleBefore: formatMoney(portfolio.idle, portfolio.asset),
    idleAfter: formatMoney(p.postIdle, portfolio.asset),
    postIdlePct: formatPct(p.postIdle, p.total),
    vaultValueBefore: formatMoney(p.currentVault, portfolio.asset),
    vaultValueAfter: formatMoney(p.postVault, portfolio.asset),
    postVaultPct: formatPct(p.postVault, p.total),
    postChainPct: formatPct(p.postChain, p.total),
    actionPctOfPortfolio: formatPct(action.amount, p.total),
    vaultTvl: formatMoney(facts.totalAssets, facts.asset),
    // The beat-3 figure: how much of the vault itself we would own.
    vaultShareAfter: formatPct(p.vaultShareNum, p.vaultShareDen),
    pausedSource: facts.paused === null ? 'status-fallback' : 'onchain',
    factsStale: facts.stale ? 'true' : 'false',
  }
  if (action.kind === 'deposit' && action.amount > portfolio.idle) numbers['insufficientIdle'] = 'true'

  const inputs = {
    portfolio: serializePortfolio(portfolio),
    facts: serializeFacts(facts),
    action: serializeAction(action),
  }

  const hashed = { verdict, ruleSetHash: ruleSet.hash, ruleSetVersion: ruleSet.version, checks, citedRules, numbers, inputs }
  const hash = createHash('sha256').update(canonicalJson(hashed)).digest('hex')

  return Object.freeze({
    ...hashed,
    rationale: templateRationale(verdict, checks, citedRules),
    rationaleSource: 'template',
    evaluatedAt: new Date().toISOString(),
    hash,
  })
}

/** Plain text, no LaTeX, always available. The model may replace it; it never replaces the verdict. */
export function templateRationale(verdict: Verdict, checks: readonly RuleCheck[], cited: readonly RuleCheck[]): string {
  const applicable = checks.filter((c) => c.applicable).length
  if (verdict === 'ALLOW') {
    return `ALLOWED. All ${applicable} applicable rule${applicable === 1 ? '' : 's'} pass (${checks.length} evaluated).`
  }
  const lines = cited.map(
    (c) => `${c.rule.type}: ${c.detail} Actual ${c.actual}, limit ${c.limit} ("${c.rule.sourcePhrase}").`,
  )
  return `REFUSED. ${cited.length} of ${checks.length} rules breached. ${lines.join(' ')}`
}

/** The fields the hash commits to, for anyone re-deriving it. */
export function decisionHashInput(d: Decision): string {
  const { verdict, ruleSetHash, ruleSetVersion, checks, citedRules, numbers, inputs } = d
  return canonicalJson({ verdict, ruleSetHash, ruleSetVersion, checks, citedRules, numbers, inputs })
}

export function verifyDecisionHash(d: Decision): boolean {
  return createHash('sha256').update(decisionHashInput(d)).digest('hex') === d.hash
}
