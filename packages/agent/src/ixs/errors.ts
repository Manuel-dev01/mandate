/**
 * IXS error taxonomy.
 *
 * Four distinct failure modes, because the compliance evaluator will need to
 * tell them apart: a transport wobble is degradable, a tool refusal is a fact
 * about the vault, and a schema mismatch means IXS changed under us.
 */

export type IxsErrorKind = 'transport' | 'rpc' | 'tool' | 'schema'

export class IxsError extends Error {
  readonly kind: IxsErrorKind
  readonly tool: string | null

  constructor(kind: IxsErrorKind, message: string, tool: string | null = null) {
    super(message)
    this.name = new.target.name
    this.kind = kind
    this.tool = tool
  }
}

/** HTTP failure, timeout, or an SSE frame we could not decode. Degradable. */
export class IxsTransportError extends IxsError {
  readonly status: number | null

  constructor(message: string, opts: { status?: number | null; tool?: string | null } = {}) {
    super('transport', message, opts.tool ?? null)
    this.status = opts.status ?? null
  }
}

/** JSON-RPC envelope error, e.g. { code: -32601, message: 'Method not found' }. */
export class IxsRpcError extends IxsError {
  readonly code: number

  constructor(code: number, message: string, tool: string | null = null) {
    super('rpc', `JSON-RPC ${code}: ${message}`, tool)
    this.code = code
  }
}

/**
 * Classified reasons for `result.isError === true`.
 *
 * Verified live on 13 Sep 2026 — the message text is PLAIN, not JSON, so it is
 * carried verbatim in `text` and never parsed.
 */
export type IxsToolErrorReason =
  | 'unknown_vault' //          "Unknown vaultId"
  | 'deposit_limit' //          "Deposit amount exceeds the current vault limit of 0 USDC."
  | 'nothing_claimable' //      "No claimable deposit for requestId 0."
  | 'bad_amount_format' //      "assetAmount must be an integer string in base units"
  | 'subgraph_unavailable' //   "Type `DepositRequest` has no field `owner`" / "status 404"
  | 'not_whitelisted'
  | 'unsupported_settlement'
  | 'unknown'

/**
 * A tool that ran and refused. `text` is exactly what IXS said, so a receipt
 * can quote the upstream reason rather than paraphrasing it.
 */
export class IxsToolError extends IxsError {
  readonly reason: IxsToolErrorReason
  readonly text: string
  /** For `deposit_limit`: the cap IXS reported, as its raw decimal string. */
  readonly limitRaw: string | null

  constructor(tool: string, text: string) {
    const { reason, limitRaw } = classify(text)
    super('tool', `${tool}: ${text}`, tool)
    this.reason = reason
    this.text = text
    this.limitRaw = limitRaw
  }
}

/** Response decoded but did not match its schema — IXS changed shape. */
export class IxsSchemaError extends IxsError {
  readonly detail: string

  constructor(message: string, opts: { tool?: string | null; detail?: string } = {}) {
    super('schema', message, opts.tool ?? null)
    this.detail = opts.detail ?? ''
  }
}

function classify(text: string): { reason: IxsToolErrorReason; limitRaw: string | null } {
  const limit = text.match(/current vault limit of\s+([\d.]+)/i)
  if (limit) return { reason: 'deposit_limit', limitRaw: limit[1] ?? null }

  const at = (reason: IxsToolErrorReason) => ({ reason, limitRaw: null })

  if (/unknown vault/i.test(text)) return at('unknown_vault')
  if (/no claimable/i.test(text)) return at('nothing_claimable')
  if (/integer string in base units/i.test(text)) return at('bad_amount_format')
  if (/has no field|request feed query failed|subgraph/i.test(text)) return at('subgraph_unavailable')
  if (/whitelist/i.test(text)) return at('not_whitelisted')
  if (/sync vault|async vault|erc-?7540 vaults only/i.test(text)) return at('unsupported_settlement')
  return at('unknown')
}
