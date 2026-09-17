/**
 * Receipt CLI.
 *
 *   npm run receipt --workspace=agent -- list [--verdict REFUSE] [--limit 20]
 *   npm run receipt --workspace=agent -- show <id>
 *   npm run receipt --workspace=agent -- verify <id|all>
 *   npm run receipt --workspace=agent -- replay <id>
 *   npm run receipt --workspace=agent -- export <id> [--out file.md]
 *
 * <id> may be any unique prefix.
 */

import { writeFileSync } from 'node:fs'
import { receiptStore, renderReport, replayReceipt, verifyReceipt } from '../audit/index.js'
import { formatBaseUnits } from '../ixs/schemas.js'

const [cmd, arg, ...rest] = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`)
  return i === -1 ? undefined : rest[i + 1]
}
const store = receiptStore()

function resolveOrExit(prefix: string | undefined): string {
  if (!prefix) {
    console.error('receipt id required')
    process.exit(1)
  }
  const id = store.resolve(prefix)
  if (!id) {
    console.error(`no unique receipt matches "${prefix}"`)
    process.exit(1)
  }
  return id
}

function main(): number {
  switch (cmd) {
    case 'list': {
      const verdict = flag('verdict') as 'ALLOW' | 'REFUSE' | undefined
      const entries = store.list({ limit: Number(flag('limit') ?? 20), ...(verdict ? { verdict } : {}) })
      if (entries.length === 0) {
        console.log(`no receipts in ${store.dir}`)
        return 0
      }
      for (const e of entries) {
        console.log(`${e.id.slice(0, 12)}  ${e.createdAt}  ${e.verdict.padEnd(6)}  ${e.kind} ${formatBaseUnits(BigInt(e.amount), 6)}  ${e.vaultId}  ${e.network}  [${e.portfolioSource}]`)
      }
      console.log(`\n${entries.length} shown · head ${store.head()?.slice(0, 12) ?? 'none'} · ${store.dir}`)
      return 0
    }
    case 'show': {
      const r = store.get(resolveOrExit(arg))
      console.log(JSON.stringify(r, null, 2))
      return 0
    }
    case 'verify': {
      if (arg === 'all') {
        const v = store.verifyChain()
        console.log(`${v.count} receipt(s) · chain ${v.ok ? 'OK' : 'BROKEN'}`)
        for (const p of v.problems) console.log(`  ${p.id.slice(0, 12)}  ${p.problem}`)
        return v.ok ? 0 : 3
      }
      const r = store.get(resolveOrExit(arg))!
      const v = verifyReceipt(r)
      for (const c of v.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(28)} ${c.detail}`)
      console.log(`\n${r.id}  ${v.ok ? 'VERIFIED' : 'TAMPERED OR CORRUPT'}`)
      return v.ok ? 0 : 3
    }
    case 'replay': {
      const r = store.get(resolveOrExit(arg))!
      const p = replayReceipt(r)
      console.log(`  original  ${p.verdict.padEnd(6)}  ${p.originalHash}`)
      console.log(`  replay    ${p.replayVerdict.padEnd(6)}  ${p.replayHash}`)
      console.log(`\n${p.reproduced ? 'REPRODUCED — identical verdict, identical hash' : `NOT REPRODUCED — first difference in "${p.diff}"`}`)
      return p.reproduced ? 0 : 3
    }
    case 'export': {
      const r = store.get(resolveOrExit(arg))!
      const md = renderReport(r)
      const out = flag('out')
      if (out) {
        writeFileSync(out, md)
        console.log(`wrote ${out} (${md.length} bytes)`)
      } else {
        console.log(md)
      }
      return 0
    }
    default:
      console.error('usage: receipt <list|show|verify|replay|export> [id] [--verdict ALLOW|REFUSE] [--limit n] [--out file]')
      return 1
  }
}

process.exit(main())
