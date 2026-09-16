/**
 * IXS — public surface of the only module that talks to IXS.
 *
 * Two unified reads sit on top of the raw clients, each backed by a last-good
 * snapshot so a dev-host wobble degrades to a staleness badge instead of an
 * error screen.
 *
 * CACHE POLICY IS A SAFETY BOUNDARY, NOT AN OPTIMISATION.
 *   cached:   listVaults, getVaultState          (display + portfolio state)
 *   never:    checkWhitelist                     (stale `true` = false ALLOW)
 *   never:    every build_*                      (stale payload = wrong tx)
 * The uncached calls fail loud through the raw clients on purpose.
 */

import { IxsError } from './errors.js'
import { mcp, type IxsMcpClient } from './mcp.js'
import { rest, type IxsRestClient } from './rest.js'
import type { Vault, VaultState } from './schemas.js'

export * from './errors.js'
export * from './schemas.js'
export { IxsMcpClient, MCP_TOOLS, mcp, type McpToolName } from './mcp.js'
export { IxsRestClient, rest } from './rest.js'

/** A read that may be served from the last good copy. */
export interface Snapshot<T> {
  readonly data: T
  /** True when `data` came from cache because the live fetch failed. */
  readonly stale: boolean
  /** ISO-8601 time `data` was actually fetched from IXS. */
  readonly fetchedAt: string
  /** The live-fetch failure that forced a stale serve, else null. */
  readonly error: string | null
}

export interface VaultUniverse {
  readonly vaults: readonly Vault[]
  /** How many vaults each source reported. REST is authoritative. */
  readonly sources: { readonly rest: number; readonly mcp: number }
  /** REST vault ids the MCP feed did not return — the canary for finding 1. */
  readonly divergence: readonly string[]
  /** MCP failure, if any. Non-fatal: REST alone is a complete answer. */
  readonly mcpError: string | null
}

interface Deps {
  mcp: IxsMcpClient
  rest: IxsRestClient
}

class LastGood<T> {
  private readonly entries = new Map<string, { data: T; fetchedAt: string }>()

  async serve(key: string, fetchLive: () => Promise<T>): Promise<Snapshot<T>> {
    try {
      const data = await fetchLive()
      const fetchedAt = new Date().toISOString()
      this.entries.set(key, { data, fetchedAt })
      return { data, stale: false, fetchedAt, error: null }
    } catch (err) {
      const cached = this.entries.get(key)
      if (!cached) throw err
      const message = err instanceof Error ? err.message : String(err)
      return { data: cached.data, stale: true, fetchedAt: cached.fetchedAt, error: message }
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

const universeCache = new LastGood<VaultUniverse>()
const stateCache = new LastGood<VaultState>()

/**
 * The vault universe. REST is the source of truth; MCP vaults_list is merged
 * in and its gap reported, so we notice the day IXS fixes the MCP feed.
 *
 * If REST fails but MCP answers, the (partial) MCP set is served fresh with
 * `sources.rest === 0` rather than a stale full set — a partial truth beats a
 * stale one for a list, and the caller can see which it got.
 */
export function listVaults(deps: Deps = { mcp, rest }): Promise<Snapshot<VaultUniverse>> {
  return universeCache.serve('universe', async () => {
    const [restResult, mcpResult] = await Promise.allSettled([deps.rest.listVaults(), deps.mcp.vaultsList()])

    if (restResult.status === 'rejected' && mcpResult.status === 'rejected') {
      throw restResult.reason instanceof IxsError ? restResult.reason : mcpResult.reason
    }

    const restVaults = restResult.status === 'fulfilled' ? restResult.value : []
    const mcpVaults = mcpResult.status === 'fulfilled' ? mcpResult.value.vaults : []
    const mcpError = mcpResult.status === 'rejected' ? messageOf(mcpResult.reason) : null

    const byId = new Map<string, Vault>()
    for (const v of restVaults) byId.set(v.id, v)
    for (const v of mcpVaults) if (!byId.has(v.id)) byId.set(v.id, v)

    const mcpIds = new Set(mcpVaults.map((v) => v.id))
    const divergence = restVaults.map((v) => v.id).filter((id) => !mcpIds.has(id))

    return Object.freeze({
      vaults: Object.freeze([...byId.values()]),
      sources: Object.freeze({ rest: restVaults.length, mcp: mcpVaults.length }),
      divergence: Object.freeze(divergence),
      mcpError,
    })
  })
}

/** Settlement kind, metadata and live pricing for one vault, via MCP vault_get. */
export function getVaultState(vaultId: string, deps: Deps = { mcp, rest }): Promise<Snapshot<VaultState>> {
  return stateCache.serve(`state:${vaultId}`, () => deps.mcp.vaultGet(vaultId))
}

/** Test hook. */
export function clearIxsCaches(): void {
  universeCache.clear()
  stateCache.clear()
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
