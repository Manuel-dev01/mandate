/**
 * The disk tier of the last-good cache: what a cold process degrades to.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LastGood } from './index.js'
import { parseWithBigint, stringifyWithBigint } from './schemas.js'

interface Thing {
  name: string
  amount: bigint
  nested: { shares: bigint; note: string | null }
}

const THING: Thing = { name: 'IXHYB - BSC', amount: 11_373_029_684n, nested: { shares: 4_598_170_479_929_445_672_155n, note: null } }

test('bigint JSON round-trips exactly, including nested and null', () => {
  const text = stringifyWithBigint(THING)
  assert.ok(text.includes('"$bigint":"11373029684"'))
  assert.deepEqual(parseWithBigint<Thing>(text), THING)
  assert.equal(typeof parseWithBigint<Thing>(text).nested.shares, 'bigint')
})

test('a fresh process degrades to the disk snapshot with the original fetchedAt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mandate-snap-'))
  try {
    const warm = new LastGood<Thing>('state', { dir })
    const live = await warm.serve('state:bsc', async () => THING)
    assert.equal(live.source, 'live')
    assert.equal(live.stale, false)
    assert.equal(readdirSync(dir).length, 1, 'snapshot written')

    // A brand-new instance = a cold process. IXS is down.
    const cold = new LastGood<Thing>('state', { dir })
    const served = await cold.serve('state:bsc', async () => {
      throw new Error('IXS MCP tools/call timed out after 30000ms')
    })
    assert.equal(served.source, 'disk')
    assert.equal(served.stale, true)
    assert.equal(served.fetchedAt, live.fetchedAt)
    assert.equal(served.error, 'IXS MCP tools/call timed out after 30000ms')
    assert.deepEqual(served.data, THING)
    assert.equal(typeof served.data.amount, 'bigint', 'bigints survive the disk')

    // Second miss in the same process comes from memory now.
    const again = await cold.serve('state:bsc', async () => {
      throw new Error('still down')
    })
    assert.equal(again.source, 'memory')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt snapshot is not a fallback: the live error propagates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mandate-snap-'))
  try {
    writeFileSync(join(dir, 'state.state_bsc.json'), '{ not json')
    const cold = new LastGood<Thing>('state', { dir })
    await assert.rejects(
      () =>
        cold.serve('state:bsc', async () => {
          throw new Error('IXS down')
        }),
      /IXS down/,
    )
    writeFileSync(join(dir, 'state.state_bsc.json'), JSON.stringify({ fetchedAt: 'x' })) // no data
    await assert.rejects(() => cold.serve('state:bsc', async () => { throw new Error('IXS down') }), /IXS down/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no snapshot dir means memory only', async () => {
  const mem = new LastGood<Thing>('state', { dir: null })
  await mem.serve('k', async () => THING)
  const fresh = new LastGood<Thing>('state', { dir: null })
  await assert.rejects(() => fresh.serve('k', async () => { throw new Error('down') }), /down/)
})

test('clear() removes the files it wrote and nothing else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mandate-snap-'))
  try {
    writeFileSync(join(dir, 'other.json'), '{}')
    const c = new LastGood<Thing>('state', { dir })
    await c.serve('a', async () => THING)
    await c.serve('b', async () => THING)
    assert.equal(readdirSync(dir).length, 3)
    c.clear()
    assert.deepEqual(readdirSync(dir), ['other.json'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
