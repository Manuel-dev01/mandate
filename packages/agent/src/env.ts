/**
 * Mandate — environment.
 *
 * One loader, because both clients need `.env` and neither should read
 * `process.env` directly. Values default to the constants verified on
 * 13 Sep 2026 (docs/RECON.md), so a missing .env degrades to the live
 * endpoints rather than to undefined.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Repo root: packages/agent/src -> ../../.. */
export const REPO_ROOT = join(HERE, '..', '..', '..')

const ENV_PATH = join(REPO_ROOT, '.env')
if (existsSync(ENV_PATH)) loadDotenv({ path: ENV_PATH, quiet: true })

const KEYS = [
  'SERV_API_KEY',
  'SERV_BASE_URL',
  'SERV_MODEL_DEV',
  'SERV_MODEL_DEMO',
  'IXS_API_BASE_URL',
  'IXS_MCP_URL',
  'IXS_VAULT_ID',
  'IXS_WRITE_VAULT_ID',
  'AGENT_PRIVATE_KEY',
  'EXECUTION_MODE',
  'BLOCKED_WRITE_CHAIN_IDS',
  'MAX_ACTION_ASSET_AMOUNT',
  'PORTFOLIO_DECLARED_PATH',
  'FORK_RPC_URL',
  'FORK_CHAIN_ID',
  'RECEIPTS_DIR',
] as const

/**
 * `.env` files routinely carry declared-but-empty keys (`AGENT_PRIVATE_KEY=`).
 * Zod's `.default()` only fires on `undefined`, so empty strings are dropped
 * here — otherwise an empty line silently beats the verified default.
 */
function present(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of KEYS) {
    const value = process.env[key]
    if (value !== undefined && value !== '') out[key] = value
  }
  return out
}

const EnvSchema = z.object({
  // Not required at load time: the IXS client works without it. The SERV
  // client raises its own actionable error when it is actually needed.
  SERV_API_KEY: z.string().optional(),
  SERV_BASE_URL: z.string().url().default('https://inference-api.openserv.ai'),
  SERV_MODEL_DEV: z.string().min(1).default('gpt-5.4-mini'),
  SERV_MODEL_DEMO: z.string().min(1).default('claude-opus-5'),
  IXS_API_BASE_URL: z.string().url().default('https://api-dev-v2.ixs.finance'),
  IXS_MCP_URL: z.string().url().optional(),
  IXS_VAULT_ID: z.string().min(1).default('6a952683732c2b84b55ce89b'),
  /** The only vault that builds a deposit today (RECON §6.9): IXHYB-BSC, sync. */
  IXS_WRITE_VAULT_ID: z.string().min(1).default('6a278b40a7d16b245d665479'),
  /** Read ONLY by signer/index.ts. Never logged. */
  AGENT_PRIVATE_KEY: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'AGENT_PRIVATE_KEY must be a 32-byte hex key')
    .transform((k) => (k.startsWith('0x') ? k : `0x${k}`) as `0x${string}`)
    .optional(),
  /** dry-run simulates via eth_call and never broadcasts. The safe default. */
  EXECUTION_MODE: z.enum(['dry-run', 'live']).default('dry-run'),
  /** Chain ids the signer refuses before touching a transport. Keep 4663 here. */
  BLOCKED_WRITE_CHAIN_IDS: z
    .string()
    .default('4663,8453,1')
    .transform((s) => Object.freeze(s.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))),
  /** Hard ceiling on any single action, in asset units, regardless of mandate. */
  MAX_ACTION_ASSET_AMOUNT: z.string().regex(/^\d+(\.\d{1,6})?$/).default('10000'),
  PORTFOLIO_DECLARED_PATH: z.string().min(1).optional(),
  /**
   * Local Anvil fork (docs/RECON.md §6.10). When set, every read and write for
   * FORK_CHAIN_ID goes to this RPC instead of the vault's own, and the chain is
   * labelled "(fork)" in every receipt. Never set this in a demo you call live.
   */
  FORK_RPC_URL: z.string().url().optional(),
  FORK_CHAIN_ID: z.coerce.number().int().positive().default(97),
  /** Where receipts are written. Gitignored: they carry wallet addresses. */
  RECEIPTS_DIR: z.string().min(1).optional(),
})

const parsed = EnvSchema.parse(present())

export const env = Object.freeze({
  ...parsed,
  /** Defaults off the API base so overriding one host moves both. */
  IXS_MCP_URL: parsed.IXS_MCP_URL ?? `${parsed.IXS_API_BASE_URL}/mcp`,
  PORTFOLIO_DECLARED_PATH: parsed.PORTFOLIO_DECLARED_PATH ?? join(REPO_ROOT, 'packages', 'agent', 'portfolio.declared.json'),
  RECEIPTS_DIR: parsed.RECEIPTS_DIR ?? join(REPO_ROOT, 'data', 'receipts'),
})

export type Env = typeof env
