# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS builder
WORKDIR /app

# pnpm pinned by the root package.json packageManager field. Installed
# directly (not via corepack) so the image build never depends on
# corepack's interactive download prompt.
RUN npm install -g pnpm@10.20.0

# NOTE (ADR 0026): pnpm settings live in pnpm-workspace.yaml (ignoreScripts,
# nodeLinker=hoisted, linkWorkspacePackages) — no .npmrc is required.
# Do NOT split this into a manifests-first COPY + install: pnpm's frozen
# install on a manifests-only context is unverified, and the workspace bin
# links (the check below) depend on the workspace sources being present.
# Full source + a store cache mount keeps re-downloads free when the layer
# busts.
COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

RUN test -e node_modules/.bin/every-plugin \
    || { echo "workspace bin not linked — workspace sources must be present at install time"; exit 1; }
RUN pnpm --filter every-plugin build
RUN pnpm --filter everything-dev build
RUN node --import tsx scripts/resolve-workspace-refs.ts

# ── Dist build (ADR 0009): all workspaces the start stack serves ──
# Forked BEFORE the prod stage strips sources — the ui/api/plugins builds run here.
# DEPLOY=true selects dist-first resolution and drops source maps — the same
# mode the deploy train's CDN uploads use, so image bytes ≡ CDN bytes.
FROM builder AS dist-builder
ENV DEPLOY=true
RUN node --import tsx scripts/regression/container-build.ts

# ── Prod build: strip sources — the framework loads remotes at runtime ──
# The authored descriptor (bos.app.ts / bos.dev.ts) goes too: the runtime
# image bakes the generated config (dist-builder, ADR 0005) as the boot
# fallback, and findConfigPath must not shadow it with the authored form.
FROM builder AS prod-builder

# Derived node_modules prune: keep the union of every workspace's production
# dependency closure, delete the rest. Runs BEFORE the source strip — the
# seeds are the workspace package.jsons. nodeLinker=hoisted (ADR 0026 §4)
# keeps this a flat tree the prune walker understands.
RUN node --import tsx scripts/prune-runtime-node-modules.ts /app

RUN rm -rf host api ui plugins && rm -f bos.app.ts bos.dev.ts pnpm-workspace.yaml

# Clean broken workspace symlinks (the stripped workspaces leave dead links)
RUN find node_modules -maxdepth 1 -type l ! -exec test -e {} \; -print -delete 2>/dev/null || true

# ── Regression fixture (ADR 0009): the browser-suite harness image ──
# Serves the staged dists on container-local static servers and boots the
# production host over a baked local config (--config-path). Built explicitly
# with `docker build --target regression` — not the deployment artifact.
FROM node:24-alpine AS regression
WORKDIR /app

RUN apk add --no-cache curl

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001

COPY --from=dist-builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=dist-builder --chown=appuser:appgroup /app/package.json .
# Generated config (ADR 0005) — baked as the bare-start boot fallback.
COPY --from=dist-builder --chown=appuser:appgroup /app/.bos/bos.resolved-config.json ./bos.config.json
COPY --from=dist-builder --chown=appuser:appgroup /app/packages/everything-dev ./packages/everything-dev
COPY --from=dist-builder --chown=appuser:appgroup /app/packages/every-plugin ./packages/every-plugin
COPY --from=dist-builder --chown=appuser:appgroup /app/packages/better-near-auth ./packages/better-near-auth
COPY --from=dist-builder --chown=appuser:appgroup /app/scripts/regression ./scripts/regression
COPY --from=dist-builder --chown=appuser:appgroup /app/.bos/regression/image ./.bos/regression/image
COPY --from=dist-builder --chown=appuser:appgroup /app/.bos/bundles ./.bos/bundles
ENV BOS_BUNDLE_DIR=/app/.bos/bundles

RUN mkdir -p .bos/generated .bos/logs && \
    chown -R appuser:appgroup .bos && \
    chown appuser:appgroup /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4100
EXPOSE 4100

HEALTHCHECK --interval=10s --timeout=3s --start-period=180s --retries=5 \
  CMD curl -f http://localhost:4100/health || exit 1

USER appuser
ENTRYPOINT ["node", "scripts/regression/container-entrypoint.mjs"]

# ── Deployment runtime (ADR 0021): the last stage — the universal image ──
# `node …/cli.mjs start` boots `bos start`: identity-driven (BOS_ACCOUNT/
# BOS_GATEWAY env → FastKV; unset → the baked bos.config.json), with tier
# auto-detection over BOS_BUNDLE_DIR. The start stack loads the host, api,
# and plugins in-process through Module Federation — no child spawns, so the
# runtime needs only node. This is the default build target; GHCR publishes
# it (ADR 0020: all bundle distribution lives on the CDN — the image keeps
# the boot role). One container = the whole start stack; only the host port
# is mapped. Databases and secrets arrive via env at `docker run`.
FROM node:24-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache curl

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001

COPY --from=prod-builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=prod-builder --chown=appuser:appgroup /app/package.json .
# Generated config (ADR 0005) — baked as the bare-start boot fallback.
COPY --from=dist-builder --chown=appuser:appgroup /app/.bos/bos.resolved-config.json ./bos.config.json
COPY --from=prod-builder --chown=appuser:appgroup /app/packages/everything-dev ./packages/everything-dev
COPY --from=prod-builder --chown=appuser:appgroup /app/packages/every-plugin ./packages/every-plugin

# Image-native boot artifacts (plan 043, boot role per ADR 0020): the
# namespace-staged bundle layout built by the dist-builder stage — the
# outbound fetch interceptor resolves own-namespace URLs from this directory
# so cold boots need zero network. Distribution serves the same bytes from
# the CDN.
COPY --from=dist-builder --chown=appuser:appgroup /app/.bos/bundles ./.bos/bundles
ENV BOS_BUNDLE_DIR=/app/.bos/bundles

# Foreign-namespace stale-if-error cache (ADR 0021): registry-tier instances
# (children) cache boot-time and inbound bytes and serve last-known-good on
# upstream outages.
ENV BOS_BUNDLE_CACHE_DIR=/app/.bos/bundle-cache

RUN mkdir -p .bos/generated .bos/logs .bos/bundle-cache && \
    chown -R appuser:appgroup .bos && \
    chown appuser:appgroup /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
# BOS_ENV: set to "staging" to enable staging mode (uses staging domain for BOS_GATEWAY)
# Defaults to "production" if unset.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=120s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

USER appuser
CMD ["sh", "-c", "node ./node_modules/everything-dev/dist/cli.mjs start --no-interactive --port ${PORT:-3000}"]
