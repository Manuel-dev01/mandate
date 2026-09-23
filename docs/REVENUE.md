# Revenue model

> Every figure below is labelled **measured** or **assumed**. Measured numbers come from
> this system's own receipts and on-chain transactions and can be re-derived by anyone.
> Assumed numbers are a stated model with the arithmetic exposed, so you can substitute
> your own inputs and see what changes. A product whose entire thesis is "don't claim
> what you can't prove" does not get to present an invented TAM as a fact.

---

## 1. What is already true

**Measured.** Not projections — settled transactions on Base Sepolia, recorded in an
append-only ledger that only writes after a facilitator confirms payment.

| | |
|---|---|
| Reports sold | **3** |
| Revenue | **1.50 USDC** |
| Price | 0.50 USDC per report |
| Payee | `0xEAbc…13` — the agent's own ERC-8004 identity (`84532:9316`) |
| Rails | Our own x402 (Base Sepolia) **and** OpenServ's x402 marketplace, both fulfilled by the same agent, returning byte-identical documents |

Small, and that is the point: the counter moves only when someone actually pays. It has
never been seeded, and the console says so on screen.

## 2. Unit economics

**Measured.** The evaluator is pure TypeScript — deciding costs nothing. The only variable
cost per decision is one SERV call to write the explanation *after* the verdict is already
fixed.

Across 12 live decisions: **886–1,014 tokens, mean ~940**, on `gpt-5.4-mini` at
$1.00/M input and $6.00/M output.

| Item | Cost |
|---|---|
| Rule evaluation (7 predicates) | **$0** — deterministic code |
| IXS vault reads + whitelist check | **$0** — unauthenticated API |
| SERV explanation, worst case (all 940 tokens billed as output) | **$0.0056** |
| Receipt: hash, chain, persist | **$0** |
| **Marginal cost per decision** | **< $0.006** |

Compiling a mandate is one further SERV call, and happens when the *policy* changes, not
when a decision is made — so it amortises to near zero per decision.

**Against a $0.50 report: gross margin ≥ 98.8%.** The cost of the product is not compute.
It is the trust the receipt carries.

## 3. Pricing

| Stream | Price | Status |
|---|---|---|
| **Audit report** | $0.50 per report, x402 | **Live — 3 sold** |
| **Mandate seat** | $500 / month per active mandate — unlimited decisions, receipts, console | Assumed |
| **Allocation fee** | 3 bps on value moved under mandate | Assumed |
| **Compliance tier** | $2,500 / month — multi-mandate, auditor seats, retention, SSO | Assumed |

The $0.50 report is deliberately cheap. It is not the business; it is the **wedge** — the
thing an auditor, a counterparty or *another agent* can buy without a procurement cycle.
The ERC-8004 identity is what makes the last case work: Mandate is discoverable and
hireable by other agents, which is the only distribution channel in agentic finance that
does not require a salesperson.

## 4. One customer, bottom-up

**Assumed** — a $50M stablecoin treasury running four mandates and rotating a quarter of
the book each quarter.

| Line | Working | Annual |
|---|---|---|
| Mandate seats | 4 × $500 × 12 | **$24,000** |
| Allocation fee | $50M turnover × 3 bps | **$15,000** |
| Reports | ~200 pulls × $0.50 | **$100** |
| **ACV** | | **≈ $39,000** |

Cost to serve, using the measured figures above: ~500 decisions/year × $0.006 = **$3**,
plus a share of roughly $25/month of hosting. **COGS under $350/year against $39,000 of
revenue.**

That ratio is the argument. Compliance software is priced on the liability it absorbs,
not on the compute it consumes — and this absorbs liability with a deterministic,
reproducible artifact rather than a human review queue.

## 5. Sizing

**Assumed, and shown as arithmetic rather than asserted as a number.** Substitute your own
inputs:

```
licensed RWA venues' institutional customers reachable in 3 years   500   (assumption)
share that adopt a mandate layer                                     10%   (assumption)
customers                                                             50
ACV (section 4)                                                  $39,000
                                                              -----------
ARR                                                            ~$1.95M
```

The denominator is not "all stablecoins." It is the set of institutions that (a) hold idle
stablecoin balances, (b) want onchain yield, and (c) **cannot act without an audit trail** —
which is precisely the customer IXS already sells to: broker-dealers, RIAs, fintechs and
neobanks. We are not creating that demand; we are removing the thing that blocks it.

The honest form of the top-down number: global stablecoin supply is on the order of
hundreds of billions of dollars, and tokenized treasury products are in the billions. We
have not independently verified either figure and do not rely on them. The bottom-up model
above stands on its own.

## 6. Why the refusal is the thing that gets bought

Nobody buys "an agent that allocates capital" — that is a feature, and every venue will
ship one. What stalls agentic finance in procurement is that no agent can **prove** it
stayed inside its instructions.

The buyer is not the trader. It is the person who has to sign off: the CFO, the compliance
officer, the auditor, the regulator. What they need is exactly what this produces — a
record showing, for every decision including the ones that never happened, which rule was
evaluated, against which live data, and why the answer was no.

That record is the SKU. The agent is the thing that generates it.

## 7. What would have to be true

Stated plainly, because a model that only lists upside is not a model.

- **The allocation fee is unproven.** IXS confirmed on 17 Sep that no vault — testnet or
  mainnet — accepts outside deposits during the build window, so nothing has been executed
  under mandate. The execution path is built and tested but dormant. Until a real
  rebalance settles, the 3 bps line is a plan, not a business.
- **Only the report line has revenue on the board**, and it is $1.50.
- **Seat pricing is untested.** No customer has been quoted, let alone signed.
- **The moat is the receipt format, not the code.** Rule evaluation is a few hundred lines
  of TypeScript anyone could write. What is hard to copy is a hash-linked artifact that
  auditors come to expect — which means distribution and standard-setting matter more than
  the evaluator does.

## 8. What is proven today

- A real 402, a real settlement, a real counter that only a payment moves.
- Two independent payment rails returning the identical document from one agent.
- An on-chain identity that makes the agent payable by other agents without an account.
- A marginal cost of under a cent against a price of fifty.
