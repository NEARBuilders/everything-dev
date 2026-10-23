---
"everything-dev": minor
"host": patch
---

Instrument the SSR pipeline: Server-Timing headers on SSR responses, Effect-log debug marks across the compose/render seams (level-gated, silent at default), per-service boot metrics flushed to `.bos/boot-metrics.json` at session-ready, and a Go-harness SSR timing bench (`BOS_SSR_BENCH=1`).
