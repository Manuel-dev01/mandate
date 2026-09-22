'use server'

import { api, type ApiResult, type VerifyView } from '@/lib/api'

/** Verify + replay run in the agent (pure functions over the stored receipt); the console only relays. */
export async function verifyAndReplay(id: string): Promise<ApiResult<VerifyView>> {
  return api<VerifyView>(`/receipts/${encodeURIComponent(id)}/verify`)
}
