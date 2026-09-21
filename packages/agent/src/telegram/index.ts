/**
 * Telegram surface — the OpenServ agent and its five handlers.
 * Route, never decide: verdicts come from mandate/, receipts from audit/.
 */
export * from './capabilities.js'
export * from './mandates.js'
export * from './parse.js'
export { TelegramBot, type BotOptions } from './bot.js'
export { AGENT_DESCRIPTION, AGENT_NAME, SYSTEM_PROMPT, createMandateAgent, type AgentOptions } from './agent.js'
