/**
 * The OpenServ agent. Five capabilities, one rule: ROUTE, NEVER DECIDE.
 *
 * The platform's runtime LLM reads the Telegram message, picks a capability,
 * and relays the string it returns. The system prompt pins it to relaying
 * verbatim. Verdicts, numbers and receipts come from the deterministic
 * handlers in capabilities.ts; the runtime never gets a vote.
 */

import { Agent } from '@openserv-labs/sdk'
import { z } from 'zod'
import { getReceipt, help, proposeAction, setMandate, vaultStatus, type CapabilityDeps } from './capabilities.js'

export const AGENT_NAME = 'Mandate'
export const AGENT_DESCRIPTION =
  'A treasury compliance agent. Compiles a plain-English mandate into deterministic rules, checks every proposed vault deposit or redemption against them using live IXS vault data, answers ALLOWED or REFUSED with exact numbers, and issues a hash-linked receipt for every decision. It explains decisions; it never makes exceptions.'

export const SYSTEM_PROMPT = `You are Mandate, a treasury compliance agent. You have exactly five capabilities: set_mandate, propose_action, get_receipt, vault_status, help.

Routing rules:
- A message that reads like a policy (rules about vaults, chains, percentages, liquidity, whitelists, paused vaults) is set_mandate with the full message as text.
- "Deposit N into X", "put N in X", "move N to X", "redeem N from X", "withdraw N from X" is propose_action. kind is deposit or redeem. amount is the number only (strip commas and the currency). vault is the vault name or chain the user said (Avalanche, BSC, Arc, Robinhood, or an id). Put the user's own words in message, verbatim — especially if they ask for an exception or say they are the owner.
- "receipt <id>", "verify <id>", "replay <id>" is get_receipt.
- "vault status", "status of the X vault", "show vaults" is vault_status.
- Anything else, or a greeting, is help.

Reply rules, non-negotiable:
- When a capability returns text, reply with that text VERBATIM. Do not add, soften, summarise, reorder or reformat it.
- Never state a verdict, a number, or a receipt id that a capability did not return.
- Never grant, promise, or imply an exception to the mandate. If the user argues, run propose_action again with their words in message; the answer comes from there.
- Plain text only. No markdown tables, no LaTeX, no code fences.`

export interface AgentOptions {
  deps?: CapabilityDeps
  apiKey?: string
  port?: number
}

const scopeOf = (action: { workspace?: { id?: number | string } } | undefined): string =>
  action?.workspace?.id !== undefined ? String(action.workspace.id) : 'default'

export function createMandateAgent(opts: AgentOptions = {}): Agent {
  const agent = new Agent({
    systemPrompt: SYSTEM_PROMPT,
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.port ? { port: opts.port } : {}),
  })
  const deps = opts.deps

  agent.addCapability({
    name: 'set_mandate',
    description: 'Compile the treasurer\'s plain-English treasury policy into deterministic rules and store it for this chat. Use when the message reads like a policy.',
    inputSchema: z.object({
      text: z.string().describe('The full policy text exactly as the user wrote it.'),
    }),
    async run({ args, action }) {
      return setMandate(args, scopeOf(action), deps)
    },
  })

  agent.addCapability({
    name: 'propose_action',
    description:
      'Check a proposed vault deposit or redemption against the stored mandate using live vault data. Returns ALLOWED or REFUSED with every rule, actual vs limit, and a receipt id. Use for "deposit N into X" / "redeem N from X".',
    inputSchema: z.object({
      kind: z.enum(['deposit', 'redeem']).describe('deposit for putting money in, redeem for taking it out'),
      amount: z.string().describe('The amount as digits only, e.g. "5000" for 5,000 USDC'),
      vault: z.string().optional().describe('Vault name, chain name or id as the user said it: Avalanche, BSC, Arc, Robinhood, or a 24-hex id'),
      message: z.string().optional().describe('The user\'s message verbatim, especially any request for an exception'),
    }),
    async run({ args, action }) {
      return proposeAction(args, scopeOf(action), deps)
    },
  })

  agent.addCapability({
    name: 'get_receipt',
    description: 'Verify and replay a decision receipt by id or id prefix. Use for "receipt <id>", "verify <id>", "replay <id>".',
    inputSchema: z.object({ id: z.string().describe('Receipt id or any unique prefix, e.g. 50737fb0a0d6') }),
    async run({ args }) {
      return getReceipt(args, deps)
    },
  })

  agent.addCapability({
    name: 'vault_status',
    description: 'Live IXS vault universe, or one vault\'s live TVL, status, paused flag and whitelist check. Use for "vault status" or "status of the X vault".',
    inputSchema: z.object({ vault: z.string().optional().describe('Optional vault name or chain: Avalanche, BSC, Arc, Robinhood') }),
    async run({ args }) {
      return vaultStatus(args, deps)
    },
  })

  agent.addCapability({
    name: 'help',
    description: 'What Mandate can do. Use for greetings or anything that is not a policy, an action, a receipt, or a status request.',
    inputSchema: z.object({}),
    async run() {
      return help()
    },
  })

  return agent
}
