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

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '../env.js'
import { IxsError } from './errors.js'
import { mcp, type IxsMcpClient } from './mcp.js'
import { rest, type IxsRestClient } from './rest.js'
import { parseWithBigint, stringifyWithBigint, type Vault, type VaultState } from './schemas.js'

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
  /** Where `data` came from. `disk` is what a cold process degrades to. */
  readonly source: 'live' | 'memory' | 'disk'
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

interface Cached<T> {
  readonly data: T
  readonly fetchedAt: string
}

/**
 * Last-good cache with two tiers: memory, then disk. The disk tier is what
 * a COLD process degrades to — before it exists, an IXS outage on first launch
 * is an error screen, which the demo must never show.
 *
 * Writes are best-effort and never throw; a corrupt or missing file is simply
 * not a fallback. Snapshots hold bigints, hence the custom JSON.
 */
export class LastGood<T> {
  private readonly entries = new Map<string, Cached<T>>()
  private readonly dir: string | null

  constructor(
    private readonly name: string,
    opts: { dir?: string | null } = {},
  ) {
    this.dir = opts.dir === undefined ? env.SNAPSHOT_DIR : opts.dir
  }

  async serve(key: string, fetchLive: () => Promise<T>): Promise<Snapshot<T>> {
    try {
      const data = await fetchLive()
      const fetchedAt = new Date().toISOString()
      this.entries.set(key, { data, fetchedAt })
      this.persist(key, { data, fetchedAt })
      return { data, stale: false, fetchedAt, error: null, source: 'live' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const memory = this.entries.get(key)
      if (memory) return { data: memory.data, stale: true, fetchedAt: memory.fetchedAt, error: message, source: 'memory' }
      const disk = this.restore(key)
      if (disk) {
        this.entries.set(key, disk)
        return { data: disk.data, stale: true, fetchedAt: disk.fetchedAt, error: message, source: 'disk' }
      }
      throw err
    }
  }

  private file(key: string): string | null {
    return this.dir ? join(this.dir, `${this.name}.${key.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`) : null
  }

  private persist(key: string, entry: Cached<T>): void {
    const path = this.file(key)
    if (!path) return
    try {
      mkdirSync(this.dir!, { recursive: true })
      writeFileSync(path, stringifyWithBigint(entry, 2))
    } catch {
      // A snapshot that fails to write is a missing fallback, not a failure now.
    }
  }

  private restore(key: string): Cached<T> | null {
    const path = this.file(key)
    if (!path || !existsSync(path)) return null
    try {
      const parsed = parseWithBigint<Partial<Cached<T>>>(readFileSync(path, 'utf8'))
      if (!parsed || typeof parsed.fetchedAt !== 'string' || parsed.data === undefined) return null
      return { data: parsed.data, fetchedAt: parsed.fetchedAt }
    } catch {
      return null
    }
  }

  /** Test hook: forgets memory and removes the files for every key this instance has seen. */
  clear(): void {
    const keys = [...this.entries.keys()]
    this.entries.clear()
    for (const key of keys) {
      const path = this.file(key)
      if (path && existsSync(path)) rmSync(path, { force: true })
    }
  }
}

const universeCache = new LastGood<VaultUniverse>('universe')
const stateCache = new LastGood<VaultState>('state')

/**
 * The vault universe. REST is the source of truth; MCP vaults_list is merged
 * in and its gap reported, so we notice the day IXS fixes the MCP feed.
 *
 * If REST fails, the read fails and LastGood serves the previous good universe
 * with the STALE badge. MCP alone is never served as a universe: it returns 1 of 5,
 * and on 21 Sep a REST wobble merged into a one-vault universe that overwrote the
 * five-vault snapshot and made "the BSC vault" unresolvable on stage.
 */
export function listVaults(deps: Deps = { mcp, rest }): Promise<Snapshot<VaultUniverse>> {
  return universeCache.serve('universe', () => fetchUniverse(deps))
}

/** One live read of the universe. Throws when REST fails — never a partial answer. */
export async function fetchUniverse(deps: Deps = { mcp, rest }): Promise<VaultUniverse> {
  const [restResult, mcpResult] = await Promise.allSettled([deps.rest.listVaults(), deps.mcp.vaultsList()])

  // REST is the source of truth; MCP vaults_list is known to return 1 of 5 (RECON §6.1).
  // A REST failure is therefore a failed read, never a one-vault universe: throw, and let
  // LastGood serve the previous good universe with the STALE badge. (Seen live 21 Sep: a
  // REST wobble merged into a 1-vault answer and overwrote the 5-vault snapshot.)
  if (restResult.status === 'rejected') throw restResult.reason
  if (restResult.value.length === 0) throw new IxsError('schema', 'IXS REST /vaults returned no vaults')

  const restVaults = restResult.value
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
