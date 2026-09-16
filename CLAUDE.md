# CLAUDE.md — Mandate

## What this is

**Mandate** is an autonomous treasury agent that is *provably incapable of breaking its mandate*.

A user writes a treasury policy in plain English. Mandate compiles it into a bounded, machine-checkable rule set, then allocates capital into **IXS licensed RWA yield vaults** across multiple chains — and emits an **audit-grade decision receipt for every action it takes and every action it refuses**.

Built for **SERV Hackathon Edition 01** (14–27 Sep 2026). Tracks: **RWA Vaults (IXS)** + **Mainnet & MCP (Robinhood Chain)**.

> **The demo is the spec.** Read `docs/DEMO_SCRIPT.md` before writing any feature. If a change does not make one of those six beats land harder, it is out of scope.

---

## Non-negotiable context

**Deadline: 27 September 2026.** The hackathon page contradicts itself (hero says 27, FAQ says 28). Build to 27. Feature freeze is D11.

**Judged on exactly three things** — nothing else scores:
1. **Creativity** — a novel primitive, not a novel stack.
2. **User-readiness** — works first try, onboards in under 60s, looks finished.
3. **Revenue potential** — a business, not a toy.

There is **no technical-difficulty criterion.** Do not trade polish for cleverness. A rough-but-clever build loses to a finished one here.

**SERV Reasoning is mandatory** — the build must demonstrably run on it.

---

## Verified facts — do NOT re-derive, do NOT trust upstream docs

Confirmed by live probe on 13 Sep 2026. `docs/RECON.md` holds the raw evidence.

### The IXS skills repo `.env.example` is STALE. Do not copy values from it.

- Its `IXS_VAULT_ID=ixs-tokenized-vault-base-sepolia` returns **404 `VAULT_NOT_FOUND`**.
- **There is no Base Sepolia vault.** Any plan, doc, or memory referencing Base Sepolia for IXS is wrong.
- **REST `GET /vaults` is the source of truth for vault IDs.** MCP `vaults_list` returns only **1 of the 5** vaults (D1 probe, stable 3/3 — RECON §6.1). `ixs.listVaults()` uses REST and reports the MCP gap as `divergence`.

### The live vault universe (5 vaults, 5 chains)

| Vault | id | Chain | Asset | Whitelist |
|---|---|---|---|---|
| IXHYB - Avalanche | `6a952683732c2b84b55ce89b` | Avalanche Fuji testnet (43113) | USDC | no |
| IXHYB - BSC | `6a278b40a7d16b245d665479` | BSC testnet (97) | USDC | no |
| IXHYB - Arc | `6a8832299e7fddf1f49e6f6c` | Arc testnet (5042002) | USDC | no |
| t_ix7540v1 | `6a8ebe8e732c2b84b55ce88c` | BSC testnet (97) | USDC | **YES** |
| IXHYB - Robinhood | `6a8832289e7fddf1f49e6f51` | **Robinhood Chain MAINNET (4663)** | **USDG** | no |

- **Primary dev target: Avalanche Fuji** (`6a952683732c2b84b55ce89b`) — for **reads and redeem builds**. See the deposit-cap blocker below.
- **`t_ix7540v1` requires a whitelist** — this is our *real*, non-contrived refusal demo. Never fake a refusal when a genuine one exists.
- **IXHYB - Robinhood is MAINNET with real USDG.** Reads and plans only. **Never send a write transaction to chain 4663** unless the user explicitly approves that specific action in that specific session.

### Four vaults are ERC-7540 async. IXHYB - BSC is SYNC (ERC-4626).

Corrected by the D1 probe (RECON §6.5): `vault_get` reports BSC as `settlement: "sync"` and its deposit builds as `approve + deposit`, "settles immediately". The subgraph URL naming is *not* a settlement signal — read `vault_get.settlement`. `BuildResult` is a union over both kinds; never assume one.

The async lifecycle is still the primary path, not an edge case:

```
vault_build_request_deposit -> sign/send -> poll vault_request_status -> vault_build_claim_deposit -> sign/send
```

Build async-first. Do not write a sync happy path and bolt async on afterwards.

### Two D4 blockers, found on D1 (RECON §6.3, §6.4) — do not discover these again

- **`vault_request_status` is broken upstream.** Every call errors with a subgraph query bug (`` Type `DepositRequest` has no field `owner` ``). The poll step needs another source: on-chain `pendingDepositRequest` / `claimableDepositRequest` via viem, or the Goldsky subgraph directly.
- **Fuji cannot build a deposit.** On-chain `maxDeposit()` is **0 for every address** (a global operator cap; not paused, not KYC), so `vault_build_request_deposit` always fails. Arc and `t_ix7540v1` are the same. **BSC is currently the only vault that builds a deposit** — and it is sync. Beat 2 needs IXS to raise the cap, or a target change.

### IXS MCP — live, unauthenticated, build-only

`POST https://api-dev-v2.ixs.finance/mcp`, header `Accept: application/json, text/event-stream`. It responds over **SSE** (`event: message` then `data: {...}`) — you must strip the `data: ` prefix before parsing.

**Three decoding gotchas, all non-obvious:**
1. The transport is SSE, not JSON — strip `data: `.
2. Successful `tools/call` results are **double-encoded**: `result.content[0].text` is itself a JSON string needing a second `JSON.parse`. `tools/list` is *not* wrapped this way.
3. **Failed `tools/call` results are NOT JSON.** HTTP is still 200, `result.isError` is `true`, and `content[0].text` is plain prose (`Unknown vaultId`). Parsing it throws. Triage order: envelope `error` → `result.isError` → second decode. `packages/agent/src/ixs/mcp.ts` is the reference implementation — use the client, don't re-solve it.

`vault_get` returns `{ ok, settlement, vault, pricing }` where `pricing` carries `totalAssets`, `totalSupply` and `pricePerShare` as decimal **strings** — parse to bigint at the boundary, never to float. **`pricePerShare` carries a unit suffix** (`"1.1 USDC"`); `totalAssets`/`totalSupply` do not.

**Amounts sent to build tools are integer strings in BASE UNITS.** `'5000'` means 0.005 USDC; 5,000 USDC is `'5000000000'`. The client takes `bigint` so the wrong form cannot be typed.

8 tools, **all `readOnlyHint: true`** — they return *unsigned* transaction payloads and never broadcast:

```
vaults_list  vault_get  vault_check_whitelist  vault_request_status
vault_build_request_deposit  vault_build_request_redeem
vault_build_claim_deposit    vault_build_claim_redeem
```

This hands us the non-custodial architecture for free: **the agent plans, a signer approves.** Preserve that boundary — signing lives in exactly one module and nowhere else.

REST: `GET https://api-dev-v2.ixs.finance/vaults`, `/vaults/{vaultId}`, `/vaults/{vaultId}/positions/{walletAddress}`

### SERV Reasoning API

`https://inference-api.openserv.ai`, `Authorization: Bearer $SERV_API_KEY`, OpenAI + Anthropic SDK compatible by base-URL swap.

| Endpoint | Format |
|---|---|
| `POST /v1/chat/completions` | OpenAI — all models |
| `POST /v1/responses` | OpenAI models only |
| `POST /v1/messages` | Anthropic format |

- **Every request MUST include a system prompt** or it returns 400. This is the number-one integration gotcha.
- **SERV Tools** — declare a tool whose name starts with `serv_`; SERV applies the feature and strips the tool before the model sees it. They are *not* callable functions.
  - `serv_shadow_agent` — validate-and-iterate loop. Params `hint`, `max_iterations` (default 3), set via a `default` inside the tool's JSON schema.
  - `serv_prompt_guard` — protects the system prompt from injection-based leakage.
  - `serv_disable_content_filter` — disables the default content filter.
- Models are **paid**. Use `gpt-5.4-mini` or `claude-haiku-4.5` for all dev and test loops; reserve a frontier model for the recorded demo only.

### SERV behaviour — measured 13 Sep 2026, not assumed

- **`max_tokens` is rejected.** Newer models require **`max_completion_tokens`**. Sending `max_tokens` returns a 400 that looks like an auth or model error but is neither.
- **`serv_prompt_guard` short-circuits the whole turn.** On an injection attempt it returns a bare refusal (*"I can't share that."*) with **`finish_reason: 'content_filter'`** and **bills zero tokens** — `usage` comes back all zeros, inference never runs. `ServClient.chat()` surfaces this as `{ kind: 'guarded' }`, keyed off `finish_reason`, never off the refusal string. It does not answer the legitimate half of a mixed request. So never combine a guarded call with work you still need done: compute first, then explain. Our design already separates these — keep it that way, and always have the deterministic template ready as a fallback when a guarded call returns a refusal.
- **Clean requests usually pass the guard — but not always.** Measured 16 Sep on the explanation prompt: a request made entirely of our own words short-circuited about one run in three. Attach the guard only where there is untrusted input (`explain.ts` does so only when a `userMessage` exists), and keep the template fallback.
- **The guard redacts system-prompt content echoed in the reply.** Quoted mandate phrases came back as `"redacted"` and numbers as `0.00` when the decision summary lived in the system prompt. Anything the model must quote goes in the **user** turn; the system prompt carries instructions only.
- **SERV Tools cost ~5x latency.** Same prompt: 2.1s bare, **10.6s** with `serv_prompt_guard` + `serv_shadow_agent`. Budget for it in the Telegram UX (show a working indicator) and never put a guarded call in a loop.
- **Output is markdown with LaTeX math by default** (`\[ \frac{...} \]`), which renders as garbage in Telegram. Constrain formatting explicitly in every system prompt: plain text, no LaTeX, no display math.
- `serv_shadow_agent` honours its `hint` — a hint demanding "a percentage to two decimals" reliably produced `88.80%`.

### Robinhood Chain

`https://rpc.mainnet.chain.robinhood.com`, chainId **4663** (`0x1237`), explorer `robinhoodchain.blockscout.com`. Public and permissionless — **no brokerage approval needed**. Only Robinhood's *brokerage MCP* is gated; the chain itself is not. This is the dual-track unlock.

**Windows gotcha:** `curl` fails against this RPC with `CRYPT_E_REVOCATION_OFFLINE` (schannel). Use `curl --ssl-no-revoke` for manual probes. Node uses OpenSSL and is unaffected.

---

## Architecture

```
packages/agent/src/
  serv/     SERV Reasoning client — the ONLY module that talks to inference-api
  ixs/      IXS MCP + REST client — the ONLY module that talks to IXS
  mandate/  plain-English -> rule set, and the compliance evaluator (core IP)
  audit/    decision receipts: inputs, rules fired, verdict, hash
packages/web/   Next.js audit console (the hero surface)
scripts/        smoke.mjs — zero-dependency integration verification
```

**The compliance evaluator is the product.** Everything else is plumbing around it. Its contract:

```
evaluate(ruleSet, portfolio, facts, action) -> { verdict: ALLOW | REFUSE, checks[], citedRules[], numbers, rationale, inputs, hash }
```

Built on D3 in `packages/agent/src/mandate/evaluate.ts` — pure, synchronous, bigint-only. `facts.ts` gathers live inputs beforehand (the only I/O), `explain.ts` asks SERV for prose afterwards. `hash` excludes the timestamp and the prose, so the same inputs hash identically across runs. `action.userMessage` is stored in the receipt and read by no predicate.

**Refusals must be deterministic.** A refusal decided by an LLM coin-flip is worthless — it is the centrepiece of both the demo and the pitch. Rule checks are plain TypeScript predicates evaluated in code. SERV is used to *compile* English into rules and to *explain* verdicts — **never to decide them**. If you find yourself asking a model "should this be allowed?", the design has been broken.

---

## Commands

```bash
node scripts/smoke.mjs                 # verify all live integrations (no deps, no build)
npm run typecheck                      # tsc --noEmit in every workspace, strict
npm test --workspace=agent             # unit tests only — never bills SERV
npm run test:integration --workspace=agent   # live IXS + SERV loop; costs a few gpt-5.4-mini calls
npm run dev --workspace=agent
npm run dev --workspace=web
```

---

## Conventions and guardrails

- **TypeScript, ESM, strict.** Zod at every external boundary.
- **Money is never a float.** `bigint` plus explicit decimals. USDC and USDG are 6dp; vault shares are 18dp. Mixing these is the likeliest source of a silent, demo-killing bug.
- **Secrets live only in `.env`** (gitignored). Never in code, logs, receipts, screenshots, or commit messages. Burner wallets only.
- **Writes go to testnet.** Avalanche Fuji is the dev target. Robinhood Chain mainnet is read/plan-only unless explicitly approved per action.
- **Degrade, never crash.** IXS runs on a `-dev-` host and may wobble. Cache the last good vault snapshot and serve it with a staleness badge. The demo must never show an error screen.
- **No AI attribution in commits or PRs.**

## Definition of done for any feature

1. It makes a demo beat land harder.
2. It has an empty state, a loading state, and an error state.
3. It works on a cold start in a fresh browser profile.
