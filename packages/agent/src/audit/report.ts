/**
 * The audit report — a receipt rendered for a human, byte-stable.
 *
 * Plain Markdown, no LaTeX, no tables that wrap badly in Telegram. This is
 * what a treasurer hands an auditor, and what D9 puts behind x402. Two
 * renders of the same receipt are identical bytes.
 */

import { formatBaseUnits } from '../ixs/schemas.js'
import type { CompiledRule } from '../mandate/schema.js'
import type { Receipt } from './receipt.js'

export function renderReport(r: Receipt): string {
  const d = r.decision
  const action = d.inputs.action
  const facts = d.inputs.facts
  const portfolio = d.inputs.portfolio
  const decimals = portfolio.asset.decimals
  const money = (baseUnits: string) => `${formatBaseUnits(BigInt(baseUnits), decimals)} ${portfolio.asset.symbol}`
  const total = portfolio.positions.reduce((a, p) => a + BigInt(p.value), BigInt(portfolio.idle))
  const lines: string[] = []
  const l = (s = '') => lines.push(s)

  l(`# Mandate decision receipt`)
  l()
  l(`Receipt ${r.id}`)
  l(`Issued ${r.createdAt} · schema ${r.schema} · agent ${r.environment.agentVersion}`)
  l(`Previous receipt: ${r.previousId ?? 'none (first in chain)'}`)
  l()
  l(`## Verdict: ${d.verdict}`)
  l()
  l(`Action: ${action.kind} ${money(action.amount)} → ${facts.name} (${facts.vaultId}) on ${facts.network} (chain ${facts.chainId})`)
  if (action.userMessage) l(`Treasurer's message: "${action.userMessage}" — recorded, not consulted by any rule.`)
  l()
  l(`## Mandate v${r.mandate.version} · ${r.mandate.hash}`)
  l()
  l(`> ${r.mandate.sourceText}`)
  l()
  for (const rule of r.mandate.rules) l(`- ${rule.type} ${params(rule)} — ${rule.inferred ? 'inferred' : 'stated'} — from "${rule.sourcePhrase}"`)
  if (r.mandate.unmappable.length) {
    l()
    l(`Not expressible as rules (surfaced, not dropped):`)
    for (const u of r.mandate.unmappable) l(`- "${u}"`)
  }
  l()
  l(`## Inputs`)
  l()
  l(`Portfolio [${portfolio.source}] as of ${portfolio.asOf}: total ${money(total.toString())}, idle ${money(portfolio.idle)}, ${portfolio.positions.length} position(s)`)
  for (const p of portfolio.positions) l(`- ${p.vaultId} on chain ${p.chainId}: ${money(p.value)}`)
  l(
    `Vault facts${facts.stale ? ' [STALE snapshot]' : ''} at ${facts.observedAt}: ${facts.settlement}, status ${facts.status ?? 'unknown'}, ` +
      `paused ${facts.paused === null ? 'unreadable' : facts.paused}, whitelisted ${facts.whitelisted === null ? 'unverified' : facts.whitelisted}, ` +
      `TVL ${formatBaseUnits(BigInt(facts.totalAssets), facts.asset.decimals)} ${facts.asset.symbol}`,
  )
  l()
  l(`## Rule checks (${d.checks.length} evaluated, ${d.citedRules.length} breached)`)
  l()
  for (const c of d.checks) {
    const mark = !c.applicable ? 'n/a ' : c.passed ? 'PASS' : 'FAIL'
    l(`- [${mark}] ${c.rule.type}: actual ${c.actual}, limit ${c.limit}`)
    l(`  ${c.detail}`)
  }
  l()
  l(`Context: this deposit would be ${d.numbers['vaultShareAfter'] ?? 'n/a'} of the vault's TVL.`)
  l()
  l(`## Explanation [${d.rationaleSource}]`)
  l()
  l(d.rationale)
  if (d.explanation) {
    l()
    l(
      `SERV: ${d.explanation.attempted ? `${d.explanation.model ?? 'no model'}, ${d.explanation.tokens} tokens, tools ${d.explanation.tools.join(' + ') || 'none'}` : 'not attempted'}` +
        `${d.explanation.guarded ? ' — prompt guard fired, template kept' : ''}${d.explanation.note ? ` — ${d.explanation.note}` : ''}`,
    )
  }
  l()
  l(`## Provenance`)
  l()
  l(`- Portfolio source: ${r.environment.portfolioSource}`)
  l(`- Vault facts stale: ${r.environment.factsStale}`)
  l(`- Rationale source: ${r.environment.rationaleSource}`)
  l(`- Mandate hash: ${r.mandate.hash}`)
  l(`- Decision hash: ${d.hash}`)
  l(`- Receipt hash: ${r.hash}`)
  l()
  l(`## How to verify`)
  l()
  l(`Re-derive the decision hash from the inputs above with the open evaluator (npm run receipt -- replay ${r.id.slice(0, 12)}); the verdict, every number and the hash must match. The receipt hash commits to the mandate, the decision and the labels; the previous-receipt id chains this record to the one before it.`)
  l()
  return lines.join('\n')
}

function params(rule: CompiledRule): string {
  switch (rule.type) {
    case 'max_vault_concentration':
    case 'max_chain_concentration':
      return `max ${rule.maxPct}%`
    case 'min_liquidity_buffer':
      return `min ${rule.minPct}%`
    case 'max_single_action_size':
      return [rule.maxPct !== null ? `max ${rule.maxPct}%` : null, rule.maxAbsolute !== null ? `max ${rule.maxAbsolute}` : null].filter(Boolean).join(', ')
    case 'paused_vault_prohibition':
      return 'enabled'
    case 'allowed_networks':
      return `chains ${rule.chainIds.join(', ')}`
    case 'whitelist_required':
      return 'enforced'
  }
}
