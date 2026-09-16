# RECON — live-probe evidence

All probes run **13 September 2026**. This file is the evidence behind the constants in `CLAUDE.md`. If something breaks, re-run these before assuming the code is at fault.

---

## 1. The IXS skills repo `.env.example` is stale

```
$ curl -s https://api-dev-v2.ixs.finance/vaults/ixs-tokenized-vault-base-sepolia
{"error":{"code":"VAULT_NOT_FOUND","message":"Unknown vaultId","status":404}}
```

The orphaned Base Sepolia contract `0x9421a6C925D466Ac22956B1a7D553c3E74F59571` still answers on-chain (`paused()` false, `totalAssets()` ≈ 283.6 USDC) but is **not registered in the API or MCP**, so it cannot be used through IXS tooling.

**Conclusion:** ignore that `.env.example` entirely. REST `GET /vaults` is the source of truth (MCP `vaults_list` returns a subset — see §6.1).

---

## 2. The live vault universe

```
$ curl -s https://api-dev-v2.ixs.finance/vaults
```

5 active vaults:

| Vault | id | chainId | Network | Asset | Whitelist |
|---|---|---|---|---|---|
| IXHYB - Avalanche | `6a952683732c2b84b55ce89b` | 43113 | avalanche-testnet | USDC | no |
| IXHYB - BSC | `6a278b40a7d16b245d665479` | 97 | bsc-testnet | USDC | no |
| IXHYB - Arc | `6a8832299e7fddf1f49e6f6c` | 5042002 | arc-testnet | USDC | no |
| t_ix7540v1 | `6a8ebe8e732c2b84b55ce88c` | 97 | bsc-testnet | USDC | **yes** |
| IXHYB - Robinhood | `6a8832289e7fddf1f49e6f51` | 4663 | robinhood-mainnet | **USDG** | no |

All expose `actions: ["deposit","mint","withdraw","redeem"]` and `status: "active"`.

Every subgraph URL is of the form `ixs-erc7540-vault-<network>`. **That naming is NOT a settlement signal:** IXHYB - BSC settles `sync` (ERC-4626) while the other four are `async-erc7540` — see §6.5. Read `vault_get.settlement`, never the URL.

---

## 3. IXS MCP is live and unauthenticated

```
$ curl -s -X POST https://api-dev-v2.ixs.finance/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

event: message
data: {"result":{"tools":[...]}}
```

No API key required. Response is **SSE** — strip the `data: ` prefix before parsing.

Tools returned:

```
vaults_list                  vault_get
vault_check_whitelist        vault_request_status
vault_build_request_deposit  vault_build_request_redeem
vault_build_claim_deposit    vault_build_claim_redeem
```

Every tool carries `"annotations":{"readOnlyHint":true}` and `"execution":{"taskSupport":"forbidden"}` — they **build unsigned payloads and never broadcast**.

`vault_check_whitelist` is **not documented** in the IXS skills repo. Its description: *"Check whether a wallet is whitelisted for a vault before attempting a deposit — call this ahead of vault_build_request_deposit to avoid a reverted transaction."* This became rule type #7.

---

## 4. Robinhood Chain is public and permissionless

```
$ curl -s --ssl-no-revoke -X POST https://rpc.mainnet.chain.robinhood.com \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
{"jsonrpc":"2.0","id":1,"result":"0x1237"}          # 4663

$ ... eth_blockNumber
{"jsonrpc":"2.0","id":2,"result":"0x3b2fd63"}       # ~62,061,411
```

IXHYB vault `0x4a8B74A9d246082b671540492222e89c9A866498` on chain 4663:

| Call | Selector | Result | Meaning |
|---|---|---|---|
| `totalAssets()` | `0x01e1d114` | `0x2191c0` | ≈ **2.199 USDG** (6dp) |
| `asset()` | `0x38d52e0f` | `0x5fc5360d...d168` | USDG |
| `totalSupply()` | `0x18160ddd` | `0x1e87f85809dc0000` | ≈ 2.199 shares (18dp) |
| `decimals()` | `0x313ce567` | `0x12` | 18 (shares) |

**No brokerage account, API key, or approval was used.** Only Robinhood's *brokerage MCP* (`agent.robinhood.com/mcp/trading`) is gated behind a US account in good standing; the **chain** is open. This is what makes the dual-track play legitimate.

**Explorer:** `robinhoodchain.blockscout.com` (behind Cloudflare — browser works, scripted access may be challenged).

### Windows TLS gotcha

Without `--ssl-no-revoke`, Windows `curl` fails on this RPC:

```
schannel: next InitializeSecurityContext failed: CRYPT_E_REVOCATION_OFFLINE (0x80092013)
```

This is a **local schannel revocation-check failure, not a server refusal**. Node uses OpenSSL and is unaffected.

---

## 5. SERV Reasoning

Base `https://inference-api.openserv.ai`, bearer auth, OpenAI/Anthropic SDK compatible.

- `POST /v1/chat/completions` (all models) · `POST /v1/responses` (OpenAI only) · `POST /v1/messages` (Anthropic format)
- **A system prompt is mandatory** — omitting it returns:
  `{"error":{"type":"invalid_request_error","message":"A system prompt is required..."}}`
- SERV Tools are toggled by declaring a tool named `serv_*`; SERV strips it before the model sees it. Available: `serv_prompt_guard`, `serv_shadow_agent` (`hint`, `max_iterations` default 3), `serv_disable_content_filter`.
- Catalog is **paid**, priced per million tokens including reasoning. Cheap dev models: `gpt-5.4-mini` ($1.00/$6.00), `claude-haiku-4.5` ($1.25/$6.50), `gemini-3.1-flash-lite` ($0.30/$1.80).

**UNVERIFIED — the one open blocker:** whether hackathon participants receive free credits. Confirm in the OpenServ Telegram before relying on it.

---

## 6. D1 probe — 13 Sep 2026 (supersedes parts of §2, §3, §5)

Re-probed everything before writing the clients. **Five findings contradict earlier sections; two of them are D4 blockers.** Each was reproduced live; the divergent ones 3× for stability.

### 6.1 MCP `vaults_list` returns ONE vault. REST returns five. — corrects §2/§3

```
tools/call vaults_list   x3 ->  { "ok": true, "total": 1, "vaults": [ { "id": "6a8ebe8e732c2b84b55ce88c", ... } ] }
GET /vaults                  ->  { items: [5], page, pageSize, totalItems: 5, totalPages, hasNextPage: false, ... }
```

**REST `GET /vaults` is the authoritative universe.** `listVaults()` in `packages/agent/src/ixs/index.ts` uses REST and merges MCP on top, reporting the gap as `divergence` — the canary for when IXS fixes the feed. REST items share `vault_get`'s vault shape (`rpcUrl`); only MCP `vaults_list` items use `rpc`.

### 6.2 Tool errors are PLAIN TEXT under `isError: true` — corrects the "double-encoded" rule

HTTP is 200 either way. Only successful `tools/call` results are double-encoded JSON:

```
vault_get {vaultId:"deadbeef…"}   -> result.isError: true, content[0].text: "Unknown vaultId"
tools/nope                        -> { "error": { "code": -32601, "message": "Method not found" } }
```

`JSON.parse` on the error text throws `SyntaxError: Unexpected token 'T'`. Triage order in `ixs/mcp.ts`: envelope `error` → `result.isError` → second decode. `scripts/smoke.mjs` was hardened the same way.

### 6.3 `vault_request_status` is BROKEN upstream — D4 blocker

```
{ownerAddress, vaultId}  -> isError: "Type `DepositRequest` has no field `owner`"      (subgraph query bug)
{ownerAddress}           -> isError: "Request feed query failed with status 404"
```

The ERC-7540 poll step has no working status source via MCP. Candidates for D4: on-chain `pendingDepositRequest` / `claimableDepositRequest` via viem, or the Goldsky subgraph directly.

### 6.4 Fuji cannot build a deposit: `maxDeposit` is 0 for everyone — D4 blocker

```
vault_build_request_deposit FUJI, any amount, any wallet -> "Deposit amount exceeds the current vault limit of 0 USDC."
eth_call 0x648c66…  maxDeposit(anyAddress)  -> 0x0
eth_call 0x648c66…  maxMint(anyAddress)     -> 0x0
eth_call 0x648c66…  paused()                -> false
```

A **global operator cap**, not per-owner and not KYC. Arc (`6a883229…`) and the whitelist vault behave identically. Fuji reads and **redeem** builds work (`vault_build_request_redeem` → one `vault_request_redeem` step, `settlement: "async-erc7540"`). Demo beat 2 cannot broadcast on Fuji until IXS raises the cap.

### 6.5 IXHYB - BSC is SYNC, not ERC-7540 — corrects §2

```
vault_get 6a278b40a7d16b245d665479 -> "settlement": "sync", pricing: { totalAssets: "11362.928784", totalSupply: "10449.7367…", pricePerShare: "1.087389 USDC" }
vault_build_request_deposit BSC 1000000 -> ok, settlement "sync", steps: [ erc20_approve_exact, vault_deposit "Submit ERC-4626 deposit… Settles immediately." ]
```

The §2 inference from `ixs-erc7540-vault-<network>` subgraph names was wrong — BSC's subgraph is erc7540-named but the vault settles sync. **BSC is currently the only vault that builds a deposit.** `BuildResult` in `ixs/schemas.ts` is a union over `settlement: 'sync' | 'async-erc7540'`.

### 6.6 Payload details the clients depend on

- `pricePerShare` carries a **unit suffix** (`"1.1 USDC"`, `"1 USDG"`); `totalAssets` / `totalSupply` are bare decimals. `splitUnit()` strips it before the bigint parse.
- `assetAmount` / `shareAmount` are **integer strings in base units**: `'0.1'` → `"assetAmount must be an integer string in base units"`. So 5,000 USDC is `'5000000000'`; `'5000'` silently means 0.005 USDC.
- `vault_check_whitelist` → `{ ok, whitelistEnabled, whitelisted }`. Fuji: `false/true`. `t_ix7540v1`: `true/false` — the genuine refusal.
- `vault_build_claim_deposit` with an unknown id → `"No claimable deposit for requestId 0."`
- Deposit builds carry `amount: { baseUnits, decimals }`; redeem builds carry `shares: { baseUnits, decimals: 18, symbol: "shares" }`. Every step is `{ type, description, tx: { to, data, value } }`, unsigned.

### 6.7 SERV guard short-circuit has a clean signature — extends §5

```
clean prompt + serv_shadow_agent(hint: "percentage to two decimals")
  -> content "88.80%", finish_reason "stop", usage 435/7/442, model "gpt-5.4-mini-2026-03-17"

injection + serv_prompt_guard
  -> content "I can't share that.", finish_reason "content_filter", usage 0/0/0, model "gpt-5.4-mini"
```

`ServClient.chat()` keys `{ kind: 'guarded' }` off **`finish_reason === 'content_filter'`**, corroborated by zero usage — never off the refusal string. The 435 prompt tokens for a two-line prompt confirm SERV Tools inject their own scaffolding.

### 6.7b `serv_prompt_guard` on the explanation prompt — 16 Sep 2026

With the decision summary (rule checks, quoted mandate clauses, numbers) placed in the **system** prompt and `serv_prompt_guard` attached:

```
run A: content "REFUSE. ... under the mandate words \"redacted\", ... \"actual value 50.00%, limit 40.00%\" ..."
run B: content "... vault concentration was \"actual value 0.00, limit 0.00\" ..."
run C: finish_reason content_filter, usage 0/0/0   (clean request, no user message)
```

The guard treats system-prompt content echoed into the reply as leakage. Moving the summary into the **user** turn fixed the redaction; the clean request still short-circuited roughly 1 in 3 runs, so `explain.ts` attaches the guard only when the action carries a `userMessage`. With that split: 4/4 and 3/4 (the miss was a paraphrased quote, not a guard event) across consecutive runs; the deterministic template is the answer of record whenever the guard fires.

### 6.8 Dependency note

`@openserv-labs/sdk@2.4.1` peers on `openai@^5`; the scaffold's `openai@^4` failed `npm install` with ERESOLVE. Bumped to `^5` (resolves 5.23.x). npm 11.6.2 also died once mid-install with `Exit handler never called!` while reporting exit 0 — if `node_modules/openai` is missing after an install, run it again.

**viem is not loadable as installed (16 Sep).** The network-interrupted installs left root `@scure/bip32@1.7.0` with an empty nested `@noble/curves` directory and root `@noble/curves@1.2.0` — `import 'viem'` fails with `ERR_MODULE_NOT_FOUND … @noble/curves/abstract/modular`. D3's single `paused()` read uses a raw `eth_call` instead (`mandate/facts.ts`). **D4 needs a clean `npm ci` on a stable connection before the signer can import viem.**

---

## 7. Sources

| What | Where |
|---|---|
| Hackathon brief | `https://www.openserv.ai/hackathon` (403s to scripted fetch; use a browser UA) |
| Pre-registration | `https://form.typeform.com/to/GyPxGqRn` |
| Telegram | `https://t.me/openserv.ai` |
| SERV docs index | `https://docs.openserv.ai/llms.txt` — every page is fetchable as `.md` |
| OpenServ skills | `https://github.com/openserv-labs/skills` |
| IXS skills (stale env) | `https://github.com/IXS-Finance/ixs-rwa-agent-skills` |
