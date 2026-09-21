/**
 * The vault universe never shrinks because REST wobbled. MCP vaults_list returns 1 of 5
 * (RECON §6.1); on 21 Sep a REST failure merged into a one-vault universe and overwrote the
 * good snapshot. REST is authoritative: when it fails, the last good universe is served STALE.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { IxsError } from './errors.js'
import { fetchUniverse, LastGood, type VaultUniverse } from './index.js'
import type { Vault } from './schemas.js'

const vault = (id: string, name: string): Vault => ({
  id, name, symbol: null, chainId: 97, network: 'bsc-testnet', chainName: null,
  contractAddress: '0x0000000000000000000000000000000000000001', rpcUrl: null, explorerUrl: null, subgraphUrl: null, routeId: null,
  asset: { symbol: 'USDC', decimals: 6, address: '0x0000000000000000000000000000000000000002' },
  requiresWhitelist: false, status: 'active', actions: ['deposit', 'redeem'],
})
const FIVE = ['a', 'b', 'c', 'd', 'e'].map((x) => vault(`id-${x}`, `IXHYB - ${x}`))
const ONE = [vault('id-b', 'IXHYB - b')]

// The live read, driven through a private LastGood so the test never touches the
// process-wide cache or the real .snapshots/ directory.
function merge(restFn: () => Promise<Vault[]>, mcpFn: () => Promise<Vault[]>): Promise<VaultUniverse> {
  return fetchUniverse({
    rest: { listVaults: restFn } as never,
    mcp: { vaultsList: async () => ({ vaults: await mcpFn() }) } as never,
  })
}

test('REST is authoritative: a REST failure is a failed read, not a one-vault universe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mandate-universe-'))
  try {
    const cache = new LastGood<VaultUniverse>('universe', { dir })
    const good = await cache.serve('u', () => merge(async () => FIVE, async () => ONE))
    assert.equal(good.data.vaults.length, 5)
    assert.deepEqual(good.data.sources, { rest: 5, mcp: 1 })
    assert.equal(good.data.divergence.length, 4)

    const wobble = await cache.serve('u', () =>
      merge(
        async () => { throw new IxsError('transport', 'GET /vaults fetch failed') },
        async () => ONE,
      ),
    )
    assert.equal(wobble.stale, true, 'served from the last good copy')
    assert.equal(wobble.data.vaults.length, 5, 'the universe did not shrink')
    assert.match(wobble.error ?? '', /fetch failed/)

    const empty = await cache.serve('u', () => merge(async () => [], async () => ONE))
    assert.equal(empty.stale, true, 'an empty REST page is a failure too')
    assert.equal(empty.data.vaults.length, 5)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('MCP failure alone is non-fatal: REST is a complete answer', async () => {
  const u = await merge(async () => FIVE, async () => { throw new Error('MCP timed out') })
  assert.equal(u.vaults.length, 5)
  assert.deepEqual(u.sources, { rest: 5, mcp: 0 })
  assert.match(u.mcpError ?? '', /timed out/)
})
