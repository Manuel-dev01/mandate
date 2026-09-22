import Link from 'next/link'
import { notFound } from 'next/navigation'
import { api, apiText, API_URL, type ReceiptView, type X402View } from '@/lib/api'
import { Barcode } from '@/components/barcode'
import { PageHead, Tile, Unreachable } from '@/components/panels'
import { shortHash, utcDateTime, utcTime, verdictWord } from '@/lib/format'
import { delay } from '@/lib/motion'

export const dynamic = 'force-dynamic'

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [res, preview, x402] = await Promise.all([
    api<ReceiptView>(`/receipts/${encodeURIComponent(id)}`),
    apiText(`/receipts/${encodeURIComponent(id)}/report?preview=1`),
    api<X402View>('/x402', { timeoutMs: 15_000 }),
  ])
  if (!res.ok) {
    if (res.status === 404) notFound()
    return (
      <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
        <PageHead kicker="Audit report" title="Unreachable" />
        <Unreachable reason={res.reason} checkedAt={res.checkedAt} />
      </div>
    )
  }
  const r = res.data
  const svc = x402.ok ? x402.data.service : null
  const identity = x402.ok ? x402.data.identity : null
  const sales = x402.ok ? x402.data.sales : null
  const lines = preview.ok ? preview.data.split('\n') : []
  const buyUrl = `${API_URL}/receipts/${r.id}/report`

  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <PageHead
        kicker="Audit report"
        title="One decision, sold as its proof"
        right={
          sales ? (
            <div className="label-sm" style={{ letterSpacing: '.08em' }}>
              {sales.sold} sold · {Number(sales.earned).toFixed(2)} USDC earned
            </div>
          ) : null
        }
      />

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 40, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 64, alignItems: 'start' }}>
        {/* what is being sold */}
        <div className="rise" style={{ minWidth: 0, ...delay(0, 0, 150) }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 40, marginBottom: 40 }}>
            <Tile label="Receipt" value={r.short} />
            <Tile label="Verdict" value={verdictWord(r.verdict)} tone={r.verdict === 'REFUSE' ? 'red' : 'green'} />
            <Tile label="Issued" value={utcDateTime(r.createdAt)} />
            <Tile label="Report" value={preview.ok ? `${lines.length}+ lines · Markdown` : 'unavailable'} tone={preview.ok ? undefined : 'amber'} />
          </div>

          <div className="label" style={{ marginBottom: 16 }}>
            What the buyer receives
          </div>
          <p className="prose" style={{ marginBottom: 24 }}>
            The full decision record as byte-stable Markdown: all seven rules with their actual value and limit, the clause of the policy that produced each one, the live vault facts it was decided on, the explanation and its trace, and the three hashes anyone can re-derive. Two buyers of the same receipt get identical files.
          </p>

          {preview.ok ? (
            <>
              <div className="label" style={{ marginBottom: 12 }}>
                Free preview
              </div>
              <pre style={{ margin: 0, padding: 16, border: '1px solid var(--line-2)', fontSize: 11, lineHeight: 1.6, color: 'var(--mute)', overflowX: 'auto', maxHeight: 420 }}>
                {preview.data}
              </pre>
            </>
          ) : (
            <p className="prose amber">Preview unavailable: {preview.reason}.</p>
          )}
        </div>

        {/* the paywall */}
        <div className="rise" style={{ minWidth: 0, ...delay(0, 0, 300) }}>
          {!svc ? (
            <Unreachable reason={x402.ok ? 'no service facts' : x402.reason} checkedAt={x402.checkedAt} />
          ) : (
            <>
              <div className="label" style={{ marginBottom: 24 }}>
                Price
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
                <span className="serif" style={{ fontSize: 56, lineHeight: 1 }}>
                  {Number(svc.price).toFixed(2)}
                </span>
                <span className="dim">USDC per report</span>
              </div>
              <div className="label-sm" style={{ marginBottom: 32, letterSpacing: '.08em' }}>
                x402 · {svc.network}
                {svc.testnet ? ' · testnet' : ''}
              </div>

              <div style={{ fontSize: 13, marginBottom: 32 }}>
                <Row k="Payee" v={svc.payTo} href={svc.payToUrl} mono />
                <Row k="Identity" v={identity?.registered ? `ERC-8004 ${identity.agentId}` : 'ERC-8004 · not registered'} href={identity?.scanUrl ?? null} />
                <Row k="Asset" v={`USDC ${shortHash(svc.asset, 6, 4)}`} mono />
                <Row k="Facilitator" v={svc.facilitator.replace(/^https?:\/\//, '')} />
                <Row
                  k="Also listed"
                  v={svc.openserv.listed ? `OpenServ${svc.openserv.name ? ` · ${svc.openserv.name}` : ''}${svc.openserv.price ? ` · ${svc.openserv.price} USDC` : ''}` : 'OpenServ · not listed yet'}
                  href={svc.openserv.paywallUrl ?? svc.openserv.triggerUrl}
                />
              </div>

              <a href={buyUrl} className="btn primary" style={{ display: 'inline-block', marginBottom: 16 }}>
                Buy the report · {Number(svc.price).toFixed(2)} USDC
              </a>
              <p className="prose muted" style={{ marginBottom: 32 }}>
                The link answers <span className="ink-3">402 Payment Required</span> with the x402 terms above and opens a pay page for your wallet. Pay {svc.testnet ? 'faucet ' : ''}USDC on {svc.network}; the file is served the moment the facilitator settles, and the sale is recorded below with its transaction.
              </p>

              <div className="label" style={{ marginBottom: 16 }}>
                Sales
              </div>
              {!sales || sales.sold === 0 ? (
                <p className="prose muted">No reports sold yet. This counter moves only on a settled payment — nothing here is seeded.</p>
              ) : (
                <div style={{ fontSize: 13 }}>
                  <Row k="Sold" v={`${sales.sold} report${sales.sold === 1 ? '' : 's'}`} />
                  <Row k="Earned" v={`${Number(sales.earned).toFixed(2)} USDC`} />
                  {sales.recent.map((s) => (
                    <Row key={s.txHash + s.at} k={utcTime(s.at)} v={`${Number(s.price).toFixed(2)} USDC · ${s.short} · ${shortHash(s.txHash, 8, 6)}`} href={s.txUrl} mono />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="rise" style={{ ...delay(0, 0, 450), borderTop: '1px solid var(--line)', marginTop: 40, paddingTop: 24, color: 'var(--ink-3)' }}>
        <Barcode hash={r.hashes.receipt} height={28} />
      </div>
      <div style={{ marginTop: 24, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link href={`/receipts/${r.id}`} className="btn">
          Back to the receipt
        </Link>
        <Link href="/chain" className="btn">
          The chain
        </Link>
      </div>
    </div>
  )
}

function Row({ k, v, href, mono }: { k: string; v: string; href?: string | null; mono?: boolean }) {
  const value = <span style={{ textAlign: 'right', wordBreak: 'break-all', fontSize: mono ? 11 : undefined, letterSpacing: mono ? '.04em' : undefined }}>{v}</span>
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '12px 0', borderBottom: '1px solid var(--row)' }}>
      <span className="dim" style={{ whiteSpace: 'nowrap' }}>
        {k}
      </span>
      {href ? (
        <a href={href} style={{ borderBottom: '1px solid var(--line-4)' }}>
          {value}
        </a>
      ) : (
        value
      )}
    </div>
  )
}
