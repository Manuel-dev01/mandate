import { api, type VaultsView } from '@/lib/api'
import { PageHead, Unreachable } from '@/components/panels'
import { age, utcTime } from '@/lib/format'
import { delay } from '@/lib/motion'

export const dynamic = 'force-dynamic'

const COLS = '150px minmax(180px,1fr) 64px 120px 190px 88px 96px'
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const word = (n: number) => WORDS[n] ?? String(n)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default async function VaultsPage() {
  const res = await api<VaultsView>('/vaults', { timeoutMs: 45_000 })
  if (!res.ok) {
    return (
      <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
        <PageHead kicker="Vault universe · IXS" title="Unreachable" />
        <Unreachable reason={res.reason} checkedAt={res.checkedAt} />
      </div>
    )
  }
  const v = res.data
  const now = Date.now()
  const staleRows = v.vaults.filter((x) => x.stale)
  const mainnet = v.vaults.filter((x) => x.mainnet)

  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <PageHead
        kicker="Vault universe · IXS"
        title={`${cap(word(v.vaults.length))} vault${v.vaults.length === 1 ? '' : 's'}, ${word(v.chains)} chain${v.chains === 1 ? '' : 's'}`}
        right={
          <div className={`label-sm ${v.stale ? 'amber' : ''}`} style={{ letterSpacing: '.08em' }}>
            {v.stale ? `Stale · ${v.source} snapshot from ${utcTime(v.fetchedAt)}` : `Live · REST + MCP · read ${age(v.fetchedAt, now)} ago`}
          </div>
        }
      />

      <div className="scroll-x rule-top">
        <div style={{ minWidth: 860 }}>
          <div className="trow thead" style={{ gridTemplateColumns: COLS }}>
            <span>Vault</span>
            <span>Chain</span>
            <span>Asset</span>
            <span>Settlement</span>
            <span className="tright">TVL</span>
            <span className="tright">Status</span>
            <span className="tright">Facts</span>
          </div>
          {v.vaults.map((x, i) => (
            <div key={x.id} className="trow printed" style={{ gridTemplateColumns: COLS, background: x.stale ? 'var(--amber-soft)' : undefined, ...delay(i, 70, 150) }}>
              <span>
                {x.name}
                {x.requiresWhitelist ? <span className="dim"> · whitelist</span> : null}
              </span>
              <span className={x.mainnet ? 'mainnet' : 'muted'}>
                {x.network} <span className="ghost">({x.chainId})</span>
                {x.mainnet ? <span> · mainnet</span> : null}
              </span>
              <span className="muted">{x.asset}</span>
              <span className="muted">{x.settlement ?? '—'}</span>
              <span className="tright">{x.tvl ?? <span className="ghost">unread</span>}</span>
              <span className={`tright ${x.status === 'active' ? 'green' : 'amber'}`}>{x.status ?? 'unknown'}</span>
              <span className={`tright ${x.stale ? 'amber' : 'dim'}`}>{x.stale ? `stale ${x.fetchedAt ? age(x.fetchedAt, now) : ''}`.trim() : age(x.fetchedAt, now)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rise" style={{ ...delay(0, 0, 600), marginTop: 40, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 40 }}>
        {staleRows.length ? (
          <div>
            <div className="label amber" style={{ marginBottom: 16 }}>
              Stale, not broken
            </div>
            <p className="prose muted">
              {staleRows.map((x) => x.name).join(', ')} {staleRows.length === 1 ? 'is' : 'are'} served from the last good snapshot and shown with {staleRows.length === 1 ? 'its' : 'their'} age.
              A decision made on stale facts says so on its receipt, and the whitelist check is never cached — it fails closed instead.
              {staleRows[0]?.error ? ` Last error: ${staleRows[0].error}.` : ''}
            </p>
          </div>
        ) : null}
        {mainnet.length ? (
          <div>
            <div className="label" style={{ marginBottom: 16 }}>
              Mainnet, {v.mainnetRefusals > 0 ? 'always refused' : 'read-only'}
            </div>
            <p className="prose muted">
              {mainnet.map((x) => x.name).join(', ')} holds real {mainnet.map((x) => x.asset).join('/')} on Robinhood Chain. The agent reads it live;
              {v.mainnetRefusals > 0
                ? ` every proposal into it so far — ${v.mainnetRefusals} — was refused under "Testnet only".`
                : ' a testnet-only mandate refuses every proposal into it.'}
            </p>
          </div>
        ) : null}
        <div>
          <div className="label" style={{ marginBottom: 16 }}>
            What is read
          </div>
          <p className="prose muted">
            Vault list from IXS REST (the source of truth), settlement and pricing from the IXS MCP <span className="ink-3">vault_get</span>, and{' '}
            <span className="ink-3">paused()</span> straight from the chain at decision time. Nothing here is a yield figure — the agent does not chase one.
          </p>
        </div>
      </div>
    </div>
  )
}
