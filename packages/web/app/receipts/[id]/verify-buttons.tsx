'use client'

import { useState, useTransition } from 'react'
import type { ApiResult, VerifyView } from '@/lib/api'
import { verifyAndReplay } from './actions'

export function VerifyButtons({ id }: { id: string }) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<ApiResult<VerifyView> | null>(null)
  const [mode, setMode] = useState<'verify' | 'replay' | null>(null)

  const run = (m: 'verify' | 'replay') => {
    setMode(m)
    start(async () => setResult(await verifyAndReplay(id)))
  }

  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'end' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={`btn sm${pending && mode === 'verify' ? ' checking' : ''}`} onClick={() => run('verify')} disabled={pending}>
          {pending && mode === 'verify' ? 'Verifying…' : 'Verify'}
        </button>
        <button className={`btn sm muted${pending && mode === 'replay' ? ' checking' : ''}`} onClick={() => run('replay')} disabled={pending}>
          {pending && mode === 'replay' ? 'Replaying…' : 'Replay'}
        </button>
      </div>
      {result ? (
        <div key={`${mode}-${result.checkedAt}`} className="result-in">
          <Result r={result} mode={mode ?? 'verify'} />
        </div>
      ) : null}
    </div>
  )
}

function Result({ r, mode }: { r: ApiResult<VerifyView>; mode: 'verify' | 'replay' }) {
  if (!r.ok) {
    return <div className="label-sm amber">Agent unreachable — {r.reason}</div>
  }
  if (mode === 'verify') {
    const v = r.data.verify
    return (
      <div style={{ textAlign: 'right', fontSize: 11, letterSpacing: '.08em' }}>
        <div className={v.ok ? 'green' : 'red'}>{v.ok ? 'VERIFIED — every hash re-derives' : 'FAILED'}</div>
        <div className="ghost" style={{ marginTop: 6 }}>
          {v.checks.map((c) => (
            <div key={c.name} className={c.ok ? undefined : 'red'}>
              {c.ok ? '✓' : '✗'} {c.name} · {c.detail}
            </div>
          ))}
        </div>
      </div>
    )
  }
  const p = r.data.replay
  return (
    <div style={{ textAlign: 'right', fontSize: 11, letterSpacing: '.08em' }}>
      <div className={p.reproduced ? 'green' : 'red'}>{p.reproduced ? 'REPRODUCED — identical verdict, identical hash' : `NOT REPRODUCED — ${p.diff ?? 'unknown'}`}</div>
      <div className="ghost" style={{ marginTop: 6 }}>
        evaluator re-run on the stored inputs · {p.replayVerdict} · {p.replayHash.slice(0, 12)} vs {p.originalHash.slice(0, 12)}
      </div>
    </div>
  )
}
