import Link from 'next/link'
import type { ReceiptView } from '@/lib/api'
import { TELEGRAM_HANDLE, utcDateTime } from '@/lib/format'
import { Barcode } from './barcode'

/**
 * The hero object: a printed receipt on the desk. With a receipt, every line is that receipt's;
 * rows print one by one and the verdict is stamped once. Without one, a blank receipt says where
 * the first decision comes from. Same paper either way — the product's own artifact.
 */
export function PaperReceipt({ r }: { r: ReceiptView | null }) {
  return (
    <div className="paper-wrap">
      <div className="paper">
        <div className="paper-head">
          <span>MANDATE</span>
          <span>DECISION RECEIPT</span>
        </div>
        <div className="paper-rule" />
        {r ? <Printed r={r} /> : <Blank />}
      </div>
      <div className="paper-tear" />
    </div>
  )
}

function Printed({ r }: { r: ReceiptView }) {
  const refused = r.verdict === 'REFUSE'
  const rows = r.checks
  return (
    <>
      <div className="paper-kv">
        <span>RCPT</span>
        <span>{r.short}</span>
      </div>
      <div className="paper-kv">
        <span>ISSUED</span>
        <span>{utcDateTime(r.createdAt)}</span>
      </div>
      <div className="paper-kv">
        <span>ACTION</span>
        <span>
          {r.action.kind} {r.action.amount}
        </span>
      </div>
      <div className="paper-kv">
        <span>VAULT</span>
        <span>
          {r.action.vaultName} · {r.action.network}
        </span>
      </div>
      <div className="paper-rule dashed" />
      <div className="paper-rows">
        {rows.map((c, i) => {
          const fail = c.applicable && !c.passed
          return (
            <div key={c.code} className={`paper-row print${fail ? ' fail' : ''}`} style={{ animationDelay: `${0.15 + i * 0.22}s` }}>
              <span className="code">{c.code}</span>
              <span className="phrase">{c.applicable ? c.phrase : 'n/a'}</span>
              <span className="mark">{!c.applicable ? '–' : fail ? '✗' : '✓'}</span>
            </div>
          )
        })}
      </div>
      <div className="paper-rule dashed" />
      <div className="paper-verdict print" style={{ animationDelay: `${0.15 + rows.length * 0.22}s` }}>
        <div className="paper-kv">
          <span>RULES</span>
          <span>
            {r.breached} of {r.applicable} breached
          </span>
        </div>
        {r.context ? <div className="paper-note">{r.context}</div> : null}
        <div className={`stamp ${refused ? 'refused' : 'allowed'}`} style={{ animationDelay: `${0.5 + rows.length * 0.22}s` }}>
          {refused ? 'REFUSED' : 'ALLOWED'}
        </div>
      </div>
      <div className="paper-rule dashed" />
      <div className="paper-barcode">
        <Barcode hash={r.hashes.receipt} />
        <div className="paper-hash">{r.hashes.receipt.match(/.{1,16}/g)?.join(' ')}</div>
      </div>
      <Link href={`/receipts/${r.id}`} className="paper-cta">
        OPEN THE FULL RECEIPT →
      </Link>
    </>
  )
}

function Blank() {
  return (
    <>
      <div className="paper-kv">
        <span>RCPT</span>
        <span>— none yet —</span>
      </div>
      <div className="paper-kv">
        <span>CHAIN</span>
        <span>empty · 0 links</span>
      </div>
      <div className="paper-rule dashed" />
      <div className="paper-blank">
        <div className="paper-blank-title">NO DECISIONS YET</div>
        <p>
          This receipt prints when the first proposal is checked. Proposals are made in Telegram, to <b>{TELEGRAM_HANDLE}</b> — nothing on this console is seeded or simulated.
        </p>
        <div className="paper-rule dashed" />
        <div className="paper-rows">
          {['Paste a mandate in plain English', 'Propose a deposit', 'Read the verdict, open the receipt here'].map((t, i) => (
            <div key={t} className="paper-row">
              <span className="code">0{i + 1}</span>
              <span className="phrase">{t}</span>
              <span className="mark">·</span>
            </div>
          ))}
        </div>
      </div>
      <div className="paper-rule dashed" />
      <div className="paper-barcode faint">
        <Barcode hash="0000000000000000000000000000000000000000000000000000000000000000" />
        <div className="paper-hash">the hash prints with the first receipt</div>
      </div>
    </>
  )
}
