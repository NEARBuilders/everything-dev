# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS builder
WORKDIR /app

# pnpm comes from Corepack — the root package.json `packageManager` field is
# the single version source (ADR 0026 §5: the universal image is node-based
# with corepack pnpm). The download prompt is off because image builds have
# no TTY; the warm-up run resolves the pinned pnpm into Corepack's cache in
# its own layer so `COPY . .` busts never re-download it.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json ./
RUN corepack enable && pnpm --version

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

# Framework package copies carry only their runtime surface: dist + manifest
# (banner/version reads). src/, skills/, and dev metadata never load in the
# start stack — the image resolves dist under every condition (ADR 0018).
RUN rm -rf packages/everything-dev/src packages/everything-dev/skills \
           packages/everything-dev/CHANGELOG.md packages/everything-dev/README.md \
           packages/everything-dev/tsconfig*.json packages/everything-dev/vitest.config.ts \
    packages/every-plugin/src packages/every-plugin/skills \
           packages/every-plugin/CHANGELOG.md packages/every-plugin/README.md \
           packages/every-plugin/tsconfig*.json packages/every-plugin/vitest*.ts \
           packages/every-plugin/bin

# Clean broken workspace symlinks (the stripped workspaces leave dead links)
RUN find node_modules -maxdepth 1 -type l ! -exec test -e {} \; -print -delete 2>/dev/null || true

# ── Shared runtime base (ADR 0021): hardened user + env both final stages
# inherit. The probe uses node's built-in fetch — no curl in the runtime
# layers.
FROM node:24-alpine AS runtime-base
WORKDIR /app

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001

ENV NODE_ENV=production
ENV HOST=0.0.0.0

# ── Regression fixture (ADR 0009): the browser-suite harness image ──
# Serves the staged dists on container-local static servers and boots the
# production host over a baked local config (--config-path). Built explicitly
# with `docker build --target regression` — not the deployment artifact.
FROM runtime-base AS regression

ENV PORT=4100
EXPOSE 4100

HEALTHCHECK --interval=10s --timeout=3s --start-period=180s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

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
FROM runtime-base AS runtime

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

ENV PORT=3000
# BOS_ENV: set to "staging" to enable staging mode (uses staging domain for BOS_GATEWAY)
# Defaults to "production" if unset.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER appuser
CMD ["sh", "-c", "node ./node_modules/everything-dev/dist/cli.mjs start --no-interactive --port ${PORT:-3000}"]
