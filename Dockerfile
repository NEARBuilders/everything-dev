# syntax=docker/dockerfile:1.7

FROM oven/bun:1.4.2-alpine AS builder
WORKDIR /app

# NOTE: do NOT split this into a manifests-first COPY + install. Bun's frozen
# install resolves a different tree on a manifests-only context than on a full
# checkout (and skips workspace bin links whose targets are absent), which
# breaks the lockfile check and the workspace build scripts. Full source + a
# cache mount keeps re-downloads free when the layer busts.
COPY . .

RUN --mount=type=cache,id=s/2532431a-4bd9-48a4-ac79-e7aeac2fedb4-/root/.bun/install/cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

RUN test -e node_modules/.bin/every-plugin \
    || { echo "workspace bin not linked — bun skips bin links whose targets are absent at install time"; exit 1; }
RUN bun run --cwd packages/every-plugin build
RUN bun run --cwd packages/everything-dev build
RUN bun run scripts/resolve-workspace-refs.ts

# ── Dist build (ADR 0009): all workspaces the start stack serves ──
# Forked BEFORE the prod stage strips sources — the ui/api/plugins builds run here.
FROM builder AS dist-builder
RUN bun run scripts/regression/container-build.ts

# ── Prod build: strip sources — the framework loads remotes at runtime ──
# The authored descriptor (bos.app.ts / bos.dev.ts) goes too: the runtime
# image bakes the generated config (dist-builder, ADR 0005) as the boot
# fallback, and findConfigPath must not shadow it with the authored form.
FROM builder AS prod-builder

RUN rm -rf host api ui plugins && rm -f bos.app.ts bos.dev.ts

# Clean broken workspace symlinks and strip workspace entries from package.json
RUN find node_modules -maxdepth 1 -type l ! -exec test -e {} \; -print -delete 2>/dev/null || true
RUN node -e "const p=require('./package.json');p.workspaces.packages=p.workspaces.packages.filter(e=>!['api','ui','host'].includes(e)&&e!=='plugins/*');require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"

# ── Regression fixture (ADR 0009): the browser-suite harness image ──
# Serves the staged dists on container-local static servers and boots the
# production host over a baked local config (--config-path). Built explicitly
# with `docker build --target regression` — not the deployment artifact.
FROM oven/bun:1.4.2-alpine AS regression
WORKDIR /app

RUN apk add --no-cache curl

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001

COPY --from=dist-builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=dist-builder --chown=appuser:appgroup /app/package.json .
COPY --from=dist-builder --chown=appuser:appgroup /app/bun.lock .
COPY --from=dist-builder --chown=appuser:appgroup /app/bunfig.toml .
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
ENTRYPOINT ["bun", "run", "scripts/regression/container-entrypoint.mjs"]

# ── Deployment runtime (ADR 0021): the last stage — the universal image ──
# `bun run start` boots `bos start`: identity-driven (BOS_ACCOUNT/BOS_GATEWAY
# env → FastKV; unset → the baked bos.config.json), with tier auto-detection
# over BOS_BUNDLE_DIR. This is the default build target; GHCR publishes it
# (ADR 0020: all bundle distribution lives on the CDN — the image keeps the
# boot role). One container = the whole start stack; only the host port is
# mapped. Databases and secrets arrive via env at `docker run`.
FROM oven/bun:1.4.2-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache curl

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001

COPY --from=prod-builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=prod-builder --chown=appuser:appgroup /app/package.json .
COPY --from=prod-builder --chown=appuser:appgroup /app/bun.lock .
COPY --from=prod-builder --chown=appuser:appgroup /app/bunfig.toml .
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
CMD ["sh", "-c", "bun run start --port ${PORT:-3000}"]
