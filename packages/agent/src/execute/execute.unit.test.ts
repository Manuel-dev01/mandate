/**
 * The execution gate and lifecycle, with a scripted signer and transport.
 * No network. A REFUSE decision must be impossible to execute.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { custom, encodeAbiParameters, encodeEventTopics, toFunctionSelector, type Hex, type Transport } from 'viem'
import type { IxsMcpClient } from '../ixs/index.js'
import type { BuildResult } from '../ixs/schemas.js'
import { evaluate } from '../mandate/evaluate.js'
import { buildRuleSet, type CompiledRule } from '../mandate/schema.js'
import type { Decision, PortfolioState, VaultFacts } from '../mandate/types.js'
import type { ChainTarget, SendContext, SendResult, Signer, UnsignedTx } from '../signer/index.js'
import { ERC7540_ABI, clearChainClients } from './chain.js'
import { ExecutionRefused, planAction } from './plan.js'
import { decodeApprove, phaseOf, requestIdFromLogs, runPlan } from './run.js'

// ------------------------------------------------------------ fixtures

const BSC_VAULT_ID = '6a278b40a7d16b245d665479'
const BSC_VAULT = '0xCb09a5326AEFD705d14FF4C5ca2beD7086ba0Dcc'
const USDC = '0xbBCa80a7116aE46B0f249D279EF43f86274dc4f4'
const OWNER = '0xBCA6f82e240C6AC36B23b4f7D21adF17e03966Fe'
const CHAIN: ChainTarget = { chainId: 97, rpcUrl: 'http://scripted', name: 'bsc-testnet', explorerUrl: 'https://testnet.bscscan.com' }

const RULES: CompiledRule[] = [
  { type: 'max_vault_concentration', maxPct: 40, sourcePhrase: 'Never put more than 40% into a single vault', inferred: false },
  { type: 'allowed_networks', chainIds: [97, 43113, 5042002], sourcePhrase: 'Testnet only', inferred: false },
]
const RULE_SET = buildRuleSet({ version: 1, sourceText: 'Never put more than 40% into a single vault. Testnet only.', rules: RULES, unmappable: [], model: 'fixture' })

const PORTFOLIO: PortfolioState = {
  wallet: OWNER,
  asset: { symbol: 'USDC', decimals: 6 },
  idle: 100_000_000_000n,
  positions: [],
  asOf: '2026-09-16T00:00:00.000Z',
  source: 'declared',
}

const BSC_FACTS: VaultFacts = {
  vaultId: BSC_VAULT_ID,
  name: 'IXHYB - BSC',
  chainId: 97,
  network: 'bsc-testnet',
  status: 'active',
  settlement: 'sync',
  requiresWhitelist: false,
  asset: { symbol: 'USDC', decimals: 6 },
  totalAssets: 11_362_928_784n,
  paused: false,
  whitelisted: true,
  whitelistEnabled: false,
  observedAt: '2026-09-16T00:00:00.000Z',
  stale: false,
}

const pad = (a: string) => a.toLowerCase().replace('0x', '').padStart(64, '0')
const word = (n: bigint) => n.toString(16).padStart(64, '0')
const approveData = (spender: string, amount: bigint) => `0x095ea7b3${pad(spender)}${word(amount)}`
const depositData = (amount: bigint, receiver: string) => `0x6e553f65${word(amount)}${pad(receiver)}`

function syncBuild(amount: bigint): BuildResult {
  return {
    ok: true,
    settlement: 'sync',
    chainId: 97,
    network: 'bsc-testnet',
    vault: { id: `97-${BSC_VAULT.toLowerCase()}`, address: BSC_VAULT },
    ownerAddress: OWNER.toLowerCase(),
    asset: { symbol: 'USDC', decimals: 6, address: USDC },
    amount: { raw: amount.toString(), baseUnits: amount, decimals: 6, symbol: null },
    shares: null,
    steps: [
      { type: 'erc20_approve_exact', description: 'approve', tx: { to: USDC, data: approveData(BSC_VAULT, amount), value: '0', valueWei: 0n } },
      { type: 'vault_deposit', description: 'deposit', tx: { to: BSC_VAULT, data: depositData(amount, OWNER), value: '0', valueWei: 0n } },
    ],
  }
}

function asyncBuild(amount: bigint): BuildResult {
  return {
    ...syncBuild(amount),
    settlement: 'async-erc7540',
    steps: [{ type: 'vault_request_deposit', description: 'request', tx: { to: BSC_VAULT, data: '0x00000000', value: '0', valueWei: 0n } }],
  }
}

function fakeMcp(build: BuildResult, claim?: BuildResult): IxsMcpClient {
  return {
    buildRequestDeposit: async () => build,
    buildRequestRedeem: async () => build,
    buildClaimDeposit: async () => claim ?? build,
    buildClaimRedeem: async () => claim ?? build,
    requestStatus: async () => {
      throw new Error('subgraph broken')
    },
  } as unknown as IxsMcpClient
}

/** A signer that records what it was asked to send and answers by script. */
function scriptedSigner(mode: 'dry-run' | 'live', answer: (tx: UnsignedTx, ctx: SendContext, i: number) => Partial<SendResult> = () => ({})) {
  const sent: Array<{ tx: UnsignedTx; ctx: SendContext }> = []
  const signer: Signer = {
    address: OWNER,
    mode,
    blockedChainIds: [4663],
    async send(tx, ctx) {
      sent.push({ tx, ctx })
      const i = sent.length - 1
      const base =
        mode === 'dry-run'
          ? ({ mode: 'dry-run', simulated: true, ok: true, from: OWNER, to: tx.to, gasEstimate: 50_000n, revertReason: null, decisionHash: ctx.decisionHash, chain: '97 bsc-testnet' } as const)
          : ({ mode: 'live', simulated: false, from: OWNER, to: tx.to, txHash: `0x${word(BigInt(i + 1))}` as Hex, blockNumber: 1n, status: 'success', explorerUrl: null, decisionHash: ctx.decisionHash, chain: '97 bsc-testnet' } as const)
      return { ...base, ...answer(tx, ctx, i) } as SendResult
    },
  }
  return { signer, sent }
}

function transportWith(handlers: Record<string, (params: unknown[]) => unknown>) {
  const calls: Array<{ method: string; params: unknown[] }> = []
  const transport = (): Transport =>
    custom({
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        calls.push({ method, params: params ?? [] })
        const h = handlers[method]
        if (!h) throw new Error(`unscripted ${method}`)
        return h(params ?? [])
      },
    }, { retryCount: 0 })
  return { calls, transport }
}

const CLAIMABLE_DEPOSIT_SELECTOR = toFunctionSelector('claimableDepositRequest(uint256,address)')

const allow = (amount = 5_000_000_000n): Decision => evaluate(RULE_SET, PORTFOLIO, BSC_FACTS, { kind: 'deposit', vaultId: BSC_VAULT_ID, amount })

// ---------------------------------------------------------------- gate

test('planAction: an ALLOW decision with a verifying hash becomes a plan', async () => {
  const d = allow()
  const plan = await planAction(d, { mcp: fakeMcp(syncBuild(5_000_000_000n)) })
  assert.equal(plan.decisionHash, d.hash)
  assert.equal(plan.settlement, 'sync')
  assert.equal(plan.chainId, 97)
  assert.equal(plan.amount, '5000000000')
  assert.deepEqual(plan.steps.map((s) => s.type), ['erc20_approve_exact', 'vault_deposit'])
})

test('planAction: a redeem converts assets to shares on-chain and sends shares to IXS', async () => {
  const d = evaluate(RULE_SET, { ...PORTFOLIO, positions: [{ vaultId: BSC_VAULT_ID, chainId: 97, value: 10_000_000_000n }] }, BSC_FACTS, { kind: 'redeem', vaultId: BSC_VAULT_ID, amount: 1_000_000_000n })
  assert.equal(d.verdict, 'ALLOW')
  const sent: bigint[] = []
  const mcp = { buildRequestRedeem: async (i: { shareBaseUnits: bigint }) => { sent.push(i.shareBaseUnits); return { ...syncBuild(1n), shares: { raw: '', baseUnits: i.shareBaseUnits, decimals: 18, symbol: 'shares' } } } } as unknown as IxsMcpClient
  const plan = await planAction(d, { mcp, sharesFor: async (assets) => assets * 10n ** 12n * 100n / 109n })
  assert.equal(plan.kind, 'redeem')
  assert.equal(plan.amount, '1000000000')
  assert.equal(plan.shares, sent[0]?.toString())
  assert.ok(BigInt(plan.shares!) > 0n)
  await assert.rejects(() => planAction(d, { mcp }), (err: unknown) => err instanceof ExecutionRefused && err.reason === 'amount', 'no chain, no conversion, no plan')
})

test('planAction: a REFUSE decision cannot be planned', async () => {
  const refused = evaluate(RULE_SET, PORTFOLIO, BSC_FACTS, { kind: 'deposit', vaultId: BSC_VAULT_ID, amount: 60_000_000_000n })
  assert.equal(refused.verdict, 'REFUSE')
  let built = false
  const mcp = { buildRequestDeposit: async () => { built = true; return syncBuild(1n) } } as unknown as IxsMcpClient
  await assert.rejects(
    () => planAction(refused, { mcp }),
    (err: unknown) => err instanceof ExecutionRefused && err.reason === 'verdict' && err.citedRuleTypes.includes('max_vault_concentration'),
  )
  assert.equal(built, false, 'IXS was never asked to build anything')
})

test('planAction: a tampered decision cannot be planned', async () => {
  const d = allow()
  const tampered = { ...d, verdict: 'ALLOW' as const, numbers: { ...d.numbers, postVaultPct: '1.00%' } }
  await assert.rejects(() => planAction(tampered, { mcp: fakeMcp(syncBuild(1n)) }), (err: unknown) => err instanceof ExecutionRefused && err.reason === 'hash')

  const flipped = { ...evaluate(RULE_SET, PORTFOLIO, BSC_FACTS, { kind: 'deposit', vaultId: BSC_VAULT_ID, amount: 60_000_000_000n }), verdict: 'ALLOW' as const }
  await assert.rejects(() => planAction(flipped, { mcp: fakeMcp(syncBuild(1n)) }), (err: unknown) => err instanceof ExecutionRefused && err.reason === 'hash')
})

// ------------------------------------------------------------- runner

test('runPlan sync: approve then deposit, dry-run, both simulated', async () => {
  clearChainClients()
  const plan = await planAction(allow(), { mcp: fakeMcp(syncBuild(5_000_000_000n)) })
  const { signer, sent } = scriptedSigner('dry-run')
  const { transport } = transportWith({ eth_call: () => `0x${word(0n)}` }) // allowance 0
  const r = await runPlan(plan, signer, { chain: CHAIN, transport, mcp: fakeMcp(syncBuild(1n)) })
  assert.equal(r.completed, true)
  assert.equal(r.settlement, 'sync')
  assert.deepEqual(r.steps.map((s) => s.phase), ['approve', 'deposit'])
  assert.deepEqual(sent.map((s) => s.tx.to), [USDC, BSC_VAULT])
  assert.ok(sent.every((s) => s.ctx.decisionHash === plan.decisionHash), 'every send carries the decision hash')
  assert.ok(sent.every((s) => s.ctx.assetAmount === 5_000_000_000n))
})

test('runPlan sync: an approve is skipped when the allowance already covers it', async () => {
  clearChainClients()
  const plan = await planAction(allow(), { mcp: fakeMcp(syncBuild(5_000_000_000n)) })
  const { signer, sent } = scriptedSigner('dry-run')
  const { transport } = transportWith({ eth_call: () => `0x${word(5_000_000_000n)}` })
  const r = await runPlan(plan, signer, { chain: CHAIN, transport, mcp: fakeMcp(syncBuild(1n)) })
  assert.equal(r.completed, true)
  assert.equal(r.steps[0]?.skipped, 'allowance already sufficient')
  assert.deepEqual(sent.map((s) => s.tx.to), [BSC_VAULT], 'only the deposit was sent')
})

test('runPlan queued: one request step, complete once sent, nothing polled', async () => {
  clearChainClients()
  const queued: BuildResult = { ...syncBuild(1n), settlement: 'queued', steps: [{ type: 'vault_request_redeem', description: 'queued redeem', tx: { to: BSC_VAULT, data: '0x107703ab', value: '0', valueWei: 0n } }] }
  const plan = await planAction(allow(), { mcp: fakeMcp(queued) })
  const { signer, sent } = scriptedSigner('live')
  const { transport, calls } = transportWith({})
  const r = await runPlan(plan, signer, { chain: CHAIN, transport, mcp: fakeMcp(queued) })
  assert.equal(r.settlement, 'queued')
  assert.equal(r.completed, true)
  assert.equal(r.claimed, false)
  assert.match(r.note ?? '', /queued/)
  assert.equal(sent.length, 1)
  assert.equal(calls.length, 0, 'no status polling for a queued redeem')
})

test('runPlan: a simulated revert stops the lifecycle and is recorded, not thrown', async () => {
  clearChainClients()
  const plan = await planAction(allow(), { mcp: fakeMcp(syncBuild(5_000_000_000n)) })
  const { signer } = scriptedSigner('dry-run', (_tx, _ctx, i) => (i === 1 ? { ok: false, revertReason: 'ERC20: transfer amount exceeds balance' } : {}))
  const { transport } = transportWith({ eth_call: () => `0x${word(0n)}` })
  const r = await runPlan(plan, signer, { chain: CHAIN, transport, mcp: fakeMcp(syncBuild(1n)) })
  assert.equal(r.completed, false)
  assert.match(r.note ?? '', /vault_deposit.*exceeds balance/)
  assert.equal(r.steps.length, 2)
})

test('runPlan: a signer refusal is recorded and stops the lifecycle', async () => {
  clearChainClients()
  const plan = await planAction(allow(), { mcp: fakeMcp(syncBuild(5_000_000_000n)) })
  const signer: Signer = { address: OWNER, mode: 'live', blockedChainIds: [97], send: async () => { throw new Error('chain 97 is in BLOCKED_WRITE_CHAIN_IDS') } }
  const { transport } = transportWith({ eth_call: () => `0x${word(0n)}` })
  const r = await runPlan(plan, signer, { chain: CHAIN, transport, mcp: fakeMcp(syncBuild(1n)) })
  assert.equal(r.completed, false)
  assert.match(r.steps[0]?.error ?? '', /BLOCKED_WRITE_CHAIN_IDS/)
})

test('runPlan async, dry-run: request is simulated; poll and claim are explicitly not', async () => {
  clearChainClients()
  const plan = await planAction(allow(), { mcp: fakeMcp(asyncBuild(5_000_000_000n)) })
  const { signer, sent } = scriptedSigner('dry-run')
  const { transport, calls } = transportWith({})
  const r = await runPlan(plan, signer, { chain: CHAIN, transport, mcp: fakeMcp(asyncBuild(1n)) })
  assert.equal(r.settlement, 'async-erc7540')
  assert.equal(r.completed, false)
  assert.equal(r.claimed, false)
  assert.match(r.note ?? '', /dry-run: request simulated/)
  assert.equal(sent.length, 1)
  assert.equal(calls.length, 0, 'no chain reads without a live request')
})

test('runPlan async, live: request -> requestId from logs -> poll until claimable -> claim', async () => {
  clearChainClients()
  const requestId = 7n
  const topics = encodeEventTopics({ abi: ERC7540_ABI, eventName: 'DepositRequest', args: { controller: OWNER, owner: OWNER, requestId } })
  const data = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [OWNER, 5_000_000_000n])
  const log = { address: BSC_VAULT as `0x${string}`, data, topics, blockNumber: 1n, transactionHash: `0x${word(1n)}`, logIndex: 0, transactionIndex: 0, blockHash: `0x${word(9n)}`, removed: false }

  let polls = 0
  const { transport } = transportWith({
    eth_getTransactionReceipt: () => ({ status: '0x1', blockNumber: '0x1', logs: [{ ...log, blockNumber: '0x1', logIndex: '0x0', transactionIndex: '0x0' }], transactionHash: log.transactionHash, blockHash: log.blockHash, from: OWNER, to: BSC_VAULT, cumulativeGasUsed: '0x0', gasUsed: '0x0', logsBloom: `0x${'0'.repeat(512)}`, effectiveGasPrice: '0x1', type: '0x2', contractAddress: null }),
    eth_call: (params) => {
      // pendingDepositRequest / claimableDepositRequest selectors differ; answer by poll count.
      const selector = String((params[0] as { data: string }).data).slice(0, 10)
      polls++
      // Each poll issues two reads (pending, claimable). Rounds 1-2: pending. Round 3: claimable.
      const round = Math.ceil(polls / 2)
      const isClaimable = selector === CLAIMABLE_DEPOSIT_SELECTOR
      return `0x${word(isClaimable ? (round >= 3 ? 5_000_000_000n : 0n) : round >= 3 ? 0n : 5_000_000_000n)}`
    },
  })

  const claim: BuildResult = { ...syncBuild(1n), settlement: 'async-erc7540', steps: [{ type: 'vault_claim_deposit', description: 'claim', tx: { to: BSC_VAULT, data: '0x11111111', value: '0', valueWei: 0n } }] }
  const plan = await planAction(allow(), { mcp: fakeMcp(asyncBuild(5_000_000_000n)) })
  const { signer, sent } = scriptedSigner('live')
  const slept: number[] = []
  const r = await runPlan(plan, signer, {
    chain: CHAIN,
    transport,
    mcp: fakeMcp(asyncBuild(1n), claim),
    pollIntervalMs: 1,
    maxWaitMs: 60_000,
    sleep: async (ms) => { slept.push(ms) },
  })
  assert.equal(r.requestId, '7', 'requestId came from the DepositRequest log')
  assert.equal(r.claimed, true)
  assert.equal(r.completed, true)
  assert.equal(r.status?.claimable, 5_000_000_000n)
  assert.equal(r.status?.mcp, 'unavailable')
  assert.deepEqual(r.steps.map((s) => s.phase), ['request', 'claim'])
  assert.deepEqual(sent.map((s) => s.tx.data), ['0x00000000', '0x11111111'])
  assert.equal(slept.length, 2, 'slept between the two not-yet-claimable polls')
})

// ------------------------------------------------------------- helpers

test('decodeApprove reads spender and amount from approve calldata', () => {
  const d = decodeApprove(approveData(BSC_VAULT, 123n))
  assert.equal(d?.spender.toLowerCase(), BSC_VAULT.toLowerCase())
  assert.equal(d?.amount, 123n)
  assert.equal(decodeApprove(depositData(1n, OWNER)), null)
})

test('phaseOf maps every known step type and degrades unknown ones', () => {
  assert.equal(phaseOf('erc20_approve_exact'), 'approve')
  assert.equal(phaseOf('vault_deposit'), 'deposit')
  assert.equal(phaseOf('vault_request_redeem'), 'request')
  assert.equal(phaseOf('vault_claim_redeem'), 'claim')
  assert.equal(phaseOf('something_new'), 'other')
})

test('requestIdFromLogs falls back to 0 when no request event is present', () => {
  assert.equal(requestIdFromLogs([], 'deposit'), 0n)
})
