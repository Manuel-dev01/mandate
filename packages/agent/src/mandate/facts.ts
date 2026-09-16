/**
 * Gathers the live facts the evaluator needs. The only I/O in mandate/.
 *
 * READ-ONLY. No wallet, no signing, no broadcast — a public client and three
 * reads. Chain 4663 (Robinhood mainnet) reads are within CLAUDE.md's rules.
 *
 * Cache policy mirrors ixs/index.ts: vault pricing may come from the last
 * good snapshot (flagged `stale`), the whitelist check never does, and the
 * on-chain paused() read is attempted fresh every time.
 */

import { getVaultState, mcp, type IxsMcpClient } from '../ixs/index.js'
import type { VaultFacts } from './types.js'

/** keccak256("paused()")[0:4]. The same selector scripts/smoke.mjs uses. */
const PAUSED_SELECTOR = '0x5c975abb'
const RPC_TIMEOUT_MS = 10_000

export interface GatherFactsOptions {
  mcp?: IxsMcpClient
  /** Override the vault's own RPC (tests, private endpoints). */
  rpcUrl?: string
  readPaused?: (rpcUrl: string, address: `0x${string}`) => Promise<boolean | null>
}

export async function gatherFacts(input: { vaultId: string; wallet: string }, opts: GatherFactsOptions = {}): Promise<VaultFacts> {
  const client = opts.mcp ?? mcp
  const snap = await getVaultState(input.vaultId)
  const { vault, pricing, settlement } = snap.data

  const [whitelist, paused] = await Promise.all([
    client.checkWhitelist(input.vaultId, input.wallet).then(
      (w) => ({ whitelisted: w.whitelisted, whitelistEnabled: w.whitelistEnabled }),
      // The check itself failed. Null, so whitelist_required fails closed.
      () => ({ whitelisted: null, whitelistEnabled: null }),
    ),
    (opts.readPaused ?? readPausedOnChain)(opts.rpcUrl ?? vault.rpcUrl ?? '', vault.contractAddress as `0x${string}`),
  ])

  return Object.freeze({
    vaultId: vault.id,
    name: vault.name,
    chainId: vault.chainId,
    network: vault.network,
    status: vault.status,
    settlement,
    requiresWhitelist: vault.requiresWhitelist,
    asset: { symbol: vault.asset.symbol, decimals: vault.asset.decimals },
    totalAssets: pricing.totalAssets.baseUnits,
    paused,
    whitelisted: whitelist.whitelisted,
    whitelistEnabled: whitelist.whitelistEnabled,
    observedAt: snap.fetchedAt,
    stale: snap.stale,
  })
}

/**
 * `paused()` via a raw eth_call. Any failure — revert, missing function,
 * RPC down, malformed reply — is null, never a throw.
 *
 * Deliberately not viem: one selector does not justify a 40-package dependency
 * on the evaluator's hot path, and the flaky install left viem's tree broken
 * (docs/RECON.md §6.8). viem stays declared for the D4 signer.
 */
export async function readPausedOnChain(rpcUrl: string, address: `0x${string}`): Promise<boolean | null> {
  if (!rpcUrl || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: address, data: PAUSED_SELECTOR }, 'latest'] }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { result?: unknown; error?: unknown }
    if (json.error || typeof json.result !== 'string') return null
    // A bool is a 32-byte word; anything else (e.g. "0x" from a contract with no paused()) is unreadable.
    if (!/^0x[0-9a-fA-F]{64}$/.test(json.result)) return null
    const word = BigInt(json.result)
    return word === 0n ? false : word === 1n ? true : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
