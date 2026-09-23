# web — the Mandate audit console

A Next.js renderer of the agent's read-only console API (`packages/agent/src/console/api.ts`). It imports no agent code, touches no disk and calls no IXS endpoint: everything on screen is the API's JSON, which is built from real receipts made in Telegram.

```bash
# .env.local
MANDATE_API_URL=http://localhost:8787     # or the Railway URL
MANDATE_API_KEY=                          # only if the agent sets CONSOLE_API_KEY

npm run dev --workspace=web               # http://localhost:3000
node scripts/web-smoke.mjs                # from the repo root: every route answers with real data
```

Routes: `/` (the newest refusal resolving row by row) · `/chain` · `/receipts/[id]` (verify + replay) · `/mandate` · `/vaults` · `/export/[id]`.
Every page has an empty state (no receipts → open Telegram), a loading state, and an unreachable state (the agent is down → say so, never an error screen). Tables fold into two columns under 720px instead of scrolling sideways — `node scripts/overflow-check.mjs` (from the repo root) asserts no route scrolls sideways at 390px.

Deployed on Vercel from GitHub `master`, **root directory `packages/web`**, with `MANDATE_API_URL` (and `MANDATE_API_KEY` when the agent sets `CONSOLE_API_KEY`). The design tokens live in `app/globals.css`; the base design is `Mandate.dc.html` at the repo root.
