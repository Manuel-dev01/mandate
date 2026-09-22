'use client'

import Link from 'next/link'
import { useState } from 'react'

/** A full hash as a first-class object: monospace, click to copy, optionally a link. */
export function CopyHash({ label, value, href }: { label: string; value: string | null; href?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard unavailable — the text is still selectable
    }
  }
  return (
    <div>
      <div className="label" style={{ marginBottom: 10, color: 'var(--ghost)' }}>
        {label}
        {copied ? <span className="green"> · copied</span> : null}
      </div>
      {value ? (
        href ? (
          <Link href={href} className="hash" style={{ color: 'var(--mute)' }} title="open">
            {value}
          </Link>
        ) : (
          <button onClick={copy} className="hash" style={{ textAlign: 'left', cursor: 'copy' }} title="copy">
            {value}
          </button>
        )
      ) : (
        <span className="hash">none — first in chain</span>
      )}
    </div>
  )
}
