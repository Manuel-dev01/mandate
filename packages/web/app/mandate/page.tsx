import Link from 'next/link'
import { api, type MandateView } from '@/lib/api'
import { MandateProse } from '@/components/checks'
import { NoReceipts, PageHead, Unreachable } from '@/components/panels'
import { utcDateTime } from '@/lib/format'
import { delay } from '@/lib/motion'

export const dynamic = 'force-dynamic'

const COLS = '80px minmax(220px,1fr) 96px 72px'
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const word = (n: number) => WORDS[n] ?? String(n)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default async function MandatePage() {
  const res = await api<{ empty: boolean; mandate: MandateView | null; receiptId?: string }>('/mandate')
  if (!res.ok) {
    return (
      <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
        <PageHead kicker="Compiled mandate" title="Unreachable" />
        <Unreachable reason={res.reason} checkedAt={res.checkedAt} />
      </div>
    )
  }
  const m = res.data.mandate
  if (!m) {
    return (
      <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
        <PageHead kicker="Compiled mandate" title="No mandate compiled yet" />
        <NoReceipts title="No mandate on record" />
      </div>
    )
  }
  const fired = new Set(m.rules.filter((r) => (r.fired ?? 0) > 0).map((r) => r.code))

  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <PageHead
        kicker="Compiled mandate"
        title={`${cap(word(m.clauses))} clause${m.clauses === 1 ? '' : 's'}, ${word(m.rules.length)} rule${m.rules.length === 1 ? '' : 's'}`}
        right={
          <div className="label-sm" style={{ letterSpacing: '.08em' }}>
            v{m.version} · {m.hash.slice(0, 12)} · compiled {utcDateTime(m.compiledAt)} · {m.model}
          </div>
        }
      />

      <div style={{ borderTop: '1px solid var(--line)', padding: '40px 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 64, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="label" style={{ marginBottom: 24 }}>
            As written
          </div>
          <MandateProse segments={m.segments} fired={fired} />
          <p className="prose muted" style={{ marginTop: 24 }}>
            Underlined text became a rule. Red text has refused at least one proposal. Amending the mandate compiles a new version with a new hash; every receipt keeps the hash it was decided under, so no rule changes retroactively.
          </p>
        </div>

        <div style={{ minWidth: 0 }} className="scroll-x">
          <div className="label" style={{ marginBottom: 24 }}>
            Compiled rules
          </div>
          <div style={{ minWidth: 480 }}>
            <div className="trow thead" style={{ gridTemplateColumns: COLS, padding: '12px 0' }}>
              <span>Rule</span>
              <span>Predicate</span>
              <span>From</span>
              <span className="tright">Fired</span>
            </div>
            {m.rules.map((r, i) => {
              const hot = fired.has(r.code)
              return (
                <div key={r.code} className={`trow printed${hot ? ' flag' : ''}`} style={{ gridTemplateColumns: COLS, padding: '14px 0', ...delay(i, 70, 200) }}>
                  <span className={hot ? 'red-2' : 'dim'}>{r.code}</span>
                  <span>
                    <span>{r.label}</span>
                    <span className="dim"> — {r.threshold}</span>
                  </span>
                  <span className={r.inferred ? 'ghost' : 'dim'}>{r.inferred ? 'inferred' : r.clauseIndex ? `clause ${r.clauseIndex}` : 'stated'}</span>
                  <span className={`tright ${hot ? '' : 'muted'}`}>{r.fired ?? 0}</span>
                </div>
              )
            })}
          </div>
          <p className="prose muted" style={{ marginTop: 16 }}>
            “Fired” counts refusals on the chain that cited the rule. An inferred rule's threshold was supplied by the compiler from a clause with no number in it.
          </p>
        </div>
      </div>

      <div className="rise" style={{ ...delay(0, 0, 500), borderTop: '1px solid var(--line)', paddingTop: 40, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 64 }}>
        <div>
          <div className="label" style={{ marginBottom: 16 }}>
            Not a rule
          </div>
          {m.unmappable.length ? (
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              {m.unmappable.map((u) => (
                <span key={u} className="serif" style={{ fontSize: 18, color: 'var(--ink-3)' }}>
                  “{u}”
                </span>
              ))}
            </div>
          ) : null}
          <p className="prose" style={{ maxWidth: '64ch' }}>
            {m.unmappable.length ? 'Kept on record, enforced by nothing — no rule type can express it. ' : ''}
            Instructions sent alongside a proposal are recorded as inputs and evaluated by nothing. There is no override path in the checker.
          </p>
        </div>
        <div>
          <div className="label" style={{ marginBottom: 16 }}>
            Provenance
          </div>
          <p className="prose muted">
            This is the mandate on the newest receipt
            {res.data.receiptId ? (
              <>
                {' '}
                (
                <Link href={`/receipts/${res.data.receiptId}`} style={{ color: 'var(--ink)', borderBottom: '1px solid var(--line-4)' }}>
                  {res.data.receiptId.slice(0, 12)}
                </Link>
                )
              </>
            ) : null}
            . Compiled by SERV Reasoning ({m.model}) with structured output; the hash covers the text and the rules, never the model's prose.
          </p>
        </div>
      </div>
    </div>
  )
}
