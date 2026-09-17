/**
 * Deterministic half of the compiler — no network, no SERV, no tokens.
 * Everything here must give the same answer every run.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { anchorPhrase, expandNetworks, normalizeAbsolute, postprocess, resolveNetworks, splitSentences } from './compile.js'
import {
  RULE_TYPES,
  RuleSchema,
  RuleSetSchema,
  buildRuleSet,
  canonicalJson,
  hashRuleSet,
  stricter,
  verifyRuleSetHash,
  type CompiledRule,
  type Rule,
} from './schema.js'

const DEMO_TEXT =
  "Preserve capital first. Never put more than 40% into a single vault, and no more than 60% on any one chain. " +
  "Keep 20% liquid at all times. Testnet only. Only enter vaults I'm cleared for. Never touch a paused vault."

// ------------------------------------------------------------------ schema

test('exactly seven rule types, and the schema rejects an eighth', () => {
  assert.equal(RULE_TYPES.length, 7)
  const eighth = RuleSchema.safeParse({ type: 'min_holding_period', days: 30 })
  assert.equal(eighth.success, false)
})

test('max_single_action_size needs at least one bound', () => {
  assert.equal(RuleSchema.safeParse({ type: 'max_single_action_size', maxPct: null, maxAbsolute: null }).success, false)
  assert.equal(RuleSchema.safeParse({ type: 'max_single_action_size', maxPct: 25, maxAbsolute: null }).success, true)
  assert.equal(RuleSchema.safeParse({ type: 'max_single_action_size', maxPct: null, maxAbsolute: '10000' }).success, true)
})

test('percentages must be in (0, 100]; unknown keys are rejected', () => {
  assert.equal(RuleSchema.safeParse({ type: 'max_vault_concentration', maxPct: 0 }).success, false)
  assert.equal(RuleSchema.safeParse({ type: 'max_vault_concentration', maxPct: 101 }).success, false)
  assert.equal(RuleSchema.safeParse({ type: 'max_vault_concentration', maxPct: 40, extra: 1 }).success, false)
})

test('allowed_networks dedupes and sorts chain ids', () => {
  const r = RuleSchema.parse({ type: 'allowed_networks', chainIds: [97, 43113, 97] })
  assert.equal(r.type, 'allowed_networks')
  if (r.type === 'allowed_networks') assert.deepEqual([...r.chainIds], [97, 43113])
})

test('rule set: one rule per type', () => {
  const dup = {
    version: 1,
    hash: 'a'.repeat(64),
    sourceText: 'x',
    rules: [
      { type: 'min_liquidity_buffer', minPct: 20, sourcePhrase: 'a', inferred: false },
      { type: 'min_liquidity_buffer', minPct: 30, sourcePhrase: 'b', inferred: false },
    ],
    unmappable: [],
    compiledAt: new Date().toISOString(),
    model: 'test',
  }
  assert.equal(RuleSetSchema.safeParse(dup).success, false)
})

// -------------------------------------------------------------------- hash

test('canonicalJson is key-order independent', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } }), canonicalJson({ a: { c: [{ y: 2, z: 1 }], d: 2 }, b: 1 }))
})

test('hash covers content only; timestamps and model do not move it', () => {
  const rules: CompiledRule[] = [{ type: 'min_liquidity_buffer', minPct: 20, sourcePhrase: 'Keep 20% liquid', inferred: false }]
  const a = buildRuleSet({ version: 1, sourceText: 'Keep 20% liquid', rules, unmappable: [], model: 'm1', compiledAt: '2026-09-15T00:00:00.000Z' })
  const b = buildRuleSet({ version: 1, sourceText: 'Keep 20% liquid', rules, unmappable: [], model: 'm2', compiledAt: '2026-09-16T00:00:00.000Z' })
  assert.equal(a.hash, b.hash)
  assert.match(a.hash, /^[0-9a-f]{64}$/)
  assert.equal(verifyRuleSetHash(a), true)

  const c = buildRuleSet({ version: 2, sourceText: 'Keep 20% liquid', rules, unmappable: [], model: 'm1' })
  assert.notEqual(a.hash, c.hash, 'version is part of the content')
  const d = buildRuleSet({ version: 1, sourceText: 'Keep 20% liquid', rules, unmappable: ['maximize yield'], model: 'm1' })
  assert.notEqual(a.hash, d.hash, 'unmappable is part of the content')
})

test('a tampered rule set fails hash verification', () => {
  const rs = buildRuleSet({
    version: 1,
    sourceText: 'Never exceed 40%',
    rules: [{ type: 'max_vault_concentration', maxPct: 40, sourcePhrase: 'Never exceed 40%', inferred: false }],
    unmappable: [],
    model: 'm',
  })
  const tampered = { ...rs, rules: [{ ...rs.rules[0]!, maxPct: 90 }] } as typeof rs
  assert.equal(hashRuleSet(tampered) === rs.hash, false)
})

// ------------------------------------------------------------------- merge

test('stricter() picks the conservative reading per type', () => {
  // Omit<> over a discriminated union collapses it; go through Rule instead.
  const p = (r: Rule, inferred = false): CompiledRule => ({ ...r, sourcePhrase: 's', inferred })

  assert.equal((stricter(p({ type: 'max_vault_concentration', maxPct: 40 }), p({ type: 'max_vault_concentration', maxPct: 30 })) as { maxPct: number }).maxPct, 30)
  assert.equal((stricter(p({ type: 'min_liquidity_buffer', minPct: 10 }), p({ type: 'min_liquidity_buffer', minPct: 25 })) as { minPct: number }).minPct, 25)

  const action = stricter(
    p({ type: 'max_single_action_size', maxPct: 25, maxAbsolute: null }),
    p({ type: 'max_single_action_size', maxPct: null, maxAbsolute: '10000' }),
  ) as { maxPct: number | null; maxAbsolute: string | null }
  assert.deepEqual([action.maxPct, action.maxAbsolute], [25, '10000'], 'both bounds survive a merge')

  const abs = stricter(
    p({ type: 'max_single_action_size', maxPct: null, maxAbsolute: '2500.5' }),
    p({ type: 'max_single_action_size', maxPct: null, maxAbsolute: '10000' }),
  ) as { maxAbsolute: string | null }
  assert.equal(abs.maxAbsolute, '2500.5', 'decimal strings compared without floats')

  const nets = stricter(
    p({ type: 'allowed_networks', chainIds: [43113, 97, 5042002] }),
    p({ type: 'allowed_networks', chainIds: [97, 4663] }),
  ) as { chainIds: readonly number[]; inferred: boolean }
  assert.deepEqual([...nets.chainIds], [97], 'allowlists intersect')
  assert.equal(nets.inferred, false)

  const contradiction = stricter(
    p({ type: 'allowed_networks', chainIds: [43113] }),
    p({ type: 'allowed_networks', chainIds: [4663] }),
  ) as { chainIds: readonly number[]; inferred: boolean }
  assert.equal(contradiction.chainIds.length, 1)
  assert.equal(contradiction.inferred, true, 'an empty intersection is flagged, not silently allowed')
})

// -------------------------------------------------------------- provenance

test('anchorPhrase returns the source text verbatim, tolerant of case/whitespace/quotes', () => {
  const exact = anchorPhrase(DEMO_TEXT, 'never put more than 40% into a single vault')
  assert.equal(exact.verbatim, true)
  assert.equal(exact.phrase, 'Never put more than 40% into a single vault')

  const quoted = anchorPhrase(DEMO_TEXT, '"Keep 20%   liquid at all times."')
  assert.equal(quoted.verbatim, true)
  assert.equal(quoted.phrase, 'Keep 20% liquid at all times')

  const apostrophe = anchorPhrase(DEMO_TEXT, "Only enter vaults I'm cleared for.")
  assert.equal(apostrophe.verbatim, true)
})

test('anchorPhrase falls back to the best sentence and flags it', () => {
  const para = anchorPhrase(DEMO_TEXT, 'do not deposit into paused vaults')
  assert.equal(para.verbatim, false)
  assert.equal(para.phrase, 'Never touch a paused vault.')

  const nothing = anchorPhrase(DEMO_TEXT, 'zzz qqq')
  assert.equal(nothing.verbatim, false)
  assert.equal(nothing.phrase, 'zzz qqq')
})

test('splitSentences handles periods, semicolons and newlines', () => {
  assert.deepEqual(splitSentences('A first. B second; C third\nD fourth'), ['A first.', 'B second;', 'C third', 'D fourth'])
})

// ----------------------------------------------------------- normalizers

test('normalizeAbsolute parses money strings without floats', () => {
  assert.equal(normalizeAbsolute('10,000 USDC'), '10000')
  assert.equal(normalizeAbsolute('$10k'), '10000')
  assert.equal(normalizeAbsolute('2.5k'), '2500')
  assert.equal(normalizeAbsolute('1.5M'), '1500000')
  assert.equal(normalizeAbsolute('0.000001'), '0.000001')
  assert.equal(normalizeAbsolute('12.3456789'), '12.345678', 'truncated to 6dp')
  assert.equal(normalizeAbsolute('lots'), null)
  assert.equal(normalizeAbsolute(null), null)
})

test('expandNetworks maps tokens to chain ids in canonical order', () => {
  assert.deepEqual(expandNetworks(['all-testnets']), [97, 43113, 5042002])
  assert.deepEqual(expandNetworks(['robinhood-mainnet', 'avalanche-testnet']), [4663, 43113])
  assert.deepEqual(expandNetworks(['all-mainnets', 'all-testnets']), [97, 4663, 43113, 5042002])
  assert.deepEqual(expandNetworks([]), [])
})

test('resolveNetworks: exclusions are complemented in code, never by the model', () => {
  assert.deepEqual(resolveNetworks([], ['all-mainnets']), [97, 43113, 5042002], '"stay off mainnet"')
  assert.deepEqual(resolveNetworks([], ['robinhood-mainnet']), [97, 43113, 5042002])
  assert.deepEqual(resolveNetworks(['all-testnets'], ['bsc-testnet']), [43113, 5042002], 'allow minus deny')
  assert.deepEqual(resolveNetworks(['robinhood-mainnet'], []), [4663])
  assert.deepEqual(resolveNetworks([], []), [], 'nothing named -> unmappable upstream')
})

// ------------------------------------------------------------- postprocess

test('postprocess is deterministic: same model output, same rules, DSL order', () => {
  const llm = {
    rules: [
      { type: 'whitelist_required' as const, pct: null, absolute: null, networks: [], deniedNetworks: [], sourcePhrase: "Only enter vaults I'm cleared for", inferred: false },
      { type: 'max_vault_concentration' as const, pct: 40, absolute: null, networks: [], deniedNetworks: [], sourcePhrase: 'Never put more than 40% into a single vault', inferred: false },
      { type: 'allowed_networks' as const, pct: null, absolute: null, networks: ['all-testnets' as const], deniedNetworks: [], sourcePhrase: 'Testnet only', inferred: false },
      // Duplicate type, looser: must lose to the 40% above.
      { type: 'max_vault_concentration' as const, pct: 55, absolute: null, networks: [], deniedNetworks: [], sourcePhrase: 'no more than 60% on any one chain', inferred: true },
      // Missing number for a numeric type: goes to unmappable, never dropped.
      { type: 'min_liquidity_buffer' as const, pct: null, absolute: null, networks: [], deniedNetworks: [], sourcePhrase: 'Keep 20% liquid at all times', inferred: false },
    ],
    unmappable: ['  maximize yield  ', ''],
  }
  const a = postprocess(DEMO_TEXT, llm)
  const b = postprocess(DEMO_TEXT, llm)
  assert.deepEqual(a, b)

  assert.deepEqual(
    a.rules.map((r) => r.type),
    // max_single_action_size is the code-enforced default for "Preserve capital first."
    ['max_vault_concentration', 'max_single_action_size', 'allowed_networks', 'whitelist_required'],
    'DSL order regardless of model order',
  )
  const conc = a.rules[0] as { maxPct: number; inferred: boolean }
  assert.equal(conc.maxPct, 40)
  assert.equal(conc.inferred, false)
  const nets = a.rules.find((r) => r.type === 'allowed_networks') as { chainIds: readonly number[] }
  assert.deepEqual([...nets.chainIds], [97, 43113, 5042002])
  assert.equal(a.unmappable.length, 2)
  assert.ok(a.unmappable.includes('maximize yield'))
  assert.ok(a.unmappable.some((u) => u.startsWith('Keep 20% liquid at all times (')), 'dropped rule is explained')
})

test('postprocess ignores a model "inferred" flag on threshold-less types', () => {
  const { rules } = postprocess(DEMO_TEXT, {
    rules: [{ type: 'allowed_networks', pct: null, absolute: null, networks: ['all-testnets'], deniedNetworks: [], sourcePhrase: 'Testnet only', inferred: true }],
    unmappable: [],
  })
  const nets = rules.find((r) => r.type === 'allowed_networks')
  assert.equal(nets?.inferred, false, 'a chain list is an expansion, not an inferred threshold')
})

test('postprocess enforces the capital-preservation default when the model skips it', () => {
  const none = { rules: [], unmappable: ['Preserve capital first.'] }
  const { rules, unmappable } = postprocess(DEMO_TEXT, none)
  assert.equal(rules.length, 1)
  const r = rules[0] as { type: string; maxPct: number | null; inferred: boolean; sourcePhrase: string }
  assert.equal(r.type, 'max_single_action_size')
  assert.equal(r.maxPct, 25)
  assert.equal(r.inferred, true)
  assert.equal(r.sourcePhrase, 'Preserve capital first', 'anchored like the model path, so the hash is path-independent')
  assert.deepEqual(unmappable, [], 'the clause is no longer unmappable once it is a rule')

  // A stated single-action number always wins over the default.
  const stated = postprocess('Preserve capital first. Never move more than 10% at once.', {
    rules: [{ type: 'max_single_action_size', pct: 10, absolute: null, networks: [], deniedNetworks: [], sourcePhrase: 'Never move more than 10% at once', inferred: false }],
    unmappable: [],
  })
  const s = stated.rules[0] as { maxPct: number | null; inferred: boolean }
  assert.equal(s.maxPct, 10)
  assert.equal(s.inferred, false)

  // No caution phrase, no rule invented.
  assert.equal(postprocess('Keep 20% liquid at all times.', { rules: [], unmappable: [] }).rules.length, 0)
})

test('postprocess flags a paraphrased sourcePhrase as inferred', () => {
  const { rules } = postprocess(DEMO_TEXT, {
    rules: [{ type: 'paused_vault_prohibition', pct: null, absolute: null, networks: [], deniedNetworks: [], sourcePhrase: 'avoid paused vaults', inferred: false }],
    unmappable: [],
  })
  const paused = rules.find((r) => r.type === 'paused_vault_prohibition')
  assert.equal(paused?.sourcePhrase, 'Never touch a paused vault.')
  assert.equal(paused?.inferred, true)
})
