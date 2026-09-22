/**
 * The console back end: view models and the read-only HTTP API the web console
 * renders. One process with the Telegram bot (bin/serve.ts).
 */
export * from './view.js'
export { createConsoleHandler, createConsoleServer, defaultConsoleDeps, type ConsoleDeps, type ConsoleHandler } from './api.js'
