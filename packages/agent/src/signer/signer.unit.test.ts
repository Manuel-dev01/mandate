/**
 * Signer guardrails. No network: a scripted viem transport records every
 * JSON-RPC method the signer tries to call.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { custom, encodeErrorResult, parseAbi, type Transport } from 'viem'
import { SignerRefusal, createSigner, type ChainTarget } from './index.js'

/** A throwaway key. Deterministic, public, never funded. */
const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const TEST_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

const BSC: ChainTarget = { chainId: 97, rpcUrl: 'http://scripted', name: 'bsc-testnet', explorerUrl: 'https://testnet.bscscan.com' }
const ROBINHOOD: ChainTarget = { chainId: 4663, rpcUrl: 'http://scripted', name: 'robinhood-mainnet' }

const TX = { to: '0xCb09a5326AEFD705d14FF4C5ca2beD7086ba0Dcc', data: '0x6e553f65', value: '0' }

function scripted(handlers: Record<string, (params: unknown[]) => unknown> = {}) {
  const calls: string[] = []
  const transport = (): Transport =>
    custom({
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        calls.push(method)
        const h = handlers[method]
        if (!h) throw new Error(`unscripted RPC method ${method}`)
        return h(params ?? [])
      },
    }, { retryCount: 0 })
  return { calls, transport }
}

test('signer: address derives from the key; mode defaults to dry-run', () => {
  const { transport } = scripted()
  const s = createSigner({ privateKey: TEST_KEY, transport, blockedChainIds: [4663] })
  assert.equal(s.address, TEST_ADDRESS)
  assert.equal(s.mode, 'dry-run')
})

test('signer: refuses a blocked chain before touching any transport', async () => {
  const { calls, transport } = scripted()
  const s = createSigner({ privateKey: TEST_KEY, transport, blockedChainIds: [4663, 8453, 1], mode: 'live' })
  await assert.rejects(
    () => s.send(TX, { chain: ROBINHOOD, decisionHash: 'a'.repeat(64) }),
    (err: unknown) => err instanceof SignerRefusal && err.reason === 'blocked_chain',
  )
  assert.deepEqual(calls, [], 'no RPC call was made')
})

test('signer: refuses over MAX_ACTION_ASSET_AMOUNT before touching any transport', async () => {
  const { calls, transport } = scripted()
  const s = createSigner({ privateKey: TEST_KEY, transport, blockedChainIds: [], maxActionAssetAmount: '10000', mode: 'live' })
  await assert.rejects(
    () => s.send(TX, { chain: BSC, decisionHash: 'a'.repeat(64), assetAmount: 10_000_000_001n, assetDecimals: 6 }),
    (err: unknown) => err instanceof SignerRefusal && err.reason === 'amount_cap',
  )
  assert.deepEqual(calls, [])
  // exactly the cap is allowed through to the guardrail-free path (dry-run then simulates)
})

test('signer: dry-run simulates and NEVER sends', async () => {
  const { calls, transport } = scripted({
    eth_call: () => '0x',
    eth_estimateGas: () => '0x5208',
  })
  const s = createSigner({ privateKey: TEST_KEY, transport, blockedChainIds: [], mode: 'dry-run' })
  const r = await s.send(TX, { chain: BSC, decisionHash: 'b'.repeat(64), assetAmount: 1_000_000n, assetDecimals: 6 })
  assert.equal(r.mode, 'dry-run')
  if (r.mode === 'dry-run') {
    assert.equal(r.ok, true)
    assert.equal(r.gasEstimate, 21000n)
    assert.equal(r.revertReason, null)
    assert.equal(r.from, TEST_ADDRESS)
    assert.equal(r.decisionHash, 'b'.repeat(64))
  }
  assert.ok(calls.includes('eth_call'))
  assert.ok(!calls.includes('eth_sendRawTransaction'), `sent a transaction in dry-run: ${calls.join(',')}`)
  assert.ok(!calls.includes('eth_sendTransaction'))
})

test('signer: dry-run reports a revert as a result, not an exception', async () => {
  const { transport } = scripted({
    eth_call: () => {
      throw Object.assign(new Error('execution reverted: ERC20: transfer amount exceeds balance'), { code: 3 })
    },
  })
  const s = createSigner({ privateKey: TEST_KEY, transport, blockedChainIds: [], mode: 'dry-run' })
  const r = await s.send(TX, { chain: BSC, decisionHash: 'c'.repeat(64) })
  assert.equal(r.mode, 'dry-run')
  if (r.mode === 'dry-run') {
    assert.equal(r.ok, false)
    assert.match(r.revertReason ?? '', /revert|balance/i)
  }
})

test('signer: decodes OpenZeppelin custom errors into readable reasons', async () => {
  const { transport } = scripted({
    eth_call: () => {
      throw Object.assign(new Error('execution reverted'), {
        code: 3,
        data: encodeErrorResult({
          abi: parseAbi(['error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)']),
          errorName: 'ERC20InsufficientAllowance',
          args: ['0xCb09a5326AEFD705d14FF4C5ca2beD7086ba0Dcc', 0n, 1_000_000n],
        }),
      })
    },
  })
  const s = createSigner({ privateKey: TEST_KEY, transport, blockedChainIds: [], mode: 'dry-run' })
  const r = await s.send(TX, { chain: BSC, decisionHash: 'd'.repeat(64) })
  assert.equal(r.mode, 'dry-run')
  if (r.mode === 'dry-run') {
    assert.equal(r.ok, false)
    assert.match(r.revertReason ?? '', /ERC20InsufficientAllowance\(spender=0xcb09a5326aefd705d14ff4c5ca2bed7086ba0dcc, allowance=0, needed=1000000\)/i)
  }
})

test('signer: no key is a typed refusal, not a crash', () => {
  const { transport } = scripted()
  assert.throws(
    () => createSigner({ privateKey: null, transport, blockedChainIds: [] }),
    (err: unknown) => err instanceof SignerRefusal && err.reason === 'no_key',
  )
})
