# ── Stage 1: Build ──
FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY skills/ skills/
COPY tsconfig.json tsdown.config.ts ./
RUN npm run build

# ── Stage 2: Production ──
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -r tinyclaw && useradd -r -g tinyclaw -m tinyclaw

WORKDIR /app

COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/package.json package.json
COPY --from=builder /app/skills/ skills/

RUN chown -R tinyclaw:tinyclaw /app

USER tinyclaw

ENV NODE_ENV=production

EXPOSE 18789

ENTRYPOINT ["node", "dist/cli/cli.mjs"]
CMD ["serve"]
