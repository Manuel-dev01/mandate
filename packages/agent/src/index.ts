/**
 * Mandate — agent entrypoint.
 *
 * D1: the two typed clients. D2: the mandate compiler. D3 adds the compliance
 * evaluator. Nothing in this package may sign or broadcast: signing lives in
 * exactly one module (not yet written), and the IXS layer only ever returns
 * UNSIGNED payloads.
 */

export * as ixs from './ixs/index.js'
export * as mandate from './mandate/index.js'
export * from './serv/client.js'
export { env } from './env.js'
