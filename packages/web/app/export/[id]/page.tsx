import Link from 'next/link'
import { notFound } from 'next/navigation'
import { api, apiText, type ReceiptView, type VaultsView } from '@/lib/api'
import { PageHead, Tile, Unreachable } from '@/components/panels'
import { utcDateTime, verdictWord } from '@/lib/format'
import { delay } from '@/lib/motion'

export const dynamic = 'force-dynamic'

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [res, report] = await Promise.all([api<ReceiptView>(`/receipts/${encodeURIComponent(id)}`), apiText(`/receipts/${encodeURIComponent(id)}/report`)])
  if (!res.ok) {
    if (res.status === 404) notFound()
    return (
      <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
        <PageHead kicker="Export audit report" title="Unreachable" />
        <Unreachable reason={res.reason} checkedAt={res.checkedAt} />
      </div>
    )
  }
  const r = res.data
  const price = process.env['X402_PRICE_USDC'] ?? '0.50'
  const lines = report.ok ? report.data.split('\n') : []
  const bytes = report.ok ? Buffer.byteLength(report.data, 'utf8') : 0
  const sections = report.ok ? lines.filter((l) => /^## /.test(l)).map((l) => l.replace(/^## /, '')) : []

  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <PageHead kicker="Export audit report" title="Built from the receipt" />

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 40, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 64, alignItems: 'start' }}>
        <div className="rise" style={{ minWidth: 0, ...delay(0, 0, 150) }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 40, marginBottom: 40 }}>
            <Tile label="Receipt" value={r.short} />
            <Tile label="Verdict" value={verdictWord(r.verdict)} tone={r.verdict === 'REFUSE' ? 'red' : 'green'} />
            <Tile label="Issued" value={utcDateTime(r.createdAt)} />
            <Tile label="Report" value={report.ok ? `${lines.length} lines · ${bytes} B` : 'unavailable'} tone={report.ok ? undefined : 'amber'} />
          </div>
          <div className="label" style={{ marginBottom: 16 }}>
            Included
          </div>
          <div style={{ fontSize: 13 }}>
            {(sections.length ? sections : ['Decision', 'Rule checks', 'Inputs', 'Explanation', 'Hashes']).map((s) => (
              <div key={s} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '14px 0', borderBottom: '1px solid var(--row)' }}>
                <span>{s}</span>
                <span className="green">ON</span>
              </div>
            ))}
          </div>
          <p className="prose muted" style={{ marginTop: 16 }}>
            The report is byte-stable Markdown rendered from the receipt: every rule, every number, the explanation and the three hashes. Two exports of the same receipt are identical files.
          </p>
        </div>

        <div className="rise" style={{ minWidth: 0, ...delay(0, 0, 300) }}>
          <div className="label" style={{ marginBottom: 24 }}>
            Price
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
            <span className="serif" style={{ fontSize: 56, lineHeight: 1 }}>
              {price}
            </span>
            <span className="dim">USDC per report</span>
          </div>
          <div style={{ fontSize: 13, marginBottom: 40 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '12px 0', borderBottom: '1px solid var(--row)' }}>
              <span className="dim">Rail</span>
              <span>x402 · HTTP 402 Payment Required</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '12px 0', borderBottom: '1px solid var(--row)' }}>
              <span className="dim">Payee</span>
              <span>the agent's ERC-8004 identity</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '12px 0' }}>
              <span className="dim">Status</span>
              <span className="amber">paywall arrives with D9 — download is open until then</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
            <a href={`/export/${r.id}/route-download`} className={`btn primary${report.ok ? '' : ' muted'}`}>
              Download report
            </a>
            <Link href={`/receipts/${r.id}`} className="btn">
              Back to the receipt
            </Link>
          </div>
          {report.ok ? (
            <pre style={{ margin: 0, padding: 16, border: '1px solid var(--line-2)', fontSize: 11, lineHeight: 1.6, color: 'var(--mute)', overflowX: 'auto', maxHeight: 420 }}>
              {lines.slice(0, 40).join('\n')}
              {lines.length > 40 ? `\n… ${lines.length - 40} more lines` : ''}
            </pre>
          ) : (
            <p className="prose amber">Report unavailable: {report.reason}.</p>
          )}
        </div>
      </div>
    </div>
  )
}
