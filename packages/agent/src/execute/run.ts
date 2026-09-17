/**
 * Runs an ExecutionPlan through the signer.
 *
 *   sync           approve? -> deposit                           (settles immediately)
 *   queued         request                                       (vault's queue finalizes; nothing to claim)
 *   async-erc7540  request  -> requestId -> poll -> claim build -> claim
 *
 * Every phase is a StepResult, so a half-finished lifecycle is visible and
 * resumable, and a failure mid-way is a recorded fact rather than a crash.
 * The allowance check skips an approve the chain does not need.
 *
 * Dry-run runs every step through simulation. The async poll/claim is not
 * simulated: nothing is pending on-chain after a simulated request.
 */

import { parseEventLogs, type Address, type Hex } from 'viem'
import { mcp as defaultMcp, type IxsMcpClient } from '../ixs/index.js'
import { isKnownStepType, type BuildStep } from '../ixs/schemas.js'
import { chainLabel, type ChainTarget, type SendResult, type Signer } from '../signer/index.js'
import { ERC20_ABI, ERC7540_ABI, publicClientFor, type TransportFactory } from './chain.js'
import type { ExecutionPlan } from './plan.js'
import { readRequestStatus, type RequestStatus } from './status.js'

export type StepPhase = 'approve' | 'deposit' | 'redeem' | 'request' | 'claim' | 'other'

export interface StepResult {
  readonly phase: StepPhase
  readonly type: string
  readonly description: string
  readonly to: string
  /** Why the step was not sent, else null. */
  readonly skipped: string | null
  readonly result: SendResult | null
  readonly error: string | null
  readonly at: string
}

export interface ExecutionResult {
  readonly decisionHash: string
  readonly planCreatedAt: string
  readonly mode: Signer['mode']
  /** "97 bsc-testnet" or "97 bsc-testnet (fork)". */
  readonly chain: string
  readonly settlement: ExecutionPlan['settlement']
  readonly kind: ExecutionPlan['kind']
  readonly steps: readonly StepResult[]
  readonly requestId: string | null
  readonly status: RequestStatus | null
  readonly claimed: boolean
  /** True when every step needed for this settlement kind was sent (or validly skipped). */
  readonly completed: boolean
  readonly note: string | null
}

export interface RunOptions {
  chain: ChainTarget
  mcp?: IxsMcpClient
  transport?: TransportFactory
  /** Skip an approve whose allowance already covers the amount. Default true. */
  allowanceCheck?: boolean
  pollIntervalMs?: number
  maxWaitMs?: number
  /** Test seam for the poll loop. */
  sleep?: (ms: number) => Promise<void>
  onStep?: (step: StepResult) => void
}

const APPROVE_SELECTOR = '0x095ea7b3'

export async function runPlan(plan: ExecutionPlan, signer: Signer, opts: RunOptions): Promise<ExecutionResult> {
  const mcp = opts.mcp ?? defaultMcp
  const allowanceCheck = opts.allowanceCheck ?? true
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const steps: StepResult[] = []
  const record = (s: StepResult) => {
    steps.push(s)
    opts.onStep?.(s)
  }
  const amount = BigInt(plan.amount)
  const assetDecimals = plan.asset?.decimals ?? 6
  const base = (step: BuildStep, phase: StepPhase) => ({
    phase,
    type: step.type,
    description: step.description,
    to: step.tx.to,
    at: new Date().toISOString(),
  })

  let requestId: bigint | null = null
  let status: RequestStatus | null = null
  let claimed = false
  let note: string | null = null

  for (const step of plan.steps) {
    const phase = phaseOf(step.type)

    if (phase === 'approve' && allowanceCheck) {
      const enough = await allowanceCovers(step, plan, opts).catch(() => false)
      if (enough) {
        record({ ...base(step, phase), skipped: 'allowance already sufficient', result: null, error: null })
        continue
      }
    }

    let result: SendResult
    try {
      result = await signer.send(step.tx, {
        chain: opts.chain,
        decisionHash: plan.decisionHash,
        assetAmount: amount,
        assetDecimals,
        label: step.type,
      })
    } catch (err) {
      record({ ...base(step, phase), skipped: null, result: null, error: err instanceof Error ? err.message : String(err) })
      return finish('a step failed before it was sent')
    }
    record({ ...base(step, phase), skipped: null, result, error: null })

    if (result.mode === 'dry-run' && !result.ok) return finish(`simulation reverted at ${step.type}: ${result.revertReason ?? 'unknown'}`)
    if (result.mode === 'live' && result.status === 'reverted') return finish(`${step.type} reverted on-chain`)

    if (phase === 'request' && result.mode === 'live' && plan.settlement === 'async-erc7540') {
      requestId = await requestIdFromReceipt(result.txHash, plan, opts).catch(() => 0n)
    }
  }

  if (plan.settlement === 'sync') return finish(null, true)
  if (plan.settlement === 'queued') {
    return finish('queued: the vault settles this request from its queue; nothing to poll or claim', true)
  }

  // ---- async-erc7540: poll, then claim -----------------------------------
  if (signer.mode === 'dry-run') {
    return finish('dry-run: request simulated; poll and claim are not simulated because nothing is pending on-chain')
  }
  requestId ??= 0n
  const pollIntervalMs = opts.pollIntervalMs ?? 15_000
  const maxWaitMs = opts.maxWaitMs ?? 600_000
  const started = Date.now()
  const query = {
    chain: opts.chain,
    vaultId: plan.vaultId,
    vaultAddress: plan.vaultAddress,
    controller: plan.ownerAddress,
    requestId,
    kind: plan.kind,
  } as const

  for (;;) {
    status = await readRequestStatus(query, { mcp, ...(opts.transport ? { transport: opts.transport } : {}) })
    if (status.claimable > 0n) break
    if (Date.now() - started > maxWaitMs) {
      return finish(`request ${requestId} still pending after ${Math.round(maxWaitMs / 1000)}s — claim later`)
    }
    await sleep(pollIntervalMs)
  }

  const claimBuild =
    plan.kind === 'deposit'
      ? await mcp.buildClaimDeposit({ vaultId: plan.vaultId, ownerAddress: plan.ownerAddress, requestId: requestId.toString() })
      : await mcp.buildClaimRedeem({ vaultId: plan.vaultId, ownerAddress: plan.ownerAddress, requestId: requestId.toString() })

  for (const step of claimBuild.steps) {
    let result: SendResult
    try {
      result = await signer.send(step.tx, { chain: opts.chain, decisionHash: plan.decisionHash, label: step.type })
    } catch (err) {
      record({ ...base(step, 'claim'), skipped: null, result: null, error: err instanceof Error ? err.message : String(err) })
      return finish('claim failed before it was sent')
    }
    record({ ...base(step, 'claim'), skipped: null, result, error: null })
    if (result.mode === 'live' && result.status === 'reverted') return finish('claim reverted on-chain')
  }
  claimed = true
  return finish(null, true)

  function finish(reason: string | null, completed = false): ExecutionResult {
    note = reason
    return Object.freeze({
      decisionHash: plan.decisionHash,
      planCreatedAt: plan.createdAt,
      mode: signer.mode,
      chain: chainLabel(opts.chain),
      settlement: plan.settlement,
      kind: plan.kind,
      steps: Object.freeze([...steps]),
      requestId: requestId === null ? null : requestId.toString(),
      status,
      claimed,
      completed,
      note,
    })
  }
}

export function phaseOf(type: string): StepPhase {
  if (!isKnownStepType(type)) return 'other'
  switch (type) {
    case 'erc20_approve_exact':
      return 'approve'
    case 'vault_deposit':
    case 'vault_mint':
      return 'deposit'
    case 'vault_redeem':
    case 'vault_withdraw':
      return 'redeem'
    case 'vault_request_deposit':
    case 'vault_request_redeem':
      return 'request'
    case 'vault_claim_deposit':
    case 'vault_claim_redeem':
      return 'claim'
  }
}

/** approve(spender, amount) calldata -> { spender, amount }. Null when it is not an approve. */
export function decodeApprove(data: string): { spender: Address; amount: bigint } | null {
  if (!data.toLowerCase().startsWith(APPROVE_SELECTOR) || data.length < 10 + 128) return null
  const spender = `0x${data.slice(10 + 24, 10 + 64)}` as Address
  const amount = BigInt(`0x${data.slice(10 + 64, 10 + 128)}`)
  return { spender, amount }
}

async function allowanceCovers(step: BuildStep, plan: ExecutionPlan, opts: RunOptions): Promise<boolean> {
  const approve = decodeApprove(step.tx.data)
  if (!approve) return false
  const client = publicClientFor(opts.chain, opts.transport)
  const allowance = await client.readContract({
    address: step.tx.to as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [plan.ownerAddress as Address, approve.spender],
  })
  return allowance >= approve.amount
}

/** The requestId is the third indexed topic of DepositRequest / RedeemRequest. */
export async function requestIdFromReceipt(txHash: Hex, plan: ExecutionPlan, opts: RunOptions): Promise<bigint> {
  const client = publicClientFor(opts.chain, opts.transport)
  const receipt = await client.getTransactionReceipt({ hash: txHash })
  return requestIdFromLogs(receipt.logs, plan.kind)
}

export function requestIdFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], kind: 'deposit' | 'redeem'): bigint {
  const events = parseEventLogs({
    abi: ERC7540_ABI,
    logs: logs as never,
    eventName: kind === 'deposit' ? 'DepositRequest' : 'RedeemRequest',
  })
  const first = events[0]
  return first ? first.args.requestId : 0n
}
