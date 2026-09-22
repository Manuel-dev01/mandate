import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <div className="label" style={{ marginBottom: 16 }}>
        404
      </div>
      <h1 className="h1" style={{ marginBottom: 24 }}>
        Nothing at this address
      </h1>
      <Link href="/" className="btn">
        Back to the console
      </Link>
    </div>
  )
}
