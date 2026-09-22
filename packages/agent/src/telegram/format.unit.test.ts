import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { chunkLines, escapeHtml, prettyAmount, toTelegramHtml } from './format.js'

describe('prettyAmount', () => {
  it('trims trailing zeros and groups thousands', () => {
    assert.equal(prettyAmount(5_000_000_000n, 6), '5,000')
    assert.equal(prettyAmount(50_000_000_000n, 6), '50,000')
    assert.equal(prettyAmount(1_234_500_000n, 6), '1,234.5')
    assert.equal(prettyAmount(5000n, 6), '0.005')
    assert.equal(prettyAmount(0n, 6), '0')
    assert.equal(prettyAmount(-2_500_000n, 6), '-2.5')
    assert.equal(prettyAmount(123456789012345678901234n, 18), '123,456.789012345678901234')
  })
})

describe('toTelegramHtml', () => {
  it('escapes user-controlled text before adding markup', () => {
    assert.equal(escapeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d')
    const html = toTelegramHtml('Mandate v1\n• "<script>&"')
    assert.ok(html.includes('&lt;script&gt;&amp;'))
    assert.ok(!html.includes('<script>'))
  })

  it('bolds the headline, italicises clauses, and only styles what leads somewhere', () => {
    const html = toTelegramHtml(
      [
        'REFUSED — deposit 50,000 USDC into IXHYB - BSC (bsc-testnet)',
        '✗ Vault concentration — 70.00% · limit 40.00% — "Never put more than 40% into a single vault"',
        'Receipt f46d51cba9f9 · mandate c47687db · decision 07176c6f',
        'Portfolio: declared. Vault facts: live.',
        'Why: max_vault_concentration was breached.',
      ].join('\n'),
    )
    const lines = html.split('\n')
    assert.equal(lines[0], '<b>REFUSED — deposit 50,000 USDC into IXHYB - BSC (bsc-testnet)</b>')
    assert.ok(lines[1]!.includes('"<i>Never put more than 40% into a single vault</i>"'))
    // A receipt id is a real link to the console; nothing else pretends to be one.
    assert.match(lines[2]!, /<b>Receipt<\/b> <a href="https?:\/\/[^"]+\/receipts\/f46d51cba9f9">f46d51cba9f9<\/a>/)
    assert.ok(lines[3]!.startsWith('<b>Portfolio</b>:'))
    assert.ok(!lines[4]!.includes('<code>'), 'rule types in prose are left plain — they link nowhere')
    assert.ok(!lines[4]!.includes('<a '), 'and are certainly not links')
  })

  it('a long hash stays copyable, and the href is never mangled by the quote rule', () => {
    const hash = 'c47687dbc30b57e53e8baca64cfb9bd31183ef1c162c71efb5647b3ffb1d40d8'
    const html = toTelegramHtml([`Mandate ${hash}`, 'say "receipt f46d51cba9f9" to verify and replay'].join('\n'))
    assert.ok(html.includes(`<code>${hash}</code>`), 'hashes are tap-to-copy, not fake links')
    assert.match(html, /<a href="https?:\/\/[^"<>]+">f46d51cba9f9<\/a>/, 'the href has no tags inside it')
    assert.equal((html.match(/<a /g) ?? []).length, (html.match(/<\/a>/g) ?? []).length, 'balanced anchors')
  })

  it('never alters the numbers or the words', () => {
    const plain = 'ALLOWED — deposit 5,000 USDC into IXHYB - BSC (bsc-testnet)\n✓ min_liquidity_buffer: 60.00% vs 20.00%\nThis deposit would be 44.98% of the vault\'s TVL.'
    const stripped = toTelegramHtml(plain).replace(/<\/?(b|i|code|a)(\s[^>]*)?>/g, '')
    assert.equal(stripped, escapeHtml(plain))
  })
})

describe('chunkLines', () => {
  it('splits on line boundaries only and keeps everything', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(40)}`)
    const chunks = chunkLines(lines.join('\n'), 1000)
    assert.ok(chunks.length > 1)
    for (const c of chunks) assert.ok(c.length <= 1000)
    assert.equal(chunks.join('\n'), lines.join('\n'))
    assert.deepEqual(chunkLines(''), [''])
  })
})
