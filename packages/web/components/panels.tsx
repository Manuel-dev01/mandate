import Link from 'next/link'
import type { ReactNode } from 'react'
import { API_URL } from '@/lib/api'
import { TELEGRAM_HANDLE, TELEGRAM_URL, utcTime } from '@/lib/format'
import { delay } from '@/lib/motion'
import { TelegramIcon } from './telegram'

/** The console could not reach the agent. Never a raw error: say what, where, when. */
export function Unreachable({ reason, checkedAt }: { reason: string; checkedAt: string }) {
  const host = API_URL.replace(/^https?:\/\//, '')
  return (
    <div className="panel stale rise" style={{ maxWidth: 640 }}>
      <div className="label amber" style={{ marginBottom: 12 }}>
        Agent unreachable
      </div>
      <p className="prose">
        The console reads a live agent and could not reach it at <span style={{ color: 'var(--ink)' }}>{host}</span> — {reason}. Last check {utcTime(checkedAt)}.
        Nothing here is cached or invented, so there is nothing to show until it answers.
      </p>
    </div>
  )
}

/** No receipts yet. The only way to make one is to talk to the bot, so say so. */
export function NoReceipts({ title = 'No decisions yet' }: { title?: string }) {
  const lines = ['Never put more than 40% into a single vault. Keep 20% liquid at all times. Testnet only.', 'Deposit 5,000 USDC into the BSC vault.', 'Now deposit 50,000 into the same vault.']
  return (
    <div className="panel rise" style={{ maxWidth: 640 }}>
      <div className="label" style={{ marginBottom: 12 }}>
        {title}
      </div>
      <p className="prose" style={{ marginBottom: 20 }}>
        Every receipt on this console is a real decision made in Telegram — there is no other input. Open the bot, paste a mandate, then propose a deposit:
      </p>
      <div className="chat" style={{ marginBottom: 20 }}>
        {lines.map((t, i) => (
          <div key={t} className="bubble printed" style={delay(i, 120, 150)}>
            <span className="n">{i + 1}</span>
            <span className="serif" style={{ fontSize: 16, lineHeight: 1.45 }}>
              {t}
            </span>
          </div>
        ))}
      </div>
      <a href={TELEGRAM_URL} className="btn primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <TelegramIcon size={13} /> Open {TELEGRAM_HANDLE}
      </a>
    </div>
  )
}

export function PageHead({ kicker, title, right }: { kicker: ReactNode; title: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 24, flexWrap: 'wrap', marginBottom: 40 }}>
      <div>
        <div className="label" style={{ marginBottom: 16 }}>
          {kicker}
        </div>
        <h1 className="h1">{title}</h1>
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'red' | 'green' | 'amber' | undefined }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, color: tone ? `var(--${tone})` : undefined }}>{value}</div>
    </div>
  )
}

export function Tile({ label, value, tone }: { label: string; value: ReactNode; tone?: 'red' | 'green' | 'amber' | undefined }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, color: tone ? `var(--${tone})` : undefined }}>{value}</div>
    </div>
  )
}

export function Card({ href, title, meta }: { href: string; title: string; meta: string }) {
  return (
    <Link href={href} className="panel" style={{ display: 'block', transition: 'border-color .15s' }}>
      <div style={{ fontSize: 13, marginBottom: 12 }}>{title}</div>
      <div className="label-sm">{meta} →</div>
    </Link>
  )
}
