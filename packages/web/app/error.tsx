'use client'

/** Last resort. Pages handle their own degraded states; this catches anything that slipped. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <div className="label amber" style={{ marginBottom: 16 }}>
        Console fault
      </div>
      <h1 className="h1" style={{ marginBottom: 24 }}>
        This page could not render
      </h1>
      <p className="prose muted" style={{ maxWidth: '52ch', marginBottom: 24 }}>
        The agent and its receipts are unaffected — this is the console failing to draw them. {error.digest ? `Ref ${error.digest}.` : ''}
      </p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  )
}
