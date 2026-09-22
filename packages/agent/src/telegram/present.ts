/**
 * How a decision reads in chat. Pure functions over the evaluator's output: every number
 * is copied from the check, never recomputed, so what the treasurer reads is what was hashed.
 */

import type { CompiledRule, RuleType } from '../mandate/schema.js'
import type { RuleCheck, VaultFacts } from '../mandate/types.js'

export const RULE_LABELS: Record<RuleType, string> = {
  max_vault_concentration: 'Vault concentration',
  max_chain_concentration: 'Chain concentration',
  min_liquidity_buffer: 'Liquidity buffer',
  max_single_action_size: 'Single action size',
  paused_vault_prohibition: 'Paused vault',
  allowed_networks: 'Allowed networks',
  whitelist_required: 'Whitelist',
}

export const ruleLabel = (type: RuleType): string => RULE_LABELS[type]

/** Console-only short codes, in DSL order. Telegram and receipts keep the labels. */
export const RULE_CODES: Record<RuleType, string> = {
  max_vault_concentration: 'CON-01',
  max_chain_concentration: 'CHN-02',
  min_liquidity_buffer: 'LIQ-03',
  max_single_action_size: 'ACT-04',
  paused_vault_prohibition: 'PSE-05',
  allowed_networks: 'NET-06',
  whitelist_required: 'CLR-07',
}

export const ruleCode = (type: RuleType): string => RULE_CODES[type]

/** The value-vs-threshold phrase for one check, in the rule's own vocabulary. */
export function checkPhrase(c: RuleCheck, facts: Pick<VaultFacts, 'network' | 'chainId' | 'paused' | 'status'>): string {
  switch (c.rule.type) {
    case 'max_vault_concentration':
    case 'max_chain_concentration':
      return `${c.actual} · limit ${c.limit}`
    case 'min_liquidity_buffer':
      return `${c.actual} liquid · floor ${c.limit}`
    case 'max_single_action_size':
      return `${c.actual} of the book · limit ${c.limit}`
    case 'paused_vault_prohibition':
      if (c.passed) return facts.paused === null ? `not paused (status ${facts.status ?? 'unknown'})` : 'not paused'
      return facts.paused === true ? 'PAUSED on-chain' : `status ${facts.status ?? 'unknown'}`
    case 'allowed_networks':
      return `${facts.network} (${facts.chainId}) · ${c.passed ? 'allowed' : 'not allowed'}`
    case 'whitelist_required':
      return c.passed ? 'cleared' : c.actual
  }
}

/** One check -> one or two lines. Breached rules carry the treasurer's clause underneath. */
export function checkLines(c: RuleCheck, facts: Pick<VaultFacts, 'network' | 'chainId' | 'paused' | 'status'>): string[] {
  const label = ruleLabel(c.rule.type)
  if (!c.applicable) return [`– ${label} — not applicable`]
  const line = `${c.passed ? '✓' : '✗'} ${label} — ${checkPhrase(c, facts)}`
  return c.passed ? [line] : [line, `    "${c.rule.sourcePhrase}"`]
}

/** The rationale without its leading verdict word: the headline already carries it. */
export function trimVerdict(rationale: string): string {
  return rationale.replace(/^\s*(ALLOWED|REFUSED)\b[\s.:,;!—-]*/, '').trim()
}

/** Chain ids the mandate may name -> the network names the treasurer knows them by. */
const NETWORK_NAMES: Record<number, string> = {
  97: 'bsc-testnet',
  43113: 'avalanche-testnet',
  5042002: 'arc-testnet',
  4663: 'robinhood-mainnet',
}

export const networkName = (chainId: number): string => NETWORK_NAMES[chainId] ?? `chain ${chainId}`

/** A compiled rule's threshold, in the rule's own vocabulary. */
export function ruleThreshold(r: CompiledRule): string {
  switch (r.type) {
    case 'max_vault_concentration':
      return `max ${r.maxPct}% in any one vault`
    case 'max_chain_concentration':
      return `max ${r.maxPct}% on any one chain`
    case 'min_liquidity_buffer':
      return `at least ${r.minPct}% kept liquid`
    case 'max_single_action_size':
      return [r.maxPct !== null ? `max ${r.maxPct}% of the book per action` : null, r.maxAbsolute !== null ? `max ${r.maxAbsolute} per action` : null]
        .filter(Boolean)
        .join(', ')
    case 'paused_vault_prohibition':
      return 'never touch a paused vault'
    case 'allowed_networks':
      return r.chainIds.map(networkName).join(', ')
    case 'whitelist_required':
      return 'only vaults this wallet is cleared for'
  }
}

/** One compiled rule -> two lines: `n. Label — threshold (inferred)` and the clause it came from. */
export function ruleLines(r: CompiledRule, n: number): string[] {
  return [`${n}. ${ruleLabel(r.type)} — ${ruleThreshold(r)}${r.inferred ? ' (inferred)' : ''}`, `    "${r.sourcePhrase}"`]
}
