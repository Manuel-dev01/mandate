import type { ReactNode } from 'react'

/** Re-mounts on every navigation, so each page enters with the same fade-rise. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>
}
