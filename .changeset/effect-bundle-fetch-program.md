---
"everything-dev": patch
---

The boot-fetch interceptor is one Effect program now (staged disk → network → stale-if-error on the managed runtime), replacing the hand-rolled retry loops, and idempotent GETs get an interruption-backed per-attempt deadline (30s, tunable via `installGlobalBundleFetch({ timeoutMs })`): `Effect.timeout` interrupts the fiber, whose signal aborts the in-flight request — a hung CDN connection now retries on the exponential schedule and fails loud in ~90s instead of stalling until undici's ~300s registry timeout. Caller-provided abort signals compose and still cancel immediately (cancellation is not retried); the last transient response still surfaces for stale-if-error. The image smoke captures the full container stdout to the artifact (a tail window was cutting the error behind spinner output).
