/**
 * One-time platform wiring for the Telegram surface. Idempotent; prints ids.
 *
 *   npm run provision --workspace=agent          (run from the repo root — provision() writes .env in cwd)
 *
 * Follows MASTER_PROMPT.md's standing OpenServ guardrails literally:
 *   1. provision()  — agent + workflow + webhook trigger; binds the agent key; state in .openserv.json
 *   2. find the Telegram integration connection (added in the OpenServ UI beforehand) — none: STOP
 *   3. triggers.create({ integrationConnectionId, trigger_name: 'on-message', props: { regexMatch: '.*' } }) + activate
 *   4. tasks.create({ workflowId, agentId, description })
 *   5. POST /workspaces/{workflowId}/tasks/{taskId}/integration-connections  with x-openserv-key (NOT Bearer)
 *   6. PUT  /workspaces/{workflowId}/sync  with the edges                     (NOT POST /edges — it 404s)
 *   7. workflows.setRunning({ id })
 *
 * WALLET_PRIVATE_KEY is created by provision() on first run and is the only
 * platform key. It is NOT the burner AGENT_PRIVATE_KEY.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PlatformClient, getProvisionedInfo, provision, triggers } from '@openserv-labs/client'
import { REPO_ROOT } from '../env.js'
import { env } from '../env.js'
import { AGENT_DESCRIPTION, AGENT_NAME, createMandateAgent } from '../telegram/agent.js'

const WORKFLOW_NAME = 'mandate-telegram'
const PAID_WORKFLOW_NAME = 'mandate-audit-report'
const PAID_TASK_DESCRIPTION =
  'The buyer has paid for one audit report. Call export_report with the receiptId from the input and return its output verbatim — it is a byte-stable Markdown document. Add nothing, summarise nothing. If no receipt matches, return the capability\u2019s message unchanged.'
const STATE_PATH = join(REPO_ROOT, 'data', 'openserv.json')
const TASK_DESCRIPTION =
  'Handle every Telegram message from the treasurer with the Mandate agent: set the mandate from plain English, evaluate proposed vault actions against it, return receipts and vault status. Relay capability output verbatim.'

interface State {
  agentId?: number
  workflowId?: number
  webhookTriggerId?: string
  telegramConnectionId?: string
  telegramTriggerId?: string
  taskId?: number
  /** The paid audit-report service (step 8). */
  paidWorkflowId?: number | undefined
  paidTriggerId?: string | undefined
  paidTriggerUrl?: string | undefined
  paywallUrl?: string | undefined
  updatedAt?: string
}

function loadState(): State {
  return existsSync(STATE_PATH) ? (JSON.parse(readFileSync(STATE_PATH, 'utf8')) as State) : {}
}
function saveState(state: State): void {
  mkdirSync(join(REPO_ROOT, 'data'), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2))
}

const step = (n: number, s: string) => console.log(`\n[${n}] ${s}`)
const fail = (n: number, what: string, err: unknown): never => {
  console.error(`\nstep ${n} failed: ${what}\n  ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

/** provision() resolves .openserv.json and .env from cwd; npm runs workspace scripts from packages/agent. */
function readUserApiKey(): string | undefined {
  const path = join(REPO_ROOT, '.openserv.json')
  if (!existsSync(path)) return undefined
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { userApiKey?: string }
  return parsed.userApiKey
}

async function main(): Promise<void> {
  process.chdir(REPO_ROOT)
  const state = loadState()

  // ---- 1. provision ------------------------------------------------------
  step(1, 'provision agent + workflow (reuses .openserv.json if present)')
  const agent = createMandateAgent()
  let agentId: number
  let workflowId: number
  try {
    const existing = getProvisionedInfo(AGENT_NAME, WORKFLOW_NAME)
    if (existing?.agentId && existing.workflowId) {
      agentId = existing.agentId
      workflowId = existing.workflowId
      console.log(`   already provisioned: agentId ${agentId}, workflowId ${workflowId}`)
    } else {
      const result = await provision({
        agent: { instance: agent, name: AGENT_NAME, description: AGENT_DESCRIPTION },
        workflow: {
          name: WORKFLOW_NAME,
          goal: 'Relay a treasurer’s Telegram message to the Mandate agent and return its reply verbatim.',
          trigger: triggers.webhook({ waitForCompletion: true, timeout: 600 }),
          task: { description: TASK_DESCRIPTION },
        },
      })
      agentId = result.agentId
      workflowId = result.workflowId
      state.webhookTriggerId = result.triggerId
      console.log(`   agentId ${agentId} · workflowId ${workflowId} · webhook trigger ${result.triggerId}`)
      if (result.apiEndpoint) console.log(`   webhook endpoint ${result.apiEndpoint}`)
    }
  } catch (err) {
    fail(1, 'provision() — is WALLET_PRIVATE_KEY/OPENSERV_USER_API_KEY valid and the platform reachable?', err)
  }
  state.agentId = agentId!
  state.workflowId = workflowId!
  saveState(state)

  // provision() stored the user API key it minted for the wallet identity.
  const userApiKey = readUserApiKey() ?? process.env['OPENSERV_USER_API_KEY'] ?? ''
  if (!userApiKey) fail(1, 'no user API key in .openserv.json — provision() did not complete', new Error('missing userApiKey'))
  const client = new PlatformClient({ apiKey: userApiKey })

  // ---- 2. the Telegram integration connection ----------------------------
  step(2, 'find the Telegram integration connection')
  let connectionId: string | undefined
  let telegramAvailable = true
  try {
    const connections = await client.integrations.listConnections()
    const telegram = connections.find((c) => /telegram/i.test(`${c.integrationName} ${c.integrationDisplayName} ${c.integrationId} ${c.name}`))
    if (!telegram) {
      // Their integration form was failing on 21 Sep (RECON §6.12) and the demo runs the
      // direct bot, so this is a skip, not a stop — steps 3-7 only wire that route.
      console.log('   none on this account — skipping the platform Telegram route (the direct bot is the demo surface)')
      console.log(`   connections seen: ${connections.map((c) => `${c.integrationDisplayName} (${c.integrationType})`).join(', ') || 'none'}`)
      telegramAvailable = false
    } else {
      connectionId = telegram.id
      console.log(`   ${telegram.integrationDisplayName} · connection ${connectionId}`)
    }
  } catch (err) {
    fail(2, 'integrations.listConnections()', err)
  }
  if (telegramAvailable) {
    state.telegramConnectionId = connectionId!
    saveState(state)
  }

  // ---- 3-7: the platform Telegram route, only when the integration exists ----
  if (telegramAvailable) {
  // ---- 3. on-message trigger --------------------------------------------
  step(3, 'create + activate the Telegram on-message trigger')
  try {
    if (state.telegramTriggerId) {
      console.log(`   reusing trigger ${state.telegramTriggerId}`)
    } else {
      const trigger = await client.triggers.create({
        workflowId: workflowId!,
        name: 'telegram',
        description: 'Every Telegram message goes to Mandate',
        integrationConnectionId: connectionId!,
        trigger_name: 'on-message',
        props: { regexMatch: '.*' },
      })
      state.telegramTriggerId = trigger.id
      saveState(state)
      console.log(`   trigger ${trigger.id}`)
    }
    await client.triggers.activate({ workflowId: workflowId!, id: state.telegramTriggerId! })
    console.log('   activated')
  } catch (err) {
    fail(3, 'triggers.create / activate', err)
  }

  // ---- 4. task ------------------------------------------------------------
  step(4, 'the task assigned to the agent')
  try {
    if (!state.taskId) {
      // provision() already created one task for the webhook trigger; reuse it
      // rather than leaving two tasks competing for the same messages.
      const tasks = await client.tasks.list({ workflowId: workflowId! })
      const mine = tasks.find((t) => t.assigneeAgentId === agentId!)
      if (mine) {
        state.taskId = mine.id
        saveState(state)
        console.log(`   reusing provision()'s task ${mine.id}`)
      }
    }
    if (state.taskId) {
      console.log(`   task ${state.taskId}`)
    } else {
      const task = await client.tasks.create({ workflowId: workflowId!, agentId: agentId!, description: TASK_DESCRIPTION })
      state.taskId = task.id
      saveState(state)
      console.log(`   task ${task.id}`)
    }
  } catch (err) {
    fail(4, 'tasks.create', err)
  }

  // ---- 5. attach the integration connection to the task ------------------
  step(5, 'attach the Telegram connection to the task (x-openserv-key header)')
  try {
    const key = userApiKey
    await client.post(
      `/workspaces/${workflowId!}/tasks/${state.taskId!}/integration-connections`,
      { integrationConnectionId: connectionId! },
      { headers: { 'x-openserv-key': key } },
    )
    console.log('   attached')
  } catch (err) {
    fail(5, 'POST .../integration-connections', err)
  }

  // ---- 6. wire the graph --------------------------------------------------
  step(6, 'sync the workflow graph (trigger -> task)')
  try {
    await client.put(`/workspaces/${workflowId!}/sync`, {
      edges: [{ from: { type: 'trigger', id: state.telegramTriggerId! }, to: { type: 'task', id: state.taskId! } }],
    })
    console.log('   synced')
  } catch (err) {
    fail(6, 'PUT /workspaces/{id}/sync', err)
  }

  // ---- 7. run -------------------------------------------------------------
  step(7, 'set the workflow running')
  try {
    await client.workflows.setRunning({ id: workflowId! })
    console.log('   running')
  } catch (err) {
    fail(7, 'workflows.setRunning', err)
  }

  } else {
    console.log('\n   steps 3-7 skipped: no Telegram integration. The paid service below does not need one.')
  }

  // ---- 8. the paid audit-report service ----------------------------------
  // A second workflow, because its task description is its own: return the report
  // for one receipt id. The Telegram workflow keeps its own shape.
  step(8, 'list the audit report as a paid x402 service')
  try {
    if (state.paidWorkflowId && state.paidTriggerUrl) {
      console.log(`   reusing paid workflow ${state.paidWorkflowId}`)
    } else {
      const paid = await client.workflows.create({
        name: PAID_WORKFLOW_NAME,
        goal: 'Sell one Mandate audit report: given a receipt id, return the byte-stable report for that decision.',
        triggers: [
          triggers.x402({
            name: 'Mandate — audit report',
            description:
              'A reproducible audit record for one autonomous treasury decision: every rule checked with its actual value and limit, the clause of the policy that produced it, the live vault facts it was decided on, and three hashes anyone can re-derive.',
            price: env.X402_PRICE_USDC,
            input: { receiptId: { type: 'string', description: 'Receipt id, or any unique prefix of it' } },
            walletAddress: env.X402_PAY_TO,
          }),
        ],
        tasks: [{ name: 'export', agentId: agentId!, description: PAID_TASK_DESCRIPTION }],
      })
      state.paidWorkflowId = paid.id
      const trigger = (paid.triggers ?? [])[0] as { id?: string; webhookUrl?: string; paywallUrl?: string } | undefined
      state.paidTriggerId = trigger?.id
      state.paidTriggerUrl = trigger?.webhookUrl
      state.paywallUrl = trigger?.paywallUrl
      console.log(`   workflow ${paid.id} · trigger ${trigger?.id ?? '?'}`)
    }
    if (state.paidTriggerId) await client.triggers.activate({ workflowId: state.paidWorkflowId!, id: state.paidTriggerId }).catch(() => undefined)
    await client.workflows.setRunning({ id: state.paidWorkflowId! }).catch(() => undefined)
    if (state.paidTriggerUrl) console.log(`   trigger url  ${state.paidTriggerUrl}`)
    if (state.paywallUrl) console.log(`   paywall url  ${state.paywallUrl}`)
  } catch (err) {
    // The listing is a bonus: the demo's paywall is our own x402 on Base Sepolia.
    console.error(`   step 8 failed (the OpenServ listing is optional): ${err instanceof Error ? err.message : String(err)}`)
  }

  saveState(state)
  if (state.paidTriggerUrl) {
    console.log(`\nset on Railway (and .env) so the console can show the listing:`)
    console.log(`  X402_TRIGGER_URL=${state.paidTriggerUrl}`)
    if (state.paywallUrl) console.log(`  X402_PAYWALL_URL=${state.paywallUrl}`)
    console.log(`  X402_WORKFLOW_ID=${state.paidWorkflowId}`)
  }
  console.log(`\nprovisioned:\n  agentId      ${state.agentId}\n  workflowId   ${state.workflowId}\n  triggerId    ${state.telegramTriggerId}\n  taskId       ${state.taskId}\n  connection   ${state.telegramConnectionId}\n  state        ${STATE_PATH}`)
  console.log('\nnext: npm run agent --workspace=agent   (then message the bot on Telegram)')
}

main().catch((err) => {
  console.error(`provision: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
