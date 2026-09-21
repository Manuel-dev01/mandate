/**
 * The Telegram surface — five handlers, each returning the exact plain text
 * the platform relays. Testable without the platform: every dependency is
 * injectable.
 *
 * Nothing here decides anything. Verdicts come from evaluate(); prose comes
 * from explain() after the verdict; receipts come from record(). The OpenServ
 * runtime's own LLM only routes a message to one of these and relays the
 * string back — see the system prompt in agent.ts.
 *
 * Telegram renders plain text: no LaTeX, no markdown tables, short lines.
 */

import { receiptStore, record, replayReceipt, verifyReceipt, type ReceiptStore } from '../audit/index.js'
import { env } from '../env.js'
import { listVaults, type Snapshot, type VaultUniverse } from '../ixs/index.js'
import { parseDecimalAmount, type Vault } from '../ixs/schemas.js'
import { prettyAmount } from './format.js'
import { checkLines, ruleLabel, ruleLines, trimVerdict } from './present.js'
import { compileCached } from '../mandate/compile.js'
import { evaluate } from '../mandate/evaluate.js'
import { explain } from '../mandate/explain.js'
import { gatherFacts } from '../mandate/facts.js'
import { loadPortfolio } from '../mandate/portfolio.js'
import type { RuleSet } from '../mandate/schema.js'
import type { Decision, PortfolioState, VaultFacts } from '../mandate/types.js'
import { agentAddress } from '../signer/index.js'
import { FileMandateStore, type MandateStore } from './mandates.js'

export interface CapabilityDeps {
  wallet: string
  mandates: MandateStore
  receipts: ReceiptStore & { resolve?: (prefix: string) => string | null }
  compile: (text: string) => Promise<RuleSet>
  universe: () => Promise<Snapshot<VaultUniverse>>
  facts: (vaultId: string, wallet: string) => Promise<VaultFacts>
  portfolio: (wallet: string, targetVaultId: string, vaults: readonly Vault[]) => Promise<PortfolioState>
  explain: (decision: Decision) => Promise<Decision>
  /** Last vault each chat talked about, so "the same vault" resolves. Process-lifetime. */
  recent?: Map<string, string>
}

let defaults: CapabilityDeps | null = null

/** Production wiring. Lazy so importing this module never touches the key or the disk. */
export function defaultDeps(): CapabilityDeps {
  defaults ??= {
    wallet: agentAddress(),
    mandates: new FileMandateStore(),
    receipts: receiptStore(),
    compile: (text) => compileCached(text),
    universe: () => listVaults(),
    facts: (vaultId, wallet) => gatherFacts({ vaultId, wallet }),
    portfolio: (wallet, targetVaultId, vaults) => loadPortfolio({ wallet, targetVaultId, source: 'declared', vaults }),
    explain: (decision) => explain(decision),
    recent: new Map(),
  }
  return defaults
}

// ----------------------------------------------------------------- helpers

const NAME_HINTS: ReadonlyArray<[RegExp, string]> = [
  [/avalanche|avax|fuji/i, '6a952683732c2b84b55ce89b'],
  [/robinhood|rh\b/i, '6a8832289e7fddf1f49e6f51'],
  [/\barc\b/i, '6a8832299e7fddf1f49e6f6c'],
  [/whitelist|t_ix|7540v1/i, '6a8ebe8e732c2b84b55ce88c'],
  [/\bbsc\b|bnb|binance/i, '6a278b40a7d16b245d665479'],
]

const SAME_RE = /\b(same|that|this|it|previous|again|there)\b/i

/**
 * "the Avalanche vault", "BSC", an id, a name fragment, or "the same vault"
 * (given the chat's last vault) -> one vault, or a question.
 */
export function resolveVault(query: string | undefined, vaults: readonly Vault[], lastVaultId?: string): { vault: Vault } | { ask: string } {
  const q = (query ?? '').trim()
  if (lastVaultId && q && SAME_RE.test(q) && !NAME_HINTS.some(([re]) => re.test(q))) {
    const last = vaults.find((v) => v.id === lastVaultId)
    if (last) return { vault: last }
  }
  if (!q) {
    const fallback = vaults.find((v) => v.id === env.IXS_WRITE_VAULT_ID)
    return fallback ? { vault: fallback } : { ask: `Which vault? ${vaults.map((v) => v.name).join(', ')}` }
  }
  const byId = vaults.find((v) => v.id.toLowerCase() === q.toLowerCase())
  if (byId) return { vault: byId }
  for (const [re, id] of NAME_HINTS) {
    if (re.test(q)) {
      const v = vaults.find((x) => x.id === id)
      if (v) return { vault: v }
    }
  }
  const byName = vaults.filter((v) => v.name.toLowerCase().includes(q.toLowerCase()))
  if (byName.length === 1) return { vault: byName[0]! }
  return { ask: `I don't know a vault called "${q}". Choose one: ${vaults.map((v) => v.name).join(', ')}.` }
}

const money = (baseUnits: bigint, asset: { symbol: string; decimals: number }) => `${prettyAmount(baseUnits, asset.decimals)} ${asset.symbol}`

// ------------------------------------------------------------- capabilities

export async function setMandate(args: { text: string }, scope: string, deps: CapabilityDeps = defaultDeps()): Promise<string> {
  const text = args.text.trim()
  if (text.length < 10) return 'Paste your treasury policy in plain English, for example: "Never put more than 40% into a single vault. Keep 20% liquid. Testnet only."'
  const ruleSet = await deps.compile(text)
  deps.mandates.set(scope, ruleSet)
  const lines = [
    `📜 Mandate v${ruleSet.version} compiled — ${ruleSet.rules.length} rule${ruleSet.rules.length === 1 ? '' : 's'} · hash ${ruleSet.hash.slice(0, 12)}`,
    '',
    ...ruleSet.rules.flatMap((r, i) => ruleLines(r, i + 1)),
  ]
  if (ruleSet.unmappable.length) {
    lines.push('', 'Kept on record, not enforced (no rule can express it):')
    for (const u of ruleSet.unmappable) lines.push(`    "${u}"`)
  }
  lines.push('', 'Every rule is now a deterministic check. Try: "Deposit 5,000 USDC into the BSC vault".')
  return lines.join('\n')
}

export async function proposeAction(
  args: { kind: 'deposit' | 'redeem'; amount: string; vault?: string | undefined; message?: string | undefined },
  scope: string,
  deps: CapabilityDeps = defaultDeps(),
): Promise<string> {
  const ruleSet = deps.mandates.get(scope)
  if (!ruleSet) return 'No mandate set for this chat yet. Paste your policy in plain English first.'
  const amountText = args.amount.replace(/[,_\s]/g, '').replace(/usdc|usdg/i, '')
  if (!/^\d+(\.\d{1,6})?$/.test(amountText) || amountText === '0') return `I need an amount in asset units, e.g. 5000. Got "${args.amount}".`

  const universe = await deps.universe()
  const resolved = resolveVault(args.vault, universe.data.vaults, deps.recent?.get(scope))
  if ('ask' in resolved) return resolved.ask
  const vault = resolved.vault
  deps.recent?.set(scope, vault.id)

  const [facts, portfolio] = await Promise.all([deps.facts(vault.id, deps.wallet), deps.portfolio(deps.wallet, vault.id, universe.data.vaults)])
  const amount = parseDecimalAmount(amountText, portfolio.asset.decimals)
  const decided = evaluate(ruleSet, portfolio, facts, {
    kind: args.kind,
    vaultId: vault.id,
    amount,
    ...(args.message?.trim() ? { userMessage: args.message.trim() } : {}),
  })
  const explained = await deps.explain(decided)
  const receipt = record({ ruleSet, decision: explained }, deps.receipts)

  const breached = explained.citedRules.length
  const applicable = explained.checks.filter((c) => c.applicable).length
  const allowed = explained.verdict === 'ALLOW'
  const id = receipt.id.slice(0, 12)
  const lines = [
    `${allowed ? '✅ ALLOWED' : '⛔ REFUSED'} — ${args.kind} ${money(amount, portfolio.asset)} into ${facts.name} (${facts.network})`,
    '',
    allowed ? `All ${applicable} rules pass` : `${breached} of ${applicable} rules breached`,
  ]
  for (const c of explained.checks) lines.push(...checkLines(c, facts))
  if (args.kind === 'deposit') lines.push(`You would hold ${explained.numbers['vaultShareAfter']} of this vault's TVL.`)
  lines.push('', `Why: ${trimVerdict(explained.rationale)}`)
  lines.push(
    '',
    `🧾 Receipt ${id} · mandate ${ruleSet.hash.slice(0, 8)} · decision ${explained.hash.slice(0, 8)}`,
    `Portfolio ${portfolio.source} · vault facts ${facts.stale ? 'STALE snapshot' : 'live'}${facts.whitelisted === null ? ' · whitelist unverified' : ''} · say "receipt ${id}" to verify and replay`,
  )
  return lines.join('\n')
}

export async function getReceipt(args: { id: string }, deps: CapabilityDeps = defaultDeps()): Promise<string> {
  const store = deps.receipts
  const id = store.resolve ? store.resolve(args.id.trim()) : args.id.trim()
  const receipt = id ? store.get(id) : null
  if (!receipt) return `No receipt matches "${args.id}". Use the id from a decision reply, e.g. "receipt 50737fb0a0d6".`
  const v = verifyReceipt(receipt)
  const r = replayReceipt(receipt)
  const d = receipt.decision
  return [
    `🧾 Receipt ${receipt.id.slice(0, 12)} — ${d.verdict === 'ALLOW' ? '✅ ALLOWED' : '⛔ REFUSED'} · ${d.inputs.action.kind} ${money(BigInt(d.inputs.action.amount), d.inputs.portfolio.asset)} → ${d.inputs.facts.name}`,
    `Issued ${receipt.createdAt}`,
    `Verify: ${v.ok ? '✓ VERIFIED — every hash re-derives' : 'FAILED — ' + v.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`,
    `Replay: ${r.reproduced ? '✓ REPRODUCED — identical verdict, identical hash' : `NOT reproduced (${r.diff})`}`,
    `Breached: ${d.citedRules.map((c) => ruleLabel(c.rule.type)).join(', ') || 'none'}`,
    `Mandate ${receipt.mandate.hash}`,
    `Decision ${d.hash}`,
    `Receipt ${receipt.hash}`,
    `Previous ${receipt.previousId ?? 'none (first in chain)'}`,
    `Portfolio ${receipt.environment.portfolioSource} · facts ${receipt.environment.factsStale ? 'stale' : 'live'} · explanation ${receipt.environment.rationaleSource}`,
  ].join('\n')
}

export async function vaultStatus(args: { vault?: string | undefined }, deps: CapabilityDeps = defaultDeps()): Promise<string> {
  const universe = await deps.universe()
  const badge = universe.stale ? ` (STALE snapshot from ${universe.fetchedAt})` : ''
  if (args.vault?.trim()) {
    const resolved = resolveVault(args.vault, universe.data.vaults)
    if ('ask' in resolved) return resolved.ask
    const facts = await deps.facts(resolved.vault.id, deps.wallet)
    return [
      `${facts.name} — ${facts.network} (chain ${facts.chainId})${facts.stale ? ' (STALE snapshot)' : ''}`,
      `Settlement ${facts.settlement} · status ${facts.status ?? 'unknown'} · paused ${facts.paused === null ? 'unreadable' : facts.paused}`,
      `TVL ${money(facts.totalAssets, facts.asset)} · whitelist ${facts.whitelistEnabled ? 'enforced' : 'not enforced'} · this wallet ${facts.whitelisted === null ? 'unverified' : facts.whitelisted ? 'cleared' : 'NOT cleared'}`,
      `Vault id ${facts.vaultId}`,
    ].join('\n')
  }
  const lines = [`${universe.data.vaults.length} IXS vaults${badge}:`]
  for (const v of universe.data.vaults) {
    lines.push(`• ${v.name} — ${v.network} (chain ${v.chainId}) · ${v.asset.symbol} · ${v.requiresWhitelist ? 'whitelist required' : 'open'} · ${v.status ?? 'unknown'}`)
  }
  lines.push('', 'Ask "status of the BSC vault" for live TVL and the whitelist check.')
  return lines.join('\n')
}

export function help(): string {
  return [
    'Mandate — the treasury agent that can say no.',
    '',
    '1. Paste your policy in plain English to set the mandate.',
    '2. "Deposit 5,000 USDC into the BSC vault" — I check every rule against live vault data and answer ALLOWED or REFUSED with the numbers.',
    '3. "receipt <id>" — verify and replay any decision.',
    '4. "vault status" or "status of the Avalanche vault".',
    '',
    'Every verdict is deterministic code. I explain decisions; I never make exceptions.',
  ].join('\n')
}
