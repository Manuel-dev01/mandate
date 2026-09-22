import Link from 'next/link'
import { api, type ChainRowView, type StatsView } from '@/lib/api'
import { NoReceipts, PageHead, Unreachable } from '@/components/panels'
import { utcTime, verdictWord } from '@/lib/format'
import { delay } from '@/lib/motion'
import { Barcode } from '@/components/barcode'

export const dynamic = 'force-dynamic'

const COLS = '150px 96px minmax(200px,1fr) 130px 250px 84px'

export default async function ChainPage({ searchParams }: { searchParams: Promise<{ verdict?: string }> }) {
  const { verdict } = await searchParams
  const filter = verdict === 'REFUSE' || verdict === 'ALLOW' ? verdict : null
  const [stats, list, strip] = await Promise.all([
    api<StatsView>('/stats'),
    api<{ rows: ChainRowView[] }>(`/receipts?limit=200${filter ? `&verdict=${filter}` : ''}`),
    api<{ rows: ChainRowView[] }>('/receipts?limit=24'),
  ])

  if (!stats.ok || !list.ok) {
    const bad = !stats.ok ? stats : list
    return (
      <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
        <PageHead kicker="Receipt chain" title="Unreachable" />
        {!bad.ok ? <Unreachable reason={bad.reason} checkedAt={bad.checkedAt} /> : null}
      </div>
    )
  }

  const s = stats.data
  const rows = list.data.rows
  const recent = strip.ok ? [...strip.data.rows].reverse() : []

  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <PageHead
        kicker="Receipt chain"
        title={
          <>
            {s.receipts} receipt{s.receipts === 1 ? '' : 's'}, {s.breaks} break{s.breaks === 1 ? '' : 's'}
          </>
        }
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/chain" className={`btn sm${filter ? ' muted' : ' active'}`}>
              All
            </Link>
            <Link href="/chain?verdict=REFUSE" className={`btn sm${filter === 'REFUSE' ? ' active' : ' muted'}`}>
              Refused {s.refused}
            </Link>
            <Link href="/chain?verdict=ALLOW" className={`btn sm${filter === 'ALLOW' ? ' active' : ' muted'}`}>
              Allowed {s.allowed}
            </Link>
          </div>
        }
      />

      {s.receipts === 0 ? (
        <NoReceipts />
      ) : (
        <>
          {recent.length ? (
            <>
              <div style={{ display: 'flex', gap: 4, height: 32, alignItems: 'stretch', marginBottom: 12 }}>
                {recent.map((r, i) => (
                  <Link key={r.id} href={`/receipts/${r.id}`} className="bar-grow" title={`${r.short} ${verdictWord(r.verdict)}`} style={{ flex: 1, background: r.verdict === 'REFUSE' ? 'var(--red-line)' : 'var(--green)', ...delay(i, 30, 200) }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 11, letterSpacing: '.08em', color: 'var(--ghost)', marginBottom: 40 }}>
                <span>{recent[0]?.short}</span>
                <span>{recent[recent.length - 1]?.short}</span>
              </div>
            </>
          ) : null}

          <div className="scroll-x">
            <div style={{ minWidth: 820 }}>
              <div className="trow thead" style={{ gridTemplateColumns: COLS }}>
                <span>Receipt</span>
                <span>Verdict</span>
                <span>Action</span>
                <span className="tright">Amount</span>
                <span>Rules</span>
                <span className="tright">Time</span>
              </div>
              {rows.length === 0 ? (
                <div className="prose dim" style={{ padding: '24px 0' }}>
                  No {filter === 'REFUSE' ? 'refused' : 'allowed'} receipts yet.
                </div>
              ) : (
                rows.map((r, i) => {
                  const refused = r.verdict === 'REFUSE'
                  return (
                    <Link key={r.id} href={`/receipts/${r.id}`} className={`trow link printed${refused ? ' flag' : ''}`} style={{ gridTemplateColumns: COLS, ...delay(i, 30, 350) }}>
                      <span className="mini-code">
                        <Barcode hash={r.id} height={14} />
                        <span className="id">{r.short}</span>
                      </span>
                      <span className={`v-${r.verdict}`}>{verdictWord(r.verdict)}</span>
                      <span>
                        {r.kind} → {r.vaultName} <span className={r.mainnet ? 'mainnet' : 'dim'}>{r.network}</span>
                        {r.hasMessage ? <span className="dim"> · msg</span> : null}
                        {r.factsStale ? <span className="amber"> · stale</span> : null}
                      </span>
                      <span className="tright">{r.amount}</span>
                      <span className={refused ? 'red-2' : 'ghost'}>{r.cited.length ? r.cited.join(' ') : '—'}</span>
                      <span className="tright dim">{utcTime(r.createdAt)}</span>
                    </Link>
                  )
                })
              )}
            </div>
          </div>
          <div style={{ marginTop: 24, fontSize: 11, letterSpacing: '.08em', color: 'var(--ghost)', textTransform: 'uppercase' }}>
            Showing {rows.length} of {filter ? (filter === 'REFUSE' ? s.refused : s.allowed) : s.receipts} · portfolio declared on every receipt
          </div>
        </>
      )}
    </div>
  )
}
