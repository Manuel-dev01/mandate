/**
 * SERV Reasoning client — the ONLY module that talks to inference-api.
 *
 * SERV is used to compile English into rules and to explain verdicts. It is
 * never asked to decide one. If a call from this module ever influences a
 * verdict, the design has been broken.
 *
 * Wire facts, measured 13 Sep 2026 (docs/RECON.md):
 *   - A system prompt is MANDATORY (400 without one). Enforced by the type of
 *     `chat()`: `system` is not optional.
 *   - `max_tokens` is REJECTED by current models. Only `max_completion_tokens`
 *     appears in this file, and the word "max_tokens" appears only here.
 *   - Default output is markdown with LaTeX display math, which renders as
 *     garbage in Telegram. FORMATTING_RULES is appended to every system prompt.
 *   - SERV Tools are declared as tools named `serv_*`; SERV applies the feature
 *     and strips the tool before the model sees it. Parameters travel as
 *     `default` values inside the tool's JSON schema.
 *   - serv_prompt_guard SHORT-CIRCUITS the whole turn on an injection attempt:
 *     finish_reason 'content_filter', usage all zeros, no inference billed,
 *     and the legitimate half of a mixed request is NOT answered. Surfaced as
 *     { kind: 'guarded' } so callers fall back to a deterministic template.
 *   - SERV Tools cost ~5x latency (2.1s bare -> 10.6s guarded + shadow).
 */

import OpenAI from 'openai'
import { env } from '../env.js'

export const SERV_BASE_URL = `${env.SERV_BASE_URL.replace(/\/$/, '')}/v1`

/** Cheap dev model. The demo model is chosen explicitly, never by default. */
export const DEFAULT_MODEL = env.SERV_MODEL_DEV

/**
 * Appended to EVERY system prompt. Verified to suppress LaTeX on gpt-5.4-mini;
 * a hint of "a percentage to two decimals" then yields exactly "88.80%".
 */
export const FORMATTING_RULES = [
  'Formatting rules, non-negotiable:',
  'Reply in plain text only.',
  'Never use LaTeX, never use \\[ \\] or $ $ delimiters, never use display math.',
  'Never use markdown tables, headings, or code fences.',
  'Write numbers and percentages inline as plain digits, for example 88.80%.',
].join(' ')

// ---------------------------------------------------------------- SERV Tools

export interface ShadowAgentOptions {
  /** What "correct" looks like. Honoured reliably — be specific. */
  hint: string
  /** Validate-and-iterate rounds. SERV default is 3. */
  maxIterations?: number
}

export type ServToolSpec = { kind: 'prompt_guard' } | ({ kind: 'shadow_agent' } & ShadowAgentOptions)

type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool

/**
 * Builds the `serv_*` tool declarations. These are NOT callable functions —
 * SERV strips them before inference. Parameters ride in `default`.
 */
export function servTools(specs: readonly ServToolSpec[]): ChatTool[] {
  return specs.map((spec): ChatTool => {
    switch (spec.kind) {
      case 'prompt_guard':
        return {
          type: 'function',
          function: {
            name: 'serv_prompt_guard',
            description: 'Protect the system prompt from injection-based leakage.',
            parameters: { type: 'object', properties: {} },
          },
        }
      case 'shadow_agent':
        return {
          type: 'function',
          function: {
            name: 'serv_shadow_agent',
            description: 'Validate the answer against the hint and iterate until it complies.',
            parameters: {
              type: 'object',
              properties: {
                hint: { type: 'string', default: spec.hint },
                max_iterations: { type: 'integer', default: spec.maxIterations ?? 3 },
              },
            },
          },
        }
    }
  })
}

// ------------------------------------------------------------------ results

export interface ServUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens: number
}

export type ServResult =
  | {
      readonly kind: 'ok'
      readonly text: string
      readonly model: string
      readonly finishReason: string
      readonly usage: ServUsage
    }
  | {
      /**
       * serv_prompt_guard fired. No inference ran, nothing was billed, and the
       * request was NOT answered. Fall back to the deterministic template.
       */
      readonly kind: 'guarded'
      readonly refusal: string
      readonly model: string
      readonly usage: ServUsage
    }

export class ServError extends Error {
  readonly status: number | null
  /** 401 — key rejected. A blocker, not something to work around. */
  readonly isAuthError: boolean
  /** 402 or a message about credits/balance/quota. Also a blocker. */
  readonly isCreditsError: boolean
  /** 400 mentioning the system prompt — should be unreachable via chat(). */
  readonly isMissingSystemPrompt: boolean

  constructor(message: string, status: number | null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ServError'
    this.status = status
    this.isAuthError = status === 401
    this.isCreditsError = status === 402 || /credit|balance|quota|insufficient funds/i.test(message)
    this.isMissingSystemPrompt = status === 400 && /system/i.test(message)
  }
}

// ------------------------------------------------------------------- client

export interface ChatRequest {
  /** REQUIRED. SERV returns 400 without one; the type makes that unreachable. */
  system: string
  user: string
  model?: string
  /** Upper bound on the reply. Sent as max_completion_tokens. */
  maxCompletionTokens?: number
  tools?: readonly ServToolSpec[]
  temperature?: number
  /**
   * Structured output. Sent as response_format json_schema with strict: true —
   * verified working on SERV/gpt-5.4-mini alongside serv_shadow_agent. The
   * caller still Zod-validates the text; strict mode is a first line, not a proof.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> }
}

export interface ServClientOptions {
  apiKey?: string
  baseURL?: string
  timeoutMs?: number
  maxRetries?: number
}

export class ServClient {
  private readonly openai: OpenAI

  constructor(opts: ServClientOptions = {}) {
    const apiKey = opts.apiKey ?? env.SERV_API_KEY
    if (!apiKey) {
      throw new ServError(
        'SERV_API_KEY is not set. Create one at https://console.openserv.ai and add it to .env.',
        null,
      )
    }
    this.openai = new OpenAI({
      apiKey,
      baseURL: opts.baseURL ?? SERV_BASE_URL,
      // SERV Tools measured at ~10.6s; frontier models are slower again.
      // 120s x 2 attempts meant a hung SERV call could hold a Telegram reply for four
      // minutes before the deterministic template took over. The explanation is never
      // worth that wait; the verdict is already decided without it.
      timeout: opts.timeoutMs ?? 45_000,
      // Paid tokens: one retry on 5xx/429, never a loop.
      maxRetries: opts.maxRetries ?? 1,
    })
  }

  async chat(req: ChatRequest): Promise<ServResult> {
    const model = req.model ?? DEFAULT_MODEL
    const guarded = req.tools?.some((t) => t.kind === 'prompt_guard') ?? false

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [
        { role: 'system', content: `${req.system.trim()}\n\n${FORMATTING_RULES}` },
        { role: 'user', content: req.user },
      ],
      max_completion_tokens: req.maxCompletionTokens ?? 400,
    }
    if (req.tools && req.tools.length > 0) params.tools = servTools(req.tools)
    if (req.temperature !== undefined) params.temperature = req.temperature
    if (req.jsonSchema) {
      params.response_format = {
        type: 'json_schema',
        json_schema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema },
      }
    }

    let completion: OpenAI.Chat.Completions.ChatCompletion
    try {
      completion = await this.openai.chat.completions.create(params)
    } catch (err) {
      throw toServError(err)
    }

    const choice = completion.choices[0]
    const text = (choice?.message?.content ?? '').trim()
    const finishReason = choice?.finish_reason ?? 'unknown'
    const usage: ServUsage = Object.freeze({
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      totalTokens: completion.usage?.total_tokens ?? 0,
    })

    // Measured guard signature: finish_reason 'content_filter' AND zero usage.
    // Either alone is treated as guarded when the guard was attached — a
    // false "guarded" costs one template fallback; a false "ok" would let an
    // injection refusal masquerade as an answer.
    if (guarded && (finishReason === 'content_filter' || usage.totalTokens === 0)) {
      return { kind: 'guarded', refusal: text, model: completion.model, usage }
    }

    return { kind: 'ok', text, model: completion.model, finishReason, usage }
  }
}

function toServError(err: unknown): ServError {
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? null
    const detail = err.message || 'SERV request failed'
    const prefix =
      status === 401
        ? 'SERV rejected the API key (401)'
        : status === 402
          ? 'SERV reports no credits (402)'
          : `SERV HTTP ${status ?? 'error'}`
    return new ServError(`${prefix}: ${detail}`, status, err)
  }
  if (err instanceof Error) return new ServError(`SERV transport error: ${err.message}`, null, err)
  return new ServError(`SERV transport error: ${String(err)}`, null)
}

let defaultClient: ServClient | null = null

/** Lazily constructed so importing this module never throws on a missing key. */
export function serv(): ServClient {
  defaultClient ??= new ServClient()
  return defaultClient
}
