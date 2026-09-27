# ADR 0009: Regression stacks run production mode against locally built artifacts

Date: 2026-09-23 · Status: accepted (amended 2026-09-23 — Dockerfile fixture) · Supersedes: none

## Context

The browser regression suites ran against the **dev server** (`bos dev`) as their fixture. The dev server is the heaviest process tree the platform can build — watchers, per-service dev servers, and a host that loads every plugin in-process alongside source-composed SSR. Under CI, the browser suite progressively degraded (fast start, growing flake cluster, then ~15 minutes of total silence with every process alive) and died at the job timeout. Because timeout-killed jobs conclude `cancelled`, the `if: failure()` artifact-upload step never ran: **no stall ever produced its evidence**. Mitigations accumulated on the suites — no-watch mode, per-spec fetch deadlines, a lock-timeout patch that could not reach the connections it targeted — without curing the fixture.

Meanwhile the `prod` regression mode tested the **published** FastKV config: it validated the last deploy, not the change under review. And the host's composition layer carried Effect idiom debt (module singletons, hand-rolled polling, untyped failures) next to an already-idiomatic baseline (the orchestrator, dev-program, plugins service).

## Decision

1. **The full browser regression suite runs on production stacks built from the branch's own artifacts.** CI builds every workspace once, serves the dists statically, and boots the real production host via a **first-class local config** on `bos start` (`--config <path>` / `BOS_CONFIG_PATH`). No NEAR credentials, no FastKV, no publish in PR CI.
2. **Stack:variant scheme.** Two stacks — `prod` (built artifacts) and `dev` (the dev server) — each with `ssr` and `csr` variants (`start:ssr`, `start:csr`, `dev:ssr`, `dev:csr`); a bare stack name runs both variants serially. The full suite runs on `start:*`; the dev stack is smoke-only, so its resource profile can no longer stall CI.
3. **SRI integrity is skipped for local configs.** Integrity hashes bind an artifact to a deployment; local artifacts change every build. FastKV-resolved configs keep full verification.
4. **Published-config coverage moves out of PR CI** (both browser and Go HTTP suites) to the Deploy workflow's own smoke. PR CI validates the artifacts the change produces.
5. **Fail fast, with evidence.** A stall-watchdog reporter fails the suite within minutes of zero test progress, printing a runner snapshot into the job log; CI browser jobs run without retries and a 10-minute job timeout. This is what makes artifact capture possible at all.
6. **The Effect dividing line is deliberate.** Runtime code (orchestrator, dev-program, plugins service, every-plugin runtime, the host server layer) is idiomatic Effect v4 — `Context.Service` tags, layers with scoped finalizers, `Schema.TaggedError`, `Schedule`-based polling, `Effect.timeout` deadlines. Leaf dev servers, static file servers, and signal-handling process edges stay plain node. Two boundary bridges are sanctioned and stay: the ManagedRuntime bridge for Hono handlers, and the plugins-client deadline proxy (its consumer is non-Effect).
7. **The Module Federation composition instance stays a process-level singleton.** One share scope per process is the invariant that prevents duplicate React copies (composed SSR crashes with "Invalid hook call" otherwise). It is excluded from layer-ification; a rebuilt layer silently reintroduces that crash class.

## Amendment (2026-09-23): the start stack runs the deployment image

The first implementation built every workspace on the CI runner (a `prod-stack`
script) — runner build environments kept leaking into the fixture (bun export
conditions resolving framework packages to stale-or-absent `dist` trees,
`better-near-auth` unbuilt, fresh-checkout route-generation notices). The start
stack now builds and runs through the committed Dockerfile instead: a
`regression` stage builds all workspaces hermetically and the container serves
the staged dists internally, booting the production host over them. Only the
host port is mapped; test databases and secrets arrive via env with the docker
host gateway. The container build is the same artifact production deploys, and
it is identical locally and in CI.

## Consequences

- PR CI validates the artifacts the change produces, end to end, in production mode — the same host program Railway runs.
- Dev-server coverage shrinks to a smoke suite; full-suite dev-mode behavior (watchers, hot reload) is verified by daily use, not CI.
- Teardown of federation/compose resources moves under runtime disposal (post-green), retiring the manual reset exports.
- New Effect code follows `docs/agents/effect-patterns.md` by construction; behavior-sensitive refactors wait for a green gate.

## Alternatives considered

- **Keep the dev-server fixture, fix the starvation** (heap caps, serialized builds) — rejected: it treats the symptom; the dev server's footprint on shared runners remains the failure mode, and CI would still not be testing production mode.
- **Test the published config in PR CI** — rejected: it validates the previous deploy; a broken PR merges green.
- **Local k8s/container fixture** — rejected as disproportionate: the static-dist + `bos start` shape is already production's shape.
