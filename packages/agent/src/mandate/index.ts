/**
 * Mandate DSL — public surface.
 *
 * schema.ts    the seven rule types, the RuleSet, hashing, stricter-merge
 * compile.ts   plain English -> RuleSet via SERV structured outputs   (D2)
 * types.ts     evaluator inputs and outputs, with JSON forms           (D3)
 * evaluate.ts  the pure, deterministic compliance evaluator            (D3)
 * explain.ts   SERV prose for an ALREADY-decided verdict, guarded      (D3)
 * facts.ts     vault state, whitelist, on-chain paused()                 (D3)
 * portfolio.ts live PortfolioState, labelled declared fallback            (D4)
 *
 * The verdict is decided in evaluate.ts and nowhere else.
 */

export * from './schema.js'
export * from './types.js'
export { CompileError, compile, compileWithTrace, type CompileOptions, type CompileTrace } from './compile.js'
export { evaluate, formatPct, pctToBps, templateRationale, verifyDecisionHash, decisionHashInput } from './evaluate.js'
export { explain, type ExplainOptions } from './explain.js'
export { gatherFacts, readPausedOnChain, type GatherFactsOptions } from './facts.js'
export { loadPortfolio, loadDeclared, loadOnchain, type LoadPortfolioOptions } from './portfolio.js'

import { evaluate } from './evaluate.js'
import { explain, type ExplainOptions } from './explain.js'
import type { RuleSet } from './schema.js'
import type { Decision, PortfolioState, ProposedAction, VaultFacts } from './types.js'

/** Decide, then narrate. The verdict is fixed before SERV is asked anything. */
export async function evaluateAndExplain(
  ruleSet: RuleSet,
  portfolio: PortfolioState,
  facts: VaultFacts,
  action: ProposedAction,
  opts: ExplainOptions = {},
): Promise<Decision> {
  return explain(evaluate(ruleSet, portfolio, facts, action), opts)
}
