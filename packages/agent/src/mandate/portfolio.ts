/**
 * PortfolioState from the chain, with a labelled declared fallback.
 *
 *   onchain   idle      = target vault's asset balanceOf(wallet) on the target chain
 *             positions = share balanceOf(wallet) x convertToAssets, per vault
 *   declared  the seed file (portfolio.declared.json) — rehearsal / unfunded wallet
 *   auto      onchain when the wallet holds anything at all, else declared
 *
 * Assumption, stated because it is one: every vault asset is a 6dp USD
 * stablecoin (USDC / USDG) and they aggregate 1:1 into one portfolio figure.
 * `source` rides into the decision hash, so a declared book is never hidden.
 */

import { readFileSync } from 'node:fs'
import type { Address } from 'viem'
import { z } from 'zod'
import { env } from '../env.js'
import { ERC20_ABI, ERC4626_ABI, chainOf, publicClientFor, type TransportFactory } from '../execute/chain.js'
import { listVaults } from '../ixs/index.js'
import { parseDecimalAmount, type Vault } from '../ixs/schemas.js'
import type { PortfolioPosition, PortfolioSource, PortfolioState } from './types.js'

export interface LoadPortfolioOptions {
  wallet: string
  /** Whose chain and asset define "idle". */
  targetVaultId: string
  source?: PortfolioSource | 'auto'
  /** Skip the IXS call by supplying the universe. */
  vaults?: readonly Vault[]
  declaredPath?: string
  transport?: TransportFactory
}

const DeclaredSchema = z.object({
  asset: z.object({ symbol: z.string(), decimals: z.number().int().nonnegative() }),
  /** Asset units, e.g. "65000". */
  idle: z.string().regex(/^\d+(\.\d+)?$/),
  positions: z.array(z.object({ vaultId: z.string(), chainId: z.number().int(), value: z.string().regex(/^\d+(\.\d+)?$/) })),
})

export async function loadPortfolio(opts: LoadPortfolioOptions): Promise<PortfolioState> {
  const source = opts.source ?? 'auto'
  if (source === 'declared') return loadDeclared(opts.wallet, opts.declaredPath)

  const vaults = opts.vaults ?? (await listVaults()).data.vaults
  const target = vaults.find((v) => v.id === opts.targetVaultId)
  if (!target) throw new Error(`target vault ${opts.targetVaultId} is not in the vault universe`)

  const live = await loadOnchain(opts.wallet, target, vaults, opts.transport)
  const total = live.positions.reduce((a, p) => a + p.value, live.idle)
  if (source === 'onchain' || total > 0n) return live
  return loadDeclared(opts.wallet, opts.declaredPath)
}

export function loadDeclared(wallet: string, path = env.PORTFOLIO_DECLARED_PATH): PortfolioState {
  const raw = DeclaredSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  const d = raw.asset.decimals
  return Object.freeze({
    wallet,
    asset: Object.freeze({ ...raw.asset }),
    idle: parseDecimalAmount(raw.idle, d),
    positions: Object.freeze(
      raw.positions.map((p) => Object.freeze({ vaultId: p.vaultId, chainId: p.chainId, value: parseDecimalAmount(p.value, d) })),
    ),
    asOf: new Date().toISOString(),
    source: 'declared',
  })
}

export async function loadOnchain(
  wallet: string,
  target: Vault,
  vaults: readonly Vault[],
  transport?: TransportFactory,
): Promise<PortfolioState> {
  const owner = wallet as Address

  const idle = await publicClientFor(chainOf(target), transport).readContract({
    address: target.asset.address as Address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [owner],
  })

  const positions: PortfolioPosition[] = []
  await Promise.all(
    vaults.map(async (vault) => {
      if (!vault.rpcUrl) return
      const client = publicClientFor(chainOf(vault), transport)
      const address = vault.contractAddress as Address
      try {
        const shares = await client.readContract({ address, abi: ERC4626_ABI, functionName: 'balanceOf', args: [owner] })
        if (shares === 0n) return
        const value = await client.readContract({ address, abi: ERC4626_ABI, functionName: 'convertToAssets', args: [shares] })
        positions.push({ vaultId: vault.id, chainId: vault.chainId, value: rescale(value, vault.asset.decimals, target.asset.decimals) })
      } catch {
        // An unreachable chain contributes no position. The receipt still says
        // `onchain`; a missing position under-counts exposure, so the safer
        // direction (more concentration, less liquidity) is left to the rules.
      }
    }),
  )
  positions.sort((a, b) => a.vaultId.localeCompare(b.vaultId))

  return Object.freeze({
    wallet,
    asset: Object.freeze({ symbol: target.asset.symbol, decimals: target.asset.decimals }),
    idle,
    positions: Object.freeze(positions),
    asOf: new Date().toISOString(),
    source: 'onchain',
  })
}

function rescale(value: bigint, from: number, to: number): bigint {
  if (from === to) return value
  return from < to ? value * 10n ** BigInt(to - from) : value / 10n ** BigInt(from - to)
}
