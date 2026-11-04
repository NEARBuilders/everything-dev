---
"everything-dev": patch
---

`bos deploy --wallet` now parses (the deploy schema was missing the `wallet` field that publish and rollback already had — the gasless NEP-366 relay path was unreachable from the deploy command). The signing stack also honors `NEAR_RPC_URL`: near-kit's default mainnet RPC (free.rpc.fastnear.com) currently accepts signed broadcasts and silently drops them post-acceptance, so publishes can pin the signing stack to an endpoint with a real transaction pool (set `NEAR_RPC_URL=https://rpc.mainnet.near.org`).
