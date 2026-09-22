import Link from 'next/link'
import { api, type HealthView } from '@/lib/api'
import { TELEGRAM_HANDLE, TELEGRAM_URL } from '@/lib/format'
import { Nav } from './nav'
import { TelegramIcon } from './telegram'

/** Sticky header. The right side is the agent's real state from /health — no invented feed timer. */
export async function Header() {
  const health = await api<HealthView>('/health', { timeoutMs: 8000 })
  const tg = health.ok ? health.data.telegram : null
  const state = !health.ok ? 'unreachable' : tg?.state === 'polling' ? 'polling' : tg?.state === 'connecting' ? 'connecting' : 'api only'
  const dot = !health.ok ? 'off' : state === 'polling' || state === 'api only' ? '' : 'amber'

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
        padding: '20px var(--gutter)',
        borderBottom: '1px solid var(--line)',
        position: 'sticky',
        top: 0,
        background: 'var(--bg)',
        zIndex: 20,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 40, flexWrap: 'wrap' }}>
        <Link href="/" style={{ fontSize: 13, letterSpacing: '.28em' }}>
          MANDATE
        </Link>
        <Nav />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: 11, color: 'var(--dim)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`pulse ${dot}`} />
          {health.ok ? `agent ${state}` : 'agent unreachable'}
        </span>
        {health.ok ? <span>{health.data.receipts} receipts</span> : null}
        <a href={TELEGRAM_URL} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink)' }} title="Talk to the treasurer">
          <TelegramIcon size={13} /> {TELEGRAM_HANDLE}
        </a>
      </div>
    </header>
  )
}
