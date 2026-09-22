import Link from 'next/link'
import { PageHead } from '@/components/panels'

export default function ReceiptNotFound() {
  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <PageHead kicker="Receipt" title="No receipt matches that id" />
      <p className="prose muted" style={{ maxWidth: '52ch', marginBottom: 24 }}>
        Ids are the receipt's own hash; any unique prefix of six or more characters resolves. Nothing is ever deleted from the chain, so a missing id was never issued.
      </p>
      <Link href="/chain" className="btn">
        See the chain
      </Link>
    </div>
  )
}
