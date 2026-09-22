'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/chain', label: 'Chain', match: (p) => p === '/chain' },
  { href: '/receipts', label: 'Decision', match: (p) => p.startsWith('/receipts') },
  { href: '/mandate', label: 'Mandate', match: (p) => p === '/mandate' },
  { href: '/vaults', label: 'Vaults', match: (p) => p === '/vaults' },
  { href: '/export', label: 'Export', match: (p) => p.startsWith('/export') },
]

export function Nav() {
  const path = usePathname() ?? '/'
  return (
    <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase' }}>
      {ITEMS.map((it) => {
        const on = it.match(path)
        return (
          <Link key={it.href} href={it.href} style={{ color: on ? 'var(--ink)' : 'var(--dim)' }}>
            {it.label}
            {on ? ' ·' : ''}
          </Link>
        )
      })}
    </nav>
  )
}
