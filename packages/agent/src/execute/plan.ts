/**
 * Decision -> ExecutionPlan.
 *
 * The gate. A plan can only be built from a Decision whose verdict is ALLOW
 * AND whose hash verifies. There is no flag, no override, no "I'm the owner":
 * a REFUSE decision cannot reach the signer because nothing downstream accepts
 * anything but an ExecutionPlan, and this is the only place that makes one.
 */

import type { Address } from 'viem'
import { mcp as defaultMcp, type IxsMcpClient } from '../ixs/index.js'
import type { BuildResult, BuildStep } from '../ixs/schemas.js'
import { verifyDecisionHash } from '../mandate/evaluate.js'
import type { Decision } from '../mandate/types.js'
import type { ChainTarget } from '../signer/index.js'
import { ERC4626_ABI, publicClientFor, type TransportFactory } from './chain.js'

export type ExecutionRefusedReason = 'verdict' | 'hash' | 'vault_mismatch' | 'amount' | 'kind'

export class ExecutionRefused extends Error {
  readonly reason: ExecutionRefusedReason
  readonly verdict: Decision['verdict']
  readonly citedRuleTypes: readonly string[]

  constructor(reason: ExecutionRefusedReason, message: string, decision: Decision) {
    super(message)
    this.name = 'ExecutionRefused'
    this.reason = reason
    this.verdict = decision.verdict
    this.citedRuleTypes = Object.freeze(decision.citedRules.map((c) => c.rule.type))
  }
}

export interface ExecutionPlan {
  readonly decisionHash: string
  readonly ruleSetHash: string
  readonly kind: 'deposit' | 'redeem'
  readonly vaultId: string
  readonly vaultAddress: string
  readonly chainId: number
  readonly network: string
  readonly settlement: BuildResult['settlement']
  readonly ownerAddress: string
  /** The decision's amount: asset base units, for both kinds. */
  readonly amount: string
  /** Redeem only: the share amount (18dp) sent to IXS, from on-chain convertToShares. */
  readonly shares: string | null
  readonly asset: { readonly symbol: string; readonly decimals: number; readonly address: string } | null
  readonly steps: readonly BuildStep[]
  readonly createdAt: string
}

export interface PlanOptions {
  mcp?: IxsMcpClient
  /** Required for redeems: the chain to read convertToShares from. */
  chain?: ChainTarget
  vaultAddress?: string
  transport?: TransportFactory
  /** Test seam: skip the chain read. */
  sharesFor?: (assets: bigint) => Promise<bigint>
}

export async function planAction(decision: Decision, opts: PlanOptions = {}): Promise<ExecutionPlan> {
  if (decision.verdict !== 'ALLOW') {
    throw new ExecutionRefused(
      'verdict',
      `decision ${decision.hash.slice(0, 12)} is ${decision.verdict}; cited ${decision.citedRules.map((c) => c.rule.type).join(', ') || 'nothing'}`,
      decision,
    )
  }
  if (!verifyDecisionHash(decision)) {
    throw new ExecutionRefused('hash', `decision hash ${decision.hash.slice(0, 12)} does not verify — refusing to act on a tampered decision`, decision)
  }
  const action = decision.inputs.action
  const facts = decision.inputs.facts
  if (action.vaultId !== facts.vaultId) {
    throw new ExecutionRefused('vault_mismatch', `action targets ${action.vaultId} but facts describe ${facts.vaultId}`, decision)
  }
  const amount = BigInt(action.amount)
  if (amount <= 0n) throw new ExecutionRefused('amount', 'action amount must be positive', decision)

  const client = opts.mcp ?? defaultMcp
  const ownerAddress = decision.inputs.portfolio.wallet

  // The mandate reasons in assets; the vault redeems in shares. Convert on-chain
  // so the receipt can show both numbers and the conversion source.
  let shares: bigint | null = null
  if (action.kind === 'redeem') {
    if (opts.sharesFor) shares = await opts.sharesFor(amount)
    else if (opts.chain && opts.vaultAddress) {
      shares = await publicClientFor(opts.chain, opts.transport).readContract({
        address: opts.vaultAddress as Address,
        abi: ERC4626_ABI,
        functionName: 'convertToShares',
        args: [amount],
      })
    } else {
      throw new ExecutionRefused('amount', 'a redeem plan needs { chain, vaultAddress } to convert assets to shares', decision)
    }
    if (shares <= 0n) throw new ExecutionRefused('amount', `${amount} asset units converts to zero shares`, decision)
  }

  const build =
    action.kind === 'deposit'
      ? await client.buildRequestDeposit({ vaultId: action.vaultId, ownerAddress, assetBaseUnits: amount })
      : await client.buildRequestRedeem({ vaultId: action.vaultId, ownerAddress, shareBaseUnits: shares! })

  return Object.freeze({
    decisionHash: decision.hash,
    ruleSetHash: decision.ruleSetHash,
    kind: action.kind,
    vaultId: action.vaultId,
    vaultAddress: build.vault.address,
    chainId: build.chainId,
    network: build.network,
    settlement: build.settlement,
    ownerAddress,
    amount: amount.toString(),
    shares: shares === null ? null : shares.toString(),
    asset: build.asset,
    steps: Object.freeze([...build.steps]),
    createdAt: new Date().toISOString(),
  })
}
