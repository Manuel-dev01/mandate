<div align="center">

# Mandate

### The autonomous treasurer that is provably incapable of breaking its mandate.

*Write your treasury policy in plain English. Mandate compiles it into machine-checkable rules, allocates your capital into licensed RWA yield vaults, and produces an audit-grade receipt for every decision it makes — and every one it refuses.*

**SERV Hackathon Edition 01** · RWA Vaults (IXS) + Mainnet & MCP (Robinhood Chain)

</div>

---

## The problem

Autonomous agents that move money have no way to prove they stayed inside their instructions.

You can tell an agent "never put more than 40% in one vault." It will agree. It may even comply. But when the treasurer, the auditor, or the regulator asks *"prove it never breached the policy, across all 4,000 decisions last quarter"* — there is nothing to show. A chat log is not an audit trail, and an LLM's promise is not a control.

This is the single reason agentic finance stalls in procurement. Not capability. **Provability.**

## What Mandate does

Mandate treats an investment policy as an **executable compliance contract**, not a prompt.

1. **Write the mandate in English.** *"Preserve capital. Never exceed 40% in a single vault. Keep a 20% liquidity buffer. Only enter vaults this wallet is cleared for. Never touch a paused vault."*
2. **It compiles to rules.** SERV Reasoning turns the prose into a typed, versioned rule set you can read and diff.
3. **It allocates.** Deposits and redemptions across IXS licensed RWA vaults on five chains — including Robinhood Chain.
4. **It refuses.** When an instruction would breach the mandate, Mandate declines and cites the exact clause and the exact numbers.
5. **It proves it.** Every decision — allowed or refused — emits a hash-anchored receipt showing the inputs, the rules evaluated, the verdict, and the reasoning.

> The interesting output of an agent that handles money is not what it did.
> It is **what it refused to do, and why.**

## Why the refusal is the product

Rule checks are **deterministic TypeScript predicates**, evaluated in code — never by a model. SERV Reasoning is used to *compile* English into rules and to *explain* a verdict in human language. It is never asked to *decide* one.

That separation is the whole design. It means a refusal is reproducible, testable, and defensible — the same inputs always produce the same verdict, and the receipt proves which rule fired. An agent whose constraints are merely *suggested* to a model is not constrained at all.

Mandate is also **non-custodial by construction**. The IXS MCP returns *unsigned* transaction payloads; the agent plans, and a signer approves. Mandate never holds custody and never broadcasts unilaterally.

## Architecture

```
        plain English mandate
                 |
                 v
    [ SERV Reasoning ]  compile -> typed rule set
                 |
                 v
    [ Compliance Evaluator ]  deterministic predicates   <-- the core IP
         |            |
      ALLOW        REFUSE
         |            |
         v            v
   [ IXS MCP ]   [ Audit Receipt ]  hash-anchored, replayable
   unsigned tx        |
         |            v
         v      [ Web Audit Console ]
   [ Signer ] -> Avalanche Fuji / BSC / Arc / Robinhood Chain
```

| Layer | Technology |
|---|---|
| Reasoning | **SERV Reasoning** — `serv_shadow_agent` validation, `serv_prompt_guard` injection defence |
| Yield | **IXS** licensed RWA vaults (ERC-7540 async), 5 vaults across 5 chains |
| Chains | Avalanche Fuji, BSC testnet, Arc testnet, **Robinhood Chain mainnet** |
| Interaction | Telegram agent (OpenServ triggers) |
| Proof | Next.js audit console |
| Monetization | **x402** paywall on exported audit reports · **ERC-8004** on-chain agent identity |

## Two tracks, one build

- **RWA Vaults (IXS)** — Mandate allocates capital into licensed IXS RWA yield vaults.
- **Mainnet & MCP** — it does so *on Robinhood Chain*, whose RPC is public and permissionless. IXS has a live IXHYB vault deployed there.

## Revenue model

| Stream | Mechanism |
|---|---|
| Audit reports | **x402** paywall, priced per exported report |
| Allocation fee | Basis points per rebalance executed under mandate |
| Compliance SaaS | Seat-based, for treasuries running multiple mandates |
| Agent-to-agent | **ERC-8004** identity makes Mandate discoverable and hireable by other agents |

The buyers are the ones IXS already sells to — broker-dealers, RIAs, fintechs and neobanks holding idle stablecoin balances, all of whom need the audit trail before they can touch onchain yield at all.

## Running it

```bash
cp .env.example .env        # add SERV_API_KEY, then a burner key for testnet writes
node scripts/smoke.mjs      # verifies every live integration — no install required
npm install
npm run dev --workspace=agent
npm run dev --workspace=web
```

`scripts/smoke.mjs` has zero dependencies and checks SERV Reasoning, the IXS MCP and REST API, and live vault reads on both Avalanche Fuji and Robinhood Chain.

## Safety

Writes target testnet. Robinhood Chain mainnet is read-and-plan only unless an action is explicitly approved. Burner wallets only, funded with the minimum needed. Mandate plans transactions; it never holds custody.

## Documentation

| Doc | Contents |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | Working agreement, verified constants, guardrails |
| [`docs/RECON.md`](./docs/RECON.md) | Live-probe evidence for every integration claim |
| [`docs/MANDATE_DSL.md`](./docs/MANDATE_DSL.md) | The seven rule types |
| [`docs/DEMO_SCRIPT.md`](./docs/DEMO_SCRIPT.md) | The six-beat demo — the build's real spec |
| [`docs/STRATEGY.md`](./docs/STRATEGY.md) | Track selection and competitive reasoning |
