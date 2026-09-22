/** A receipt hash as a barcode: every hex digit sets one bar's width and the gap after it. Decorative, but derived — two hashes never print the same. */
export function Barcode({ hash, height = 44 }: { hash: string; height?: number }) {
  const bars: { x: number; w: number }[] = []
  let x = 0
  for (const ch of hash.toLowerCase()) {
    const n = parseInt(ch, 16)
    if (Number.isNaN(n)) continue
    const w = 1 + (n % 4)
    bars.push({ x, w })
    x += w + 1 + (n >> 2) % 3
  }
  return (
    <svg viewBox={`0 0 ${x} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden="true" style={{ display: 'block' }}>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="currentColor" />
      ))}
    </svg>
  )
}
