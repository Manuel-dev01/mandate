export default function Loading() {
  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <div className="label" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="pulse" /> Reading the agent
      </div>
      <div className="shimmer" style={{ height: 40, width: 320, maxWidth: '100%', marginBottom: 40 }} />
      <div style={{ borderTop: '1px solid var(--line)' }}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="shimmer" style={{ height: 17, margin: '16px 0', width: `${88 - i * 6}%` }} />
        ))}
      </div>
    </div>
  )
}
