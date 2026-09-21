/**
 * Per-chat mandate store. One rule set per scope (the OpenServ workspace id,
 * or "default"), on disk so a restarted agent remembers the treasurer's
 * policy. Gitignored alongside receipts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env, REPO_ROOT } from '../env.js'
import { RuleSetSchema, type RuleSet } from '../mandate/schema.js'

export interface MandateStore {
  get(scope: string): RuleSet | null
  set(scope: string, ruleSet: RuleSet): void
}

const safe = (scope: string) => scope.replace(/[^A-Za-z0-9_.-]/g, '_') || 'default'

export class FileMandateStore implements MandateStore {
  constructor(readonly dir: string = env.MANDATES_DIR ?? join(REPO_ROOT, 'data', 'mandates')) {}

  get(scope: string): RuleSet | null {
    const path = join(this.dir, `${safe(scope)}.json`)
    if (!existsSync(path)) return null
    const parsed = RuleSetSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data : null
  }

  set(scope: string, ruleSet: RuleSet): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, `${safe(scope)}.json`), JSON.stringify(ruleSet, null, 2))
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
