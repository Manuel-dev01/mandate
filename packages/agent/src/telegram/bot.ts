/**
 * Direct Telegram bot — long-polling the Bot API with fetch, no dependencies.
 *
 * Why this exists: OpenServ's Telegram integration form was failing on their
 * side on 21 Sep with six days left. This path has no third party between the
 * treasurer's message and our handlers except Telegram itself. SERV still
 * compiles and explains; verdicts and receipts are unchanged.
 *
 * Scope = the Telegram chat id, so each chat keeps its own mandate.
 */

import { defaultDeps, getReceipt, help, nudge, proposeAction, setMandate, vaultStatus, type CapabilityDeps } from './capabilities.js'
import { parseIntent } from './parse.js'
import { chunkLines, toTelegramHtml } from './format.js'

export interface BotOptions {
  token: string
  deps?: CapabilityDeps
  /** Long-poll timeout in seconds. */
  pollSeconds?: number
  log?: (line: string) => void
}

interface Update {
  update_id: number
  message?: { message_id: number; chat: { id: number; type: string }; text?: string; from?: { id: number; username?: string } }
}

type LastAction = { action: 'deposit' | 'redeem'; amount: string; vault: string | undefined }

export class TelegramBot {
  private readonly api: string
  private readonly deps: CapabilityDeps
  private readonly log: (line: string) => void
  private readonly pollSeconds: number
  private readonly lastAction = new Map<string, LastAction>()
  private offset = 0
  /** For /health: what the poller is doing right now. */
  status: { state: 'idle' | 'connecting' | 'polling' | 'stopped'; username: string | null; lastPollAt: string | null; lastError: string | null } = {
    state: 'idle',
    username: null,
    lastPollAt: null,
    lastError: null,
  }
  private running = false
  /** Aborts the in-flight long poll so stop() returns at once instead of up to pollSeconds later. */
  private inflight: AbortController | null = null

  constructor(private readonly opts: BotOptions) {
    this.api = `https://api.telegram.org/bot${opts.token}`
    this.deps = opts.deps ?? defaultDeps()
    this.log = opts.log ?? ((l) => console.log(l))
    this.pollSeconds = opts.pollSeconds ?? 25
  }

  async me(): Promise<{ id: number; username?: string }> {
    return (await this.call('getMe', {})) as { id: number; username?: string }
  }

  private async call(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const res = await fetch(`${this.api}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
    const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string }
    if (!json.ok) throw new Error(`telegram ${method}: ${json.description ?? res.status}`)
    return json.result
  }

  async send(chatId: number, text: string): Promise<void> {
    // Telegram caps a message at 4096 chars; our replies are far shorter, but never truncate silently.
    for (const chunk of chunkLines(text)) {
      try {
        await this.call('sendMessage', { chat_id: chatId, text: toTelegramHtml(chunk), parse_mode: 'HTML', disable_web_page_preview: true })
      } catch (err) {
        // Presentation must never lose a verdict: if Telegram rejects the markup, send the plain text.
        this.log(`html send failed (${err instanceof Error ? err.message : String(err)}) — sending plain`)
        await this.call('sendMessage', { chat_id: chatId, text: chunk, disable_web_page_preview: true })
      }
    }
  }

  private async typing(chatId: number): Promise<void> {
    try {
      await this.call('sendChatAction', { chat_id: chatId, action: 'typing' })
    } catch {
      // cosmetic
    }
  }

  /** One message -> one reply. Exposed for tests; no Telegram call inside except via `send`. */
  async reply(chatId: number, text: string): Promise<string> {
    const scope = String(chatId)
    const intent = parseIntent(text, this.lastAction.has(scope))
    switch (intent.kind) {
      case 'help':
        return help()
      case 'set_mandate':
        return setMandate({ text: intent.text }, scope, this.deps)
      case 'propose_action': {
        this.lastAction.set(scope, { action: intent.action, amount: intent.amount, vault: intent.vault })
        return proposeAction({ kind: intent.action, amount: intent.amount, vault: intent.vault, message: intent.message }, scope, this.deps)
      }
      case 'argue': {
        const last = this.lastAction.get(scope)!
        return proposeAction({ kind: last.action, amount: last.amount, vault: last.vault, message: intent.message }, scope, this.deps)
      }
      case 'get_receipt':
        return getReceipt({ id: intent.id }, this.deps)
      case 'vault_status':
        return vaultStatus({ vault: intent.vault }, this.deps)
      case 'unknown':
        return nudge()
    }
  }

  async start(): Promise<void> {
    this.running = true
    this.status = { ...this.status, state: 'connecting' }
    // A network blip at startup is not a reason to exit; a bad token is (Telegram answers 401, not a fetch error).
    let me: { id: number; username?: string } | null = null
    for (let attempt = 1; me === null; attempt++) {
      try {
        me = await this.me()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/unauthorized|not found/i.test(msg)) throw err
        const wait = Math.min(3000 * attempt, 15_000)
        this.log(`getMe failed (${msg}) — Telegram unreachable, retrying in ${wait / 1000}s (attempt ${attempt})`)
        await new Promise((r) => setTimeout(r, wait))
      }
    }
    this.status = { ...this.status, state: 'polling', username: me.username ?? String(me.id) }
    this.log(`bot @${me.username ?? me.id} polling · wallet ${this.deps.wallet}`)
    while (this.running) {
      let updates: Update[] = []
      try {
        this.inflight = new AbortController()
        updates = (await this.call('getUpdates', { offset: this.offset, timeout: this.pollSeconds, allowed_updates: ['message'] }, this.inflight.signal)) as Update[]
        this.status = { ...this.status, lastPollAt: new Date().toISOString(), lastError: null }
      } catch (err) {
        if (!this.running) break // we aborted it on purpose
        this.status = { ...this.status, lastError: err instanceof Error ? err.message : String(err) }
        this.log(`poll error: ${err instanceof Error ? err.message : String(err)} — retrying in 3s`)
        await new Promise((r) => setTimeout(r, 3000))
        continue
      }
      for (const u of updates) {
        this.offset = u.update_id + 1
        const m = u.message
        // A sticker or photo used to get silence, which reads as a dead bot.
        if (m && !m.text) {
          void this.send(m.chat.id, nudge()).catch(() => undefined)
          continue
        }
        if (!m?.text) continue
        const chatId = m.chat.id
        this.log(`[${chatId}] ${m.from?.username ?? m.from?.id ?? '?'}: ${m.text.slice(0, 80)}`)
        void this.typing(chatId)
        try {
          const out = await this.reply(chatId, m.text)
          await this.send(chatId, out)
          this.log(`[${chatId}] -> ${out.split('\n')[0]?.slice(0, 80)}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.log(`[${chatId}] handler error: ${msg}`)
          // The detail goes to our logs, not to the chat: an internal message can carry a
          // URL or a path, and the user can do nothing with it either way.
          await this.send(chatId, 'Something failed on my side. Nothing was decided or recorded — please try that again.').catch(() => undefined)
        }
      }
    }
  }

  stop(): void {
    this.running = false
    this.inflight?.abort()
    this.status = { ...this.status, state: 'stopped' }
  }
}
