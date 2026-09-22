/**
 * Register the agent's ERC-8004 identity — once.
 *
 *   npm run identity --workspace=agent
 *
 * Base Sepolia by default (free gas, same testnet story as the mandate). The
 * wallet is the OpenServ identity wallet from provision(), which is also the
 * x402 payee — so "payee = the agent's identity" is literally true.
 *
 * The token URI is our own live agent card (`/.well-known/agent-card.json`), so
 * the identity points at something anyone can fetch from the running agent.
 * OpenServ's own registration path needs their IPFS presign endpoint, which was
 * returning 500 on 22 Sep (RECON §6.15); `--via-openserv` still tries it.
 *
 * The key is read from .env and never printed. Re-running updates the URI on the
 * existing token; it never mints a second one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getErc8004Contracts, PlatformClient, getProvisionedInfo } from '@openserv-labs/client'
import { createPublicClient, createWalletClient, decodeEventLog, formatEther, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { env, REPO_ROOT } from '../env.js'
import { agentCard } from '../monetize/agent-card.js'
import { AGENT_NAME } from '../telegram/agent.js'

/** The two pieces of the identity registry we use: mint with a URI, and read the id back out of the event. */
const REGISTRY_ABI = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
])

const CHAIN_ID = Number(process.env['ERC8004_CHAIN_ID'] ?? 84532)
const RPC_URL = process.env['ERC8004_RPC_URL'] ?? 'https://sepolia.base.org'
const OUT = join(REPO_ROOT, 'data', 'identity.json')
const EXPLORER = CHAIN_ID === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org'
const SCAN = CHAIN_ID === 8453 ? 'https://www.8004scan.io/agents/base' : 'https://www.8004scan.io/agents/base-sepolia'

const fail = (msg: string, err?: unknown): never => {
  console.error(`\n✗ ${msg}`)
  if (err) console.error(`  ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

/** Ask the platform to do it (agent card → their IPFS → registry). Kept for when their presign works. */
async function viaOpenserv(workflowId: number, key: `0x${string}`) {
  const userApiKey = existsSync(join(REPO_ROOT, '.openserv.json'))
    ? (JSON.parse(readFileSync(join(REPO_ROOT, '.openserv.json'), 'utf8')) as { userApiKey?: string }).userApiKey
    : undefined
  const client = new PlatformClient(userApiKey ? { apiKey: userApiKey } : {})
  return client.erc8004.registerOnChain({
    workflowId,
    privateKey: key,
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    name: 'Mandate',
    description: agentCard().description,
  })
}

const main = async () => {
  process.chdir(REPO_ROOT)
  const viaPlatform = process.argv.includes('--via-openserv')

  const key = env.WALLET_PRIVATE_KEY
  if (!key) fail('WALLET_PRIVATE_KEY is not set. It is written by `npm run provision` — the OpenServ identity wallet, not the burner.')
  const account = privateKeyToAccount(key!)

  const registry = getErc8004Contracts(CHAIN_ID).IDENTITY_REGISTRY as `0x${string}`
  const uri = `${(env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, '')}/.well-known/agent-card.json`

  console.log('ERC-8004 registration')
  console.log(`  wallet    ${account.address}`)
  console.log(`  chain     ${CHAIN_ID} · ${RPC_URL}`)
  console.log(`  registry  ${registry}`)
  console.log(`  token URI ${uri}`)

  const rpc = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) })
  const balance = (await rpc.getBalance({ address: account.address }).catch((err) => fail(`could not read the balance from ${RPC_URL}`, err))) as bigint
  console.log(`  balance   ${formatEther(balance)} ETH`)
  if (balance === 0n) fail(`${account.address} has no ETH on chain ${CHAIN_ID}. Fund it from a Base Sepolia faucet and re-run.`)

  // The card must be reachable before the token points at it.
  const card = await fetch(uri)
    .then(async (r) => (r.ok ? ((await r.json()) as { name?: string }) : null))
    .catch(() => null)
  if (!card?.name) console.warn(`  ⚠ ${uri} is not serving the agent card yet — register anyway, it is the deployed API's URL`)
  else console.log(`  card      live · ${card.name}`)

  let agentId: string
  let txHash: string
  let cardUrl = uri

  if (viaPlatform) {
    const info = getProvisionedInfo(AGENT_NAME, 'mandate-telegram')
    const workflowId = Number(process.env['ERC8004_WORKFLOW_ID'] ?? info?.workflowId ?? 0)
    if (!workflowId) fail('No workflowId for the platform path. Set ERC8004_WORKFLOW_ID.')
    const r = (await viaOpenserv(workflowId, key!).catch((err) => fail('erc8004.registerOnChain (platform path)', err))) as {
      agentId: string
      txHash: string
      agentCardUrl?: string
    }
    agentId = r.agentId
    txHash = r.txHash
    cardUrl = r.agentCardUrl ?? uri
  } else {
    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) })
    console.log(`\nregistering…`)
    const hash = await wallet
      .writeContract({ address: registry, abi: REGISTRY_ABI, functionName: 'register', args: [uri] })
      .catch((err) => fail('register(tokenURI) reverted', err))
    console.log(`  tx sent   ${hash as string}`)
    const receipt = await rpc.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 120_000 })
    if (receipt.status !== 'success') fail(`the registration transaction reverted (${EXPLORER}/tx/${hash as string})`)

    // The id comes from the registry's own Registered event, not from a guess at the topics.
    let tokenId = '?'
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registry.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({ abi: REGISTRY_ABI, data: log.data, topics: log.topics })
        if (decoded.eventName === 'Registered') {
          tokenId = String((decoded.args as { agentId: bigint }).agentId)
          break
        }
      } catch {
        // another event from the same contract
      }
    }
    agentId = `${CHAIN_ID}:${tokenId}`
    txHash = hash as string
  }

  const scanUrl = `${SCAN}/${agentId.split(':')[1]}`
  console.log(`\n✓ registered`)
  console.log(`  agentId   ${agentId}`)
  console.log(`  tx        ${EXPLORER}/tx/${txHash}`)
  console.log(`  card      ${cardUrl}`)
  console.log(`  scan      ${scanUrl}`)

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(
    OUT,
    `${JSON.stringify({ agentId, txHash, cardUrl, scanUrl, chainId: CHAIN_ID, registry, wallet: account.address, registeredAt: new Date().toISOString() }, null, 2)}\n`,
  )
  console.log(`\n  saved ${OUT}`)
  console.log(`\nSet these on Railway (and in .env for local runs):`)
  console.log(`  ERC8004_AGENT_ID=${agentId}`)
  console.log(`  ERC8004_TX_HASH=${txHash}`)
  console.log(`  ERC8004_CARD_URL=${cardUrl}`)
  console.log(`  ERC8004_SCAN_URL=${scanUrl}`)
}

main().catch((err) => fail('identity', err))
