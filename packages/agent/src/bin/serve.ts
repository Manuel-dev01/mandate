/**
 * The agent service: Telegram bot + read-only console API in one process.
 *
 *   npm run serve --workspace=agent
 *
 * Railway's start command. PORT is injected there; locally it is 8787. Without
 * TELEGRAM_BOT_TOKEN the API still serves (receipts, mandate, vaults) and says so.
 * Exactly one instance may run: two pollers make Telegram answer `Conflict`.
 */

import { createConsoleServer, defaultConsoleDeps } from '../console/api.js'
import { env } from '../env.js'
import { TelegramBot } from '../telegram/bot.js'

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`)

const token = env.TELEGRAM_BOT_TOKEN
const bot = token ? new TelegramBot({ token, log }) : null
if (!bot) log('TELEGRAM_BOT_TOKEN not set — serving the console API only')

const deps = { ...defaultConsoleDeps(), telegram: () => (bot ? bot.status : null) }
const server = createConsoleServer(deps, log)

server.listen(env.PORT, () => {
  log(`console api listening on :${env.PORT} · receipts ${env.RECEIPTS_DIR} · snapshots ${env.SNAPSHOT_DIR}${deps.apiKey ? ' · x-console-key required' : ''}`)
})

if (bot) {
  bot.start().catch((err) => {
    // A bad token is fatal; everything transient is retried inside start().
    log(`bot: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}

const shutdown = (signal: string) => {
  log(`${signal} — stopping`)
  bot?.stop()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
