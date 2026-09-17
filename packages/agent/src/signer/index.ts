/**
 * THE signing module. The only file in this package that may import
 * `privateKeyToAccount` or call `sendTransaction`. Everything that wants to
 * broadcast goes through `Signer.send()`, and `Signer.send()` runs the
 * guardrails before it touches a transport:
 *
 *   1. chainId in BLOCKED_WRITE_CHAIN_IDS (4663, 8453, 1)  -> SignerRefusal
 *   2. amount above MAX_ACTION_ASSET_AMOUNT                 -> SignerRefusal
 *   3. mode 'dry-run' (the default)                         -> simulate only
 *
 * The private key is read from env exactly once, here, and never logged.
 * CLAUDE.md: "the agent plans, a signer approves." This is the signer.
 */

import {
  BaseError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { env } from '../env.js'
import { formatBaseUnits, parseDecimalAmount } from '../ixs/schemas.js'

export type ExecutionMode = 'dry-run' | 'live'

export interface ChainTarget {
  readonly chainId: number
  readonly rpcUrl: string
  readonly name?: string
  readonly explorerUrl?: string | null
  /** True when rpcUrl is a local Anvil fork. Carried into every result. */
  readonly fork?: boolean
}

/** "97 bsc-testnet" or "97 bsc-testnet (fork)" — in every result, so a fork can never pass for the real chain. */
export function chainLabel(c: ChainTarget): string {
  const name = c.name ?? ''
  return `${c.chainId} ${name}${c.fork && !name.includes('(fork)') ? ' (fork)' : ''}`.trim()
}

/** Exactly the shape IXS returns in every build step. Unsigned. */
export interface UnsignedTx {
  readonly to: string
  readonly data: string
  readonly value: string
}

export interface SendContext {
  readonly chain: ChainTarget
  /** The ALLOW decision this transaction descends from. Recorded, never inferred. */
  readonly decisionHash: string
  /** Asset amount the step moves, for the MAX_ACTION_ASSET_AMOUNT cap. */
  readonly assetAmount?: bigint
  readonly assetDecimals?: number
  readonly label?: string
}

export type SendResult =
  | {
      readonly mode: 'dry-run'
      readonly simulated: true
      readonly ok: boolean
      readonly from: Address
      readonly to: Address
      readonly gasEstimate: bigint | null
      readonly revertReason: string | null
      readonly decisionHash: string
      readonly chain: string
    }
  | {
      readonly mode: 'live'
      readonly simulated: false
      readonly from: Address
      readonly to: Address
      readonly txHash: Hex
      readonly blockNumber: bigint
      readonly status: 'success' | 'reverted'
      readonly explorerUrl: string | null
      readonly decisionHash: string
      readonly chain: string
    }

export type SignerRefusalReason = 'blocked_chain' | 'amount_cap' | 'no_key'

export class SignerRefusal extends Error {
  readonly reason: SignerRefusalReason
  constructor(reason: SignerRefusalReason, message: string) {
    super(message)
    this.name = 'SignerRefusal'
    this.reason = reason
  }
}

export interface SignerOptions {
  mode?: ExecutionMode
  /** Test seam. Defaults to env.AGENT_PRIVATE_KEY; `null` means do NOT consult env. Never logged. */
  privateKey?: `0x${string}` | null
  blockedChainIds?: readonly number[]
  /** Asset units, e.g. '10000'. Defaults to env.MAX_ACTION_ASSET_AMOUNT. */
  maxActionAssetAmount?: string
  /** Test seam: swap the HTTP transport for a scripted one. */
  transport?: (chain: ChainTarget) => Transport
  /** Receipt wait, live mode only. */
  receiptTimeoutMs?: number
}

export interface Signer {
  readonly address: Address
  readonly mode: ExecutionMode
  readonly blockedChainIds: readonly number[]
  send(tx: UnsignedTx, ctx: SendContext): Promise<SendResult>
}

export function toChain(target: ChainTarget): Chain {
  return defineChain({
    id: target.chainId,
    name: target.name ?? `chain-${target.chainId}`,
    nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
    rpcUrls: { default: { http: [target.rpcUrl] } },
  })
}

export function createSigner(opts: SignerOptions = {}): Signer {
  const key = opts.privateKey === null ? undefined : (opts.privateKey ?? env.AGENT_PRIVATE_KEY)
  if (!key) {
    throw new SignerRefusal('no_key', 'AGENT_PRIVATE_KEY is not set. Add a BURNER key to .env — testnet only.')
  }
  const account: PrivateKeyAccount = privateKeyToAccount(key)
  const mode: ExecutionMode = opts.mode ?? env.EXECUTION_MODE
  const blockedChainIds = Object.freeze([...(opts.blockedChainIds ?? env.BLOCKED_WRITE_CHAIN_IDS)])
  const maxActionAssetAmount = opts.maxActionAssetAmount ?? env.MAX_ACTION_ASSET_AMOUNT
  const transportFor = opts.transport ?? ((chain: ChainTarget) => http(chain.rpcUrl, { timeout: 20_000, retryCount: 1 }))
  const receiptTimeoutMs = opts.receiptTimeoutMs ?? 180_000

  const publicClients = new Map<number, PublicClient>()
  const walletClients = new Map<number, WalletClient>()

  function publicClient(target: ChainTarget): PublicClient {
    let client = publicClients.get(target.chainId)
    if (!client) {
      client = createPublicClient({ chain: toChain(target), transport: transportFor(target) })
      publicClients.set(target.chainId, client)
    }
    return client
  }

  function walletClient(target: ChainTarget): WalletClient {
    let client = walletClients.get(target.chainId)
    if (!client) {
      client = createWalletClient({ account, chain: toChain(target), transport: transportFor(target) })
      walletClients.set(target.chainId, client)
    }
    return client
  }

  /** Guardrails. Pure, synchronous, before any network call. */
  function guard(ctx: SendContext): void {
    if (blockedChainIds.includes(ctx.chain.chainId)) {
      throw new SignerRefusal(
        'blocked_chain',
        `chain ${ctx.chain.chainId} is in BLOCKED_WRITE_CHAIN_IDS [${blockedChainIds.join(', ')}] — writes there are never permitted`,
      )
    }
    if (ctx.assetAmount !== undefined) {
      const decimals = ctx.assetDecimals ?? 6
      const cap = parseDecimalAmount(maxActionAssetAmount, decimals)
      if (ctx.assetAmount > cap) {
        throw new SignerRefusal(
          'amount_cap',
          `action of ${formatBaseUnits(ctx.assetAmount, decimals)} exceeds MAX_ACTION_ASSET_AMOUNT ${maxActionAssetAmount}`,
        )
      }
    }
  }

  async function send(tx: UnsignedTx, ctx: SendContext): Promise<SendResult> {
    guard(ctx)
    const to = tx.to as Address
    const data = tx.data as Hex
    const value = BigInt(tx.value || '0')
    const client = publicClient(ctx.chain)

    if (mode === 'dry-run') {
      let ok = true
      let revertReason: string | null = null
      let gasEstimate: bigint | null = null
      try {
        await client.call({ account, to, data, value })
        try {
          // Raw eth_estimateGas: viem's estimateGas({ account }) runs full tx
          // preparation (eth_fillTransaction, nonce, fees) which a simulation
          // does not need and a scripted transport should not have to answer.
          const gasHex = await client.request({
            method: 'eth_estimateGas',
            params: [{ from: account.address, to, data, value: `0x${value.toString(16)}` }],
          })
          gasEstimate = typeof gasHex === 'string' ? BigInt(gasHex) : null
        } catch {
          gasEstimate = null
        }
      } catch (err) {
        ok = false
        revertReason = revertReasonOf(err)
      }
      return { mode: 'dry-run', simulated: true, ok, from: account.address, to, gasEstimate, revertReason, decisionHash: ctx.decisionHash, chain: chainLabel(ctx.chain) }
    }

    const wallet = walletClient(ctx.chain)
    const txHash = await wallet.sendTransaction({ account, chain: toChain(ctx.chain), to, data, value })
    const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: receiptTimeoutMs })
    const explorer = ctx.chain.explorerUrl?.replace(/\/$/, '')
    return {
      mode: 'live',
      simulated: false,
      from: account.address,
      to,
      txHash,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      explorerUrl: explorer ? `${explorer}/tx/${txHash}` : null,
      decisionHash: ctx.decisionHash,
      chain: chainLabel(ctx.chain),
    }
  }

  return Object.freeze({ address: account.address, mode, blockedChainIds, send })
}

/** The custom errors we expect from OpenZeppelin v5 tokens and vaults. */
const KNOWN_ERRORS_ABI = parseAbi([
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error OwnableUnauthorizedAccount(address account)',
  'error EnforcedPause()',
  'error ERC4626ExceededMaxDeposit(address receiver, uint256 assets, uint256 max)',
  'error ERC4626ExceededMaxRedeem(address owner, uint256 shares, uint256 max)',
])

/** viem nests the useful message a few `cause`s down. Keep it short and plain. */
export function revertReasonOf(err: unknown): string {
  const raw = err instanceof BaseError ? err.shortMessage || err.message : err instanceof Error ? err.message : String(err)
  const first = raw.split('\n')[0] ?? raw
  const decoded = decodeKnownError(err)
  if (decoded) return `${decoded} — ${first}`.slice(0, 300)
  if (err instanceof BaseError) {
    const detail = err.walk((e) => e instanceof Error && /revert|reverted|insufficient|balance|allowance/i.test(e.message))
    const inner = detail instanceof Error ? detail.message.split('\n')[0] : undefined
    return (inner && inner !== raw ? `${raw} — ${inner}` : raw).slice(0, 300)
  }
  return raw.slice(0, 300)
}

/**
 * "0xfb8f41b2…" anywhere in an error (message, `data`, or a nested cause) ->
 * "ERC20InsufficientAllowance(spender=…, allowance=0, needed=1000000)".
 */
export function decodeKnownError(err: unknown): string | null {
  for (const hex of errorDataCandidates(err)) {
    try {
      const d = decodeErrorResult({ abi: KNOWN_ERRORS_ABI, data: hex })
      const item = KNOWN_ERRORS_ABI.find((e) => e.name === d.errorName)
      const args = (d.args ?? []).map((v, i) => `${item?.inputs[i]?.name ?? i}=${typeof v === 'bigint' ? v.toString() : String(v)}`)
      return `${d.errorName}(${args.join(', ')})`
    } catch {
      // not one of ours, or not error data at all (viem prints calldata in messages too) — try the next
    }
  }
  return null
}

/** Every `data` property down the cause chain first, then every hex blob in the messages. */
function errorDataCandidates(err: unknown): Hex[] {
  const data: Hex[] = []
  const fromMessages: Hex[] = []
  let node: unknown = err
  for (let depth = 0; node && depth < 8; depth++) {
    const rec = node as { message?: unknown; data?: unknown; cause?: unknown }
    if (typeof rec.data === 'string' && /^0x[0-9a-fA-F]{8}/.test(rec.data)) data.push(rec.data as Hex)
    if (typeof rec.message === 'string') {
      for (const m of rec.message.matchAll(/0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{64})*/g)) fromMessages.push(m[0] as Hex)
    }
    node = rec.cause
  }
  return [...data, ...fromMessages]
}

/**
 * The burner's address, and nothing else — for whitelist checks and portfolio
 * reads. Derives from the key without building a client; cannot sign.
 */
export function agentAddress(privateKey: `0x${string}` | undefined = env.AGENT_PRIVATE_KEY): Address {
  if (!privateKey) throw new SignerRefusal('no_key', 'AGENT_PRIVATE_KEY is not set. Add a BURNER key to .env — testnet only.')
  return privateKeyToAccount(privateKey).address
}
