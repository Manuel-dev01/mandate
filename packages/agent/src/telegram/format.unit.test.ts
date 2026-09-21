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

  it('bolds the headline, monospaces hashes and rule types, italicises clauses', () => {
    const html = toTelegramHtml(
      [
        'REFUSED — deposit 50,000 USDC into IXHYB - BSC (bsc-testnet)',
        '✗ max_vault_concentration: 70.00% vs 40.00% — "Never put more than 40% into a single vault"',
        'Receipt f46d51cba9f9 · mandate c47687db · decision 07176c6f',
        'Portfolio: declared. Vault facts: live.',
      ].join('\n'),
    )
    const lines = html.split('\n')
    assert.equal(lines[0], '<b>REFUSED — deposit 50,000 USDC into IXHYB - BSC (bsc-testnet)</b>')
    assert.ok(lines[1]!.includes('<code>max_vault_concentration</code>'))
    assert.ok(lines[1]!.includes('"<i>Never put more than 40% into a single vault</i>"'))
    assert.ok(lines[2]!.includes('<b>Receipt</b> <code>f46d51cba9f9</code>'))
    assert.ok(lines[3]!.startsWith('<b>Portfolio</b>:'))
  })

  it('never alters the numbers or the words', () => {
    const plain = 'ALLOWED — deposit 5,000 USDC into IXHYB - BSC (bsc-testnet)\n✓ min_liquidity_buffer: 60.00% vs 20.00%\nThis deposit would be 44.98% of the vault\'s TVL.'
    const stripped = toTelegramHtml(plain).replace(/<\/?(b|i|code)>/g, '')
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
