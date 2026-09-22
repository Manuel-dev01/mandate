import { apiText } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** Streams the agent's byte-stable Markdown report as a download. D9 puts the x402 step in front of this. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const res = await apiText(`/receipts/${encodeURIComponent(id)}/report`)
  if (!res.ok) return new Response(`report unavailable: ${res.reason}`, { status: res.status ?? 502, headers: { 'Content-Type': 'text/plain' } })
  return new Response(res.data, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="mandate-receipt-${id.slice(0, 12)}.md"`,
      'Cache-Control': 'no-store',
    },
  })
}
