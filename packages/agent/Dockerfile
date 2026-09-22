# The agent service: Telegram bot + read-only console API (packages/agent/src/bin/serve.ts).
# Build context is the REPO ROOT (Railway: root directory "/", Dockerfile path "packages/agent/Dockerfile").
FROM node:24-slim

WORKDIR /app

# Only the agent workspace; the web console deploys separately (Vercel).
COPY package.json package-lock.json ./
COPY packages/agent/package.json packages/agent/package.json
# tsx runs the TypeScript directly and is a devDependency, so dev deps stay in.
RUN npm ci --workspace=agent --include-workspace-root=false --include=dev --fetch-retries=6

COPY tsconfig.base.json ./
COPY packages/agent packages/agent

# Persistent state lives on the Railway volume mounted at /data (see railway.json).
ENV NODE_ENV=production \
    RECEIPTS_DIR=/data/receipts \
    MANDATES_DIR=/data/mandates \
    SNAPSHOT_DIR=/data/snapshots \
    COMPILE_CACHE_DIR=/data/cache \
    PORT=8787
EXPOSE 8787

# One instance only: two Telegram pollers make the Bot API answer "Conflict".
#
# Run node directly, NOT through npm: npm reports a SIGTERM'd child as a non-zero
# exit, so every ordinary redeploy looked like "Deploy Crashed" (RECON §6.16).
WORKDIR /app/packages/agent
CMD ["node", "--import", "tsx", "src/bin/serve.ts"]
