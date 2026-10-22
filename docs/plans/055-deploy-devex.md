# 055. The deploy devex — `bos deploy` as the only command

Ticket tracker: `.scratch/deploy-console/issues/` (console phase: 01–08; devex phase: 09–11, parked: 12–13).
RC-path consolidation: `.scratch/rc-nukes/issues/` (01–06).
ADR: `docs/adr/0036-three-pin-planes.md` (the security model), `docs/adr/0035-deploy-console-hosting-adapter.md` (the hosting plane — the reconciler, the adapter, Neon for data).

## Design (locked)

The finished platform: author `bos.app.ts`, deploy it fast, and never hand-manage an `.env`. Cutthroat pass verified the seams already exist — nothing below adds a new abstraction; it assembles existing ones and deletes the rest.

### The target flow

```
pnpm create everything-dev my-app     # scaffold — bos.app.ts extends the base, nothing else
bos login                             # once, machine-wide — browser wallet or --custody
bos dev                               # zero-config: ephemeral pglite, generated dev secrets
bos deploy                            # one command → live on my-app.<root>
```

After the first deploy there are no questions, only the URL.

### The seams (review-verified, all pre-existing)

| Seam | Lives at | Status |
|---|---|---|
| **Hosting** | `HostingAdapter` (`deploy/current/restart/stop` + `identityEnv` verbatim) — `services/hosting/adapter.ts` on branch 02, Docker adapter + container tests shipped | Real: one adapter live, Railway/Fly planned |
| **Secrets interface** | `secrets: ["NAME"]` declarations → `secretsFromEnv` → `process.env` (`host/src/services/plugins.ts:152-161`, single host-side resolution point) | Untouched; the platform becomes the *source* of that env via `identityEnv` |
| **Secrets cipher** | `createSealedBox(salt, secret)` (`plugins/auth/src/sealed-box.ts`) — parameterized, self-contained, proven by 2 consumers | Reused as-is; no new crypto |
| **Config** | authored `bos.app.ts` + extends resolution + atomic FastKV publish | Single form after rc-nuke 04 |
| **DB** | `databaseLayer` URL-scheme dispatch (`pglite:` ↔ `postgres:`, ADR 0033) | Dev/prod swap already works |

### The `.env` decomposition ("ideally not using .env")

| Class | In the finished platform |
|---|---|
| Identity/routing (`BOS_ACCOUNT`, `BOS_GATEWAY`, `CORS_ORIGIN`) | Gone — identity-driven boot derives them; the gateway is the domain |
| Databases (`*_DATABASE_URL`) | Gone for the RC target tier — shared-host tenants ride the root's stack (no per-tenant DB exists anywhere today); Neon is Phase 2, sequenced behind the root's Fly migration |
| Infra credentials (`RAILWAY_TOKEN`, `BOS_STORAGE_API_KEY`) | Gone by design — reconciler + login session |
| App secrets (`BETTER_AUTH_SECRET`, `AI_API_KEY`) | Sealed platform store (below) → resolved into `identityEnv` |

### Secrets: platform-root sealed, swap-source later

RC cut (decided 2026-10-21): a name-keyed store in the api shell, values sealed with `createSealedBox` under a per-runtime KEK sealed by the platform root key. Honest boundary: the platform can technically read hosted-tier secrets — the substrate is already ours. The **custody ceremony is cut from RC**; the KEK source is a swappable sub-seam — the custody-TEE swap (parked ticket 13) changes the KEK origin without touching schema, CLI, or config declarations. Delivery: reconciler assembles resolved values into `identityEnv`; host resolution unchanged.

Built as scoped (ticket 09):
- **Per-runtime KEK** = `createSealedBox(salt: "everything-dev-runtime-secrets/<account>/<gateway>", secret: BETTER_AUTH_SECRET)` — the platform root HKDF'd with a runtime-scoped salt; no new env var, no key ceremony. The api shell declares `BETTER_AUTH_SECRET` (schema-required — fail loud).
- **Reserved-key contract**: `bos secrets set` refuses `BOS_*` and `PORT` — identityEnv is a *composed* surface; operator secrets must never collide with platform identity/ports/provisioned DB URLs. Rules live in `everything-dev/hosting/secrets` (one source for store, CLI, and delivery).
- **Vault = instance-bearing tiers only.** Two refusals: BYO-account ("this tier supplies its own env") and shared-host/UI-only ("no instance to deliver env to; custom API requires the instance tier"). v1 enforces the name rules server-side; the tier refusals land with the tenant/bindings surface (ticket 14) — until then the CLI refuses a target runtime that isn't the declared config itself or a child of the credential's site.
- **Values are one column** (`base64url(iv).base64url(ciphertext)`), never echoed by `list`, never readable from the CLI. `resolve` (unseal) exists at the service level for delivery but is deliberately NOT exposed as a route in v1 — the reconciler's delivery credential is ticket 08's design problem.
- **Dev-restart caveat** (zero-config dev's per-run root secret): stored secrets can't be opened after a restart without a persisted root — `resolve` fails loudly with "re-set it"; `list` keeps showing the row. Deployed runtimes (persistent root secret) are unaffected.
- **North star (not RC)**: instance-pull delivery — instances fetch their own secrets at boot from a source they authenticate to directly, taking the platform out of the plaintext path. Recorded here as the design direction the delivery seam should not foreclose. Ticket 13's concrete shape: an OutLayer WASI "KMS" agent holding a `PROTECTED_*`-generated key (never visible even to its owner); the api shell calls seal/open over `POST /call/{owner}/kms` — a **key-custody upgrade** (KEK survives root-secret rotation, never sits in platform memory), not platform-blindness: the reconciler can invoke open, so delivery still transits the platform.

### First deploy: shared-host tier only, publish is go-live

A `*.<root>` shared-host tenant rides the root's stack end to end — no instance, no DB. Magic preflight asks exactly one class of question (declared-but-unset secrets the platform cannot invent — paste-or-skip), generates everything else (`BETTER_AUTH_SECRET` crypto-random into the store — no prompt, no `.env`), then the normal train → the live URL. Neon/own-instance provisioning is deploy-console Phase 2.

### The config is sacred

`bos.app.ts` never machine-mutated; resolved facts live in platform/console state (ADR 0034's derived-pin philosophy). `secrets: []` is the whole secrets contract — it was already a declaration, not a value.

## RC nukes (path consolidation — deleting the weeded paths)

The complaint that motivated the cutthroat pass — "maintaining too much of all the paths" — resolves here. All site-verified:

| # | Nuke | Radius |
|---|---|---|
| 01 | `bos infra export` — dead command, zero consumers | tiny |
| 02 | `bos key generate` — duplicate of `bos login --key`, stdout secret leak | small |
| 03 | `ci.image` descriptor acceptance | one line |
| 04 | Legacy JSON config form — upgrade-time conversion, then the dual-form branches die | medium, gated |
| 05 | `plugin.dev.ts` retirement finished (sync special-casing + repo files) | small |
| 06 | Doc/string drift (`bos sync` phantom, stale legacy-filename strings, `--status-list`/`--list-only` deprecation) | trivial |

Sequenced nuke: the **CLI Railway leg** (full surface mapped in the review) dies after the reconciler (console ticket 08) + Railway adapter (ticket 05) cover root and children — never before. Welded later: dev/start boot-stack unification, signing-mode dispatch — real consolidation, too hot to touch mid-RC.

## Tickets

| # | Ticket | Blocked by |
|---|---|---|
| 09 | Secrets store v1 — sealed values, platform-root KEK, `bos secrets` CLI | 02 (adapter seam) |
| 10 | Magic first deploy — shared-host only | 09 |
| 11 | Zero-config dev — subtractive, shippable now | — |
| 12 | Console secrets tab | parked (post-RC) |
| 13 | Custody KEK swap | parked (post-RC) |
