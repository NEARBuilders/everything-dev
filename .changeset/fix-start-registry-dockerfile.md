---
"everything-dev": patch
---

Add --registry flag to bos start, remove dead postinstall from Dockerfile

- Thread `--registry` override through `resolveRemoteConfigChain` and `fetchPublishedConfig` so `bos start` can override the FastKV registry contract when fetching remote config.
- Remove `RUN bun run postinstall` from Dockerfile — the script was removed from package.json in a prior commit but the Dockerfile was never updated, causing Docker builds to fail.
