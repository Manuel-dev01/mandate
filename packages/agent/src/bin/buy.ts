/**
 * Buy an audit report over x402 — the rehearsal buyer.
 *
 *   npm run buy --workspace=agent -- <receiptId> [--url https://…] [--out report.md]
 *
 * Pays from BUYER_PRIVATE_KEY, which must be a DIFFERENT burner from the agent's
 * payee wallet: paying yourself is not a sale. Needs Base Sepolia USDC
 * (faucet.circle.com) and nothing else — gas is the facilitator's problem.
 */

import { writeFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createSigner, wrapFetchWithPayment } from 'x402-fetch'
import { env } from '../env.js'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const receiptId = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true)

if (!receiptId) {
  console.error('usage: npm run buy --workspace=agent -- <receiptId> [--url https://agent…] [--out report.md]')
  process.exit(1)
}
const key = env.BUYER_PRIVATE_KEY
if (!key) {
  console.error('BUYER_PRIVATE_KEY is not set. Use a burner that is NOT the agent wallet, funded with Base Sepolia USDC (faucet.circle.com).')
  process.exit(1)
}

const base = (flag('url') ?? env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, '')
const url = `${base}/receipts/${receiptId}/report`
const buyer = privateKeyToAccount(key).address

if (buyer.toLowerCase() === env.X402_PAY_TO.toLowerCase()) {
  console.error(`BUYER_PRIVATE_KEY is the payee wallet (${buyer}). Buying from yourself proves nothing — use a different burner.`)
  process.exit(1)
}

const main = async () => {
  console.log(`buyer ${buyer} · ${env.X402_NETWORK} · ${env.X402_PRICE_USDC} USDC`)
  console.log(`GET ${url}`)

  // What the seller is asking, before paying anything.
  const challenge = await fetch(url)
  if (challenge.status !== 402) {
    console.error(`expected 402, got ${challenge.status}. Is the paywall live on that host?`)
    process.exit(2)
  }
  const { accepts } = (await challenge.json()) as { accepts: { network: string; maxAmountRequired: string; payTo: string; asset: string }[] }
  const req = accepts[0]
  console.log(`402 · pay ${req?.maxAmountRequired} base units of ${req?.asset} to ${req?.payTo} on ${req?.network}`)

  const signer = await createSigner(env.X402_NETWORK, key)
  // The SDK's own spend cap defaults to 0.10 USDC; ours is a buyer-side limit set
  // from what the seller actually asked for, so a surprise price still cannot pass.
  const cap = BigInt(req?.maxAmountRequired ?? '0')
  const paidFetch = wrapFetchWithPayment(fetch, signer, cap)
  const res = await paidFetch(url)
  if (!res.ok) {
    const body = await res.text()
    let reason = body
    try {
      reason = (JSON.parse(body) as { error?: string }).error ?? body
    } catch {
      // not JSON
    }
    console.error(`payment failed: ${res.status} — ${reason}`)
    process.exit(3)
  }
  const markdown = await res.text()
  const header = res.headers.get('x-payment-response')
  const settlement = header ? (JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { transaction?: string; network?: string }) : null

  const out = flag('out') ?? `mandate-report-${receiptId.slice(0, 12)}.md`
  writeFileSync(out, markdown)
  console.log(`\npaid · ${markdown.length} chars → ${out}`)
  if (settlement?.transaction) {
    const explorer = settlement.network === 'base' ? 'https://basescan.org' : 'https://sepolia.basescan.org'
    console.log(`tx ${settlement.transaction}`)
    console.log(`   ${explorer}/tx/${settlement.transaction}`)
  }
}

main().catch((err) => {
  console.error(`buy: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
