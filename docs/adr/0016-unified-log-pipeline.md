# ADR 0016: Unified log pipeline — stream broadcast with levels instead of pattern-only suppression

Date: 2026-09-23
Status: Accepted

## Context

Dev-session process output had three inconsistent views. The on-screen tail and the log file both suppressed lines matching `LOG_NOISE_PATTERNS`, but the `l` / shutdown export dumped the raw in-memory buffer — so the export replayed lines that never appeared on screen and vice versa. Level detection was a stderr heuristic plus pattern matching, so `WARN [Better Auth]` lines on stdout were invisible to any level logic. Two private ANSI-strip implementations existed (`dev-logs.ts`, `orchestrator.ts`), and multi-line output (Effect Logger pretty-printed objects, node `ExperimentalWarning` stack traces) polluted every view with continuation-line fragments.

## Decision

All output from every dev-session process flows through a single pure pipeline (`packages/everything-dev/src/dev-log-pipeline.ts`) with three stages:

1. **Normalize** — per-source lookahead state machine collapses multi-line blocks into one event per logical log: Effect Logger `{`…`}` object blocks (including the header line they follow), stack-trace `    at …` continuation lines, and brace-balanced pretty-printed JSON.
2. **Classify** — assigns a level (`error`/`warn`/`info`/`debug`) and a category (`banner`/`build`/`db`/`mf`/`lifecycle`/`shutdown`/`other`). `WARN [Better Auth]`-style stdout lines classify as `warn`; the old `LOG_NOISE_PATTERNS` list folds into the classifier as `mf`/`build` info events; dev-server banner blocks and rspack/rsbuild chatter classify as `banner`/`build`; clean exits (`Process exited … (exit code: 0)`) classify as `shutdown` **info**, not `[ERR]`.
3. **Filter** — level-based (`--log-level` flag > `BOS_LOG_LEVEL` env > default `warn`; `DEBUG` means show everything). Consecutive non-error `[Database]` startup events per plugin collapse to a single `db ready` event in the filtered views.

The normalized stream **broadcasts to three sinks** so the views agree by construction: the on-screen tail and the export receive level-filtered events (identical by construction); the log file is a consumer that always receives every event — raw text preserved inside normalized events, no pattern suppression.

Filtering is display-layer only: readiness detection in the orchestrator keeps matching raw lines, so service status flips are unaffected.

## Consequences

- The three views can never disagree: screen and export are the same filtered stream; the file is a superset by construction.
- `LOG_NOISE_PATTERNS` is gone; suppression is level-based, so `--log-level info`/`debug` restores chatter without new patterns.
- Noise lines now reach the log file (previously suppressed) — the file is the ground truth for debugging.
- One ANSI-strip implementation remains; `dev-logs.ts` and `orchestrator.ts` both import it from the pipeline module.
- Normalization emits an event one line of lookahead after its last continuation (or on brace balance / flush); the final pending event flushes at session end.
