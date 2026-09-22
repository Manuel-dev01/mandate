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
  'SNAPSHOT_DIR',
  'MANDATES_DIR',
  'TELEGRAM_BOT_TOKEN',
  'COMPILE_CACHE_DIR',
  'PORT',
  'CONSOLE_API_KEY',
  'X402_PRICE_USDC',
  'X402_PAY_TO',
  'X402_NETWORK',
  'X402_ASSET',
  'X402_FACILITATOR_URL',
  'X402_TRIGGER_URL',
  'X402_PAYWALL_URL',
  'X402_WORKFLOW_ID',
  'ERC8004_AGENT_ID',
  'ERC8004_TX_HASH',
  'ERC8004_CARD_URL',
  'ERC8004_SCAN_URL',
  'OPENSERV_API_KEY',
  'WALLET_PRIVATE_KEY',
  'BUYER_PRIVATE_KEY',
  'PUBLIC_API_URL',
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
  /** Last-good vault snapshots so a cold process can degrade with a staleness badge. */
  SNAPSHOT_DIR: z.string().min(1).optional(),
  /** Per-chat mandates for the Telegram agent. Gitignored. */
  MANDATES_DIR: z.string().min(1).optional(),
  /** Direct Telegram bot (from @BotFather). Read only by bin/bot.ts. Never logged. */
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, 'TELEGRAM_BOT_TOKEN must look like 123456789:AA…').optional(),
  /** Compiled rule sets, keyed by mandate text hash. On Railway, point it at the volume. */
  COMPILE_CACHE_DIR: z.string().min(1).optional(),
  /** The console API (bin/serve.ts). Railway injects PORT. */
  PORT: z.coerce.number().int().positive().default(8787),
  /** Optional shared secret the web console sends as x-console-key. The data is public either way. */
  CONSOLE_API_KEY: z.string().min(8).optional(),
  /** What one audit report costs. Decimal USDC; never parsed as a float. */
  X402_PRICE_USDC: z.string().regex(/^\d+(\.\d{1,6})?$/).default('0.50'),
  /** Where payment goes: the agent's identity wallet (also its ERC-8004 identity). */
  X402_PAY_TO: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'X402_PAY_TO must be an address')
    .default('0xEAbc8679638213F952B982dE4e03482B15C77B13'),
  /** Settlement network. Base Sepolia: the public facilitator supports it and its USDC is free (RECON §6.15). */
  X402_NETWORK: z.enum(['base-sepolia', 'base']).default('base-sepolia'),
  /** USDC on X402_NETWORK. Default is Base Sepolia USDC, from the x402 package's own config. */
  X402_ASSET: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
  /** Overrides the public x402.org facilitator. Rarely needed. */
  X402_FACILITATOR_URL: z.string().url().optional(),
  /** The OpenServ paid-service listing (written by `npm run provision`). Display only. */
  X402_TRIGGER_URL: z.string().url().optional(),
  X402_PAYWALL_URL: z.string().url().optional(),
  X402_WORKFLOW_ID: z.string().min(1).optional(),
  /** ERC-8004 identity (written by `npm run identity`). Display only. */
  ERC8004_AGENT_ID: z.string().min(1).optional(),
  ERC8004_TX_HASH: z.string().min(1).optional(),
  ERC8004_CARD_URL: z.string().url().optional(),
  ERC8004_SCAN_URL: z.string().url().optional(),
  /** Agent key from .openserv.json; when set, bin/serve.ts also runs the OpenServ agent. */
  OPENSERV_API_KEY: z.string().min(8).optional(),
  /** The OpenServ identity wallet — created by provision(), used by `npm run identity`. NOT the burner. */
  WALLET_PRIVATE_KEY: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/)
    .transform((k) => (k.startsWith('0x') ? k : `0x${k}`) as `0x${string}`)
    .optional(),
  /** A separate burner that BUYS a report in rehearsal. Paying yourself is not a sale. */
  BUYER_PRIVATE_KEY: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/)
    .transform((k) => (k.startsWith('0x') ? k : `0x${k}`) as `0x${string}`)
    .optional(),
  /** This API's public base URL, so an x402 `resource` is the URL actually paid for. */
  PUBLIC_API_URL: z.string().url().optional(),
})

const parsed = EnvSchema.parse(present())

export const env = Object.freeze({
  ...parsed,
  /** Defaults off the API base so overriding one host moves both. */
  IXS_MCP_URL: parsed.IXS_MCP_URL ?? `${parsed.IXS_API_BASE_URL}/mcp`,
  PORTFOLIO_DECLARED_PATH: parsed.PORTFOLIO_DECLARED_PATH ?? join(REPO_ROOT, 'packages', 'agent', 'portfolio.declared.json'),
  RECEIPTS_DIR: parsed.RECEIPTS_DIR ?? join(REPO_ROOT, 'data', 'receipts'),
  SNAPSHOT_DIR: parsed.SNAPSHOT_DIR ?? join(REPO_ROOT, '.snapshots'),
  /** Compiled rule sets, keyed by mandate text hash. */
  COMPILE_CACHE_DIR: parsed.COMPILE_CACHE_DIR ?? join(REPO_ROOT, 'packages', 'agent', '.cache'),
})

export type Env = typeof env
