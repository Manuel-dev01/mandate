import Link from 'next/link'
import { notFound } from 'next/navigation'
import { api, type ReceiptView } from '@/lib/api'
import { ChecksTable } from '@/components/checks'
import { CopyHash } from '@/components/copy-hash'
import { PageHead, Tile, Unreachable } from '@/components/panels'
import { age, utcDateTime, utcTime, verdictWord } from '@/lib/format'
import { delay } from '@/lib/motion'
import { Barcode } from '@/components/barcode'
import { VerifyButtons } from './verify-buttons'

export const dynamic = 'force-dynamic'

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await api<ReceiptView>(`/receipts/${encodeURIComponent(id)}`)
  if (!res.ok) {
    if (res.status === 404) notFound()
    return (
      <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
        <PageHead kicker={`Receipt ${id.slice(0, 12)}`} title="Unreachable" />
        <Unreachable reason={res.reason} checkedAt={res.checkedAt} />
      </div>
    )
  }
  const r = res.data
  const refused = r.verdict === 'REFUSE'
  const citedChecks = r.checks.filter((c) => c.applicable && !c.passed)
  const facts = r.inputs.facts
  const portfolio = r.inputs.portfolio

  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <PageHead
        kicker={`RCPT ${r.short} · ${utcDateTime(r.createdAt)}`}
        title={
          <>
            <span className={refused ? undefined : 'green'}>{r.headline}</span>
            <span className={`stamp inline ${refused ? 'refused' : 'allowed'}`} style={{ animationDelay: '0.6s' }}>
              {verdictWord(r.verdict)}
            </span>
          </>
        }
        right={<VerifyButtons id={r.id} />}
      />

      {/* tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 40, borderTop: '1px solid var(--line)', padding: '24px 0 40px' }}>
        <Tile label="Action" value={`${r.action.kind} ${r.action.amount}`} />
        <Tile label="Vault" value={r.action.vaultName} />
        <Tile label="Chain" value={r.action.network} tone={r.action.mainnet ? 'red' : undefined} />
        <Tile label="Vault facts" value={facts.stale ? `STALE · ${utcTime(facts.observedAt)}` : `live · ${utcTime(facts.observedAt)}`} tone={facts.stale ? 'amber' : undefined} />
      </div>

      {/* checks */}
      <ChecksTable checks={r.checks} />
      {r.context ? (
        <div className="prose muted" style={{ padding: '16px 0 0' }}>
          {r.context}
        </div>
      ) : null}

      {/* clauses + message */}
      <div className="rise" style={{ ...delay(0, 0, 250), borderTop: '1px solid var(--line)', marginTop: 40, padding: '40px 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 64 }}>
        <div style={{ minWidth: 0 }}>
          <div className="label" style={{ marginBottom: 24 }}>
            {refused ? `The clause${citedChecks.length === 1 ? '' : 's'} that refused it` : 'Every clause held'}
          </div>
          {refused ? (
            <div style={{ display: 'grid', gap: 20 }}>
              {citedChecks.map((c) => (
                <div key={c.code}>
                  <p className="serif" style={{ fontSize: 'clamp(20px,2.2vw,26px)', lineHeight: 1.5, margin: '0 0 8px', color: 'var(--ink-2)', textWrap: 'pretty' }}>
                    “<span className="clause fired">{c.clause}</span>”
                  </p>
                  <p className="prose muted">
                    <span className="red-2">{c.code}</span> {c.label}
                    {c.inferred ? ' (threshold inferred by the compiler)' : ''} — {c.detail}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="prose muted">
              All {r.applicable} applicable rules passed against live vault data. The mandate's clauses are on the{' '}
              <Link href="/mandate" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--line-4)' }}>
                mandate page
              </Link>
              .
            </p>
          )}
        </div>
        <div style={{ minWidth: 0, display: 'grid', gap: 40, alignContent: 'start' }}>
          <div>
            <div className="label" style={{ marginBottom: 24 }}>
              Also on this receipt
            </div>
            {r.userMessage ? (
              <p className="prose">
                Message sent with the proposal: <span style={{ color: 'var(--ink)' }}>“{r.userMessage}”</span> — recorded as an input, evaluated by no rule.
              </p>
            ) : (
              <p className="prose muted">No message was sent with the proposal.</p>
            )}
          </div>
          <div>
            <div className="label" style={{ marginBottom: 24 }}>
              Why
            </div>
            <p className="prose">{r.why}</p>
            <p className="label-sm" style={{ marginTop: 12, letterSpacing: '.08em', textTransform: 'none' }}>
              {r.explanation.source === 'serv'
                ? `${r.explanation.model ?? 'SERV'} · ${r.explanation.tokens} tokens · ${r.explanation.tools.join(' + ') || 'no SERV tools'}`
                : `deterministic template${r.explanation.guarded ? ' · serv_prompt_guard short-circuited the explanation' : r.explanation.note ? ` · ${r.explanation.note}` : ''}`}
            </p>
          </div>
        </div>
      </div>

      {/* inputs */}
      <div className="rise" style={{ ...delay(0, 0, 400), borderTop: '1px solid var(--line)', padding: '40px 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 64 }}>
        <div>
          <div className="label" style={{ marginBottom: 24 }}>
            Portfolio · {portfolio.source}
          </div>
          <KV rows={[
            ['Total', portfolio.total],
            ['Idle', portfolio.idle],
            ...portfolio.positions.map((p): [string, string] => [`Position · chain ${p.chainId}`, `${p.value} · ${p.vaultId.slice(0, 8)}…`]),
            ['Wallet', portfolio.wallet],
            ['As of', utcDateTime(portfolio.asOf)],
          ]} />
        </div>
        <div>
          <div className="label" style={{ marginBottom: 24 }}>
            Vault facts · {facts.stale ? 'stale snapshot' : 'live'}
          </div>
          <KV rows={[
            ['Vault', `${facts.name} · ${facts.vaultId.slice(0, 8)}…`],
            ['TVL', facts.tvl],
            ['Status', facts.status ?? 'unknown'],
            ['paused()', facts.paused === null ? `unreadable · ${facts.pausedSource}` : `${facts.paused} · ${facts.pausedSource}`],
            ['Settlement', facts.settlement],
            ['Whitelist', facts.requiresWhitelist ? `required · ${facts.whitelisted === null ? 'unverified' : facts.whitelisted ? 'cleared' : 'NOT cleared'}` : 'not required'],
            ['Observed', `${utcDateTime(facts.observedAt)} (${age(facts.observedAt)} ago)`],
          ]} />
        </div>
      </div>

      {/* hashes */}
      <div className="rise" style={{ ...delay(0, 0, 550), borderTop: '1px solid var(--line)', paddingTop: 24, color: 'var(--ink-3)' }}>
        <Barcode hash={r.hashes.receipt} height={36} />
      </div>
      <div className="rise" style={{ ...delay(0, 0, 600), paddingTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 24 }}>
        <CopyHash label="Mandate" value={r.hashes.mandate} />
        <CopyHash label="Decision" value={r.hashes.decision} />
        <CopyHash label="Receipt" value={r.hashes.receipt} />
        <CopyHash label="Previous" value={r.hashes.previous} {...(r.hashes.previous ? { href: `/receipts/${r.hashes.previous}` } : {})} />
      </div>

      <div style={{ marginTop: 40, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link href={`/export/${r.id}`} className="btn primary">
          Export audit report
        </Link>
        <Link href="/chain" className="btn">
          Back to the chain
        </Link>
      </div>
    </div>
  )
}

function KV({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ fontSize: 13 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '12px 0', borderBottom: '1px solid var(--row)' }}>
          <span className="dim">{k}</span>
          <span style={{ textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
        </div>
      ))}
    </div>
  )
}
