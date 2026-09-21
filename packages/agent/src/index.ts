/**
 * Mandate — agent entrypoint.
 *
 * D1: the two typed clients. D2: the mandate compiler. D3: the compliance
 * evaluator. D4: the execution path. Signing lives in exactly one module
 * (signer/), and the IXS layer only ever returns UNSIGNED payloads.
 */

export * as ixs from './ixs/index.js'
export * as mandate from './mandate/index.js'
export * as execute from './execute/index.js'
export * as signer from './signer/index.js'
export * as audit from './audit/index.js'
export * as telegram from './telegram/index.js'
export * from './serv/client.js'
export { env } from './env.js'
