/**
 * The agent service: Telegram bot + read-only console API in one process.
 *
 *   npm run serve --workspace=agent
 *
 * Railway's start command. PORT is injected there; locally it is 8787. Without
 * TELEGRAM_BOT_TOKEN the API still serves (receipts, mandate, vaults) and says so.
 * Exactly one instance may run: two pollers make Telegram answer `Conflict`.
 */

import { run } from '@openserv-labs/sdk'
import { createConsoleServer, defaultConsoleDeps } from '../console/api.js'
import { env } from '../env.js'
import { createMandateAgent } from '../telegram/agent.js'
import { TelegramBot } from '../telegram/bot.js'

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`)

const token = env.TELEGRAM_BOT_TOKEN
const bot = token ? new TelegramBot({ token, log }) : null
if (!bot) log('TELEGRAM_BOT_TOKEN not set — serving the console API only')

/** The OpenServ agent serves the paid workflow from this same process, so it reads the same receipts. */
const openserv: { state: 'disabled' | 'connecting' | 'connected' | 'failed'; note: string | null } = { state: 'disabled', note: null }
let stopOpenserv: (() => Promise<void> | void) | null = null

const deps = {
  ...defaultConsoleDeps(),
  telegram: () => (bot ? bot.status : null),
  openserv: () => ({ ...openserv }),
}
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

if (env.OPENSERV_API_KEY) {
  openserv.state = 'connecting'
  process.env['OPENSERV_API_KEY'] = env.OPENSERV_API_KEY
  void run(createMandateAgent())
    .then(({ stop }) => {
      stopOpenserv = stop
      openserv.state = 'connected'
      log('openserv: agent connected (paid audit-report workflow can reach it)')
    })
    .catch((err) => {
      // The listing is a bonus; our own x402 paywall is what the demo pays.
      openserv.state = 'failed'
      openserv.note = err instanceof Error ? err.message : String(err)
      log(`openserv: agent not connected (${openserv.note}) — the x402 paywall on this API is unaffected`)
    })
} else {
  log('openserv: OPENSERV_API_KEY not set — the paid workflow listing will not be served from here')
}

const shutdown = (signal: string) => {
  log(`${signal} — stopping`)
  bot?.stop()
  void stopOpenserv?.()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
