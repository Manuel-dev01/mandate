/**
 * Run the Mandate agent for OpenServ.
 *
 *   npm run agent --workspace=agent
 *
 * Opens the SDK tunnel to agents-proxy.openserv.ai (no public URL needed —
 * the demo runs from this machine). Set DISABLE_TUNNEL=true when deployed
 * behind a public endpoint. Credentials come from `npm run provision`
 * (.openserv.json) — nothing is invented here.
 */

import { getProvisionedInfo } from '@openserv-labs/client'
import { run } from '@openserv-labs/sdk'
import { REPO_ROOT } from '../env.js'
import { AGENT_NAME, createMandateAgent } from '../telegram/agent.js'
import { defaultDeps } from '../telegram/capabilities.js'

const WORKFLOW_NAME = 'mandate-telegram'

async function main(): Promise<void> {
  process.chdir(REPO_ROOT) // getProvisionedInfo reads .openserv.json from cwd
  const info = getProvisionedInfo(AGENT_NAME, WORKFLOW_NAME)
  const apiKey = process.env['OPENSERV_API_KEY'] ?? info?.apiKey
  if (!apiKey) {
    console.error('No agent credentials. Run `npm run provision --workspace=agent` first (it writes .openserv.json).')
    process.exit(1)
  }

  // Fail early and clearly on a missing burner key or unreadable stores.
  const deps = defaultDeps()
  console.log(`Mandate agent · wallet ${deps.wallet} · agentId ${info?.agentId ?? '?'} · workflowId ${info?.workflowId ?? '?'}`)

  const agent = createMandateAgent({ deps, apiKey })
  if (info?.authToken) agent.setCredentials({ apiKey, authToken: info.authToken })

  const { stop } = await run(agent)
  console.log(`connected${process.env['DISABLE_TUNNEL'] ? ' (HTTP only)' : ' via tunnel'} — waiting for Telegram messages. Ctrl-C to stop.`)
  process.on('SIGINT', () => void stop().then(() => process.exit(0)))
}

main().catch((err) => {
  console.error(`agent: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
