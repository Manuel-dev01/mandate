/**
 * IXS REST client. Read-only by construction — the API has no write routes.
 *
 * REST /vaults is the AUTHORITATIVE vault universe: as of 13 Sep 2026 it
 * returns all five vaults while MCP vaults_list returns one.
 *
 * Verified routes:
 *   GET /vaults                                   paginated { items, page, ... }
 *   GET /vaults/{vaultId}                         404 { error: { code, message } } when unknown
 *   GET /vaults/{vaultId}/positions/{wallet}      shape not yet exercised
 */

import type { z } from 'zod'
import { env } from '../env.js'
import { IxsSchemaError, IxsToolError, IxsTransportError } from './errors.js'
import { PositionSchema, RestVaultPageSchema, VaultSchema, type Vault } from './schemas.js'

export interface IxsRestOptions {
  baseUrl?: string
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}

const DEFAULT_TIMEOUT_MS = 20_000
/** Defensive: totalItems is 5 today, but never spin on a runaway hasNextPage. */
const MAX_PAGES = 10

export class IxsRestClient {
  readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(opts: IxsRestOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? env.IXS_API_BASE_URL).replace(/\/$/, '')
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = opts.fetch ?? globalThis.fetch
  }

  private async get<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.output<S>> {
    const url = `${this.baseUrl}${path}`
    const label = `GET ${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let status: number
    let text: string
    try {
      const res = await this.fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
      status = res.status
      text = await res.text()
    } catch (err) {
      const reason = controller.signal.aborted
        ? `timed out after ${this.timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err)
      throw new IxsTransportError(`${label} ${reason}`, { tool: label })
    } finally {
      clearTimeout(timer)
    }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new IxsTransportError(`${label} HTTP ${status}: non-JSON body`, { status, tool: label })
    }

    if (status < 200 || status >= 300) {
      // { error: { code: 'VAULT_NOT_FOUND', message: 'Unknown vaultId', status: 404 } }
      const message = restErrorMessage(body)
      if (message) throw new IxsToolError(label, message)
      throw new IxsTransportError(`${label} HTTP ${status}`, { status, tool: label })
    }

    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new IxsSchemaError(`${label}: response failed schema validation`, {
        tool: label,
        detail: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; '),
      })
    }
    return parsed.data
  }

  /** All vaults, following pagination. */
  async listVaults(): Promise<Vault[]> {
    const vaults: Vault[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await this.get(page === 1 ? '/vaults' : `/vaults?page=${page}`, RestVaultPageSchema)
      vaults.push(...result.items)
      if (!result.hasNextPage || result.items.length === 0) break
    }
    return vaults
  }

  getVault(vaultId: string): Promise<Vault> {
    return this.get(`/vaults/${encodeURIComponent(vaultId)}`, VaultSchema)
  }

  getPosition(vaultId: string, walletAddress: string) {
    return this.get(
      `/vaults/${encodeURIComponent(vaultId)}/positions/${encodeURIComponent(walletAddress)}`,
      PositionSchema,
    )
  }
}

function restErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const error = (body as { error?: unknown }).error
  if (!error || typeof error !== 'object') return null
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

/** Default instance against the RECON-verified endpoint. */
export const rest = new IxsRestClient()
