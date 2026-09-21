/**
 * IXS MCP client — the only code that speaks to the IXS MCP endpoint.
 *
 * THIS MODULE NEVER BROADCASTS. All eight tools are `readOnlyHint: true`: they
 * return UNSIGNED transaction payloads. The agent plans, a signer approves.
 * If you find yourself importing a wallet or an RPC sender here, stop.
 *
 * Wire facts, verified live 13 Sep 2026 (docs/RECON.md):
 *   - Transport is SSE: "event: message\ndata: {...}". Strip the `data: ` prefix.
 *   - tools/call results are DOUBLE-ENCODED: result.content[0].text is a JSON
 *     string needing a second JSON.parse. tools/list is not.
 *   - EXCEPT on failure: result.isError === true and content[0].text is PLAIN
 *     TEXT ("Unknown vaultId"). HTTP is 200 either way. Parsing that as JSON
 *     throws SyntaxError — which is why triage runs before the second decode.
 *   - Amounts are integer strings in BASE UNITS. '5000' means 0.005 USDC.
 */

import type { z } from 'zod'
import { env } from '../env.js'
import { IxsRpcError, IxsSchemaError, IxsToolError, IxsTransportError } from './errors.js'
import {
  BuildResultSchema,
  RequestStatusSchema,
  VaultGetSchema,
  VaultsListSchema,
  WhitelistSchema,
  toBaseUnitString,
} from './schemas.js'

export const MCP_TOOLS = [
  'vaults_list',
  'vault_get',
  'vault_check_whitelist',
  'vault_request_status',
  'vault_build_request_deposit',
  'vault_build_request_redeem',
  'vault_build_claim_deposit',
  'vault_build_claim_redeem',
] as const

export type McpToolName = (typeof MCP_TOOLS)[number]

/** Safe to retry once on a transport failure. Builds are not on this list. */
const READ_TOOLS: ReadonlySet<McpToolName> = new Set(['vaults_list', 'vault_get', 'vault_check_whitelist', 'vault_request_status'])

export interface IxsMcpOptions {
  url?: string
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}

interface JsonRpcEnvelope {
  jsonrpc?: string
  id?: number | string
  result?: unknown
  error?: { code?: number; message?: string }
}

interface ToolCallResult {
  isError?: boolean
  content?: Array<{ type?: string; text?: string }>
}

const DEFAULT_TIMEOUT_MS = 30_000

export class IxsMcpClient {
  readonly url: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof globalThis.fetch
  private nextId = 0

  constructor(opts: IxsMcpOptions = {}) {
    this.url = opts.url ?? env.IXS_MCP_URL
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = opts.fetch ?? globalThis.fetch
  }

  // ------------------------------------------------------------- transport

  /** Raw JSON-RPC round trip. Returns the envelope's `result`. */
  private async rpc(method: string, params: Record<string, unknown>, tool: string | null): Promise<unknown> {
    const id = ++this.nextId
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let text: string
    let status: number
    try {
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      })
      status = res.status
      text = await res.text()
    } catch (err) {
      const reason = controller.signal.aborted ? `timed out after ${this.timeoutMs}ms` : errorMessage(err)
      throw new IxsTransportError(`IXS MCP ${method} ${reason}`, { tool })
    } finally {
      clearTimeout(timer)
    }

    if (status < 200 || status >= 300) {
      throw new IxsTransportError(`IXS MCP ${method} HTTP ${status}: ${text.slice(0, 200)}`, { status, tool })
    }

    const envelope = decodeSse(text, tool)
    if (envelope.error) {
      throw new IxsRpcError(envelope.error.code ?? -1, envelope.error.message ?? 'unknown', tool)
    }
    return envelope.result
  }

  /** tools/list is NOT double-encoded. */
  async listTools(): Promise<string[]> {
    const result = (await this.rpc('tools/list', {}, null)) as { tools?: Array<{ name?: string }> }
    return (result.tools ?? []).map((t) => t.name).filter((n): n is string => typeof n === 'string')
  }

  /**
   * tools/call with the three-way triage:
   *   1. envelope error      -> IxsRpcError
   *   2. result.isError      -> IxsToolError (plain text, NOT parsed)
   *   3. otherwise           -> second JSON.parse, then Zod
   */
  async call<S extends z.ZodTypeAny>(name: McpToolName, args: Record<string, unknown>, schema: S): Promise<z.output<S>> {
    // The dev host wobbles: a read that times out once usually answers on the
    // next try (seen 3x on vault_check_whitelist, 16–18 Sep). One retry, reads
    // only — a build payload is never retried blindly.
    let result: ToolCallResult | undefined
    try {
      result = (await this.rpc('tools/call', { name, arguments: args }, name)) as ToolCallResult | undefined
    } catch (err) {
      if (!(err instanceof IxsTransportError) || !READ_TOOLS.has(name)) throw err
      result = (await this.rpc('tools/call', { name, arguments: args }, name)) as ToolCallResult | undefined
    }
    const text = result?.content?.[0]?.text

    if (result?.isError) {
      throw new IxsToolError(name, (text ?? 'tool returned isError with no message').trim())
    }
    if (typeof text !== 'string') {
      throw new IxsSchemaError(`${name}: result.content[0].text missing`, {
        tool: name,
        detail: JSON.stringify(result).slice(0, 300),
      })
    }

    let inner: unknown
    try {
      inner = JSON.parse(text)
    } catch {
      throw new IxsSchemaError(`${name}: tool result was not JSON`, { tool: name, detail: text.slice(0, 300) })
    }

    const parsed = schema.safeParse(inner)
    if (!parsed.success) {
      throw new IxsSchemaError(`${name}: response failed schema validation`, {
        tool: name,
        detail: parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; '),
      })
    }
    return parsed.data
  }

  // ---------------------------------------------------------------- reads

  /**
   * NOTE: as of 13 Sep 2026 this returns ONE vault (the whitelist-gated BSC
   * one) while REST /vaults returns five. Do not treat it as the universe;
   * `listVaults()` in ./index.ts merges it with REST and reports the gap.
   */
  vaultsList() {
    return this.call('vaults_list', {}, VaultsListSchema)
  }

  vaultGet(vaultId: string) {
    return this.call('vault_get', { vaultId }, VaultGetSchema)
  }

  /** Never cache this. A stale `whitelisted: true` is a false ALLOW. */
  checkWhitelist(vaultId: string, walletAddress: string) {
    return this.call('vault_check_whitelist', { vaultId, walletAddress }, WhitelistSchema)
  }

  /**
   * BROKEN UPSTREAM as of 13 Sep 2026: every call returns a subgraph error
   * ("Type `DepositRequest` has no field `owner`"). Wrapped so the failure is
   * a typed IxsToolError(reason: 'subgraph_unavailable'), not a surprise.
   */
  requestStatus(ownerAddress: string, vaultId?: string) {
    const args: Record<string, unknown> = { ownerAddress }
    if (vaultId !== undefined) args['vaultId'] = vaultId
    return this.call('vault_request_status', args, RequestStatusSchema)
  }

  // --------------------------------------------------------------- builds
  // Every builder returns UNSIGNED steps. Amounts are bigint base units so a
  // caller cannot accidentally send '0.1' — IXS rejects it, but a typo like
  // '5000' for 5,000 USDC would silently build a 0.005 USDC deposit.

  buildRequestDeposit(input: { vaultId: string; ownerAddress: string; assetBaseUnits: bigint }) {
    return this.call(
      'vault_build_request_deposit',
      {
        vaultId: input.vaultId,
        ownerAddress: input.ownerAddress,
        assetAmount: toBaseUnitString(input.assetBaseUnits),
      },
      BuildResultSchema,
    )
  }

  buildRequestRedeem(input: { vaultId: string; ownerAddress: string; shareBaseUnits: bigint }) {
    return this.call(
      'vault_build_request_redeem',
      {
        vaultId: input.vaultId,
        ownerAddress: input.ownerAddress,
        shareAmount: toBaseUnitString(input.shareBaseUnits),
      },
      BuildResultSchema,
    )
  }

  buildClaimDeposit(input: { vaultId: string; ownerAddress: string; requestId: string }) {
    return this.call('vault_build_claim_deposit', { ...input }, BuildResultSchema)
  }

  buildClaimRedeem(input: { vaultId: string; ownerAddress: string; requestId: string }) {
    return this.call('vault_build_claim_redeem', { ...input }, BuildResultSchema)
  }
}

/**
 * SSE frame -> JSON-RPC envelope. Scans every `data: ` line rather than
 * assuming line two, and falls back to plain JSON in case the server ever
 * stops negotiating event-stream.
 */
function decodeSse(text: string, tool: string | null): JsonRpcEnvelope {
  const candidates = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
  if (candidates.length === 0) candidates.push(text)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed)) {
        return parsed as JsonRpcEnvelope
      }
    } catch {
      // try the next frame
    }
  }
  throw new IxsTransportError(`IXS MCP returned an undecodable frame: ${text.slice(0, 200)}`, { tool })
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Default instance against the RECON-verified endpoint. */
export const mcp = new IxsMcpClient()
