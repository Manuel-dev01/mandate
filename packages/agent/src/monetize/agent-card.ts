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

/** The ERC-8004 identity registry we registered against (RECON 6.15). */
const ERC8004_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e'

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

  const registration = erc8004Registration()
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Mandate',
    description:
      'An autonomous treasury agent that is provably incapable of breaking its mandate. A policy written in plain English compiles to deterministic rules drawn from a fixed set of seven; every proposed move into licensed RWA vaults is checked against them with live vault data, or the last good snapshot when IXS is unreachable — the receipt says which, and every decision — allowed or refused — emits a hash-linked receipt anyone can verify and replay.',
    services,
    // This document IS the token URI the identity points at, so it must name the
    // registration it belongs to — otherwise a verifier resolving the identity cannot
    // cross-check the agent id it started from.
    ...(registration ? { registrations: [registration] } : {}),
    active: true,
    x402support: true,
  }
}

/** `<chainId>:<tokenId>` from env -> the ERC-8004 registration this card belongs to. */
function erc8004Registration(): { agentId: number; agentRegistry: string } | null {
  const raw = env.ERC8004_AGENT_ID
  if (!raw) return null
  const [chainId, tokenId] = raw.split(':')
  const id = Number(tokenId)
  if (!chainId || !Number.isInteger(id)) return null
  return { agentId: id, agentRegistry: `eip155:${chainId}:${ERC8004_REGISTRY}` }
}
