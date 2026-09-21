/**
 * Run the direct Telegram bot.
 *
 *   npm run bot --workspace=agent
 *
 * Needs TELEGRAM_BOT_TOKEN in .env (from @BotFather). Long-polls; Ctrl-C stops.
 */

import { env } from '../env.js'
import { TelegramBot } from '../telegram/bot.js'

const token = env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather and put its token in .env.')
  process.exit(1)
}

const bot = new TelegramBot({ token })
process.on('SIGINT', () => {
  bot.stop()
  process.exit(0)
})
bot.start().catch((err) => {
  console.error(`bot: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
