/**
 * IXS Zod boundary, plus the money rules.
 *
 * Every number that represents money crosses this file exactly once, as a
 * decimal string, and leaves as a bigint with explicit decimals. Nothing
 * downstream is allowed to see a float.
 *
 * Shapes verified live 13 Sep 2026 — see docs/RECON.md section 7.
 */

import { z } from 'zod'
import { IxsSchemaError } from './errors.js'

// --------------------------------------------------------------------- money

/** Vault shares are 18dp everywhere (on-chain `decimals()` returned 0x12). */
export const SHARE_DECIMALS = 18

/**
 * `pricePerShare` arrives quoted to the asset's precision ("1.087389 USDC"),
 * but scaling it at 18dp means no live value is ever rejected for precision.
 */
export const PRICE_SCALE_DECIMALS = 18

export interface Amount {
  /** Exactly what IXS sent, unit suffix included. Quote this in receipts. */
  readonly raw: string
  readonly baseUnits: bigint
  readonly decimals: number
  /** "USDC" / "USDG" when IXS appended one, else null. */
  readonly symbol: string | null
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/

/**
 * IXS sends `totalAssets` bare ("6304.473113") but `pricePerShare` with a unit
 * ("1.1 USDC"). Splitting first is what stops a naive parse yielding NaN.
 */
export function splitUnit(input: string): { value: string; symbol: string | null } {
  const trimmed = input.trim()
  const parts = trimmed.split(/\s+/)
  if (parts.length === 2) return { value: parts[0] ?? '', symbol: parts[1] ?? null }
  return { value: trimmed, symbol: null }
}

/**
 * Decimal string -> base units, by string manipulation only. Never Number(),
 * never parseFloat() — a 6dp USDC balance past 2^53 would round silently.
 *
 * Rejects more fractional digits than the asset carries instead of truncating:
 * losing a digit of someone's money is not a degradation we accept.
 */
export function parseDecimalAmount(input: string, decimals: number): bigint {
  const { value } = splitUnit(input)
  const m = value.match(DECIMAL_RE)
  if (!m) {
    throw new IxsSchemaError(`not a decimal amount: ${JSON.stringify(input)}`)
  }
  const sign = m[1] ?? ''
  const whole = m[2] ?? '0'
  const frac = m[3] ?? ''
  if (frac.length > decimals) {
    throw new IxsSchemaError(
      `"${value}" carries ${frac.length} fractional digits but this value is ${decimals}dp — refusing to truncate money`,
    )
  }
  const magnitude = BigInt(whole + frac.padEnd(decimals, '0'))
  return sign === '-' ? -magnitude : magnitude
}

/** Base units -> decimal string. Display only; never feed this back to IXS. */
export function formatBaseUnits(value: bigint, decimals: number): string {
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const frac = decimals === 0 ? '' : `.${digits.slice(digits.length - decimals)}`
  return `${negative ? '-' : ''}${whole}${frac}`
}

export function toAmount(raw: string, decimals: number): Amount {
  const { symbol } = splitUnit(raw)
  return Object.freeze({ raw, baseUnits: parseDecimalAmount(raw, decimals), decimals, symbol })
}

/** The reverse direction: base units -> the integer string IXS demands. */
export function toBaseUnitString(baseUnits: bigint): string {
  if (baseUnits <= 0n) {
    throw new IxsSchemaError(`amount must be positive base units, got ${baseUnits}`)
  }
  return baseUnits.toString()
}

// --------------------------------------------------------------------- vaults

const AssetSchema = z.object({
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  address: z.string(),
})

/**
 * REST /vaults items and vault_get's `vault` share this shape. MCP vaults_list
 * differs in exactly one field (`rpc` not `rpcUrl`), handled below.
 *
 * `.passthrough()` throughout: an added upstream field must not crash a demo.
 */
const VaultBaseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    chainId: z.number().int(),
    network: z.string(),
    contractAddress: z.string(),
    underlyingAsset: AssetSchema,
    requiresWhitelist: z.boolean(),
    actions: z.array(z.string()).default([]),
    // Null in live data, so modelled as nullable rather than optional.
    symbol: z.string().nullable().default(null),
    chainName: z.string().nullable().default(null),
    explorerUrl: z.string().nullable().default(null),
    subgraphUrl: z.string().nullable().default(null),
    routeId: z.string().nullable().default(null),
    status: z.string().nullable().default(null),
    logoUrl: z.string().nullable().default(null),
    productId: z.string().nullable().default(null),
    legacyId: z.string().nullable().default(null),
    protocolVersion: z.string().nullable().default(null),
    ixsRewards: z.unknown().nullable().default(null),
    metrics: z.unknown().nullable().default(null),
    transparency: z.unknown().nullable().default(null),
  })
  .passthrough()

type VaultBase = z.infer<typeof VaultBaseSchema>

/** REST /vaults and vault_get: the `rpcUrl` spelling. */
export const VaultSchema = VaultBaseSchema.extend({
  rpcUrl: z.string().nullable().default(null),
}).transform((v) => normalizeVault(v, v.rpcUrl))

/** MCP vaults_list: the `rpc` spelling, and a thinner field set. */
export const McpVaultSchema = VaultBaseSchema.extend({
  rpc: z.string().nullable().default(null),
}).transform((v) => normalizeVault(v, v.rpc))

export interface Vault {
  readonly id: string
  readonly name: string
  readonly symbol: string | null
  readonly chainId: number
  readonly network: string
  readonly chainName: string | null
  readonly contractAddress: string
  readonly rpcUrl: string | null
  readonly explorerUrl: string | null
  readonly subgraphUrl: string | null
  readonly routeId: string | null
  readonly asset: { readonly symbol: string; readonly decimals: number; readonly address: string }
  readonly requiresWhitelist: boolean
  readonly status: string | null
  readonly actions: readonly string[]
}

function normalizeVault(v: VaultBase, rpcUrl: string | null): Vault {
  return Object.freeze({
    id: v.id,
    name: v.name,
    symbol: v.symbol,
    chainId: v.chainId,
    network: v.network,
    chainName: v.chainName,
    contractAddress: v.contractAddress,
    rpcUrl,
    explorerUrl: v.explorerUrl,
    subgraphUrl: v.subgraphUrl,
    routeId: v.routeId,
    asset: Object.freeze({ ...v.underlyingAsset }),
    requiresWhitelist: v.requiresWhitelist,
    status: v.status,
    actions: Object.freeze([...v.actions]),
  })
}

// ---------------------------------------------------------------- settlement

/**
 * CLAUDE.md claimed every live vault was async ERC-7540. It is not: IXHYB-BSC
 * reports `sync` and builds a plain ERC-4626 approve+deposit. Both are modelled
 * so swapping the target vault mid-demo cannot break the type.
 */
export const SettlementSchema = z.enum(['sync', 'async-erc7540'])
export type SettlementKind = z.infer<typeof SettlementSchema>

export const KNOWN_STEP_TYPES = [
  'erc20_approve_exact',
  'vault_deposit',
  'vault_mint',
  'vault_withdraw',
  'vault_redeem',
  'vault_request_deposit',
  'vault_request_redeem',
  'vault_claim_deposit',
  'vault_claim_redeem',
] as const

export type KnownStepType = (typeof KNOWN_STEP_TYPES)[number]

export function isKnownStepType(type: string): type is KnownStepType {
  return (KNOWN_STEP_TYPES as readonly string[]).includes(type)
}

/**
 * An UNSIGNED transaction. Nothing in this package may broadcast it; the
 * agent plans, a signer approves.
 */
const TxSchema = z
  .object({ to: z.string(), data: z.string(), value: z.string().default('0') })
  .passthrough()
  .transform((t) => Object.freeze({ to: t.to, data: t.data, value: t.value, valueWei: BigInt(t.value) }))

/** `type` stays an open string: an unrecognised step must degrade, not crash. */
const StepSchema = z
  .object({ type: z.string(), description: z.string().default(''), tx: TxSchema })
  .passthrough()

export type BuildStep = z.infer<typeof StepSchema>

const StepAmountSchema = z
  .object({
    baseUnits: z.string(),
    decimals: z.number().int().nonnegative(),
    symbol: z.string().nullable().default(null),
  })
  .passthrough()
  .transform(
    (a): Amount =>
      Object.freeze({
        raw: a.baseUnits,
        baseUnits: BigInt(a.baseUnits),
        decimals: a.decimals,
        symbol: a.symbol,
      }),
  )

/**
 * Deposit builds carry `amount`, redeem builds carry `shares`. Both optional so
 * the claim builders — which we cannot exercise until a request is claimable —
 * validate instead of blowing up on first contact.
 */
export const BuildResultSchema = z
  .object({
    ok: z.boolean().default(true),
    settlement: SettlementSchema,
    chainId: z.number().int(),
    network: z.string(),
    vault: z.object({ id: z.string(), address: z.string() }).passthrough(),
    ownerAddress: z.string(),
    asset: AssetSchema.nullable().default(null),
    amount: StepAmountSchema.nullable().default(null),
    shares: StepAmountSchema.nullable().default(null),
    steps: z.array(StepSchema).min(1),
  })
  .passthrough()

export type BuildResult = z.infer<typeof BuildResultSchema>

/** True when the ERC-7540 request -> poll -> claim lifecycle applies. */
export function requiresClaim(build: BuildResult): boolean {
  return build.settlement === 'async-erc7540'
}

// ------------------------------------------------------------- tool results

export const VaultsListSchema = z
  .object({
    ok: z.boolean().default(true),
    total: z.number().int().nonnegative().default(0),
    vaults: z.array(McpVaultSchema).default([]),
  })
  .passthrough()

export const VaultGetSchema = z
  .object({
    ok: z.boolean().default(true),
    settlement: SettlementSchema,
    vault: VaultSchema,
    pricing: z
      .object({
        totalAssets: z.string(),
        totalSupply: z.string(),
        pricePerShare: z.string(),
      })
      .passthrough(),
  })
  .passthrough()
  // Pricing decimals are CONTEXTUAL — totalAssets is in the asset's dp, while
  // totalSupply is in share dp. That is why this transform sits on the whole
  // object and not on `pricing` alone.
  .transform((r) => ({
    ok: r.ok,
    settlement: r.settlement,
    vault: r.vault,
    pricing: Object.freeze({
      totalAssets: toAmount(r.pricing.totalAssets, r.vault.asset.decimals),
      totalSupply: toAmount(r.pricing.totalSupply, SHARE_DECIMALS),
      pricePerShare: toAmount(r.pricing.pricePerShare, PRICE_SCALE_DECIMALS),
    }),
  }))

export type VaultState = z.infer<typeof VaultGetSchema>

export const WhitelistSchema = z
  .object({
    ok: z.boolean().default(true),
    whitelistEnabled: z.boolean(),
    whitelisted: z.boolean(),
  })
  .passthrough()

export type WhitelistCheck = z.infer<typeof WhitelistSchema>

/**
 * UNVERIFIED SHAPE. `vault_request_status` is broken upstream as of
 * 13 Sep 2026 ("Type `DepositRequest` has no field `owner`"), so this has
 * never seen a success payload. Deliberately permissive; tighten it the day
 * IXS fixes the subgraph query.
 */
export const RequestStatusSchema = z
  .object({
    ok: z.boolean().default(true),
    requests: z.array(z.unknown()).default([]),
  })
  .passthrough()

export type RequestStatus = z.infer<typeof RequestStatusSchema>

/** REST /vaults is paginated: { items, page, pageSize, totalItems, ... }. */
export const RestVaultPageSchema = z
  .object({
    items: z.array(VaultSchema).default([]),
    page: z.number().int().nonnegative().default(1),
    pageSize: z.number().int().nonnegative().default(0),
    totalItems: z.number().int().nonnegative().default(0),
    totalPages: z.number().int().nonnegative().default(1),
    hasNextPage: z.boolean().default(false),
  })
  .passthrough()

/** UNVERIFIED SHAPE — positions endpoint has not been exercised yet. */
export const PositionSchema = z.record(z.unknown())
export type Position = z.infer<typeof PositionSchema>
