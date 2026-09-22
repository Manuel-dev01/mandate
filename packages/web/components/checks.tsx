import type { CheckView, MandateSegment } from '@/lib/api'
import { delay } from '@/lib/motion'

const COLS = '80px minmax(200px,1fr) 280px 72px'

/** The seven-row check table — always all seven, breached rows flagged, not-applicable dimmed. */
export function ChecksTable({ checks }: { checks: CheckView[] }) {
  return (
    <div className="scroll-x rule-top">
      <div style={{ minWidth: 640 }}>
        <div className="trow thead" style={{ gridTemplateColumns: COLS }}>
          <span>Rule</span>
          <span>Check</span>
          <span>Actual / limit</span>
          <span className="tright">Verdict</span>
        </div>
        {checks.map((c, i) => {
          const na = !c.applicable
          const fail = c.applicable && !c.passed
          return (
            <div key={c.code} className={`trow printed${fail ? ' flag' : ''}`} style={{ gridTemplateColumns: COLS, color: na ? 'var(--ghost)' : undefined, ...delay(i, 70, 100) }}>
              <span className={fail ? 'red-2' : 'dim'}>{c.code}</span>
              <span>
                {c.label}
                {c.inferred ? <span className="dim"> · inferred</span> : null}
              </span>
              <span className={fail ? 'red-2' : 'muted'}>{c.phrase}</span>
              <span className={`tright ${na ? 'ghost' : fail ? 'red' : 'green'}`}>{na ? 'N/A' : fail ? 'FAIL' : 'PASS'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The mandate prose with each rule's clause underlined; fired clauses washed red. */
export function MandateProse({ segments, fired, size = 'clamp(20px,2.4vw,28px)' }: { segments: MandateSegment[]; fired: Set<string>; size?: string }) {
  return (
    <p className="serif" style={{ fontSize: size, lineHeight: 1.55, margin: 0, color: 'var(--ink-2)', textWrap: 'pretty' }}>
      {segments.map((s, i) =>
        s.rule ? (
          <span key={i} className={`clause${fired.has(s.rule) ? ' fired' : ''}`} title={s.rule}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  )
}
