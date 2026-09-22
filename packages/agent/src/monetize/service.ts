/**
 * What the console says about the business: the price, the payee, the OpenServ
 * listing, and the agent's on-chain identity.
 *
 * Every field comes from env written by `npm run provision` / `npm run identity`
 * after a real call, or from a live preflight. Nothing is asserted that has not
 * happened — an unregistered identity says so.
 */

import { getPaywallHtml } from 'x402/paywall'
import type { PaymentRequirements } from 'x402/types'
import { env } from '../env.js'
import { explorerAddress, explorerTx } from './x402.js'

export interface ServiceFacts {
  readonly price: string
  readonly currency: 'USDC'
  readonly network: string
  readonly testnet: boolean
  readonly payTo: string
  readonly payToUrl: string | null
  readonly asset: string
  readonly facilitator: string
  /** The OpenServ paid-service listing, when provisioned. */
  readonly openserv: {
    readonly listed: boolean
    readonly triggerUrl: string | null
    readonly paywallUrl: string | null
    readonly workflowId: string | null
    /** From a live preflight: what the platform itself reports about the listing. */
    readonly name: string | null
    readonly price: string | null
    readonly active: boolean | null
    readonly checkedAt: string | null
  }
}

export interface IdentityFacts {
  readonly registered: boolean
  readonly agentId: string | null
  readonly chainId: number | null
  readonly txHash: string | null
  readonly txUrl: string | null
  readonly cardUrl: string | null
  readonly scanUrl: string | null
}

const DEFAULT_FACILITATOR = 'https://x402.org/facilitator'

/** One live preflight at a time, memoised for a minute: the console polls, the platform should not. */
let preflight: { at: number; value: ServiceFacts['openserv'] } | null = null

async function openservFacts(): Promise<ServiceFacts['openserv']> {
  const base = {
    listed: Boolean(env.X402_TRIGGER_URL),
    triggerUrl: env.X402_TRIGGER_URL ?? null,
    paywallUrl: env.X402_PAYWALL_URL ?? null,
    workflowId: env.X402_WORKFLOW_ID ?? null,
  }
  if (!env.X402_TRIGGER_URL) return { ...base, name: null, price: null, active: null, checkedAt: null }
  if (preflight && Date.now() - preflight.at < 60_000) return preflight.value

  const token = env.X402_TRIGGER_URL.split('/').pop() ?? ''
  const value = await (async (): Promise<ServiceFacts['openserv']> => {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const res = await fetch(`https://api.openserv.ai/webhooks/trigger/${token}`, { signal: ctrl.signal }).finally(() => clearTimeout(timer))
      if (!res.ok) return { ...base, name: null, price: null, active: null, checkedAt: new Date().toISOString() }
      const j = (await res.json()) as { triggerName?: string; x402Pricing?: string; isActive?: boolean }
      return { ...base, name: j.triggerName ?? null, price: j.x402Pricing ?? null, active: j.isActive ?? null, checkedAt: new Date().toISOString() }
    } catch {
      // The listing still exists; we just could not read it this minute.
      return { ...base, name: null, price: null, active: null, checkedAt: new Date().toISOString() }
    }
  })()
  preflight = { at: Date.now(), value }
  return value
}

export async function serviceFacts(): Promise<ServiceFacts> {
  return {
    price: env.X402_PRICE_USDC,
    currency: 'USDC',
    network: env.X402_NETWORK,
    testnet: env.X402_NETWORK !== 'base',
    payTo: env.X402_PAY_TO,
    payToUrl: explorerAddress(env.X402_PAY_TO),
    asset: env.X402_ASSET,
    facilitator: env.X402_FACILITATOR_URL ?? DEFAULT_FACILITATOR,
    openserv: await openservFacts(),
  }
}

export function identityFacts(): IdentityFacts {
  const agentId = env.ERC8004_AGENT_ID ?? null
  // registerOnChain returns "<chainId>:<tokenId>".
  const chainId = agentId?.includes(':') ? Number(agentId.split(':')[0]) : null
  return {
    registered: Boolean(agentId),
    agentId,
    chainId: Number.isFinite(chainId) ? chainId : null,
    txHash: env.ERC8004_TX_HASH ?? null,
    txUrl: env.ERC8004_TX_HASH ? explorerTx(env.ERC8004_TX_HASH, chainId === 8453 ? 'base' : 'base-sepolia') : null,
    cardUrl: env.ERC8004_CARD_URL ?? null,
    scanUrl: env.ERC8004_SCAN_URL ?? null,
  }
}

/** The x402 pay page the package ships, so a browser can pay with the viewer's own wallet. */
export function paywallPage(requirements: PaymentRequirements): string {
  return getPaywallHtml({
    amount: Number(env.X402_PRICE_USDC),
    testnet: env.X402_NETWORK !== 'base',
    paymentRequirements: [requirements],
    currentUrl: requirements.resource,
    appName: 'Mandate — audit report',
  })
}
