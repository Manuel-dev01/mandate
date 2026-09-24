import Link from 'next/link'
import { api, type ChainRowView, type ReceiptView, type StatsView, type X402View } from '@/lib/api'
import { MandateProse } from '@/components/checks'
import { History } from '@/components/history'
import { Card, Stat, Unreachable } from '@/components/panels'
import { PaperReceipt } from '@/components/paper-receipt'
import { TelegramBlock, TelegramIcon } from '@/components/telegram'
import { TELEGRAM_HANDLE, TELEGRAM_URL, utcTime } from '@/lib/format'
import { delay } from '@/lib/motion'

export const dynamic = 'force-dynamic'

export default async function Landing() {
  const [stats, refusals, all, x402] = await Promise.all([
    api<StatsView>('/stats'),
    api<{ rows: ChainRowView[] }>('/receipts?verdict=REFUSE&limit=1'),
    api<{ rows: ChainRowView[] }>('/receipts?limit=200'),
    api<X402View>('/x402', { timeoutMs: 15_000 }),
  ])

  const heroId = refusals.ok ? refusals.data.rows[0]?.id : undefined
  const argued = all.ok ? all.data.rows.find((r) => r.hasMessage) : undefined
  const [hero, quote] = await Promise.all([
    heroId ? api<ReceiptView>(`/receipts/${heroId}`) : Promise.resolve(null),
    argued ? api<ReceiptView>(`/receipts/${argued.id}`) : Promise.resolve(null),
  ])
  const heroReceipt = hero?.ok ? hero.data : null
  const quoteReceipt = quote?.ok ? quote.data : null
  const mandateSource = heroReceipt ?? (all.ok && all.data.rows[0] ? await api<ReceiptView>(`/receipts/${all.data.rows[0].id}`).then((r) => (r.ok ? r.data : null)) : null)

  return (
    <div>
      {/* hero */}
      <div className="desk">
      <div className="wrap" style={{ padding: '96px var(--gutter) 80px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))', gap: 64, alignItems: 'center', position: 'relative' }}>
        <div className="rise" style={{ minWidth: 0 }}>
          <h1 className="serif" style={{ fontSize: 'clamp(40px,5.6vw,72px)', lineHeight: 1.04, margin: '0 0 24px', letterSpacing: '-.02em', textWrap: 'pretty' }}>
            The interesting output is what it <em>refused</em> to do.
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--ink-3)', margin: '0 0 40px', maxWidth: '44ch' }}>
            An investment policy written in plain English, compiled into typed rules, checked against every move — and a receipt for every answer.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href={heroReceipt ? `/receipts/${heroReceipt.id}` : '/chain'} className="btn primary">
              Read a receipt
            </Link>
            <Link href="/chain" className="btn">
              See the chain
            </Link>
          </div>
        </div>

        <div className="rise" style={delay(0, 0, 150)}>{!stats.ok ? <Unreachable reason={stats.reason} checkedAt={stats.checkedAt} /> : <PaperReceipt r={heroReceipt ?? mandateSource} />}</div>
      </div>
      </div>

      {/* stats */}
      {stats.ok ? (
        <div className="wrap rise" style={{ paddingBottom: 96, ...delay(0, 0, 400) }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 40, borderTop: '1px solid var(--line)', paddingTop: 24 }}>
            <Stat label="Receipts" value={stats.data.receipts} />
            <Stat label="Refused" value={stats.data.refused} tone="red" />
            <Stat label="Reports sold" value={stats.data.sold ?? 0} />
          </div>
          {stats.data.history && stats.data.history.total > 0 ? (
            <div style={{ marginTop: 40 }}>
              <History history={stats.data.history} compact />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* where decisions come from */}
      <div className="section">
        <TelegramBlock receipts={stats.ok ? stats.data.receipts : 0} />
      </div>

      {/* how */}
      <div className="section">
        <div className="wrap" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 64 }}>
          <div>
            <div className="label" style={{ marginBottom: 16 }}>
              01 Compile
            </div>
            <p className="prose">English in, typed rules out — drawn from a fixed set of seven. Each rule keeps the clause that produced it.</p>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 16 }}>
              02 Check
            </div>
            <p className="prose">Deterministic code decides, against live vault data. The model never casts a verdict.</p>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 16 }}>
              03 Receipt
            </div>
            <p className="prose">Every decision is hashed to the one before it, and replayable by anyone.</p>
          </div>
        </div>
      </div>

      {/* the mandate */}
      {mandateSource ? (
        <div className="section">
          <div className="wrap" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 64, alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="label" style={{ marginBottom: 24 }}>
                The mandate
              </div>
              <MandateProse segments={mandateSource.mandate.segments} fired={new Set(heroReceipt?.cited ?? [])} />
            </div>
            <div style={{ minWidth: 0 }} className="scroll-x">
              <div className="label" style={{ marginBottom: 24 }}>
                Compiles to
              </div>
              <div style={{ minWidth: 300 }}>
                {mandateSource.mandate.rules.map((r) => {
                  const fired = heroReceipt?.cited.includes(r.code)
                  return (
                    <div key={r.code} style={{ display: 'grid', gridTemplateColumns: '80px minmax(190px,1fr)', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--row)' }}>
                      <span className={fired ? 'red-2' : 'dim'}>{r.code}</span>
                      <span className={fired ? 'red-2' : undefined}>
                        {r.label} — {r.threshold}
                        {r.inferred ? <span className="dim"> · inferred</span> : null}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div style={{ marginTop: 16 }}>
                <Link href="/mandate" className="label-sm" style={{ color: 'var(--mute)' }}>
                  Full mandate →
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* the argument */}
      {quoteReceipt?.userMessage ? (
        <div className="section">
          <div className="wrap" style={{ paddingTop: 96, paddingBottom: 96 }}>
            <p className="serif" style={{ fontSize: 'clamp(24px,3.4vw,40px)', lineHeight: 1.35, margin: '0 0 24px', maxWidth: '22ch', textWrap: 'pretty' }}>
              “{quoteReceipt.userMessage}”
            </p>
            <p className="prose muted" style={{ maxWidth: '52ch' }}>
              Sent with the proposal at {utcTime(quoteReceipt.createdAt)}. Stored on{' '}
              <Link href={`/receipts/${quoteReceipt.id}`} style={{ color: 'var(--ink)', borderBottom: '1px solid var(--line-4)' }}>
                receipt {quoteReceipt.short}
              </Link>{' '}
              as an input. Read by no rule. The verdict: <span className={`v-${quoteReceipt.verdict}`}>{quoteReceipt.verdict === 'REFUSE' ? 'REFUSED' : 'ALLOWED'}</span>
              {quoteReceipt.verdict === 'REFUSE' ? `, on ${quoteReceipt.cited.join(', ')}` : ''}.
            </p>
          </div>
        </div>
      ) : null}

      {/* cards */}
      {stats.ok ? (
        <div className="section">
          <div className="wrap" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 8 }}>
            <Card href="/chain" title="Receipt chain" meta={`${stats.data.receipts} links`} />
            {heroReceipt ? <Card href={`/receipts/${heroReceipt.id}`} title={`Receipt ${heroReceipt.short} in full`} meta="refused" /> : <Card href="/receipts" title="Latest receipt" meta="open" />}
            <Card href="/vaults" title="Vault universe" meta="live IXS" />
            {heroReceipt ? <Card href={`/export/${heroReceipt.id}`} title="Audit report" meta="export" /> : <Card href="/export" title="Audit report" meta="export" />}
          </div>
        </div>
      ) : null}

      <div className="section">
        <div className="wrap" style={{ paddingTop: 32, paddingBottom: 32, display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: 11, letterSpacing: '.08em', color: 'var(--ghost)', flexWrap: 'wrap', textTransform: 'uppercase' }}>
          <span>
            {x402.ok && x402.data.identity.registered ? (
              <a href={x402.data.identity.scanUrl ?? '#'} style={{ borderBottom: '1px solid var(--line-4)' }}>
                8004:{x402.data.identity.agentId}
              </a>
            ) : (
              'ERC-8004 · not registered'
            )}
            {x402.ok ? ` · x402 ${Number(x402.data.service.price).toFixed(2)} USDC/report` : ''}
          </span>
          <span>Nothing here signs or sends</span>
          <a href={TELEGRAM_URL} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--dim)' }}>
            <TelegramIcon size={12} /> {TELEGRAM_HANDLE}
          </a>
        </div>
      </div>
    </div>
  )
}
