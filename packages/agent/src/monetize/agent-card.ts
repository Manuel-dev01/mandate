/**
 * The ERC-8004 agent card — who this agent is, what it sells, and where to reach it.
 *
 * Served live at /.well-known/agent-card.json by our own API and registered as the
 * token URI, so the identity points at something anyone can fetch and check against
 * a running agent. (OpenServ's IPFS presign endpoint was 500-ing on 22 Sep —
 * RECON §6.15 — and a live URL we serve is more checkable than a pinned blob.)
 */

import { env } from '../env.js'

export interface AgentCard {
  readonly type: string
  readonly name: string
  readonly description: string
  readonly services: ReadonlyArray<{ name: string; endpoint: string; description?: string }>
  readonly registrations?: ReadonlyArray<{ agentId: number; agentRegistry: string }>
  readonly active: boolean
  readonly x402support: boolean
}

const CHAIN_ID = Number(process.env['ERC8004_CHAIN_ID'] ?? 84532)

export function agentCard(origin: string = env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`): AgentCard {
  const base = origin.replace(/\/+$/, '')
  const services: { name: string; endpoint: string; description?: string }[] = [
    { name: 'auditReport', endpoint: `${base}/receipts/{receiptId}/report`, description: `Paid over x402: ${env.X402_PRICE_USDC} USDC per report on ${env.X402_NETWORK}.` },
    { name: 'decisionApi', endpoint: base, description: 'Read-only: every decision receipt, the compiled mandate, and live IXS vault state.' },
    { name: 'console', endpoint: process.env['CONSOLE_URL'] ?? 'https://mandate-console-five.vercel.app', description: 'The audit console.' },
    { name: 'telegram', endpoint: process.env['NEXT_PUBLIC_TELEGRAM_URL'] ?? 'https://t.me/mandaeteBot', description: 'Where a treasurer sets the mandate and proposes actions.' },
    { name: 'agentWallet', endpoint: `eip155:${CHAIN_ID}:${env.X402_PAY_TO}` },
  ]
  if (env.X402_TRIGGER_URL) services.push({ name: 'openservX402', endpoint: env.X402_TRIGGER_URL, description: 'The same report as a paid OpenServ x402 service.' })

  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Mandate',
    description:
      'An autonomous treasury agent that is provably incapable of breaking its mandate. A policy written in plain English compiles to seven deterministic rules; every proposed move into licensed RWA vaults is checked against them with live vault data, and every decision — allowed or refused — emits a hash-linked receipt anyone can verify and replay.',
    services,
    active: true,
    x402support: true,
  }
}
