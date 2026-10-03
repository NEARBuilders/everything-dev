# Plan 039: Security hardening — fail-closed SRI, validated config keys, safe defaults for TLS, key files, and logs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the plans index.
>
> **Drift check (run first)**: `git diff --stat c26e8699e..HEAD -- packages/everything-dev/src/db/drizzle-kit.ts packages/everything-dev/src/db/driver.ts packages/everything-dev/src/integrity.ts packages/everything-dev/src/config.ts packages/everything-dev/src/api-contract.ts packages/everything-dev/src/plugin.ts packages/everything-dev/src/env/project-env.ts packages/everything-dev/src/cli.ts packages/everything-dev/src/auth-session.ts`
> Plans 037/038 touch `plugin.ts`? No — but 037 touches `cli.ts`? No (037's scope is dev-session/orchestrator/dev-render). 038 touches env/project-env.ts (expected drift: URL masking lands there — coordinate). Other drift: STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (TLS default flip breaks self-signed DB users until they opt out; SRI fail-closed changes degraded-path behavior; key validation rejects previously-tolerated configs)
- **Depends on**: none (coordinate with 038 for the shared masking helper and env files)
- **Category**: security
- **Planned at**: commit `add676edc`, 2026-09-23

## Why this matters

The CLI is a dev tool that spawns processes, signs NEAR transactions, publishes configs on-chain, and connects to databases. The audit found the integrity chain failing OPEN (a fetch error during SRI verification counts as "verified"; a hash failure during publish silently *deletes* the integrity field from the published config), config-derived plugin keys reaching a shell (`shell: true`) and generated TypeScript import strings unvalidated, non-local DB connections defaulting to no TLS certificate verification, an exported NEAR private key file written world-readable, and full credential-bearing DB URLs printed to terminal/logs during env sync. None require a hostile insider — a compromised upstream runtime in the `extends` chain or a misbehaving CDN exercises them.

## Current state

- **`db/drizzle-kit.ts:46-51`** — `spawn("npx", [...spec.args], { shell: true })`; `spec` config path embeds `binding.key` = raw plugin key from `bos.config.json` (incl. entries inherited from remote parents via the extends chain — keys are never validated, `config.ts:950-1055`).
- **`api-contract.ts:651`** — `generatedSubdir: \`plugins/${key}\`` with the raw key, emitted into `import ... from "${importPath}"` lines of the generated, compiled `ui/src/lib/api-types.gen.ts` (names are sanitized via `sanitizeIdentifier`; the path segment is not).
- **`db/driver.ts:58-64`** — `ssl: isLocal ? false : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" }` — non-local DBs default to accepting any certificate.
- **`integrity.ts:108-112`** — `verifySriForUrl` on `!response.ok`: `console.warn(...); return;` (fail-open). Consumers (`host/src/services/federation.server.ts:223-228`, `tenant-runtime.ts:130-136`, `integrity-monitor.ts:106-109`) cache resolution as success.
- **`integrity.ts:76-91, 254-259`** — `computeSriHashForUrl` catches all errors → `null`; `reportDeployResult` with null integrity runs `deleteNestedPath(config, integrityField)` — the anchor is removed from `bos.config.json` before on-chain publish. Same `?? undefined` pattern at `plugin.ts:626` and `ui/deploy.ts:31,43`.
- **`plugin.ts:311-313`** — `exportPublishKey` stores the generated key via near-kit `FileKeyStore("~/.near-credentials", ...)`; near-kit's `file-keystore.js:120` writes with plain `fs.writeFile` (mode 0644). Contrast `auth-session.ts:62-68` which correctly writes `.bos/session.json` with `mode: 0o600`.
- **`env/project-env.ts:71-95`** — drift log prints `${from} → ${to}` including full `*_DATABASE_URL` values; `cli/db-doctor.ts:125` already has the right masking pattern (`//user:pass@`).
- **`cli.ts:1049-1053`** — `bos key generate` writes the fresh private key to stdout as `NAME=value` (documented for CI piping — CI log storage persists it).
- **Conventions**: Effect 4 where the module already is; tagged errors; no comments; tests under `tests/unit/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Package tests | `cd packages/everything-dev && bun run test` | all pass |
| Package dist | `cd packages/everything-dev && bun run build` | success |

## Scope

**In scope**:
- `packages/everything-dev/src/config.ts` (plugin-key validation at load)
- `packages/everything-dev/src/db/drizzle-kit.ts`, `db/driver.ts`
- `packages/everything-dev/src/integrity.ts`
- `packages/everything-dev/src/plugin.ts` (key export chmod; deploy integrity handling site ~626)
- `packages/everything-dev/src/ui/deploy.ts` (integrity handling sites)
- `packages/everything-dev/src/env/project-env.ts` (masking — coordinate with 038)
- `packages/everything-dev/src/cli.ts` (key generate output)
- `packages/everything-dev/src/utils/` (shared mask helper, create)
- `packages/everything-dev/tests/unit/` (integrity fail-closed tests, key validation tests, mask tests)

**Out of scope**:
- `host/src/services/*` consumers of `verifySriForUrl` — they already have failure handling for rejected verifications; no changes needed there (verify, don't touch)
- The PID registry trust question (SEC-09) — investigate-only, see Maintenance notes
- near-kit itself (vendored dependency — work around, don't fork)

## Steps

### Step 1: Validate plugin keys once, at config load (SEC-01 + SEC-07 root cause)

Add a strict identifier check where plugin entries are read in `config.ts` (both local parse and extends-merge paths): keys must match `/^[a-zA-Z0-9._-]+$/` — anything else fails resolution with a clear error naming the offending key and its origin (local vs parent `bos://` config). This single validation closes both the shell-argument path (drizzle-kit) and the generated-import path (api-contract) for all future call sites. Do not strip/normalize silently — fail loud (a hostile or malformed parent config should not resolve).

**Verify**: new `tests/unit/config-plugin-key-validation.test.ts`: valid keys pass; a key containing `;`, spaces, quotes, or `/` fails with the origin named. `bun typecheck`.

### Step 2: Drop `shell: true` from the drizzle-kit spawn (SEC-01)

`db/drizzle-kit.ts:46-51`: spawn `npx` without `shell: true`; on win32 resolve `npx.cmd` explicitly (or keep `shell: true` ONLY with a literal, non-config-derived command string and validated args — with Step 1's validation, args are safe; prefer the no-shell form on posix). 

**Verify**: `bun run test -- drizzle` (existing db tests) pass; manual `bos db studio` against a local plugin still opens.

### Step 3: TLS verify by default for non-local DBs (SEC-02)

`db/driver.ts:58-64`: `rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false"` for non-local URLs, and print a one-line warning when the opt-out is used ("TLS certificate verification disabled for <masked URL> — self-signed deployments only"). Document `DB_SSL_REJECT_UNAUTHORIZED=false` in `.env.example` (repo root) and the db README if present.

**Verify**: unit test asserting the three states (local: ssl false; non-local default: rejectUnauthorized true; opt-out: false + warning). Update any tests/fixtures connecting to non-local DBs.

### Step 4: SRI fails closed (SEC-03 + SEC-04)

4a. `integrity.ts` `verifySriForUrl`: on `!response.ok` or network error, throw a typed integrity error (existing error taxonomy in the module) instead of warn-and-return. Confirm the three host consumers treat a rejected verification as failure (they cache only resolved successes — read each site before changing).
4b. `reportDeployResult` / the `?? undefined` sites (`plugin.ts:626`, `ui/deploy.ts:31,43`): when the just-deployed artifact's hash cannot be computed, retry with bounded backoff (e.g. 3 attempts, 1s/2s/4s — the CDN may need propagation time), then HARD-FAIL the deploy. Never `deleteNestedPath` the integrity field as a side effect of a fetch error. (Pre-existing configs whose remote predates integrity fields are a different, legitimate case — keep any existing "no integrity declared" handling distinct from "hash failed".)

**Verify**: extend `tests/unit/integrity.test.ts`: non-2xx → rejected verification (not success); hash-failure → deploy fails after retries and the config's integrity field is untouched. `bun run test -- integrity`.

### Step 5: Key file permissions + stdout discipline (SEC-05 + SEC-08)

5a. `plugin.ts` `exportPublishKey`: after `keyStore.add(...)`, `chmod` the credential file to `0o600` (locate via the keystore's path scheme `~/.near-credentials/<network>/<account>.json`); also tighten pre-existing files written by earlier versions when encountered (same chmod on read/verify paths is acceptable — keep it best-effort).
5b. `cli.ts` key generate (≈1049): when `process.stdout.isTTY` is false, print a loud warning before the key ("private key follows — writing to non-interactive stdout; ensure this stream is not persisted") and support `--out <file>` writing the `NAME=value` line with mode `0o600` (pattern: `auth-session.ts:62-68`). The TTY path keeps today's output (it's the documented piping workflow).

**Verify**: unit test for the `--out` path (file exists, mode 0600, content format); manual `bos key generate` smoke.

### Step 6: Mask credential-bearing values in env-sync logs (SEC-06)

Extract `cli/db-doctor.ts:125`'s masking into `src/utils/mask-url.ts` (mask `//user:pass@` → `//***@`, keep host/db visible); use it in `syncEnvFile`'s drift log for any key matching `/_DATABASE_URL$|URL$|SECRET$|KEY$/i` — or simplest robust rule: mask the `from`/`to` values for keys ending `_URL`/`_SECRET`/`_KEY`, print others verbatim. Coordinate with 038 Step 2 which touches the same function.

**Verify**: unit test: drift log for `API_DATABASE_URL` contains the masked form and not the literal password; non-credential keys log verbatim.

## Test plan

- Create `tests/unit/config-plugin-key-validation.test.ts` (Step 1).
- Extend `tests/unit/integrity.test.ts` (Step 4 — both fail-closed branches).
- Extend db driver tests (Step 3 states) and drizzle-kit spawn test if present.
- Create mask helper tests (Step 6).
- Model all on neighboring test files; keep fixtures credential-free (use `postgres://user:pass@...`-shaped dummies only, never real values).

## Done criteria

- [ ] `bun typecheck`, `bun lint` exit 0; package tests pass with all new cases
- [ ] `grep -n "shell: true" packages/everything-dev/src/db/drizzle-kit.ts` → no match (or literal-command-only form with a comment-free justification in the PR)
- [ ] A non-2xx during SRI verification rejects the verification (unit-proven)
- [ ] A hash failure during publish fails the deploy and leaves the integrity field intact (unit-proven)
- [ ] `~/.near-credentials/**` files written by `bos key generate` are mode 0600
- [ ] Env-sync drift logs show masked URLs
- [ ] Changeset added

## STOP conditions

- Step 3's default flip breaks a documented production deployment flow in this repo (check `.env.example`, deploy docs, CI DB steps) in a way the opt-out can't cover mechanically.
- Step 4b's retry+hard-fail blocks a real publish against a CDN whose propagation exceeds ~10s — report timings; the decision (longer budget vs. publish-without-integrity flag) belongs to the operator.
- Step 1's validation rejects a plugin key that appears in a PUBLISHED, in-use runtime config (e.g. keys with `/` for nested paths) — report the real-world key shapes before choosing the regex; the audit only saw `a-z0-9-` keys in this repo's configs.
- Any consumer of `verifySriForUrl` lacks a rejection path and would crash instead of degrading — report the site.

## Maintenance notes

- **SEC-09 (investigate, not scheduled)**: the shared PID registry (`~/.cache/everything-dev/pids.json`) is same-user trusted input that `bos kill` acts on with signals. Marginal risk over same-user direct signaling is low; if pursued, add a per-session token to entries verified before signaling. Record the decision either way in the next audit.
- The `~/.near-credentials` chmod is a stopgap until near-kit itself writes 0600 — check near-kit releases and drop the workaround when fixed upstream.
- Reviewer focus: Step 4b's distinction between "no integrity declared" (legitimate legacy) and "hash computation failed" (must fail) — conflating them breaks old configs.
- `bun audit` at planning time: 5 advisories, none on this package's dependency paths (sharp/adm-zip/esbuild-dev in other workspaces) — no action here; the Renovate vulnerabilityAlerts flow owns them.
