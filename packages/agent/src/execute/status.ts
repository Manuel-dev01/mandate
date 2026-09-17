/**
 * ERC-7540 request status without the broken tool.
 *
 * `vault_request_status` errors upstream on every call (RECON §6.3), so the
 * chain is the source of truth: `pendingDepositRequest` / `claimable…` views.
 * The MCP tool is still tried first and its outcome recorded, so the day IXS
 * fixes it we see it in the receipt rather than in a surprise.
 */

import type { Address } from 'viem'
import { IxsError, mcp as defaultMcp, type IxsMcpClient } from '../ixs/index.js'
import type { ChainTarget } from '../signer/index.js'
import { ERC7540_ABI, publicClientFor, type TransportFactory } from './chain.js'

export interface RequestStatusQuery {
  readonly chain: ChainTarget
  readonly vaultId: string
  readonly vaultAddress: string
  readonly controller: string
  readonly requestId: bigint
  readonly kind: 'deposit' | 'redeem'
}

export interface RequestStatus {
  readonly requestId: string
  readonly pending: bigint
  readonly claimable: bigint
  /** Where the numbers came from. Today: always onchain. */
  readonly source: 'onchain'
  /** What the MCP tool did when asked. */
  readonly mcp: 'ok' | 'unavailable' | 'skipped'
  readonly mcpDetail: string | null
}

export interface StatusOptions {
  mcp?: IxsMcpClient | null
  transport?: TransportFactory
}

export async function readRequestStatus(q: RequestStatusQuery, opts: StatusOptions = {}): Promise<RequestStatus> {
  let mcpState: RequestStatus['mcp'] = 'skipped'
  let mcpDetail: string | null = null
  if (opts.mcp !== null) {
    const client = opts.mcp ?? defaultMcp
    try {
      const r = await client.requestStatus(q.controller, q.vaultId)
      mcpState = 'ok'
      mcpDetail = `${r.requests.length} request(s) listed`
    } catch (err) {
      mcpState = 'unavailable'
      mcpDetail = err instanceof IxsError ? err.message : String(err)
    }
  }

  const client = publicClientFor(q.chain, opts.transport)
  const address = q.vaultAddress as Address
  const controller = q.controller as Address
  const [pending, claimable] = await Promise.all([
    client.readContract({
      address,
      abi: ERC7540_ABI,
      functionName: q.kind === 'deposit' ? 'pendingDepositRequest' : 'pendingRedeemRequest',
      args: [q.requestId, controller],
    }),
    client.readContract({
      address,
      abi: ERC7540_ABI,
      functionName: q.kind === 'deposit' ? 'claimableDepositRequest' : 'claimableRedeemRequest',
      args: [q.requestId, controller],
    }),
  ])

  return Object.freeze({ requestId: q.requestId.toString(), pending, claimable, source: 'onchain', mcp: mcpState, mcpDetail })
}
