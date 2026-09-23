import type { HistoryView } from '@/lib/api'
import { delay } from '@/lib/motion'

/**
 * The decision chain over time — allowed below, refused above, one bar per hour
 * or per day. Our own data, so it is always current; the vault subgraphs stopped
 * updating weeks ago (RECON §6.17), which is why this charts decisions instead.
 */
export function History({ history, compact = false }: { history: HistoryView; compact?: boolean }) {
  const { buckets, grain, byRule, total, refused, allowed } = history
  if (total === 0) {
    return (
      <p className="prose muted">
        No decisions yet — this chart fills in as the agent answers. Every bar is a real verdict, never a projection.
      </p>
    )
  }

  const peak = Math.max(1, ...buckets.map((b) => b.allowed + b.refused))
  const label = (iso: string) => {
    const d = new Date(iso)
    return grain === 'hour' ? `${String(d.getUTCHours()).padStart(2, '0')}:00` : `${d.getUTCDate()}/${d.getUTCMonth() + 1}`
  }
  const height = compact ? 56 : 96
  const MIN_BAR = compact ? 8 : 14
  // With two or three buckets, flex:1 makes each bar half the page — it reads as a
  // colour block, not a chart. Cap the width and let the row start from the left.
  const MAX_BAR = buckets.length <= 6 ? 44 : undefined

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start', gap: buckets.length > 40 ? 1 : 3, height, marginBottom: 8 }}>
        {buckets.map((b, i) => {
          const n = b.allowed + b.refused
          // A day with one decision must still be visible next to a day with ten,
          // so non-empty bars get a floor and stay proportional above it.
          const h = n === 0 ? 0 : Math.max(MIN_BAR, (n / peak) * height)
          return (
            <div
              key={b.at}
              className="bar-grow"
              title={`${label(b.at)} · ${b.allowed} allowed, ${b.refused} refused`}
              style={{ flex: 1, ...(MAX_BAR ? { maxWidth: MAX_BAR } : {}), display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height, ...delay(i, buckets.length > 40 ? 8 : 25, 150) }}
            >
              {n === 0 ? (
                // A quiet period is information: show the floor, not a gap.
                <div style={{ height: 1, background: 'var(--line-2)' }} />
              ) : (
                <>
                  {b.refused > 0 ? <div style={{ height: (b.refused / n) * h, background: 'var(--red-line)', minHeight: 2 }} /> : null}
                  {b.allowed > 0 ? <div style={{ height: (b.allowed / n) * h, background: 'var(--green)', minHeight: 2 }} /> : null}
                </>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 11, letterSpacing: '.08em', color: 'var(--ghost)' }}>
        <span>{buckets[0] ? label(buckets[0].at) : ''}</span>
        <span>
          {refused} refused · {allowed} allowed · per {grain}
        </span>
        <span>{buckets[buckets.length - 1] ? label(buckets[buckets.length - 1]!.at) : ''}</span>
      </div>

      {!compact && byRule.length ? (
        <div style={{ marginTop: 32 }}>
          <div className="label" style={{ marginBottom: 16 }}>
            Which rules refuse
          </div>
          <div>
            {byRule.map((r, i) => (
              <div key={r.code} className="trow printed" style={{ gridTemplateColumns: '80px minmax(0,1fr) 48px', padding: '10px 0', ...delay(i, 60, 300) }}>
                <span className="red-2">{r.code}</span>
                <span>
                  {r.label}
                  <span style={{ display: 'inline-block', width: `${(r.fired / byRule[0]!.fired) * 60}%`, maxWidth: '60%', height: 4, background: 'var(--red-line)', marginLeft: 12, verticalAlign: 'middle', opacity: 0.8 }} />
                </span>
                <span className="tright">{r.fired}</span>
              </div>
            ))}
          </div>
          <p className="prose muted" style={{ marginTop: 12 }}>
            Counted from the receipts themselves: a rule appears here only when it has actually refused a proposal.
          </p>
        </div>
      ) : null}
    </div>
  )
}
