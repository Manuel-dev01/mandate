/**
 * Telegram presentation. Handlers return plain text (the same text the OpenServ route relays
 * and the tests assert on); the direct bot renders it as Telegram HTML here, at the edge.
 *
 * Rules are structural, not semantic: nothing here can change a verdict, a number or a hash.
 */

import { formatBaseUnits } from '../ixs/schemas.js'

/** Where a receipt id points. Unset -> ids stay plain, rather than looking like dead links. */
const CONSOLE_URL = (process.env['CONSOLE_URL'] ?? 'https://mandate-console-five.vercel.app').replace(/\/+$/, '')

/** `5000.000000` -> `5,000`; `1234.500000` -> `1,234.5`; `0.005000` -> `0.005`. */
export function prettyAmount(baseUnits: bigint, decimals: number): string {
  const raw = formatBaseUnits(baseUnits, decimals)
  const negative = raw.startsWith('-')
  const [whole = '0', frac = ''] = (negative ? raw.slice(1) : raw).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const trimmed = frac.replace(/0+$/, '')
  return `${negative ? '-' : ''}${grouped}${trimmed ? `.${trimmed}` : ''}`
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const HEX_RE = /\b[0-9a-f]{12,64}\b/g
/** A receipt id, and only a receipt id: what follows these words opens on the console. */
const RECEIPT_ID_RE = /\b(Receipt|receipt|Previous)(\s+)([0-9a-f]{12,64})\b/g
const QUOTE_RE = /"([^"\n]{1,200})"/g
const LABEL_RE = /^(Why|Verify|Replay|Breached|Issued|Mandate|Decision|Receipt|Previous|Portfolio|Settlement|TVL|Vault id|Vault facts)(?=[ :])/
const CHECK_RE = /^([✓✗–] |\d+\. )([A-Z][A-Za-z ]+?)( — )/
const RECEIPT_RE = /^(🧾 )(Receipt)/
const VERDICT_RE = /\b(ALLOWED|REFUSED|ALLOW|REFUSE|VERIFIED|REPRODUCED|FAILED|STALE)\b/g

/**
 * Plain reply -> Telegram HTML (parse_mode=HTML). The first line is the headline and goes bold;
 * hashes/ids and rule types become monospace; quoted clauses italic; verdict words bold.
 */
export function toTelegramHtml(text: string): string {
  const lines = text.split('\n')
  return lines
    .map((line, i) => {
      let out = escapeHtml(line)
      // Quoted clauses first, while the line is still plain: QUOTE_RE would otherwise
      // italicise the href="…" of a link inserted below.
      out = out.replace(QUOTE_RE, (_m, q: string) => `"<i>${q}</i>"`)
      // A receipt id becomes a real link to its page on the console; every other hash stays
      // monospace, which Telegram makes tap-to-copy. Nothing is styled to look clickable
      // unless it actually is — and rule types are left plain, since they lead nowhere.
      const linked = new Set<string>()
      if (CONSOLE_URL) {
        out = out.replace(RECEIPT_ID_RE, (_m, word: string, gap: string, id: string) => {
          linked.add(id)
          return `${word}${gap}<a href="${CONSOLE_URL}/receipts/${id}">${id}</a>`
        })
      }
      out = out.replace(HEX_RE, (h) => (linked.has(h) ? h : `<code>${h}</code>`))
      if (i === 0) return `<b>${out}</b>`
      out = out.replace(LABEL_RE, (l) => `<b>${l}</b>`)
      out = out.replace(CHECK_RE, (_m, mark, label, sep) => `${mark}<b>${label}</b>${sep}`)
      out = out.replace(RECEIPT_RE, (_m, e, w) => `${e}<b>${w}</b>`)
      out = out.replace(VERDICT_RE, (v) => `<b>${v}</b>`)
      return out
    })
    .join('\n')
}

/** Split on line boundaries so no message ever cuts through a tag or a hash. */
export function chunkLines(text: string, max = 3500): string[] {
  const chunks: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    const next = current ? `${current}\n${line}` : line
    if (next.length > max && current) {
      chunks.push(current)
      current = line
    } else {
      current = next
    }
  }
  if (current || chunks.length === 0) chunks.push(current)
  return chunks
}
