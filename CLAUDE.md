# CLAUDE.md — Mandate

## What this is

**Mandate** is an autonomous treasury agent that is *provably incapable of breaking its mandate*.

A user writes a treasury policy in plain English. Mandate compiles it into a bounded, machine-checkable rule set, checks every proposed move into **IXS licensed RWA yield vaults** across multiple chains against it using live vault data — and emits an **audit-grade decision receipt for every action it allows and every action it refuses**.

Built for **SERV Hackathon Edition 01** (14–27 Sep 2026). Tracks: **RWA Vaults (IXS)** + **Mainnet & MCP (Robinhood Chain)**.

> **The demo is the spec.** Read `docs/internal/DEMO_SCRIPT.md` before writing any feature. If a change does not make one of those six beats land harder, it is out of scope.

---

## Non-negotiable context

**Deadline: 27 September 2026.** Verified 17 Sep: the page says *"Submissions close September 28th 00:00 UTC"* — the end of 27 Sep. Build to 27. Feature freeze is D11. **Submission = a public X post tagging `@openservai` + the typeform `form.typeform.com/to/GyPxGqRn`, and data collection must be enabled at `console.openserv.ai/settings/organization`** (RECON §6.10).

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

### The live vault universe (5 vaults, 4 chains)

| Vault | id | Chain | Asset | Whitelist |
|---|---|---|---|---|
| IXHYB - Avalanche | `6a952683732c2b84b55ce89b` | Avalanche Fuji testnet (43113) | USDC | no |
| IXHYB - BSC | `6a278b40a7d16b245d665479` | BSC testnet (97) | USDC | no |
| IXHYB - Arc | `6a8832299e7fddf1f49e6f6c` | Arc testnet (5042002) | USDC | no |
| t_ix7540v1 | `6a8ebe8e732c2b84b55ce88c` | BSC testnet (97) | USDC | **YES** |
| IXHYB - Robinhood | `6a8832289e7fddf1f49e6f51` | **Robinhood Chain MAINNET (4663)** | **USDG** | no |

- **Five vaults, but only FOUR distinct chains** — `IXHYB - BSC` and `t_ix7540v1` both sit on BSC testnet (97). `vaultsView` counts distinct `chainId`, so the console says 4; prose that says "five chains" is wrong and contradicts our own live page. Corrected 23 Sep.
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

### The product surface is DECIDE + PROVE. Execution is dormant code. (17 Sep — RECON §6.10)

- **IXS, 17 Sep: "we don't have a vault accessible on testnet."** Mainnet is capped at 0 as well (`maxDeposit(any)` = 0 on Robinhood too). **No IXS vault accepts outside deposits during the build window.** The user's decision: build only on what IXS actually gives access to — live vault state, the live whitelist check, MCP-built plans — and do not build around what does not exist. **No fork in the demo, no sign-and-hold story, no simulation theatre.**
- What ships: compile → live facts → evaluate → explain → **receipt**. Beat 2 is the ALLOW case with its receipt; beat 3 the refusal; beat 4 the replay. `bin/act.ts` ends at the receipt.
- `signer/` and `execute/` are **dormant D4 code**: tested, kept, unreferenced by the demo path, CLI defaults, receipts or docs. `bin/fork.ts` is an internal test harness only. Do not resurface any of it on stage.
- Facts still worth knowing: IXHYB-BSC is `sync` for deposits and **`queued`** for redeems (a third settlement kind); redeems are built in shares; the BSC test USDC (`0xbBCa80a7…`) is owner-mint-only with no faucet; the burner is `0xBCA6f82e240C6AC36B23b4f7D21adF17e03966Fe` (address only — the key is never printed, logged or committed). Hackathon Telegram: `t.me/openservai`. IXS: `t.me/ixsfinance`, `discord.gg/XXHzsJGYkq`.

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
  telegram/ the bot (demo surface) + the handlers' exact wording
  console/  view models + the read-only JSON API the web renders (same process as the bot: bin/serve.ts)
  monetize/ the x402 paywall on the report, the service/identity facts, the agent card
packages/web/   Next.js audit console — a renderer of the console API, no agent code, no disk, no IXS
scripts/        smoke.mjs (live integrations) · web-smoke.mjs (API + console routes) · overflow-check.mjs (phone width, via CDP)
```

### Build status (23 Sep — D1–D10 done, deployed)

| Module | Files | State |
|---|---|---|
| `serv/` | `client.ts` — chat, SERV Tools, structured outputs, `{ kind: 'guarded' }` | D1 ✅ |
| `ixs/` | `mcp.ts` (8 tools, triage), `rest.ts`, `schemas.ts` (money, Zod), `index.ts` (cached reads), `errors.ts` | D1 ✅ |
| `mandate/` | `schema.ts`, `compile.ts` (D2) · `types.ts`, `evaluate.ts`, `explain.ts`, `facts.ts` (D3) | D2 ✅ D3 ✅ |
| `audit/` | `receipt.ts` (build/hash/verify/replay), `store.ts` (append-only, hash-linked files), `report.ts` (byte-stable audit report) | D5 ✅ |
| `telegram/` | `capabilities.ts` (five handlers returning exact text), **`bot.ts` + `parse.ts` (direct Bot API long-poll, deterministic intent parser — the demo surface, `npm run bot`)**, `agent.ts` (the same handlers as an OpenServ Agent, route-never-decide prompt), `mandates.ts` (per-chat store); `bin/bot.ts`, `bin/provision.ts`, `bin/agent.ts` | D6 ✅ direct bot is primary (RECON §6.12); OpenServ route optional — their Telegram integration form was failing on 21 Sep |
| `ixs/` snapshots | `LastGood` memory + disk (`.snapshots/`), bigint-safe JSON; `fetchUniverse` fails on a REST wobble so the universe never shrinks to MCP's 1-of-5 (RECON §6.13) | D6 ✅ cold start degrades with STALE |
| `signer/`, `execute/` | one signing module with guardrails; plan → run → status | D4 — **dormant**, not on the product surface |
| `console/` | `view.ts` (labels, codes `CON-01`…`CLR-07`, segments, pretty amounts — reuses `telegram/present.ts`; `historyView` buckets the chain over time), `api.ts` (GET-only + the x402 paywall), `bin/serve.ts` (bot + API + the OpenServ agent in one process) | D7 ✅ D10 ✅ |
| `monetize/` | `x402.ts` (requirements, verify+settle, never sells on a facilitator outage), `service.ts` (`/x402` facts, pay page); `audit/exports.ts` is the sales ledger; `bin/buy.ts`, `bin/identity.ts` | D9 ✅ |
| `packages/web/` | landing · `/chain` · `/receipts/[id]` (verify/replay) · `/mandate` · `/vaults` · `/export/[id]`; every page has empty / loading / unreachable states, and tables fold rather than scroll under 720px | D8 ✅ D10 ✅ |
| deploy | Railway (agent) and Vercel (console), both from GitHub `master`; `scripts/watch-deploys.mjs` prints only state changes | D10 ✅ |

Tests: `*.unit.test.ts` never touch the network; `*.integration.test.ts` hit live IXS/SERV/RPC and cost a few `gpt-5.4-mini` calls. Rehearsal: `npm run act -- deposit 5000` (ALLOW → receipt), `npm run act -- deposit 50000 --message "…"` (REFUSE → receipt), `npm run receipt -- list|show|verify|replay|export`.

### 🔒 Feature freeze — D11, 24 Sep

**The build is closed.** What remains is rehearsal, the recording, and submission.

- **Frozen:** `mandate/` (no new rule types, no predicate changes, nothing that moves a hash or a schema), `audit/`, `ixs/`, `serv/`, the routes of `console/api.ts`, `monetize/`, and the route structure of `packages/web`.
- **Still allowed:** a fix for anything that breaks one of the six beats; wording and copy; docs; rehearsal tooling under `scripts/`, which is not on the product surface.
- **Push discipline:** one push to `master` redeploys *both* services; the build runs for a couple of minutes and the bot then goes unanswerable across the container swap (~10–30 s observed 23 Sep). **Never push during a rehearsal run or a recording.** Batch fixes between takes.
- **Before every run or take:** `node scripts/preflight.mjs` must say READY. It checks the bot is polling and alone, IXS is live rather than stale (stale facts turn beat 2's ALLOW into a REFUSE), the facilitator is up, the buyer is funded, the paywall answers 402, every console route is 200 and warm, and nothing scrolls sideways at 390px.

**Two rails, one document.** The report sells through our own x402 on Base Sepolia (the demo path) and through OpenServ's x402 marketplace, where their rail settles USDC on Base **mainnet**. Both are fulfilled by the same agent and return byte-identical bytes — verified 22 Sep (RECON §6.17). Say which rail is which; never blur them.

**The console is checked at phone width.** Tables fold into two columns under 720px rather than scrolling sideways, because the actual-vs-limit numbers are the demo. `node scripts/overflow-check.mjs` asserts it.

**The report is the product, and it is paid for.** `GET /receipts/:id/report` answers **402** with x402 terms (Base Sepolia USDC, payee = the ERC-8004 identity wallet) and serves the file only after the facilitator settles; `?preview=1` is 40 labelled lines and the only free path — the console key does not unlock it. A settlement writes one line to `exports.jsonl`, and that is the only thing the console's "reports sold" counts — one sale is on the board, settled on Base Sepolia. The OpenServ listing **is** fulfillable (proven 22 Sep, RECON §6.17); our own paywall is still the demo path because their trigger endpoints were answering slowly and their rail costs real mainnet USDC.

**Deploy shape (live, verified 23 Sep).** Console `https://mandate-console-five.vercel.app`, agent `https://agent-production-d238.up.railway.app` (RECON §6.14 has ids and what bit). Railway runs `bin/serve.ts` (bot + API) as **one** replica with a volume at `/data` (`RECEIPTS_DIR`, `MANDATES_DIR`, `SNAPSHOT_DIR`, `COMPILE_CACHE_DIR`); two pollers make Telegram answer `Conflict`. Vercel runs `packages/web` with `MANDATE_API_URL`. Nothing on the console is seeded: every receipt was made in Telegram.

**The OpenServ runtime LLM routes; it never decides.** The Telegram capabilities return the exact text to relay; the system prompt in `telegram/agent.ts` forbids adding, softening or inventing a verdict. If the runtime ever paraphrases a verdict, tighten the reply format — never move the verdict into the model.

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
