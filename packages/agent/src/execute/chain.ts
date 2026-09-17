/**
 * Read-only chain helpers shared by execute/ and mandate/portfolio.ts.
 * Nothing here can sign: public clients only. Signing lives in signer/.
 */

import { createPublicClient, http, parseAbi, type PublicClient, type Transport } from 'viem'
import { env } from '../env.js'
import { toChain, type ChainTarget } from '../signer/index.js'
import type { Vault } from '../ixs/schemas.js'

export type TransportFactory = (chain: ChainTarget) => Transport

const clients = new Map<string, PublicClient>()

export function publicClientFor(target: ChainTarget, transport?: TransportFactory): PublicClient {
  const key = `${target.chainId}:${target.rpcUrl}:${transport ? 'custom' : 'http'}`
  let client = clients.get(key)
  if (!client) {
    client = createPublicClient({
      chain: toChain(target),
      transport: transport ? transport(target) : http(target.rpcUrl, { timeout: 20_000, retryCount: 1 }),
    })
    clients.set(key, client)
  }
  return client
}

/**
 * A vault already knows its chain. With FORK_RPC_URL set, the forked chain id
 * is redirected to the local Anvil and labelled so no receipt can mistake a
 * fork for the real network.
 */
export function chainOf(vault: Pick<Vault, 'chainId' | 'rpcUrl' | 'network' | 'explorerUrl'>): ChainTarget {
  if (env.FORK_RPC_URL && vault.chainId === env.FORK_CHAIN_ID) {
    return { chainId: vault.chainId, rpcUrl: env.FORK_RPC_URL, name: `${vault.network} (fork)`, explorerUrl: null, fork: true }
  }
  if (!vault.rpcUrl) throw new Error(`vault on chain ${vault.chainId} has no rpcUrl`)
  return { chainId: vault.chainId, rpcUrl: vault.rpcUrl, name: vault.network, explorerUrl: vault.explorerUrl, fork: false }
}

export const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

export const ERC4626_ABI = parseAbi([
  'function asset() view returns (address)',
  'function balanceOf(address account) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function convertToShares(uint256 assets) view returns (uint256)',
  'function maxDeposit(address receiver) view returns (uint256)',
])

/** ERC-7540 async views and the two request events (requestId is the third indexed topic). */
export const ERC7540_ABI = parseAbi([
  'function pendingDepositRequest(uint256 requestId, address controller) view returns (uint256)',
  'function claimableDepositRequest(uint256 requestId, address controller) view returns (uint256)',
  'function pendingRedeemRequest(uint256 requestId, address controller) view returns (uint256)',
  'function claimableRedeemRequest(uint256 requestId, address controller) view returns (uint256)',
  'event DepositRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 assets)',
  'event RedeemRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares)',
])

/** Test hook. */
export function clearChainClients(): void {
  clients.clear()
}
