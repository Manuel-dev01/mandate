import { redirect } from 'next/navigation'
import { api, type StatsView } from '@/lib/api'
import { NoReceipts, PageHead, Unreachable } from '@/components/panels'

export const dynamic = 'force-dynamic'

export default async function ExportIndex() {
  const stats = await api<StatsView>('/stats')
  if (stats.ok && stats.data.head) redirect(`/export/${stats.data.head}`)
  return (
    <div className="wrap" style={{ padding: '64px var(--gutter) 96px' }}>
      <PageHead kicker="Export audit report" title={stats.ok ? 'Nothing to export yet' : 'Unreachable'} />
      {stats.ok ? <NoReceipts /> : <Unreachable reason={stats.reason} checkedAt={stats.checkedAt} />}
    </div>
  )
}
