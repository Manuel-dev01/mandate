# The receipt

Every decision Mandate makes — allowed or refused — is issued as a receipt. A receipt is a single JSON document that carries everything needed to reproduce the decision, and three hashes that let anyone check nothing was altered afterwards.

There is no execution block. IXS vaults are not open to outside deposits during the hackathon build window, so the product is the decision and its proof.

## Shape (`mandate.receipt/1`)

```
{
  schema:      "mandate.receipt/1",
  id:          <sha256>,                 // equals hash
  createdAt:   ISO-8601,
  mandate:     RuleSet,                  // hash, version, the treasurer's English, the seven-or-fewer rules
                                         //   each with the verbatim clause it came from and whether a threshold was inferred
  decision:    Decision,                 // verdict, every rule check (actual / limit / pass), cited breaches, numbers,
                                         //   the exact inputs (portfolio, vault facts, action, the treasurer's message),
                                         //   the explanation and its SERV trace, and the decision hash
  environment: { portfolioSource, factsStale, rationaleSource, network, chainId, agentVersion },
  previousId:  <sha256> | null,          // the receipt before this one
  hash:        <sha256>
}
```

## What each hash commits to

| Hash | Over | Meaning |
|---|---|---|
| `mandate.hash` | version, source text, rules, unmappable clauses | *These* rules, from *these* words. Timestamps and the compiling model are excluded. |
| `decision.hash` | verdict, rule-set hash, every check, cited rules, numbers, inputs | *This* verdict from *these* inputs. Prose (`rationale`), its source, the SERV trace and the timestamp are excluded — explanation never moves a verdict. |
| `hash` (= `id`) | schema, mandate, decision, environment, `previousId` | The whole record, chained to the one before. Only `createdAt` is outside it. |

Two decisions with the same inputs under the same mandate produce the same decision hash, every time, because the evaluator is pure TypeScript with no model in the loop.

## Honesty labels

- `environment.portfolioSource` — `onchain` (balances read from chain) or `declared` (a seed file). The demo uses `declared` and every receipt says so.
- `environment.factsStale` — vault pricing came from the last good snapshot because IXS was unreachable.
- `environment.rationaleSource` — `serv` (prose from SERV Reasoning) or `template` (the deterministic fallback, e.g. when `serv_prompt_guard` fired).
- `decision.inputs.action.userMessage` — the treasurer's words, stored verbatim. No rule reads this field.

`verifyReceipt` checks that these labels match the inputs they describe, so a declared portfolio cannot be relabelled as live.

## Verifying one

```bash
npm run receipt --workspace=agent -- verify <id>    # re-derives all three hashes and the label consistency
npm run receipt --workspace=agent -- replay <id>    # re-runs the evaluator on the stored inputs; must reproduce decision.hash
npm run receipt --workspace=agent -- verify all     # walks the chain: every link, every file
npm run receipt --workspace=agent -- export <id>    # the human-readable audit report (byte-stable)
```

By hand: canonicalise the JSON (keys sorted at every level, no whitespace), drop `hash`, `id` and `createdAt`, and sha256 the rest — you get `hash`. For the decision, canonicalise `{ verdict, ruleSetHash, ruleSetVersion, checks, citedRules, numbers, inputs }` and sha256 it — you get `decision.hash`.

## Storage

`data/receipts/<id>.json`, one file per receipt, plus `data/receipts/chain.jsonl`, one index line per receipt in order. Append-only: a receipt whose `previousId` is not the current head is refused. The directory is gitignored because receipts carry the wallet address.
