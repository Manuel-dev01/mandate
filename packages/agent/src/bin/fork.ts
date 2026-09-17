/**
 * INTERNAL TEST HARNESS — NOT PART OF THE PRODUCT, NOT USED IN THE DEMO.
 * The user's decision (17 Sep): build only on what IXS gives access to. This
 * exists solely to exercise the dormant execute/ runner end to end.
 *
 * Local BSC-testnet fork with test USDC minted to the burner.
 *
 *   npm run fork --workspace=agent            # starts Anvil on :8546, mints 100,000 USDC, stays up
 *   npm run fork --workspace=agent -- 250000  # different amount
 *
 * Then, in another shell:
 *   FORK_RPC_URL=http://127.0.0.1:8546 EXECUTION_MODE=live npm run act --workspace=agent -- deposit 5000 --portfolio onchain
 *
 * Why this exists: the IXS test USDC (0xbBCa80a7…) has an owner-only mint and
 * no faucet (docs/RECON.md §6.9). On a fork we impersonate the owner. Every
 * contract, every byte of IXS-built calldata, and every settlement rule is the
 * real one; only the RPC is local. Every receipt produced this way is labelled
 * "(fork)" and can never pass for the real chain.
 *
 * Requires Foundry's `anvil` on PATH (https://getfoundry.sh).
 */

import { spawn } from 'node:child_process'
import { env } from '../env.js'
import { formatBaseUnits, parseDecimalAmount } from '../ixs/schemas.js'
import { createSigner } from '../signer/index.js'

const PORT = Number(process.env['FORK_PORT'] ?? 8546)
const UPSTREAM = process.env['BSC_TESTNET_RPC_URL'] ?? 'https://bsc-testnet-rpc.publicnode.com'
const RPC = `http://127.0.0.1:${PORT}`
const USDC = '0xbBCa80a7116aE46B0f249D279EF43f86274dc4f4'
const USDC_OWNER = '0xe8ea6365c329130fd47d4d1ca0ae59caf49fa9c4'
const VAULT = '0xCb09a5326AEFD705d14FF4C5ca2beD7086ba0Dcc'

const amountArg = process.argv[2] ?? '100000'
if (!/^\d+(\.\d{1,6})?$/.test(amountArg)) {
  console.error('usage: fork [usdcAmount]')
  process.exit(1)
}

let id = 0
async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
  const json = (await res.json()) as { result?: unknown; error?: { message?: string } }
  if (json.error) throw new Error(`${method}: ${json.error.message}`)
  return json.result
}

const pad = (a: string) => a.toLowerCase().replace('0x', '').padStart(64, '0')
const word = (n: bigint) => n.toString(16).padStart(64, '0')

async function main(): Promise<void> {
  const burner = createSigner({ mode: 'dry-run' }).address
  const amount = parseDecimalAmount(amountArg, 6)

  console.log(`\nstarting anvil: fork of ${UPSTREAM} on ${RPC}`)
  const anvil = spawn('anvil', ['--fork-url', UPSTREAM, '--port', String(PORT), '--chain-id', '97', '--silent'], { stdio: ['ignore', 'ignore', 'pipe'] })
  anvil.stderr.on('data', (d: Buffer) => process.stderr.write(`anvil: ${d}`))
  anvil.on('exit', (code) => {
    console.log(`anvil exited (${code})`)
    process.exit(code ?? 0)
  })

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      await rpc('eth_chainId')
      break
    } catch {
      if (i === 59) throw new Error('anvil did not come up in 60s — is it installed? https://getfoundry.sh')
    }
  }

  await rpc('anvil_impersonateAccount', [USDC_OWNER])
  await rpc('anvil_setBalance', [USDC_OWNER, '0xde0b6b3a7640000'])
  const tx = await rpc('eth_sendTransaction', [{ from: USDC_OWNER, to: USDC, data: `0x40c10f19${pad(burner)}${word(amount)}`, gas: '0x30000' }])
  await rpc('anvil_stopImpersonatingAccount', [USDC_OWNER])

  const bal = BigInt((await rpc('eth_call', [{ to: USDC, data: `0x70a08231${pad(burner)}` }, 'latest'])) as string)
  const native = BigInt((await rpc('eth_getBalance', [burner, 'latest'])) as string)
  const tvl = BigInt((await rpc('eth_call', [{ to: VAULT, data: '0x01e1d114' }, 'latest'])) as string)

  console.log(`minted ${formatBaseUnits(amount, 6)} test USDC to ${burner} (tx ${String(tx).slice(0, 18)}…)`)
  console.log(`burner on fork: ${formatBaseUnits(bal, 6)} USDC · ${formatBaseUnits(native, 18)} tBNB · vault TVL ${formatBaseUnits(tvl, 6)} USDC`)
  console.log(`\nfork is up. In another shell:`)
  console.log(`  FORK_RPC_URL=${RPC} EXECUTION_MODE=live npm run act --workspace=agent -- deposit 5000 --portfolio onchain`)
  console.log(`  FORK_RPC_URL=${RPC} EXECUTION_MODE=live npm run test:integration --workspace=agent`)
  console.log(`\n(write target ${env.IXS_WRITE_VAULT_ID} · every receipt says "(fork)" · Ctrl-C stops anvil)`)
}

main().catch((err) => {
  console.error(`fork: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
