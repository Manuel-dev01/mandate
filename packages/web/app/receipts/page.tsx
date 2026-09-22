import { redirect } from 'next/navigation'
import { api, type StatsView } from '@/lib/api'
import { NoReceipts, PageHead, Unreachable } from '@/components/panels'

export const dynamic = 'force-dynamic'

/** "Decision" in the nav: the newest receipt, in full. */
export default async function LatestReceipt() {
  const stats = await api<StatsView>('/stats')
  if (stats.ok && stats.data.head) redirect(`/receipts/${stats.data.head}`)
  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <PageHead kicker="Decision" title={stats.ok ? 'No decisions yet' : 'Unreachable'} />
      {stats.ok ? <NoReceipts /> : <Unreachable reason={stats.reason} checkedAt={stats.checkedAt} />}
    </div>
  )
}
