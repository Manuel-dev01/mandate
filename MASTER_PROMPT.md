# Master Prompt — Mandate

Paste **Prompt 1** into a fresh Claude Code session in this folder to begin D1. Later prompts follow the same shape. The standing guardrails block at the bottom gets appended to any prompt that writes OpenServ platform code.

**Status (18 Sep):** Prompts 1–6 are done. Prompt 4's execution path is built but **shelved** — IXS: "we don't have a vault accessible on testnet"; the product surface is decide + prove. D6 platform provisioning awaits the account decision (RECON §6.11). Next is **Prompt 7** (the web console).

---

## Prompt 1 — D1: build the two clients, prove the loop ✅ done

**Current state (13 Sep, end of D0):** scaffold complete, `node scripts/smoke.mjs` is **11/11 green**, `SERV_API_KEY` works and has credits. Both integration risks are retired. Nothing in `packages/agent/src/` is implemented yet.

```
Read CLAUDE.md and docs/RECON.md before writing anything. Every endpoint, vault ID and
chain ID you need is already verified there — do not re-derive them, and do not trust the
IXS skills repo .env.example (it is stale and points at a Base Sepolia vault that no
longer exists).

STATE: D0 is done. The scaffold is in place, `node scripts/smoke.mjs` passes 11/11, and
SERV_API_KEY is set and working with credits. Both integration risks are retired. Nothing
under packages/agent/src/ is implemented yet — that starts now.

GOAL FOR D1: two typed clients and one integration test that proves the end-to-end loop.
Nothing else.

1. packages/agent/src/serv/client.ts — typed SERV Reasoning client.
   - Use the `openai` SDK with baseURL https://inference-api.openserv.ai/v1 and
     apiKey from SERV_API_KEY. Do not hand-roll HTTP.
   - ALWAYS send a system prompt; a request without one returns 400.
   - Use max_completion_tokens, NEVER max_tokens (400s on current models).
   - Every system prompt must forbid LaTeX and display math — default output is
     LaTeX-formatted markdown, which renders as garbage in Telegram.
   - Support attaching SERV Tools: serv_prompt_guard, and serv_shadow_agent with
     `hint` and `max_iterations` set as `default` values inside the tool's JSON schema.
   - Handle the guard short-circuit: on an injection attempt the API returns a bare
     refusal with zero token usage and no answer. Surface that as a distinct typed
     result (e.g. { kind: 'guarded' }) rather than treating it as a normal completion.
   - Default model gpt-5.4-mini. Models are paid — never loop a frontier model in tests.

2. packages/agent/src/ixs/mcp.ts — typed IXS MCP client.
   - POST https://api-dev-v2.ixs.finance/mcp, header
     Accept: application/json, text/event-stream
   - Response is SSE: take the line starting with `data: ` and strip the prefix.
   - tools/call results are DOUBLE-ENCODED: result.content[0].text is itself a JSON
     string needing a second JSON.parse. tools/list is NOT wrapped this way.
     scripts/smoke.mjs has the working unwrap — copy it, do not re-solve it.
   - Wrap all 8 tools. Every one is read-only/build-only and returns UNSIGNED payloads.
     Never add broadcasting to this module.
   - Zod-validate every response. vault_get returns { ok, settlement, vault, pricing };
     pricing fields are decimal STRINGS — parse to bigint at the boundary, never float.
   - Cache the last good result so a dev-host wobble degrades instead of crashing.

3. One integration test proving the loop: fetch the live vault set via vaults_list, then
   ask SERV — with serv_shadow_agent attached and a hint forcing a numeric answer — to
   summarise the vault universe. Assert 200, non-empty content, and that all 5 known
   vault IDs are present.

DO NOT build the mandate compiler or the compliance evaluator — those are D2 and D3.
DO NOT add an eighth rule type, a frontend, or any signing code today.

Verify by running `node scripts/smoke.mjs` and then the integration test, and show me the
real terminal output of both. If SERV starts returning 401 or a credits error, stop and
tell me — that is a blocker, not something to work around.
```

---

## Prompt 2 — D2: the mandate DSL ✅ done

```
Read CLAUDE.md and docs/MANDATE_DSL.md.

Build `packages/agent/src/mandate/schema.ts` and `compile.ts`.

- A Zod schema for the mandate rule set covering EXACTLY the seven rule types in
  docs/MANDATE_DSL.md. Seven. Do not invent an eighth — scope creep here is the
  documented top risk for this build.
- `compile(englishText) -> RuleSet` using SERV structured outputs, with
  serv_shadow_agent attached and a hint requiring every rule to carry a numeric
  threshold and a verbatim source quote from the user's text.
- Every rule records the phrase it came from, so the console can show provenance.
- The rule set is versioned and content-hashed.

Write table-driven tests: at least 8 English mandates with their expected compiled rule
sets, including one deliberately ambiguous phrasing that must compile to a conservative
interpretation rather than silently dropping a rule.
```

---

## Prompt 3 — D3: the compliance evaluator (core IP) ✅ done

```
Read CLAUDE.md, docs/MANDATE_DSL.md and docs/DEMO_SCRIPT.md.

Build `packages/agent/src/mandate/evaluate.ts`:

  evaluate(ruleSet, portfolioState, vaultState, proposedAction)
    -> { verdict: 'ALLOW' | 'REFUSE', citedRules[], numbers, rationale }

CRITICAL DESIGN CONSTRAINT: every rule check is a deterministic TypeScript predicate
evaluated in code. The model NEVER decides a verdict. SERV is called only afterwards, to
render the already-decided verdict into human-readable prose, with serv_prompt_guard
enabled so a user cannot talk the agent past its own mandate. If you catch yourself
sending "should this be allowed?" to a model, you have broken the design — stop and
tell me.

Then write the fixture suite — this is the most important test file in the repo:
~15 (ruleSet, state, action) cases with expected verdicts, covering every one of the
seven rule types, both ALLOW and REFUSE. Must include:
  - the real whitelist refusal (vault t_ix7540v1, id 6a8ebe8e732c2b84b55ce88c)
  - a concentration-limit refusal with exact numbers
  - an adversarial case: a user message trying to argue the agent past a rule, which
    must still REFUSE

Refusals must be bit-for-bit reproducible across runs. Run the suite 3 times and show me
identical output.
```

---

## Prompt 4 — D4: the execution path ✅ built, then shelved (RECON §6.10)

```
Read CLAUDE.md, docs/RECON.md §6 and docs/DEMO_SCRIPT.md beat 2.

STATE: D1–D3 are committed. evaluate() produces a hashed Decision; nothing signs or
broadcasts yet. Live facts, re-probed 16 Sep: only IXHYB-BSC (6a278b40a7d16b245d665479,
sync ERC-4626) builds a deposit — Fuji/Arc/t_ix7540v1 cap at maxDeposit 0, Robinhood is
mainnet. vault_request_status is broken upstream. The BSC test USDC has an OWNER-ONLY mint;
the burner (AGENT_PRIVATE_KEY in .env) is funded by IXS on request, or not at all.

GOAL FOR D4: an ALLOW decision becomes a transaction, for both settlement kinds, with
signing in exactly one module. Nothing else.

1. packages/agent/src/signer/index.ts — THE signing module. The only file that may
   import privateKeyToAccount or call sendTransaction. Guardrails run before anything
   touches a transport: refuse BLOCKED_WRITE_CHAIN_IDS (4663, 8453, 1), refuse over
   MAX_ACTION_ASSET_AMOUNT, and EXECUTION_MODE=dry-run (the default) simulates via
   eth_call/estimateGas and never broadcasts. Never log the key.

2. packages/agent/src/execute/ — plan.ts turns a Decision into an ExecutionPlan and
   throws unless verdict === 'ALLOW' AND verifyDecisionHash() passes: a REFUSE can never
   reach the signer by construction. run.ts executes the plan: allowance check before
   any approve step; sync = send in order; async-erc7540 = request -> extract requestId
   from the receipt logs -> poll -> claim. status.ts reads ERC-7540 pending/claimable
   views on-chain because vault_request_status is broken, trying the MCP tool first and
   degrading typed.

3. packages/agent/src/mandate/portfolio.ts — live PortfolioState from chain (asset
   balanceOf as idle, share balanceOf x convertToAssets as positions), with a declared
   fallback from portfolio.declared.json. PortfolioState gains `source: 'onchain' |
   'declared'` and it lands in the decision hash. A declared portfolio is never hidden.

4. Tests. Unit: signer refuses 4663 before the transport is touched; dry-run never sends;
   planAction rejects REFUSE and tampered hashes; requestId extraction; allowance skip.
   Live: real unsigned approve+deposit from IXS for BSC; dry-run simulation reaches the
   chain (approve simulates, deposit reverts for the balance reason); Fuji ERC-7540 views
   read on-chain. A live 1 USDC deposit + redeem on BSC runs ONLY when EXECUTION_MODE=live
   and the burner holds tBNB and USDC — otherwise it skips loudly.

DO NOT persist receipts (D5), wire Telegram (D6), build UI, or touch x402/ERC-8004 (D9).
DO NOT write to chain 4663 under any circumstances. Beat 2 targets BSC; switch to Fuji
only if IXS raises the cap (IXS_WRITE_VAULT_ID).

Verify: npm ci produces a loadable viem, typecheck, unit, integration in dry-run, and
show real output. If the burner is funded, show the BSC tx hashes.
```

---

## Prompt 5 — D5: the audit trail ✅ done

```
Read CLAUDE.md and docs/DEMO_SCRIPT.md beats 4 and 5.

STATE: decide + prove is the product. Nothing executes (IXS: no vault accessible).

GOAL: every decision becomes a receipt — the whole rule set, the whole Decision with
its inputs, and the honesty labels — hash-linked in an append-only store; `replay`
re-runs the pure evaluator on the stored inputs and must reproduce the identical
decision hash; `renderReport` produces the byte-stable audit report.

Built: packages/agent/src/audit/{receipt,store,report,index}.ts, bin/receipt.ts,
Decision.explanation (unhashed SERV trace). Verified with the two live cases.
```

---

## Prompt 6 — D6: the Telegram surface ✅ handlers done; platform wiring pending account decision

```
Read CLAUDE.md, docs/RECON.md §6.11 and docs/DEMO_SCRIPT.md beats 1–3.

GOAL: the demo's Telegram surface on OpenServ. Five capabilities that return the
EXACT text to relay — set_mandate, propose_action, get_receipt, vault_status, help —
built on compile/evaluate/explain/record. The runtime LLM routes; it never decides.
Provisioning follows the standing guardrails block literally and STOPS if the Telegram
integration is not in the account. Also: close the cold-start gap with disk snapshots.

Built: telegram/{capabilities,agent,mandates}.ts, bin/{provision,agent}.ts, LastGood
disk tier. 12 unit + 5 live (every beat as a chat reply).
```

---

## Standing guardrails block

Append this verbatim to any prompt that writes OpenServ platform code (triggers, x402, ERC-8004, provisioning).

```
--- OPENSERV GUARDRAILS (standard — do not change) ---

Read these skills before writing any OpenServ platform code:
- https://github.com/openserv-labs/skills/blob/main/skills/openserv-client/SKILL.md
- https://github.com/openserv-labs/skills/blob/main/skills/openserv-client/reference.md
- https://github.com/openserv-labs/skills/blob/main/skills/openserv-agent-sdk/SKILL.md
- https://github.com/openserv-labs/skills/blob/main/skills/openserv-multi-agent-workflows/SKILL.md

Auth: provision() creates or reuses the wallet and writes WALLET_PRIVATE_KEY to .env on
first run. It is the ONLY key — do not invent OPENSERV_API_KEY or similar. All calls go
through the client library, EXCEPT the integration-attachment POST, which needs the
x-openserv-key header.

Triggers: webhook -> triggers.webhook({ waitForCompletion: true, timeout: 600 });
cron -> triggers.cron(schedule); x402 -> triggers.x402. Always activate after creation.

Telegram needs dedicated wiring — provision() does NOT handle integration triggers:
  1. client.triggers.create({ workflowId, name, integrationConnectionId,
     trigger_name: 'on-message', props: { regexMatch: '.*' } }) then activate
  2. client.tasks.create({ workflowId, agentId, description })
  3. POST /workspaces/{workflowId}/tasks/{taskId}/integration-connections
     with header x-openserv-key: <string from client.authenticate(WALLET_PRIVATE_KEY)>,
     NOT Bearer
  4. Wire the graph with client.put(`/workspaces/${workflowId}/sync`, {...}) —
     do NOT use POST /edges, it 404s
  5. client.workflows.setRunning({ id: workflowId })

Integrations must be added in the OpenServ UI first (Connect -> Integrations). If one is
missing, STOP and tell me rather than inventing a fallback.

ERC-8004: registration mints on Base MAINNET (8453) and needs real ETH for gas. Reload
env with dotenv.config({ override: true }) after provision() before instantiating the
client, and wrap registration in try/catch so a gas failure cannot break startup.

Execute what you write — run it with `npx tsx <file>.ts`, print the resulting
workflowId / triggerId / taskId, and for x402 print result.paywallUrl. Do not just write
the file and claim success.
```

---

## Prompt hygiene that matters for this build

- **Always start with "Read CLAUDE.md and docs/RECON.md."** They contain live-verified constants. Re-deriving them wastes a day and risks reintroducing the dead Base Sepolia endpoint.
- **State the day and its single goal.** This build is deadline-bound; a prompt without a scope boundary invites a model to build D7 features on D2.
- **Name what NOT to build.** The top documented risk here is scope creep in the mandate DSL.
- **Demand real output.** Ask for the actual command output, not a claim of success.
- **Escalate blockers, don't route around them.** A SERV credits failure is a go/no-go for the whole project — it must surface immediately, not get stubbed out.
