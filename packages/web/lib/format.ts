/** Small display helpers. No money math here — amounts arrive formatted from the API. */

export function shortHash(h: string | null | undefined, head = 6, tail = 4): string {
  if (!h) return '—'
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`
}

export function utcTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toISOString().slice(11, 19)}Z`
}

export function utcDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z'
}

/** "41s", "14m", "3h" — the age of a snapshot relative to now. */
export function age(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 90) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

export const verdictWord = (v: 'ALLOW' | 'REFUSE'): 'ALLOWED' | 'REFUSED' => (v === 'ALLOW' ? 'ALLOWED' : 'REFUSED')

export const TELEGRAM_URL = process.env['NEXT_PUBLIC_TELEGRAM_URL'] ?? 'https://t.me/mandaeteBot'
export const TELEGRAM_HANDLE = TELEGRAM_URL.replace(/^https?:\/\/t\.me\//, '@')
