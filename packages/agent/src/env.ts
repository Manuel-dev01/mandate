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
})

const parsed = EnvSchema.parse(present())

export const env = Object.freeze({
  ...parsed,
  /** Defaults off the API base so overriding one host moves both. */
  IXS_MCP_URL: parsed.IXS_MCP_URL ?? `${parsed.IXS_API_BASE_URL}/mcp`,
})

export type Env = typeof env
