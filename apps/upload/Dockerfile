# The upload service's own image — thin on purpose (ADR 0027 phase 0).
# It runs the standalone every-plugin direct host (apps/upload/server.ts) on a
# plain Node base; it does not stage bundles or boot the gateway host (that is
# the universal image's job). The whole workspace context is copied because a
# frozen pnpm install requires every lockfile importer to exist on disk.
# Deploy target: Railway service `upload`.

FROM public.ecr.aws/docker/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NODE_ENV=production

COPY . .

RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts

# Required in production:
#   BOS_STORAGE_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION
#   BOS_STORAGE_AUTH_ORIGIN (the auth service that verifies API keys)
# Optional: BOS_STORAGE_BOOTSTRAP_API_KEY/_ACCOUNT/_GATEWAY (break-glass),
#           BOS_MAX_BUNDLE_UPLOAD_BYTES, BOS_STORAGE_UPLOAD_TIMEOUT_MS, PORT
CMD ["node", "--import", "tsx", "--conditions=development", "apps/upload/server.ts"]
