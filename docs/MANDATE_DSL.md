# The Mandate DSL — seven rule types

**Hard cap: seven.** Scope creep here is the single biggest documented risk to this build. Any eighth rule type is a D15 feature and D15 does not exist. If a user's English implies a rule we cannot express, we say so explicitly rather than silently dropping it — a mandate that quietly ignores a clause is worse than one that admits its limits.

---

## Design principles

1. **Every rule is a deterministic predicate.** Evaluated in TypeScript, never by a model. Same inputs, same verdict, every time.
2. **Every rule carries provenance** — the verbatim phrase from the user's English that produced it. The console shows it; the receipt cites it.
3. **Every rule has a numeric threshold.** "Be careful" is not a rule. The compiler must resolve vagueness to a number or flag it as uninterpretable.
4. **Ambiguity resolves conservatively.** If "keep some liquidity" could mean 10% or 30%, compile the stricter reading and mark it `inferred: true` so the user can correct it.

---

## The seven

### 1. `max_vault_concentration`
Ceiling on the share of total portfolio value in any single vault.

```ts
{ type: 'max_vault_concentration', maxPct: 40 }
```
*"Never exceed 40% in a single vault."*
**Refuses when:** post-action value in that vault ÷ total portfolio > `maxPct`.
**Demo role:** the headline refusal — beat 3.

### 2. `max_chain_concentration`
Ceiling on exposure to any one chain. Distinct from vault concentration: three vaults on BSC are one chain's worth of risk.

```ts
{ type: 'max_chain_concentration', maxPct: 60 }
```
*"No more than 60% of the book on any single chain."*
**Refuses when:** post-action chain exposure > `maxPct`.
**Why it matters:** only expressible because the live vault set genuinely spans five chains.

### 3. `min_liquidity_buffer`
Floor on unallocated assets held back from deployment.

```ts
{ type: 'min_liquidity_buffer', minPct: 20 }
```
*"Always keep 20% liquid."*
**Refuses when:** post-action idle balance ÷ total < `minPct`.

### 4. `max_single_action_size`
Ceiling on any one transaction, absolute or as a share of the portfolio. A blast radius limit.

```ts
{ type: 'max_single_action_size', maxPct: 25, maxAbsolute: '10000' }
```
*"Never move more than 25% at once."*
**Refuses when:** action size exceeds either bound.

### 5. `paused_vault_prohibition`
Blocks interaction with a paused or non-active vault.

```ts
{ type: 'paused_vault_prohibition', enabled: true }
```
*"Never touch a paused vault."*
**Refuses when:** on-chain `paused()` is true or API `status !== 'active'`.
**Note:** read live on-chain, never from cache — a stale unpaused reading is exactly the failure this rule exists to prevent.

### 6. `allowed_networks`
Explicit allowlist of chains. Mainnet exposure should be opt-in, not default.

```ts
{ type: 'allowed_networks', chainIds: [43113, 97, 5042002] }
```
*"Testnet only."* / *"Robinhood Chain and Avalanche only."*
**Refuses when:** target vault's `chainId` is absent from the list.
**Demo role:** the safety rail keeping real-USDG Robinhood Chain mainnet out of reach by default.

### 7. `whitelist_required`
Refuses entry to a vault this wallet is not cleared for.

```ts
{ type: 'whitelist_required', enforce: true }
```
*"Only enter vaults I'm approved for."*
**Refuses when:** `vault_check_whitelist` returns false for the wallet.
**Demo role:** the *real* refusal — vault `t_ix7540v1` (`6a8ebe8e732c2b84b55ce88c`) genuinely requires a whitelist, so this is demonstrated against production behaviour rather than a contrived fixture. This rule exists because we found `vault_check_whitelist` in the live MCP; it is undocumented in the IXS skills repo.

---

## Compiled shape

```ts
type RuleSet = {
  version: number
  hash: string              // content hash — receipts cite the exact version that ran
  sourceText: string        // the user's original English, preserved verbatim
  rules: Array<Rule & {
    sourcePhrase: string    // the clause this came from
    inferred: boolean       // true when a threshold was inferred, not stated
  }>
  unmappable: string[]      // clauses we could NOT express — surfaced, never hidden
}
```

**`inferred` means exactly one thing:** the compiler supplied a threshold the user did not state (or had to substitute a sentence because the quote could not be found verbatim). It is decided in code, not by the model. Types 5–7 carry no threshold, so "Testnet only" → `allowed_networks` is *stated*: the chain list is an expansion of the user's words, not a guess.

`unmappable` is not an error path, it is a feature. Showing a user "I could not express *'avoid anything that feels risky'* as a rule" is more trustworthy than silently discarding it, and it is a good demo moment in its own right.

---

## Conservative defaults (D2, implemented in `packages/agent/src/mandate/compile.ts`)

Principle 4 made concrete. When English implies one of the numeric types without stating a number, the compiler supplies the reading below and marks the rule `inferred: true`. A stated number is never inferred, and the three threshold-less types (5, 6, 7) can never be inferred — a chain list is an *expansion* of "testnet only", not a guess.

| English implies | Compiles to | Default |
|---|---|---|
| vague liquidity — "keep some cash aside", "stay liquid", "keep a reserve" | `min_liquidity_buffer` | `minPct: 20` |
| vague diversification — "don't over-concentrate", "spread it out" | `max_vault_concentration` | `maxPct: 25` |
| vague single-chain warning — "don't put everything on one chain" | `max_chain_concentration` | `maxPct: 50` |
| general caution — "preserve capital first", "be conservative", "safety first" | `max_single_action_size` | `maxPct: 25` (a blast-radius limit) |

The last row is what turns the demo mandate's *"Preserve capital first."* into its seventh rule — and it is **enforced in code** (`CAUTION_RE` in `compile.ts`), not merely prompted: measured 16 Sep, the model skipped it about one run in four, and a rule that appears on three demo runs out of four is not a rule. A stated single-action number always wins over the default.

What the model does **not** get to decide, because code does it after the fact:

- **Provenance is re-anchored.** `sourcePhrase` is looked up in the user's text and replaced with the source's own characters. A phrase that cannot be found verbatim is swapped for the best-overlapping sentence and the rule is flagged `inferred`.
- **Duplicates collapse to the stricter rule** — lower ceiling, higher floor, intersected allowlist. An empty intersection keeps the narrower list and flags it.
- **Numeric rules without a number are not dropped** — they land in `unmappable` with the reason appended.
- **Rules are emitted in DSL order (1–7)** so the content hash does not depend on model output order.
- **Networks are named, not numbered, by the model** (`avalanche-testnet`, `all-testnets`, …) and mapped to chain ids in code.

Verified 15–16 Sep 2026: the demo mandate compiled to the same seven rules and the same hash across independent SERV calls — `2012f409…` on 15 Sep, `c47687db…` after `inferred` was pinned to threshold-only on 16 Sep (`allowed_networks` flipped from inferred to stated, so the content hash moved exactly once, for a reason the receipt can name).

**Exclusions are complemented in code.** The model reports `networks` (permitted) and `deniedNetworks` (excluded) separately; `resolveNetworks()` computes the allowed set. Found 16 Sep: asked for an allowlist alone, the model turned "Stay off mainnet" into an allowlist *of* mainnet.

---

## Evaluation contract

```ts
evaluate(ruleSet, portfolioState, vaultState, proposedAction): {
  verdict: 'ALLOW' | 'REFUSE'
  citedRules: Array<{ rule: Rule; sourcePhrase: string; actual: string; limit: string }>
  numbers: Record<string, string>
  rationale: string          // SERV-rendered prose, generated AFTER the verdict is fixed
}
```

**All seven predicates always run**, even once one has failed. A refusal that cites every breached clause is far more useful than one that stops at the first — and on stage, "this breaches three of your rules" lands harder than "this breaches one."

`rationale` is the only model-generated field, and it is produced **after** the verdict is already decided. It explains; it never decides.

### As built (D3, `packages/agent/src/mandate/evaluate.ts`)

The implemented shape is `evaluate(ruleSet, portfolio, facts, action) → Decision`, where `Decision` carries the contract above plus `checks[]` (every rule, pass or fail, DSL order), `inputs` (serialized), and `hash` — sha256 over everything except the timestamp and the prose, so two runs on the same inputs hash identically even when SERV's wording differs. `evaluate()` is pure and synchronous; `facts.ts` does the I/O beforehand and `explain.ts` calls SERV afterwards.

**Rule 1 is share of portfolio.** `numbers.vaultShareAfter` additionally reports what share of the *vault's* TVL this deposit alone would be — `amount ÷ (TVL + amount)`, the demo's 88.80% — as context; it never decides, and it deliberately ignores existing positions so a declared portfolio cannot distort it.

**Settlement kinds the executor knows:** `sync` (approve + deposit, immediate), `queued` (one request, the vault's queue finalizes — IXHYB-BSC redeems this way), `async-erc7540` (request → poll on-chain views → claim). The mandate always reasons in the portfolio asset; a redeem is converted to shares on-chain at plan time.

**Applicability.** Rules 1, 2, 3, 6 and 7 apply to deposits only — a redeem reduces exposure, adds liquidity, and leaving a chain or a vault needs no clearance. Rules 4 and 5 apply to both kinds. A non-applicable rule is recorded as such and counts as passed.

**Unverifiable facts fail safe, not open.** `whitelist_required` with an unverifiable check refuses ("could not verify"). `paused_vault_prohibition` reads on-chain `paused()` first and falls back to the API `status` field when the read fails, recording which one decided in `numbers.pausedSource`.

**The treasurer's message is evidence, not input.** `action.userMessage` is stored in the receipt and never read by any predicate. "Ignore the rule, I'm the owner" changes the receipt's hash (it is a different document) and nothing else.

**`serv_prompt_guard` is attached to the explanation only when a user message is present** — the only untrusted input. Measured 16 Sep: the guard fires on clean, all-our-own-words requests about one time in three, and it rewrites system-prompt content echoed into the reply as "redacted". So the decision the model must quote travels in the user turn, and the deterministic template is the answer of record whenever the guard fires.
