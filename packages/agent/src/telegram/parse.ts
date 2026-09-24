/**
 * Deterministic intent parser for the direct Telegram bot.
 *
 * No LLM sits between the treasurer and the handlers here: the demo's exact
 * phrases map to capabilities by rules, and anything policy-shaped becomes
 * the mandate. Pure, so it is unit-tested against every beat verbatim.
 */

export type Intent =
  | { kind: 'help' }
  | { kind: 'set_mandate'; text: string }
  | { kind: 'propose_action'; action: 'deposit' | 'redeem'; amount: string; vault: string | undefined; message: string | undefined }
  | { kind: 'argue'; message: string } // "ignore the rule, I'm the owner" — re-run the last action with these words
  | { kind: 'get_receipt'; id: string }
  | { kind: 'vault_status'; vault: string | undefined }
  | { kind: 'unknown'; text: string }

const ACTION_RE =
  /^\s*(?:ok(?:ay)?[,\s]+|please\s+|now\s+|then\s+|and\s+|next[,\s]+)?(deposit|put|move|allocate|invest|add|redeem|withdraw|pull|take)\s+(?:another\s+)?\$?([\d][\d,]*(?:\.\d+)?)\s*(k|m|usdc|usdg)?\b(?:\s+(?:worth\s+)?(?:usdc|usdg))?(?:\s+(?:into|in|to|from|out of)\s+(.+?))?\s*[.!?]*\s*$/i

const EXCEPTION_RE = /\b(ignore|just this once|i'?m the owner|i am the owner|exception|override|bypass|skip|anyway|make an exception|trust me|regardless|waive)\b/i
const RECEIPT_RE = /^\s*\/?(?:receipt|verify|replay|show receipt)\s+([0-9a-f]{6,64})\b/i
// "of"/"for" are optional: a judge types "vault status arc", not "status of the arc vault".
const STATUS_RE = /^\s*\/?(?:vault\s*status|status|vaults?|show vaults?|list vaults?)(?:\s+(?:of\s+|for\s+)?(?:the\s+)?(.+?)(?:\s+vault)?)?\s*[.!?]*\s*$/i
const STATUS_ALT_RE = /^\s*(?:how is|how's|what about)\s+(?:the\s+)?(.+?)(?:\s+vault)?\s*[.!?]*\s*$/i
/** Vault names are short and name-shaped: "arc", "BSC", "Avalanche", "t_ix7540v1", "IXHYB - BSC". No sentence punctuation, no percentages. */
const VAULT_NAME_RE = /^[\w][\w \-]{0,23}$/
/** Politeness trailing a bare request — "show vaults please" means show them all, not a vault called "please". */
const FILLER_RE = /^(?:please|now|thanks|thank you|pls|report|list|all|info|details?)$/i
// A greeting may precede the question: "hey what can you do" must not fall through.
const HELP_RE = /^\s*\/?(?:(?:hi|hey|hello|yo|gm)\b[,\s]*)?(?:start|help|what can you do|what can i do|what do you do|who are you|\?)\s*[.!?]*\s*$/i
const GREETING_RE = /^\s*(?:hi|hey|hello|yo|gm)\s*[.!?]*\s*$/i
const POLICY_RE = /\b(never|always|only|keep|at all times|no more than|at most|at least|max(?:imum)?|min(?:imum)?|liquid|paused|whitelist|cleared|testnet|mainnet|chain|vault|%)\b/i

export function parseIntent(raw: string, hasLastAction: boolean): Intent {
  const text = raw.trim()
  if (!text) return { kind: 'unknown', text }
  if (HELP_RE.test(text) || GREETING_RE.test(text)) return { kind: 'help' }

  const receipt = text.match(RECEIPT_RE)
  if (receipt) return { kind: 'get_receipt', id: receipt[1]! }

  const status = text.match(STATUS_RE)
  if (status) {
    const raw = status[1]?.trim()
    // Making "of"/"for" optional let `(.+?)` swallow whole sentences, so a policy that
    // merely STARTS with "Vault" became a status lookup and the mandate was silently
    // never set — a worse failure than the one that change fixed. A vault name is short
    // and name-shaped; anything sentence-like falls through to the policy test below.
    if (!raw) return { kind: 'vault_status', vault: undefined }
    if (VAULT_NAME_RE.test(raw)) return { kind: 'vault_status', vault: FILLER_RE.test(raw) ? undefined : raw }
  }

  const action = text.match(ACTION_RE)
  if (action) {
    const verb = action[1]!.toLowerCase()
    const kind = ['redeem', 'withdraw', 'pull', 'take'].includes(verb) ? 'redeem' : 'deposit'
    const amount = expandAmount(action[2]!, action[3])
    const vault = action[4]?.trim()
    const message = EXCEPTION_RE.test(text) ? text : undefined
    return { kind: 'propose_action', action: kind, amount, vault, message }
  }

  if (EXCEPTION_RE.test(text) && hasLastAction) return { kind: 'argue', message: text }

  const alt = text.match(STATUS_ALT_RE)
  if (alt && /vault|avalanche|bsc|arc|robinhood|fuji/i.test(text)) return { kind: 'vault_status', vault: alt[1]?.trim() }

  // Policy-shaped prose: at least two clauses or a policy keyword with a number/percent.
  const clauses = text.split(/[.;\n]+/).filter((c) => c.trim().length > 3).length
  if ((clauses >= 2 && POLICY_RE.test(text)) || (POLICY_RE.test(text) && /\d/.test(text))) {
    return { kind: 'set_mandate', text }
  }
  return { kind: 'unknown', text }
}

/** "5,000" -> "5000"; "2.5k" -> "2500"; "1m" -> "1000000". Digits only, no floats. */
export function expandAmount(digits: string, suffix: string | undefined): string {
  const clean = digits.replace(/,/g, '')
  const s = (suffix ?? '').toLowerCase()
  if (s !== 'k' && s !== 'm') return clean
  const [whole = '0', frac = ''] = clean.split('.')
  const shift = s === 'k' ? 3 : 6
  const padded = frac.padEnd(shift, '0')
  const intPart = whole + padded.slice(0, shift)
  const rest = padded.slice(shift)
  return (rest ? `${intPart}.${rest}` : intPart).replace(/^0+(?=\d)/, '')
}
