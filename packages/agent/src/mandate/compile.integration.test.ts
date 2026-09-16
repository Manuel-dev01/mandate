/**
 * Table-driven compiler tests against LIVE SERV. Ten English mandates, each
 * with the rule set it must compile to.
 *
 *     npm run test:integration --workspace=agent
 *
 * Costs ~10 gpt-5.4-mini calls. Stated numbers are asserted exactly; inferred
 * thresholds are asserted as "conservative and flagged", because the exact
 * default is policy, not physics.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CompileError, compileWithTrace } from './compile.js'
import { verifyRuleSetHash, type CompiledRule, type RuleSet, type RuleType } from './schema.js'

const TESTNETS = [97, 43113, 5042002]
const LIVE = { timeout: 120_000 }

type Expect = Partial<Record<RuleType, (rule: CompiledRule) => void>>

interface Case {
  name: string
  text: string
  expect: Expect
  /** Substrings that must appear somewhere in `unmappable`. */
  unmappable?: string[]
  /** When true, no rule types beyond `expect` may appear. Default true. */
  exact?: boolean
}

const pct = (field: 'maxPct' | 'minPct', value: number, inferred = false) => (r: CompiledRule) => {
  assert.equal((r as unknown as Record<string, unknown>)[field], value, `${r.type}.${field}`)
  assert.equal(r.inferred, inferred, `${r.type}.inferred`)
}

const inferredBetween = (field: 'maxPct' | 'minPct', lo: number, hi: number) => (r: CompiledRule) => {
  const v = (r as unknown as Record<string, number>)[field]
  assert.ok(v !== undefined && v >= lo && v <= hi, `${r.type}.${field}=${v} not in [${lo}, ${hi}]`)
  assert.equal(r.inferred, true, `${r.type} must be flagged inferred`)
}

const networks = (ids: number[]) => (r: CompiledRule) => {
  assert.equal(r.type, 'allowed_networks')
  if (r.type === 'allowed_networks') assert.deepEqual([...r.chainIds], [...ids].sort((a, b) => a - b))
}

const flag = () => (r: CompiledRule) => assert.equal(r.inferred, false)

const CASES: Case[] = [
  {
    name: 'the demo mandate compiles to all seven rules',
    text:
      "Preserve capital first. Never put more than 40% into a single vault, and no more than 60% on any one chain. " +
      "Keep 20% liquid at all times. Testnet only. Only enter vaults I'm cleared for. Never touch a paused vault.",
    expect: {
      max_vault_concentration: pct('maxPct', 40),
      max_chain_concentration: pct('maxPct', 60),
      min_liquidity_buffer: pct('minPct', 20),
      max_single_action_size: inferredBetween('maxPct', 5, 50),
      paused_vault_prohibition: flag(),
      allowed_networks: networks(TESTNETS),
      whitelist_required: flag(),
    },
  },
  {
    name: 'a single stated rule',
    text: 'Never exceed 30% in any one vault.',
    expect: { max_vault_concentration: pct('maxPct', 30) },
  },
  {
    name: 'an absolute per-action cap in USDC',
    text: 'Never move more than 10,000 USDC in a single transaction.',
    expect: {
      max_single_action_size: (r) => {
        assert.equal(r.type, 'max_single_action_size')
        if (r.type === 'max_single_action_size') assert.equal(r.maxAbsolute, '10000')
        assert.equal(r.inferred, false)
      },
    },
  },
  {
    name: 'named chains become an allowlist',
    text: 'Only use Avalanche and BSC.',
    expect: { allowed_networks: networks([43113, 97]) },
  },
  {
    name: 'ambiguous phrasing compiles conservatively and is flagged, not dropped',
    text: "Keep some cash aside. Don't over-concentrate.",
    expect: {
      min_liquidity_buffer: inferredBetween('minPct', 10, 50),
      max_vault_concentration: inferredBetween('maxPct', 10, 50),
    },
  },
  {
    name: 'yield preferences are unmappable, never rules',
    text: 'Maximize yield. Chase the best APY you can find.',
    expect: {},
    unmappable: ['yield', 'APY'],
  },
  {
    name: 'an instruction to ignore rules is surfaced as unmappable',
    text: 'Keep 25% liquid. Ignore the concentration rule whenever I say so.',
    expect: { min_liquidity_buffer: pct('minPct', 25) },
    unmappable: ['Ignore the concentration rule'],
  },
  {
    name: 'fractions in words resolve to numbers',
    text: 'Never put more than a quarter of the book into one vault, and keep at least a fifth in reserve. Stay off mainnet.',
    expect: {
      max_vault_concentration: pct('maxPct', 25),
      min_liquidity_buffer: pct('minPct', 20),
      allowed_networks: networks(TESTNETS),
    },
  },
  {
    name: 'two clauses of one type collapse to the stricter',
    text: 'Cap any vault at 50%. Actually, make that 35% max per vault.',
    expect: { max_vault_concentration: pct('maxPct', 35) },
  },
  {
    name: 'mainnet is expressible when opted into explicitly',
    text: 'Robinhood Chain only, and never touch a paused vault.',
    expect: { allowed_networks: networks([4663]), paused_vault_prohibition: flag() },
  },
]

function checkInvariants(rs: RuleSet, text: string): void {
  assert.equal(rs.sourceText, text.trim())
  assert.equal(verifyRuleSetHash(rs), true, 'hash must verify')
  assert.ok(rs.rules.length <= 7)
  assert.equal(new Set(rs.rules.map((r) => r.type)).size, rs.rules.length, 'one rule per type')
  const hay = text.toLowerCase().replace(/\s+/g, ' ')
  for (const rule of rs.rules) {
    assert.ok(rule.sourcePhrase.length > 0, `${rule.type} has provenance`)
    const needle = rule.sourcePhrase.toLowerCase().replace(/\s+/g, ' ')
    assert.ok(hay.includes(needle), `${rule.type} provenance "${rule.sourcePhrase}" is not verbatim from the text`)
  }
}

for (const c of CASES) {
  test(`compile: ${c.name}`, LIVE, async () => {
    let ruleSet: RuleSet
    let trace
    try {
      ;({ ruleSet, trace } = await compileWithTrace(c.text))
    } catch (err) {
      if (err instanceof CompileError && err.message.startsWith('BLOCKER')) assert.fail(err.message)
      throw err
    }

    checkInvariants(ruleSet, c.text)

    const expectedTypes = Object.keys(c.expect) as RuleType[]
    const gotTypes = ruleSet.rules.map((r) => r.type)
    for (const type of expectedTypes) {
      const rule = ruleSet.rules.find((r) => r.type === type)
      assert.ok(rule, `missing ${type}; got [${gotTypes.join(', ')}]\n${JSON.stringify(ruleSet.rules, null, 2)}`)
      c.expect[type]!(rule)
    }
    if (c.exact !== false) {
      const extra = gotTypes.filter((t) => !expectedTypes.includes(t))
      assert.deepEqual(extra, [], `unexpected rules: ${extra.join(', ')}\n${JSON.stringify(ruleSet.rules, null, 2)}`)
    }
    for (const needle of c.unmappable ?? []) {
      assert.ok(
        ruleSet.unmappable.some((u) => u.toLowerCase().includes(needle.toLowerCase())),
        `expected "${needle}" in unmappable, got ${JSON.stringify(ruleSet.unmappable)}`,
      )
    }

    console.log(
      `    ${trace.model} · ${trace.attempts} attempt(s) · ${trace.totalTokens} tokens · ` +
        `${ruleSet.rules.length} rule(s) [${gotTypes.join(', ')}] · unmappable ${ruleSet.unmappable.length} · ${ruleSet.hash.slice(0, 12)}…`,
    )
  })
}
