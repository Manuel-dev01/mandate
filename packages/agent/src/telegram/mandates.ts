/**
 * Per-chat mandate store. One rule set per scope (the OpenServ workspace id,
 * or "default"), on disk so a restarted agent remembers the treasurer's
 * policy. Gitignored alongside receipts.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env, REPO_ROOT } from '../env.js'
import { RuleSetSchema, type RuleSet } from '../mandate/schema.js'

export interface MandateStore {
  get(scope: string): RuleSet | null
  set(scope: string, ruleSet: RuleSet): void
  /** Hash + rule count per stored scope, for /health. Never the chat id or the text. */
  summaries?(): Array<{ hash: string; rules: number }>
}

const safe = (scope: string) => scope.replace(/[^A-Za-z0-9_.-]/g, '_') || 'default'

export class FileMandateStore implements MandateStore {
  constructor(readonly dir: string = env.MANDATES_DIR ?? join(REPO_ROOT, 'data', 'mandates')) {}

  get(scope: string): RuleSet | null {
    const path = join(this.dir, `${safe(scope)}.json`)
    if (!existsSync(path)) return null
    // The safeParse was guarded but the read and JSON.parse were not: a restart mid-write
    // left truncated JSON on the volume and every later proposal threw the generic error.
    try {
      const parsed = RuleSetSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  /**
   * What mandates are actually live, so a gate can catch the case that silently broke
   * beat 6: the bot decides on the LAST policy pasted into the chat, and a stray test
   * policy replaces the demo one with no warning anywhere on the console (RECON §6.23).
   * Only the hash and rule count — never the chat id, never the policy text.
   */
  summaries(): Array<{ hash: string; rules: number }> {
    if (!existsSync(this.dir)) return []
    const out: Array<{ hash: string; rules: number }> = []
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue
      const rs = this.get(f.slice(0, -5))
      if (rs) out.push({ hash: rs.hash, rules: rs.rules.length })
    }
    return out
  }

  set(scope: string, ruleSet: RuleSet): void {
    mkdirSync(this.dir, { recursive: true })
    // Write then rename, so a kill mid-write never leaves a half-file under the real name.
    const path = join(this.dir, `${safe(scope)}.json`)
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(ruleSet, null, 2))
    renameSync(tmp, path)
  }
}

export class MemoryMandateStore implements MandateStore {
  private readonly map = new Map<string, RuleSet>()
  get(scope: string): RuleSet | null {
    return this.map.get(safe(scope)) ?? null
  }
  set(scope: string, ruleSet: RuleSet): void {
    this.map.set(safe(scope), ruleSet)
  }
}
