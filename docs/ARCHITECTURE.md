# Architecture

How Mandate turns a sentence of English into a decision nobody has to take on trust.

---

## 1. The one idea

A treasury policy is normally a **prompt**: advice given to a model, which the model may follow. Mandate treats it as a **program**: English is compiled once into a typed rule set, and every decision is then made by evaluating those rules in ordinary TypeScript.

That single move is what makes the output provable:

```
                        ┌─────────────────────────────────┐
   plain English  ──────▶│  compile  (SERV Reasoning)      │──────▶  RuleSet  (typed, hashed)
                        └─────────────────────────────────┘
                                                                        │
   live vault facts ────────────────────────────────────────────────────┤
   declared portfolio ──────────────────────────────────────────────────┤
   proposed action  ────────────────────────────────────────────────────┤
                                                                        ▼
                        ┌─────────────────────────────────┐
                        │  evaluate   pure TypeScript     │──────▶  Decision  (verdict, hashed)
                        │  no I/O · no model · no clock   │
                        └─────────────────────────────────┘
                                                                        │
                        ┌─────────────────────────────────┐             │
                        │  explain   (SERV Reasoning)     │◀────────────┤  prose only, after the fact
                        └─────────────────────────────────┘             │
                                                                        ▼
                                                                    Receipt  (hash-linked)
```

**A language model appears twice, and never on the verdict.** It compiles English into rules *before* any decision exists, and it writes prose *after* the verdict is already fixed. Delete both calls and every verdict in the system is unchanged — only the wording is lost. That is the property the whole design protects.

---

## 2. Trust boundaries

| Stage | Who decides | If it fails |
|---|---|---|
| `compile` | SERV, constrained by a JSON schema, then re-validated by Zod and post-processed in code | Compile is refused with the unmappable clauses named. No rule set is produced — a partial policy would silently permit things |
| `facts` | IXS REST + MCP, and an on-chain `paused()` read | Degrades to the last good snapshot, flagged `stale`. The whitelist is **never** cached, so it fails closed |
| `evaluate` | **Nobody.** Seven pure predicates over bigints | Cannot fail: no I/O, no clock, no network |
| `explain` | SERV | Falls back to a deterministic template. The verdict never moves |
| `record` | Append-only file store | Refuses to write if the chain head moved |

The evaluator is the only component that decides anything, and it is the only one that cannot fail.

---

## 3. Modules

```
packages/agent/src/
  serv/       the ONLY module that talks to inference-api.openserv.ai
  ixs/        the ONLY module that talks to IXS — MCP over SSE + REST, with snapshots
  mandate/    compile.ts · evaluate.ts · explain.ts · facts.ts · portfolio.ts · schema.ts
  audit/      receipt.ts (build/hash/verify/replay) · store.ts (append-only chain) · report.ts
  telegram/   parse.ts (deterministic intents) · capabilities.ts (exact replies) · bot.ts · format.ts
  console/    view.ts (view models) · api.ts (GET-only JSON + the x402 paywall)
  monetize/   x402.ts · service.ts · agent-card.ts
  signer/, execute/   dormant (see §8)
packages/web/  Next.js console — renders the API and nothing else
```

Two rules hold this together:

- **One integration, one module.** Nothing outside `serv/` makes an inference call; nothing outside `ixs/` calls IXS. Swapping either is a single-file change.
- **One wording, one place.** `telegram/present.ts` produces every human-readable rule label and check phrase, and both the bot and the console import it — so the chat and the audit console can never describe the same decision differently.

---

## 4. The decision pipeline

A proposal arrives as Telegram text and leaves as a receipt.

1. **`telegram/parse.ts`** maps the message to one of seven intents with regexes. **No model sits between the treasurer and the verdict** — which is why the demo's phrasing is reproducible.
2. **`mandate/facts.ts`** gathers live vault state: IXS `vault_get` for settlement and pricing, REST for the universe, a raw `eth_call` for on-chain `paused()`, and a live `vault_check_whitelist`. Every read is bounded and degrades to a snapshot.
3. **`mandate/portfolio.ts`** loads the declared book. It is a **declared seed**, labelled `declared` on every receipt, and never described as live.
4. **`mandate/evaluate.ts`** runs all seven predicates every time — including the ones that pass — and returns `{ verdict, checks[], citedRules[], numbers, rationale, inputs, hash }`.
5. **`mandate/explain.ts`** asks SERV for prose, with `serv_prompt_guard` attached when the user supplied a message. Any failure keeps the template.
6. **`audit/receipt.ts` + `store.ts`** build the receipt and append it to the chain.

### Why every rule runs, including the passing ones

A refusal that lists only what failed is an assertion. A refusal that lists all seven with their actual value against their limit is an argument — the reader can see what *wasn't* breached. This is also why `notApplicable` carries a reason (`"redeem (it reduces exposure)"`) rather than being omitted.

---

## 5. Money

Every amount is a `bigint` plus explicit decimals. There is no float anywhere in the money path.

- USDC and USDG are 6dp; vault shares are 18dp. `project()` rescales across them explicitly.
- Percentages are computed in basis points with integer arithmetic and formatted at the very edge.
- `parseDecimalAmount` is the only entry point, and it throws a typed error on anything malformed rather than guessing.

The reason is narrow and practical: a rounding difference between two runs would break replay, and replay is the product.

---

## 6. The three hashes

| Hash | Commits to | Proves |
|---|---|---|
| **mandate** | the whole rule set + its source text | the policy hasn't been edited since it was compiled |
| **decision** | the rule set hash, the inputs, the verdict, the numbers | the verdict follows from those exact inputs |
| **receipt** | mandate + decision + environment labels + **previous receipt id** | the record is intact and sits at one point in an ordered chain |

Deliberately **excluded** from the hash: `createdAt` and the SERV prose. So the same inputs hash identically across runs and machines — which is what makes `replay` meaningful.

Deliberately **included**: `action.userMessage`. A treasurer's attempt to argue is part of the record, so the decision hash legitimately differs between the plain refusal and the argued one. The *checks and numbers* are identical; the hash is not, and saying otherwise would be a false claim.

`verifyChain()` walks the index, re-derives every receipt, **and compares each index row against the receipt it points at** — so editing either side alone is caught.

---

## 7. Deployment

```
   Telegram ──▶ ┌──────────────────────────────────────────┐
                │  Railway · ONE replica · volume at /data │
                │    telegram bot (long poll)              │
   x402 buyer ─▶│    console API (GET-only) + paywall      │──▶ IXS · SERV · RPC · x402 facilitator
                │    OpenServ agent (paid workflow)        │
                └──────────────────────────────────────────┘
                                   ▲  reads
                                   │
                        ┌──────────────────────┐
   judge ──────────────▶│  Vercel · Next.js    │
                        │  the audit console   │
                        └──────────────────────┘
```

**One replica, deliberately.** Two Telegram pollers make the API answer `Conflict`, and the receipt chain is a file on one volume. Horizontal scale would need a real queue and a shared store — correct for production, wrong for a build where the chain's integrity is the demo.

The web tier holds **no** agent code, never touches disk, and never calls IXS. It renders the API. If the agent is unreachable every page shows a degraded panel naming the host and the reason — never a stack trace.

---

## 8. Dormant code, and why it stays

`signer/` and `execute/` implement the full execution path: unsigned steps from IXS MCP, allowance checks, signing with guardrails, and three settlement kinds (`sync`, `async-erc7540`, `queued`).

It is **not on the product surface**. IXS confirmed on 17 Sep that no vault — testnet or mainnet — accepts outside deposits during the build window, so nothing in the demo signs or broadcasts. The code is tested and kept because the constraint is IXS's, not ours; it is unreferenced by the demo path, the CLI defaults, receipts and the console.

The honest framing is the one on the console: **nothing here signs or sends.**

---

## 9. Invariants

If a change breaks one of these, it is the wrong change.

1. A model never decides a verdict.
2. `evaluate` stays pure: no I/O, no clock, no randomness.
3. Money never becomes a float.
4. The receipt chain is append-only, and `verifyChain` must be able to detect any single-sided edit.
5. Nothing is shown that the data cannot back — no seeded receipts, no invented counts, no claim of "live" over cached facts.
6. Degrade, never crash. Every external call is bounded; every failure has a named, visible fallback.
7. One replica, one chain.

---

## 10. Where to read next

| To understand | Read |
|---|---|
| The seven rule types and how English maps to them | [`MANDATE_DSL.md`](MANDATE_DSL.md) |
| The receipt's shape, its hashes, how to verify one | [`RECEIPT.md`](RECEIPT.md) |
| Live-probe evidence behind every integration claim | [`RECON.md`](RECON.md) |
| The business case and measured unit economics | [`REVENUE.md`](REVENUE.md) |
