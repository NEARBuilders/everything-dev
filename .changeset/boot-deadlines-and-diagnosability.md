---
"everything-dev": patch
---

Boot failures are diagnosable and every remote-host boot stage is deadline-bounded (CDN-only image hardening, ADR 0021):

- The log pipeline's multi-line normalizer no longer swallows a source's last event: `flushSource` drains the pending buffer, any error-status flip flushes that source's pending lines before the row flips to failed, and the image smoke stops the container gracefully (`docker stop -t 15`) so the session finalizer's flush runs before `rm -f` — the `Failed to start: …` cause reaches stdout and the artifact logs instead of being lost.
- `http-client` becomes the single HTTP resilience policy — an `HttpFetch` Effect service (`Context.Service` + injectable base fetch layer) with interruption-backed per-attempt deadlines (the fiber's signal aborts the in-flight request) and capped-exponential jittered retry. The bundle resolver (`bundle-fs-resolve` + `bundle-path` → `resolver`), the federation fetch hooks (`mf` → `federation`), and the orchestrator's manifest fetch all route through it instead of hand-rolling timeouts.
- Remote-host boot budgets: `loadRemote` (60s), server-ready (120s, shutting the half-started server down on expiry), and a 180s overall remote-host boot deadline — every hang fails named-and-loud with the URL long before the smoke's 240s probe deadline.
- `BOS_BUNDLE_CACHE_DIR` is no longer set by the runtime image and the resolver never derives it implicitly: a self-activating stale-if-error cache could serve pre-reset bundles after a deploy or rollback. It remains an operator opt-in; transient CDN blips are covered by bounded retry, real outages fail loud.
- The smoke's failure path probes the CDN from inside the container (manifest + first exposed chunks) and prints a classification — network-class failure vs app-class boot failure — with the full diagnostics in the artifact.
