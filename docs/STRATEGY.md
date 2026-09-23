# SERV Hackathon Edition 01 — Strategy & Execution Plan

## Context

**Goal:** win the SERV Hackathon Edition 01 outright — a track prize *and* the "best overall build" prize on top.

**The event (verified from openserv.ai/hackathon, 13 Sep 2026):**

| Item | Detail |
|---|---|
| Format | Online, Edition 01 of a monthly series |
| Build window | **14–27 September 2026** (opens tomorrow) |
| Deadline conflict | Hero says "Submissions close 27 sep"; FAQ says "Submissions close 28 September" — **treat 27 Sep as real** |
| Prizes | 1,000 $SERV per track × 4 tracks + **1,000 USDC best overall, stacked on top** |
| Judging | *"creativity, user-readiness, and revenue potential"* — **no technical-difficulty criterion** |
| Mandatory | Must leverage **SERV Reasoning**. "New, working, and demoable." |
| Showcase | Finalists demo on a live-streamed online event |
| Cost | Free; pre-register for API access |

**Decisions locked with the user:** Track = **RWA Vaults (IXS)**; capacity = **solo, full-time (~140h)**; demo surface = **Telegram agent + web audit console**.

---

## Track A — What actually wins this rubric

The rubric is unusually narrow. There is **no points line for technical difficulty**, which inverts normal hackathon instincts:

1. **Creativity** — rewards a *novel primitive*, not a novel stack. "Agent deposits into vault" is the obvious build and will be submitted a dozen times. We need a concept judges haven't seen.
2. **User-readiness** — the single highest-leverage criterion, and the one most hackathon projects fail. Means: works on first try, onboards in under a minute, looks finished, has no "ignore this bug" moments. This is why we're building a real frontend.
3. **Revenue potential** — judges want a *business*. OpenServ ships native monetization primitives (x402 paywall triggers, ERC-8004 on-chain identity, LAUNCH tokenization). Using them scores this criterion **in the platform's own vocabulary**.

**The meta-insight:** the judges are the platform team and its partners. The winning build is a *living proof of the sponsor's own thesis*. SERV markets itself as "bounded, auditable reasoning for regulated environments — banking, government." IXS markets itself as "the licensed yield layer for agentic finance." A build sitting exactly on that intersection is the one they will want to show investors.

**The single biggest differentiator available:** every other team will demo an agent **doing** something. We will demo an agent **correctly refusing** to do something, and prove why. Verifiable refusal is memorable, is genuinely novel in a hackathon setting, and is precisely what "bounded reasoning" means.

---

## Track B — Frontier tech scouting (all verified live)

**SERV Reasoning API** — `https://inference-api.openserv.ai`, bearer auth, OpenAI + Anthropic SDK compatible via base-URL swap. Endpoints: `/v1/chat/completions` (all models), `/v1/responses` (OpenAI models), `/v1/messages` (Anthropic format). **Every request must include a system prompt** or it 400s.

**SERV Tools** — the unfair advantage. Features toggled by declaring a fake tool whose name starts with `serv_`; SERV strips it before the model sees it:
- `serv_shadow_agent` — validate-and-iterate loop over output. Params: `hint`, `max_iterations` (default 3). Set via a `default` in the tool's JSON schema.
- `serv_prompt_guard` — protects the system prompt from injection-based leakage.
- `serv_disable_content_filter` — turns off the default filter.
- **Multipath** — contradicting rulebooks coexisting in one reasoning graph. SERV's docs literally say: *"In banking, this is called compliance."* This is the feature our champion is built on.
- **Kronos** — audit/repair the generated reasoning prompt before inference.

**IXS integration — fully ungated, no KYC, testnet** (from `IXS-Finance/ixs-rwa-agent-skills/.env.example`):
```
IXS_API_BASE_URL=https://api-dev-v2.ixs.finance
IXS_MCP_URL=https://api-dev-v2.ixs.finance/mcp
IXS_VAULT_ID=ixs-tokenized-vault-base-sepolia
IXS_VAULT_CHAIN_ID=84532          # Base Sepolia
IXS_VAULT_ADDRESS=0x9421a6C925D466Ac22956B1a7D553c3E74F59571   # ERC-4626
IXS_ASSET_ADDRESS=0xbBCa80a7116aE46B0f249D279EF43f86274dc4f4   # USDC, 6dp
IXS_SHARE_SYMBOL=vUSDC            # 18dp
IXS_VAULT_SUBGRAPH_URL=https://api.goldsky.com/.../ixs-vault-base-sepolia/1.0.0/gn
```
- **9 official drop-in agent skills**: `inspect-vault`, `quote-vault-deposit`, `quote-vault-redeem`, `compare-vault-entry-vs-exit`, `check-vault-allowance`, `approve-vault-spender`, `deposit-into-vault`, `redeem-from-vault`, `review-vault-wallet-history`.
- **MCP tools**: `vault_get`, `vault_build_request_deposit`, `vault_request_status`, `vault_build_claim_deposit`. REST: `GET /vaults/{vaultId}/positions/{walletAddress}`.
- **Architecturally important:** the MCP returns **unsigned transaction steps**, not executed txs. This hands us a non-custodial story for free — the agent *plans*, a signer *approves*.
- Two settlement kinds: `sync` (ManagedVault) and `async-erc7540` (queued → poll `vault_request_status` → `vault_build_claim_deposit`). Handling both is a credibility signal.
- A **Goldsky subgraph** gives historical vault data free — no indexer to build for the dashboard charts.

**OpenServ platform rails** — `@openserv-labs/sdk` (agent runtime, `addCapability`, Zod schemas, dev tunnel) + `@openserv-labs/client` (`provision()`, triggers, x402, ERC-8004). `provision()` creates a wallet and writes `WALLET_PRIVATE_KEY` to `.env` — it is the *only* key. Triggers: `triggers.webhook`, `triggers.cron`, `triggers.x402({ price })`. `client.erc8004.registerOnChain()` mints an Identity NFT on **Base mainnet (8453)** + Agent Card on IPFS, indexed by 8004scan.io.

**Official OpenServ skills repo** (`openserv-labs/skills`) — `openserv-client`, `openserv-agent-sdk`, `openserv-multi-agent-workflows`, `openserv-ideaboard-api`, `openserv-launch`. Feeding these to a coding agent is a large, legitimate speed advantage.

**Rejected:** Robinhood MCP (`agent.robinhood.com/mcp/trading`) requires a US Robinhood account in good standing, desktop-only onboarding, and dev-program approval — an unacceptable gating risk in 14 days.

---

## Track C — The five concepts

All within the RWA Vaults track.

**1. Mandate — the agent that can say no.** ⭐
A plain-English investment mandate ("preserve capital; never exceed 40% in one vault; keep 7-day liquidity; no unpaused-vault exceptions") is compiled into a *bounded compliance graph* via SERV Multipath. The agent allocates into IXS vaults, and **every decision — especially every refusal — emits a replayable, hash-anchored audit trail**. An autonomous treasurer that is provably constrained.

**2. Liquidity Sentinel.** Watchdog monitoring `availableAssets` vs `totalAssets`, `paused()` state, and ERC-7540 queue depth; pre-emptively exits before a redemption crunch. Sells "redemption certainty."

**3. Idle Capital Router.** Treasury-as-a-service for agent swarms: agents earning via x402 auto-sweep idle USDC into RWA yield while holding a gas/inference operating buffer. Monetizes the float of the agentic economy.

**4. Prospectus.** Generates an institutional-grade diligence memo on any IXS vault — settlement kind, liquidity, subgraph history, entry-vs-exit economics — sold per report via x402.

**5. Red Mandate.** Adversarial harness that attacks other treasury agents with prompt injection and edge-case market states using `serv_prompt_guard` + shadow agents, issuing a safety certificate.

---

## Track D — Stress test

| # | Build cost | Key bottleneck | API risk | Rubric fit | Verdict |
|---|---|---|---|---|---|
| 1 Mandate | Med-High | Mandate DSL scope creep | Low — all reads/plans ungated | **Creativity ↑↑ Ready ↑↑ Revenue ↑↑** | **CHAMPION** |
| 2 Sentinel | Low-Med | Demo is *passive* — needs a crunch that won't occur on testnet; must simulate, which reads as fake | Low | Creativity ↑ Ready → Revenue ↑ | Absorb as a mandate rule |
| 3 Router | High | Requires a swarm of earning agents; faking the swarm undercuts credibility | Med (x402 loop is multi-part) | Creativity ↑ Ready ↓ Revenue ↑↑ | Cut — too many moving parts |
| 4 Prospectus | Low | None — that's the problem | Low | **Creativity ↓↓** "an LLM writes a report" | Absorb as the audit artifact |
| 5 Red Mandate | Med | Depends on *other people's* agents existing to attack | Med | Ready ↓ Revenue → | Cut — external dependency |

**Synthesis:** the champion **absorbs the best of #2 and #4**. Liquidity thresholds become mandate rule types; the Prospectus becomes the x402-monetized audit artifact the console exports. #3 and #5 are cut for dependency risk.

---

## 👑 The Champion: **Mandate**

> *The autonomous treasurer that is provably incapable of breaking its mandate.*

**One-liner:** Write your treasury policy in plain English. Mandate compiles it into a bounded reasoning graph, allocates your USDC into licensed IXS RWA vaults, and produces an audit-grade trail for every decision it makes — and every one it refuses.

**Why it takes all three criteria:**
- **Creativity** — the novel primitive is the *mandate as an executable compliance contract*, and refusal as a first-class, provable output. Nobody else will demo an agent declining a trade.
- **User-readiness** — Telegram to interact, web console to verify. Non-custodial by construction (MCP returns unsigned steps; the user's signer approves). Under-60-second onboarding.
- **Revenue potential** — x402 paywall on exported audit reports + per-rebalance fee; ERC-8004 identity makes the agent discoverable and hireable; a direct B2B wedge into IXS's own stated customers (broker-dealers, RIAs, fintechs, neobanks with idle USDC).

**The 3-minute demo script (write this first, build backwards from it):**
1. Paste a mandate into Telegram in plain English. It compiles live into structured rules.
2. "Deposit 5,000 USDC." Agent inspects the vault, quotes, plans, executes on Base Sepolia. ✅
3. **"Now deposit 50,000 USDC."** Agent **REFUSES** — cites the exact concentration clause breached, with the numbers.
4. Open the web console: the reasoning graph for that refusal, the shadow-agent verification pass, the hash-anchored receipt.
5. Export the audit report → hits the **x402 paywall** → pay 0.5 USDC → report delivered. Revenue, live, on stage.
6. Close on the agent's **ERC-8004 identity on 8004scan.io**.

---

## Execution roadmap

**D0 — today, 13 Sep (setup only; write no product code — the build must be "new"):**
- Pre-register: `https://form.typeform.com/to/GyPxGqRn`. Join TG: `https://t.me/openservai` *(not `openserv.ai` — dead username)*.
- Create `console.openserv.ai` account → **SERV API key**. ⚠️ **Confirm in Telegram whether participants get free credits** — SERV Reasoning is a paid API and this is a hard dependency (see Risks).
- Burner wallet; ~~Base Sepolia ETH + test USDC~~ → BSC testnet tBNB + IXS test USDC (owner-mint-only — request from IXS; see RECON §1 and §6.9). Clone `IXS-Finance/ixs-rwa-agent-skills` *(its `.env.example` is stale — do not copy values)*.
- Smoke-test both integrations: one `/v1/chat/completions` call, and `vault_get` against `IXS_MCP_URL`.
- Ask in TG: exact deadline (27 vs 28), submission channel/format, multi-track eligibility.

**D1 (14 Sep) — kill both integration risks on day one.** Repo skeleton (TS monorepo: `agent/`, `web/`). Prove (a) a SERV call with `serv_shadow_agent` attached, (b) IXS `vault_get` + `GET /vaults/{id}/positions/{addr}`. Ship a read-only "vault status" reply in Telegram. *Gate: if either fails, escalate in TG immediately — do not proceed.*

**D2 — Mandate DSL v1.** Zod schema, **hard cap of 6 rule types** (max position %, min liquidity buffer, max single-vault concentration, settlement-kind allowlist, paused-vault prohibition, min holding period). Plain English → structured mandate via SERV structured outputs.

**D3 — The compliance evaluator (core IP).** `(mandate, vault state, proposed action) → ALLOW | REFUSE + cited clause + numbers`. Built on Multipath for genuinely contradicting rules ("maximize yield" vs "cap concentration"). `serv_shadow_agent` with a `hint` forcing a numeric justification. `serv_prompt_guard` on, so a user can't talk the agent out of its mandate — **demo that too**.

**D4 — Execution path.** `vault_build_request_deposit` → unsigned steps → allowance check → sign → send. Handle **both** `sync` and `async-erc7540` (poll `vault_request_status`, then `vault_build_claim_deposit`). Redeem path via the same shape.

**D5 — Audit trail.** Persist every decision: inputs, mandate version, reasoning graph, verdict, cited clauses, tx hashes. Hash each receipt. This is the product's spine — do not skimp.

**D6 — Telegram surface.** OpenServ Telegram trigger wiring (note: `provision()` does *not* handle integration triggers — needs the documented 5-step manual wiring, including `PUT /workspaces/{id}/sync` for the edge graph; `POST /edges` 404s).

**D7 — Web console v1.** Next.js. Decision feed + live mandate view + position/NAV panel.

**D8 — Web console v2: the hero screen.** Reasoning-graph visualizer and the **refusal detail view**. This screen is what wins the livestream — give it a full day.

**D9 — Monetization.** `triggers.x402({ price: '0.50' })` on the audit-report export. `client.erc8004.registerOnChain()` (needs a few dollars of **Base mainnet** ETH for gas — fund the wallet ahead of time). Wrap in try/catch so a gas failure can't break startup.

> **What actually shipped (22 Sep, RECON §6.15/§6.17):** both rails. The report is listed as a paid OpenServ x402 service *and* sold through our own x402 on **Base Sepolia**, which is the demo path — OpenServ's rail settles real USDC on Base mainnet and their trigger endpoints were slow. ERC-8004 went on **Base Sepolia** (free gas) after their IPFS presign returned 500; registered directly as `84532:9316`, with our own live agent card as the token URI. One real sale of 0.50 USDC is settled on-chain.

**D10 — History + polish.** Goldsky subgraph for vault history charts. Error states, empty states, loading states. Mobile-check the console.

> **What actually shipped (22–23 Sep, RECON §6.17):** the vault charts were **cut** — the subgraphs are live but the data is not (BSC silent for 61 days, Fuji's NAV history stops 22 days back), so a vault chart is a flat line ending weeks ago. Replaced with the **decision history**: allowed vs refused over time, and which rules have actually refused. Error/empty/loading states already shipped with D8. The mobile check found that tables hid their actual-vs-limit column behind a sideways swipe; they now fold, asserted by `scripts/overflow-check.mjs`. Three failure drills recorded.

**D11 — 🔒 FEATURE FREEZE.** No new features after today, no exceptions. Harden, seed demo data, rehearse the demo path end-to-end until it runs cleanly three times consecutively.

**D12 — Narrative assets.** Record the 3-minute demo video. README with architecture diagram. One-page landing. Written revenue model with real numbers (TAM, fee structure, unit economics).

**D13 — Submission package** + buffer for the inevitable.

**D14 (27 Sep) — submit early in the day.** Never rely on the extra day the FAQ hints at.

### Roadmap status — 16 Sep 2026

The roadmap above is the plan of record; this is what actually happened against it. Evidence in `docs/RECON.md` §6.

| Day | Status | Amendments to the plan |
|---|---|---|
| D0 | ✅ | Base Sepolia is dead (RECON §1); Avalanche Fuji became the read target. Free SERV credits confirmed in practice — the key works. |
| D1 | ✅ | Both clients + the loop test, 8/8. **REST `/vaults` is the vault source of truth**, not MCP `vaults_list` (returns 1 of 5). Tool errors are plain text under `isError`. `vault_request_status` is broken upstream. **Fuji `maxDeposit` = 0** for everyone. **IXHYB-BSC is sync**, not ERC-7540. The Telegram "vault status" reply moved to D6 with the trigger wiring. |
| D2 | ✅ | **Seven** rule types, not six (`whitelist_required` and `allowed_networks` earned their places from live findings; `min_holding_period` was dropped). Structured outputs on SERV work with `serv_shadow_agent`. `inferred` = a threshold we supplied; the model's flag is not trusted. Exclusions (`deniedNetworks`) are complemented in code after the model inverted "stay off mainnet". |
| D3 | ✅ | **Not built on Multipath** — it is not one of the three verified SERV Tools and nothing needed it; contradictions are handled deterministically (`stricter()`, `unmappable`). Rule 1 refuses on share of portfolio; vault-TVL share (the 88.80%) is context. `serv_prompt_guard` redacts system-prompt content echoed in replies and short-circuits clean requests ~1 in 3 — it is attached only when a user message exists, and the deterministic template is the answer of record. |
| D4 | ✅ then shelved | Built and tested (signer with guardrails, `planAction` gated on an ALLOW with a verifying hash, three settlement kinds — BSC redeems `queued`). Then IXS replied: *"we don't have a vault accessible on testnet"*, and mainnet is capped at 0 too. **Decision: build only on what IXS gives access to.** No fork or sign-and-hold in the demo; the code stays dormant. |
| D5 | ✅ | The receipt: whole rule set + whole decision with inputs + honesty labels, hash-linked in an append-only file store. `replay` re-runs the pure evaluator on the stored inputs → identical hash (beat 4). `renderReport` is the byte-stable audit report (beat 5). Beat 2 is now the ALLOW case with its receipt. |

---

## Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **SERV credits not free for participants** | 🔴 Blocker | Confirm D0 in Telegram. Fallback: budget ~$20–40 of credits; use `gpt-5.4-mini`/`claude-haiku-4.5` for all non-demo paths |
| Deadline is 27 not 28 Sep | 🟠 High | Plan to 27 Sep; treat 28 as buffer only |
| IXS dev API instability (`api-dev-v2`) | 🟠 High | Cache last-good vault snapshots; demo must degrade to cached data, never to an error screen |
| Mandate DSL scope creep | 🟠 High | Hard cap of 6 rule types. Enforce at D2 |
| Telegram trigger wiring is fiddly | 🟡 Med | Budget the full D6; the 5-step sequence is documented — follow it literally |
| ERC-8004 needs Base **mainnet** gas | 🟡 Med | Fund wallet at D0; try/catch so failure is non-fatal |
| Live demo fails on stage | 🟡 Med | Pre-recorded video as primary; live as bonus |

## Verification

- **Integration smoke tests (D1, then in CI):** a SERV call returning 200 with a shadow-agent-validated body; `vault_get` returning vault metadata; a positions read returning balances.
- **Compliance evaluator test suite (D3 onward, the most important tests):** a fixture table of ~15 `(mandate, state, action)` cases with expected ALLOW/REFUSE. **Refusals must be deterministic** — this is the demo's centerpiece and cannot be flaky. Include an adversarial case: a user message attempting to talk the agent past its mandate, which must still refuse.
- **End-to-end on BSC testnet** (sync, live) and Fuji (async, once IXS raises the cap): deposit → shares received → redeem → assets returned, asserted against on-chain balances, for **both** settlement kinds. Until the burner is funded, the same pipeline runs in dry-run simulation against the real chain.
- **Demo rehearsal (D11–D13):** the full 6-beat script start-to-finish, three consecutive clean runs, from a cold start on a fresh browser profile.

## Open questions for Telegram (D0)

1. Exact submission deadline — 27 or 28 September?
2. Where and in what format do we submit (repo + video + written brief)?
3. Can one project be entered in more than one track?
4. Do participants receive free SERV Reasoning credits, and at what limit?

---

# 🔴 D0 RECON — VERIFIED FINDINGS & PLAN AMENDMENTS
*(Live probes run 13 Sep 2026. These supersede the Track B config block above.)*

## ❌ CORRECTION: the Base Sepolia target is dead

The `.env.example` in `IXS-Finance/ixs-rwa-agent-skills` is **stale**:
- `GET /vaults/ixs-tokenized-vault-base-sepolia` → `404 {"code":"VAULT_NOT_FOUND"}`
- There is **no Base Sepolia vault registered** in the live API or MCP at all.
- The contract `0x9421...` still answers on-chain (`paused()=false`, `totalAssets()≈283 USDC`) but is orphaned from the API/MCP layer — unusable for our build.

**Action:** retarget to the live vault set below. Never trust that `.env.example` again; treat `vaults_list` as the source of truth.

## ✅ The live vault set (`GET /vaults` — 5 active vaults, 5 chains)

| Vault | id | Chain | Asset | Whitelist |
|---|---|---|---|---|
| IXHYB - Avalanche | `6a952683732c2b84b55ce89b` | Avalanche Fuji **testnet** (43113) | USDC | no |
| IXHYB - BSC | `6a278b40a7d16b245d665479` | BSC **testnet** (97) | USDC | no |
| IXHYB - Arc | `6a8832299e7fddf1f49e6f6c` | Arc **testnet** (5042002) | USDC | no |
| t_ix7540v1 | `6a8ebe8e732c2b84b55ce88c` | BSC **testnet** (97) | USDC | **yes** |
| **IXHYB - Robinhood** | `6a8832289e7fddf1f49e6f51` | **Robinhood Chain MAINNET** (4663) | **USDG** | no |

**Primary dev target:** Avalanche Fuji (`6a952683732c2b84b55ce89b`) — testnet, no whitelist, all 4 actions.

## 🏆 STRATEGIC UPGRADE: this is now a DUAL-TRACK build

**IXS has a vault deployed on Robinhood Chain mainnet.** Verified live:
- `eth_chainId` → `0x1237` (4663) ✅ · `eth_blockNumber` → `0x3b2fd63` (~62.06M) ✅
- Vault `0x4a8B74A9d246082b671540492222e89c9A866498`: `totalAssets()` ≈ **2.199 USDG**, `totalSupply()` ≈ 2.199 shares, ERC-7540 async
- RPC `https://rpc.mainnet.chain.robinhood.com` is **public and permissionless** · Explorer: `robinhoodchain.blockscout.com`

The Mainnet & MCP track reads: *"Agents that **act on Robinhood Chain** OR operate funds via Robinhood MCP."* Acting on Robinhood Chain needs **no brokerage approval** — only the *brokerage MCP* is gated. My earlier risk call was half right: the MCP is gated, **the chain is wide open**.

**Therefore one build legitimately straddles two tracks** — allocate into licensed IXS vaults (RWA Vaults) *while acting on Robinhood Chain* (Mainnet & MCP). Most entrants will wrongly assume the Robinhood track is closed to them. ⚠️ Confirm multi-track eligibility in Telegram (already open question #3); if we must pick one, **enter RWA Vaults and let Robinhood Chain support be the differentiator**.

## 🏆 STRATEGIC UPGRADE: cross-chain concentration is REAL

With 5 live vaults across 5 chains, Mandate's concentration and diversification rules operate on a **genuine multi-chain vault universe** — not a simulated one. This was the weakest part of the concept and it is now the strongest. Mandate becomes a real cross-chain RWA treasury allocator.

## ✅ IXS MCP verified live and **unauthenticated**

`POST https://api-dev-v2.ixs.finance/mcp` (SSE; send `Accept: application/json, text/event-stream`). `tools/list` returns 8 tools, all `readOnlyHint: true` — they **build unsigned payloads and never send transactions**:

```
vaults_list · vault_get · vault_check_whitelist · vault_request_status
vault_build_request_deposit · vault_build_request_redeem
vault_build_claim_deposit  · vault_build_claim_redeem
```

- No API key needed → **the IXS integration risk is fully retired on D0.**
- `vault_check_whitelist` is undocumented in the skills repo → becomes **mandate rule type #7** (only enter vaults this wallet is cleared for). The whitelisted `t_ix7540v1` vault gives us a *real* refusal case to demo.
- Every vault is ERC-7540 **async** → the `request → poll vault_request_status → claim` lifecycle is the **mandatory** path, not an edge case. Build for async first; there is no sync vault to fall back to.

## ⚠️ Local environment gotcha

Windows `curl`/schannel fails on the Robinhood Chain RPC with `CRYPT_E_REVOCATION_OFFLINE`; `--ssl-no-revoke` fixes it. Node's TLS stack is independent, so this likely won't affect the app — but if RPC calls fail locally, this is why, not a bad endpoint.

## Amended D0 / D1

- **D0 (rest of today):** pre-register typeform · OpenServ console + SERV key · **confirm free credits in TG** · burner wallet + **Avalanche Fuji** testnet gas & USDC (not Base Sepolia).
- **D1:** IXS risk is already retired — spend the day on the **SERV Reasoning** half (shadow agent + Multipath), then wire `vaults_list`/`vault_get` into a read-only Telegram reply across all 5 vaults.
