/**
 * Execution — an ALLOW decision becomes a transaction.
 *
 *   plan.ts    Decision -> ExecutionPlan (the gate: ALLOW + verifying hash only)
 *   run.ts     ExecutionPlan -> ExecutionResult, sync or ERC-7540 async
 *   status.ts  on-chain pending/claimable views (vault_request_status is broken)
 *   chain.ts   read-only clients and ABIs
 *
 * Signing happens in signer/, never here.
 */

export * from './plan.js'
export * from './run.js'
export * from './status.js'
export { publicClientFor, chainOf, ERC20_ABI, ERC4626_ABI, ERC7540_ABI, clearChainClients, type TransportFactory } from './chain.js'
