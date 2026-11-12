# Alchemy 2.0.0-beta.85 — evaluation notes (ticket fly-hosting/03)

Findings from the deliberate bump to `alchemy 2.0.0-beta.85` (npm `latest`, 2026-11-02;
the `next` tag beta.72 is older — never use it). Everything below was verified against
the installed `.d.ts`/`lib` in `node_modules`, not just docs. **No adoption here** — each
paragraph is a candidate for its own ticket.

## What beta.85 actually ships: the provider-package split is real

beta.84 ("Enforce package boundaries ahead of the provider split", #2244, and the follow-up
moves #2309/#2311/#2312/#2313/#2315/#2316/#2348) split the monolith. At beta.85 the core
`alchemy` package exports only `./Alchemist`, `./Auth`, `./Bundle`, `./Cli`, `./Command`,
`./DNS`, `./Runtime/*`, `./Secrets`, `./State`, `./Util/*` plus a `./*` wildcard over its
`lib/` (which still carries `Deploy`, `AdoptPolicy`, `Artifacts`, `Drift`, `AlchemyContext`,
`Output`, `RemovalPolicy`, `Stack`, `Stage`, `Interaction`). All providers now live in
versioned `@alchemy.run/*` packages at `2.0.0-beta.85`: `docker`, `cloudflare`, `aws`,
`gcp`, `fly`, `neon`, `railway`, `kubernetes`, `sql`, `drizzle`, `github`, `stripe`,
`better-auth`, `axiom`, `acme`, `redis`, `turso`, `hetzner`, `planetscale`, `prisma`,
`domain`, `frontend-frameworks`, `test`, `cloudflare-runtime`.

Consequences we already absorbed in this bump: `alchemy/Docker` → `@alchemy.run/docker`
(hosting adapter), `alchemy/Cloudflare` → `@alchemy.run/cloudflare` (infra CDN stack), and
alchemy beta.85's code imports `effect/dist/crypto/Digest.js` + `dist/SemVer.js`, which only
`effect@4.1.x` ships — the workspace catalog moved rc.118 → 4.1.4 for that reason. Resource
type names (state-ledger FQNs) survived the split unchanged (`Cloudflare.R2.Bucket`,
`Cloudflare.ApiToken.AccountApiToken`, `Docker.Container`), so existing state stays readable.

## `Alchemist` programmatic API + `Alchemist.Drift` for reconciler drift

`alchemy/Alchemist` is a first-class programmatic surface: `Operations.plan(stack, options)`
returns a `StackPlan`, `Operations.apply(plan)` applies it, and `Operations` also ships
`buildStack`, `describeStackPlan`, `summarize`, and `hasChanges(plan)` for plan presentation.
`Alchemist.Drift` exposes `scan(input)` → `DriftScan`, `hasDrift(scan)`, and
`execute(scan)` → `EngineDrift.DriftResult` — i.e. alchemy now diffs the stack's declared
props against persisted state AND live resources (beta.84/85 added out-of-band drift
detection for Lambda/DynamoDB/S3, ELBv2 attribute repair, and recreate-in-dependency-order
on deletion). This is exactly the seam our reconciler re-implements in memory today
(`DockerHostingAdapter` compares descriptors via `Deploy.deploy`'s plan diff only). Moving
the reconciler onto `Alchemist.plan` + `Drift.scan/execute` would give us live-side drift,
a typed result, and the same semantics as the CLI without shelling out. Worth a spike after
the Fly adapter lands; the API is Effect-native, so it composes with the adapter seam as-is.

## State stores for the shared ledger

Core `alchemy/State` ships `localState()` (file-backed, what the Docker adapter uses),
`inMemoryState()`, `HttpStateApi`/`HttpStateStore` (the protocol the deployed Cloudflare
store speaks), plus bucket stores with leases ("Take back a bucket-store lease that lapsed
while still held", #2693) and `State.Sync`. Providers contribute stores through the new
Contributions system: `Cloudflare.state()` (Worker + D1-backed, account-default
`alchemy-state-store`, optional `workerName`), `AWS.state()` (DynamoDB is now the AWS
default, with an `alchemy state migrate` path off S3), `GCP.state()` (Cloud Storage,
beta.84). A custom Postgres state store is possible by implementing the `State` service
interface (`alchemy/State/State`). For the shared ledger idea: the Cloudflare store is
already our infra stack's store; a Postgres store would let every tenant runtime share one
ledger with row-level scoping — but it's custom work, while `HttpStateStore` gives a ready
HTTP protocol if we'd rather stand the store up once and point every runtime at it.

## Neon provider (`@alchemy.run/neon`)

Ships at beta.85 with top-level exports consumed as `Neon.Project`, `Neon.Role`,
`Neon.Branch`, `Neon.Credential`, `Neon.Connect`, `Neon.providers()` — plus much more
(DataApi, AI Gateway, Organization/Project governance roles, VPC endpoints, spending
limits, custom domains, cron/bucket event sources, Functions). Postgres surface:
`Neon.Project` with branches, `migrations` on deploy (`Migrations.js`), pooled (PgBouncer)
+ direct connection URIs as outputs (the direct URI pattern matches `Fly.Postgres`'s
migrations transport). Credentials: `alchemy profile edit --add Neon` locally or
`NEON_API_KEY` in CI (consistent missing-credential errors landed in beta.85 #2610).
This is the strongest candidate for tenant database provisioning if we outgrow the
per-runtime PGlite/`postgres://` model — branch-per-preview flows map cleanly onto
worktree dev.

## Fly Sprites

`@alchemy.run/fly` ships `Sprite` (a `Platform` resource like `Service`) plus its provider
(`SpriteProvider`). Sprites are Fly's hibernating sandbox — a persist-while-idle compute
shape that would suit the agent workspace ("boat") better than an always-on Machine with
`autostop: "suspend"`: memory-backed suspend instead of snapshot-based. No adoption now;
revisit when ticket 07's adapter shape is settled, since Sprite vs Machine changes the
deploy/health story.

## Railway provider (`@alchemy.run/railway`)

beta.84 added ephemeral project environments (#2117); beta.85 keeps `Railway` services as
the remaining root-runtime substrate. Only relevant for the root's remaining life — the
Fly adapter (07) supersedes it for tenant hosting. No action.

## Better Auth (`@alchemy.run/better-auth`)

Ships at beta.85 as a provider package. Our auth is already Better Auth under
`plugins/auth` with its own relational store; alchemy's integration is for deploying
Better Auth apps, not for adopting a different auth stack. Park unless we later want
alchemy to provision the auth plugin's deployment (it would duplicate the hosting seam).

## Axiom (`@alchemy.run/axiom`)

Ships at beta.85 (datasets, dashboards, monitors; beta.85 fixed the redacted-token
handling #2858/#2859). Relevant to deploy-console/07: Axiom as the log sink for tenant
runtimes would give structured deploy/runtime logs without self-hosting Loki. The
`Axiom.Dataset` + token redaction fixes make it usable from CI. Candidate for the
deploy-console ticket, not this one.

## ACME (`@alchemy.run/acme`)

Moved to its own package in beta.84 (#2309); at beta.85 it provides `DnsSolver` factories
consumed by `@alchemy.run/cloudflare`'s providers (the `providers()` layer already wires
`@alchemy.run/acme/DnsSolver`). For custom domains on tenant runtimes (ticket 17's
ingress story), `Fly.Certificate` covers Fly-managed certs; ACME is the fallback where we
control DNS elsewhere. Record-only.

## `alchemy dev` / Worktrees for infra-test isolation

beta.85's `@alchemy.run/test` (ex-`lib/Test`, moved in beta.84 #2452/#2621) documents
worktrees + `--stage` and all three test runners; `Command.Dev` can wait for a required
URL and take a port (#2735/#2750). Today our infra tests share the local Docker daemon and
state dir; the worktree+stage pattern would give per-checkout isolation (`--stage` scoping
the state ledger per worktree, which our `DockerHostingOptions.stage` already passes
through). Worth adopting in the hosting tests when the Fly adapter adds shared-fixture
pressure; until then `stage`-per-run is enough.
