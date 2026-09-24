/**
 * The paywall on the audit report — standard x402, settled on Base Sepolia.
 *
 * We are the resource server: we state the price, the payer signs an EIP-3009
 * authorization in their own wallet, and the public facilitator verifies and
 * submits it. We never hold a key, never pay gas, and never see funds move
 * except as a settlement result we can point at on a block explorer.
 *
 * The report itself is unchanged: renderReport() is byte-stable, and what a
 * buyer receives is exactly what the console previews.
 */

import { decodePayment } from 'x402/schemes'
import type { PaymentPayload, PaymentRequirements } from 'x402/types'
import { useFacilitator } from 'x402/verify'
import { env } from '../env.js'
import { parseDecimalAmount } from '../ixs/schemas.js'

export const X402_VERSION = 1

/** USDC is 6dp on every chain we touch. The price is a decimal string in .env; money never becomes a float. */
export const priceBaseUnits = (price: string = env.X402_PRICE_USDC): bigint => parseDecimalAmount(price, 6)

/**
 * What one report costs and where payment goes. `origin` is the public base URL
 * of this API, so `resource` is the exact URL the buyer paid for.
 */
export function reportRequirements(receiptId: string, origin: string): PaymentRequirements {
  const resource = `${origin.replace(/\/+$/, '')}/receipts/${receiptId}/report` as PaymentRequirements['resource']
  return {
    scheme: 'exact',
    network: env.X402_NETWORK,
    maxAmountRequired: priceBaseUnits().toString(),
    resource,
    description: `Mandate audit report for receipt ${receiptId.slice(0, 12)} — every rule, every number, the explanation and the three hashes.`,
    mimeType: 'text/markdown',
    payTo: env.X402_PAY_TO,
    maxTimeoutSeconds: 120,
    asset: env.X402_ASSET,
    extra: { name: 'USDC', version: '2' },
  }
}

export type Settlement =
  /** Verified and settled: the buyer paid, and this is the transaction. */
  | { kind: 'paid'; txHash: string; payer: string; network: string }
  /** The header was present but not acceptable. The buyer gets a 402 again with this reason. */
  | { kind: 'invalid'; reason: string }
  /**
   * We could not reach the facilitator, or it did not answer in time. Never serve the
   * file on a maybe. `phase` matters for what we are allowed to tell the buyer: a
   * failure during `verify` moved no money, but a `settle` that we gave up waiting on
   * may still have been broadcast — so we must not claim nothing was charged.
   */
  | { kind: 'facilitator-down'; reason: string; phase: 'verify' | 'settle' }

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Distinguishes "the payment is bad" from "we could not check" — the second must never sell a report. */
function isTransport(err: unknown): boolean {
  const m = messageOf(err).toLowerCase()
  return m.includes('fetch failed') || m.includes('timed out') || m.includes('timeout') || m.includes('econn') || m.includes('network') || m.includes('socket')
}

export interface FacilitatorLike {
  verify: (payload: PaymentPayload, requirements: PaymentRequirements) => Promise<{ isValid: boolean; invalidReason?: string | undefined; payer?: string | undefined }>
  settle: (payload: PaymentPayload, requirements: PaymentRequirements) => Promise<{ success: boolean; errorReason?: string | undefined; transaction?: string | undefined; network?: string | undefined; payer?: string | undefined }>
}

let cached: FacilitatorLike | null = null
function facilitator(): FacilitatorLike {
  cached ??= useFacilitator(env.X402_FACILITATOR_URL ? { url: env.X402_FACILITATOR_URL as `${string}://${string}` } : undefined) as unknown as FacilitatorLike
  return cached
}

/** A facilitator call that has not answered by now is treated as unreachable. */
const FACILITATOR_TIMEOUT_MS = 20_000

/**
 * Header -> money moved, or a named reason why not. Verify first (cheap, no chain
 * write), settle second. One retry on a transport failure; never throws.
 */
export async function settlementOf(header: string, requirements: PaymentRequirements, deps: { facilitator?: FacilitatorLike } = {}): Promise<Settlement> {
  const f = deps.facilitator ?? facilitator()

  let payload: PaymentPayload
  try {
    payload = decodePayment(header)
  } catch (err) {
    return { kind: 'invalid', reason: `could not decode the X-PAYMENT header: ${messageOf(err)}` }
  }

  // The facilitator is someone else's service. A thrown error we retry, but a socket
  // that simply hangs would leave the buyer's browser waiting with money authorised and
  // nothing decided — so a hang becomes a transport failure, which the caller turns into
  // a 503 that sells nothing.
  const withTimeout = async <T>(run: () => Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`facilitator timed out after ${FACILITATOR_TIMEOUT_MS}ms`)), FACILITATOR_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** Our own timeout, as opposed to the facilitator refusing the connection. */
  const isOurTimeout = (err: unknown): boolean => messageOf(err).includes('facilitator timed out')

  const attempt = async <T>(
    run: () => Promise<T>,
    mayRetry: (err: unknown) => boolean,
  ): Promise<{ ok: true; value: T } | { ok: false; transport: boolean; reason: string }> => {
    for (let i = 0; i < 2; i++) {
      try {
        return { ok: true, value: await withTimeout(run) }
      } catch (err) {
        if (!isTransport(err) || !mayRetry(err) || i === 1) return { ok: false, transport: isTransport(err), reason: messageOf(err) }
      }
    }
    return { ok: false, transport: true, reason: 'unreachable' }
  }

  const verified = await attempt(() => f.verify(payload, requirements), () => true)
  if (!verified.ok) {
    return verified.transport ? { kind: 'facilitator-down', reason: verified.reason, phase: 'verify' } : { kind: 'invalid', reason: verified.reason }
  }
  if (!verified.value.isValid) return { kind: 'invalid', reason: verified.value.invalidReason ?? 'the facilitator rejected the payment' }

  const settled = await attempt(() => f.settle(payload, requirements), (err) => !isOurTimeout(err))
  if (!settled.ok) {
    return settled.transport ? { kind: 'facilitator-down', reason: settled.reason, phase: 'settle' } : { kind: 'invalid', reason: settled.reason }
  }
  if (!settled.value.success) return { kind: 'invalid', reason: settled.value.errorReason ?? 'settlement failed' }

  return {
    kind: 'paid',
    txHash: settled.value.transaction ?? '',
    payer: settled.value.payer ?? verified.value.payer ?? '',
    network: settled.value.network ?? requirements.network,
  }
}

/** The `X-PAYMENT-RESPONSE` header value: base64 JSON, as the spec has it. */
export function paymentResponseHeader(s: Extract<Settlement, { kind: 'paid' }>): string {
  return Buffer.from(JSON.stringify({ success: true, transaction: s.txHash, network: s.network, payer: s.payer }), 'utf8').toString('base64')
}

/** Block explorer for a settlement, so every sale on the console is checkable. */
export function explorerTx(txHash: string, network: string = env.X402_NETWORK): string | null {
  if (!txHash) return null
  const base = network === 'base' ? 'https://basescan.org' : network === 'base-sepolia' ? 'https://sepolia.basescan.org' : null
  return base ? `${base}/tx/${txHash}` : null
}

export function explorerAddress(address: string, network: string = env.X402_NETWORK): string | null {
  if (!address) return null
  const base = network === 'base' ? 'https://basescan.org' : network === 'base-sepolia' ? 'https://sepolia.basescan.org' : null
  return base ? `${base}/address/${address}` : null
}
