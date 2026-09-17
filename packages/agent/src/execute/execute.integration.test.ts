/**
 * D4 live tests. Real IXS builds, real chain simulation, real ERC-7540 views.
 *
 *     npm run test:integration --workspace=agent
 *
 * Nothing here broadcasts unless EXECUTION_MODE=live AND the burner is funded;
 * that one test skips loudly otherwise. No SERV calls.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Address } from 'viem'
import { env } from '../env.js'
import { listVaults } from '../ixs/index.js'
import { parseDecimalAmount, formatBaseUnits } from '../ixs/schemas.js'
import { evaluate } from '../mandate/evaluate.js'
import { gatherFacts } from '../mandate/facts.js'
import { loadDeclared, loadPortfolio } from '../mandate/portfolio.js'
import { buildRuleSet, type CompiledRule } from '../mandate/schema.js'
import { createSigner } from '../signer/index.js'
import { ERC20_ABI, chainOf, publicClientFor } from './chain.js'
import { planAction } from './plan.js'
import { runPlan } from './run.js'
import { readRequestStatus } from './status.js'

const BSC = '6a278b40a7d16b245d665479'
const FUJI = '6a952683732c2b84b55ce89b'
const LIVE = { timeout: 120_000 }
const usdc = (n: number | string) => parseDecimalAmount(String(n), 6)

const RULES: CompiledRule[] = [
  { type: 'max_vault_concentration', maxPct: 40, sourcePhrase: 'Never put more than 40% into a single vault', inferred: false },
  { type: 'max_chain_concentration', maxPct: 60, sourcePhrase: 'no more than 60% on any one chain', inferred: false },
  { type: 'min_liquidity_buffer', minPct: 20, sourcePhrase: 'Keep 20% liquid at all times', inferred: false },
  { type: 'max_single_action_size', maxPct: 25, maxAbsolute: null, sourcePhrase: 'Preserve capital first', inferred: true },
  { type: 'paused_vault_prohibition', enabled: true, sourcePhrase: 'Never touch a paused vault', inferred: false },
  { type: 'allowed_networks', chainIds: [97, 43113, 5042002], sourcePhrase: 'Testnet only', inferred: false },
  { type: 'whitelist_required', enforce: true, sourcePhrase: "Only enter vaults I'm cleared for", inferred: false },
]
const RULE_SET = buildRuleSet({
  version: 1,
  sourceText: "Preserve capital first. Never put more than 40% into a single vault, and no more than 60% on any one chain. Keep 20% liquid at all times. Testnet only. Only enter vaults I'm cleared for. Never touch a paused vault.",
  rules: RULES,
  unmappable: [],
  model: 'fixture',
})

const signer = createSigner({ mode: 'dry-run' })
const WALLET = signer.address

async function bscVault() {
  const { data } = await listVaults()
  const vault = data.vaults.find((v) => v.id === BSC)
  assert.ok(vault, 'BSC vault missing from the universe')
  const target = chainOf(vault)
  const override = process.env['BSC_TESTNET_RPC_URL']
  return { vault, chain: override ? { ...target, rpcUrl: override } : target }
}

async function balances(chain: Awaited<ReturnType<typeof bscVault>>['chain'], asset: Address) {
  const client = publicClientFor(chain)
  const [native, token] = await Promise.all([
    client.getBalance({ address: WALLET }),
    client.readContract({ address: asset, abi: ERC20_ABI, functionName: 'balanceOf', args: [WALLET] }),
  ])
  return { native, token }
}

test('planAction: an ALLOW decision for BSC yields real unsigned approve + deposit steps from IXS', LIVE, async () => {
  const facts = await gatherFacts({ vaultId: BSC, wallet: WALLET })
  assert.equal(facts.settlement, 'sync')
  const portfolio = loadDeclared(WALLET)
  const decision = evaluate(RULE_SET, portfolio, facts, { kind: 'deposit', vaultId: BSC, amount: usdc(1) })
  assert.equal(decision.verdict, 'ALLOW', decision.rationale)

  const plan = await planAction(decision)
  assert.equal(plan.settlement, 'sync')
  assert.equal(plan.chainId, 97)
  assert.deepEqual(plan.steps.map((s) => s.type), ['erc20_approve_exact', 'vault_deposit'])
  assert.equal(plan.vaultAddress.toLowerCase(), '0xcb09a5326aefd705d14ff4c5ca2bed7086ba0dcc')
  assert.equal(plan.amount, '1000000')
  for (const step of plan.steps) assert.match(step.tx.data, /^0x[0-9a-f]{8,}$/i)
  console.log(`    plan ${plan.decisionHash.slice(0, 12)}… → ${plan.steps.map((s) => `${s.type}@${s.tx.to.slice(0, 8)}`).join(' → ')}`)
})

test('runPlan dry-run: the pipeline reaches the real chain — approve simulates; deposit reverts with a decoded reason', LIVE, async () => {
  const { vault, chain } = await bscVault()
  const facts = await gatherFacts({ vaultId: BSC, wallet: WALLET })
  const decision = evaluate(RULE_SET, loadDeclared(WALLET), facts, { kind: 'deposit', vaultId: BSC, amount: usdc(1) })
  const plan = await planAction(decision)
  const { token } = await balances(chain, vault.asset.address as Address)

  // A fresh signer per run so a live default in .env can never leak into this test.
  const result = await runPlan(plan, createSigner({ mode: 'dry-run' }), { chain })
  assert.equal(result.mode, 'dry-run')
  const approve = result.steps[0]
  assert.ok(approve, 'approve step recorded')
  if (approve.skipped === null) {
    assert.equal(approve.result?.mode, 'dry-run')
    assert.equal(approve.result?.mode === 'dry-run' && approve.result.ok, true, `approve simulation failed: ${approve.result?.mode === 'dry-run' ? approve.result.revertReason : ''}`)
  }

  // Dry-run simulates each step on its own, so the deposit never sees the
  // simulated approve: unless a real allowance already exists on-chain, the
  // vault rejects it on allowance first (balance second, for an unfunded wallet).
  const deposit = result.steps[1]
  if (result.completed) {
    console.log(`    allowance already on-chain (${formatBaseUnits(token, 6)} USDC): approve skipped/simulated, deposit simulates OK`)
  } else {
    assert.ok(deposit?.result?.mode === 'dry-run' && deposit.result.ok === false, 'deposit must revert without a real allowance')
    assert.match(deposit.result.revertReason ?? '', /ERC20Insufficient(Allowance|Balance)\(/, 'custom error decoded to a name')
    console.log(`    ${formatBaseUnits(token, 6)} USDC, no allowance: deposit simulation reverted as expected — ${deposit.result.revertReason?.split(' — ')[0]}`)
  }
})

test('readRequestStatus: Fuji ERC-7540 views are readable on-chain; the MCP tool degrades typed', LIVE, async () => {
  const { data } = await listVaults()
  const fuji = data.vaults.find((v) => v.id === FUJI)
  assert.ok(fuji)
  const status = await readRequestStatus({
    chain: chainOf(fuji),
    vaultId: FUJI,
    vaultAddress: fuji.contractAddress,
    controller: WALLET,
    requestId: 0n,
    kind: 'deposit',
  })
  assert.equal(status.source, 'onchain')
  assert.equal(typeof status.pending, 'bigint')
  assert.equal(typeof status.claimable, 'bigint')
  assert.ok(status.mcp === 'unavailable' || status.mcp === 'ok')
  console.log(`    fuji request 0 for burner: pending=${status.pending} claimable=${status.claimable} mcp=${status.mcp}`)
})

test('loadPortfolio: onchain reads the burner; auto falls back to declared when empty', LIVE, async () => {
  const { data } = await listVaults()
  const onchain = await loadPortfolio({ wallet: WALLET, targetVaultId: BSC, source: 'onchain', vaults: data.vaults })
  assert.equal(onchain.source, 'onchain')
  assert.equal(typeof onchain.idle, 'bigint')
  assert.equal(onchain.asset.symbol, 'USDC')
  const total = onchain.positions.reduce((a, p) => a + p.value, onchain.idle)

  const auto = await loadPortfolio({ wallet: WALLET, targetVaultId: BSC, source: 'auto', vaults: data.vaults })
  assert.equal(auto.source, total > 0n ? 'onchain' : 'declared')
  console.log(`    burner onchain: idle=${formatBaseUnits(onchain.idle, 6)} USDC, ${onchain.positions.length} position(s) → auto picked ${auto.source}`)
})

test('LIVE deposit + redeem on BSC (only when EXECUTION_MODE=live and the burner is funded)', { timeout: 600_000 }, async (t) => {
  const { vault, chain } = await bscVault()
  const { native, token } = await balances(chain, vault.asset.address as Address)
  const funded = native >= 10_000_000_000_000_000n && token >= usdc(1)
  if (env.EXECUTION_MODE !== 'live' || !funded) {
    t.skip(
      `skipped: EXECUTION_MODE=${env.EXECUTION_MODE}, burner ${WALLET} holds ${formatBaseUnits(native, 18)} tBNB / ${formatBaseUnits(token, 6)} USDC ` +
        '(needs live + >=0.01 tBNB + >=1 USDC)',
    )
    return
  }

  const live = createSigner({ mode: 'live' })
  const facts = await gatherFacts({ vaultId: BSC, wallet: WALLET })
  const portfolio = await loadPortfolio({ wallet: WALLET, targetVaultId: BSC, source: 'onchain' })
  const decision = evaluate(RULE_SET, portfolio, facts, { kind: 'deposit', vaultId: BSC, amount: usdc(1) })
  assert.equal(decision.verdict, 'ALLOW', decision.rationale)
  const plan = await planAction(decision)
  const result = await runPlan(plan, live, { chain, onStep: (s) => console.log(`    ${s.phase}: ${s.skipped ?? (s.result?.mode === 'live' ? `${s.result.status} ${s.result.explorerUrl ?? s.result.txHash}` : s.error)}`) })
  assert.equal(result.completed, true, result.note ?? '')
})
