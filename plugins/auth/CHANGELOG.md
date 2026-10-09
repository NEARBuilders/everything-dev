# @everything-dev/auth-plugin

## 2.0.0-rc.0

### Major Changes

- d57b8f4: Adopt the Effect DevTools toolchain: native TypeScript 7 (`@effect/tsgo`) with the Effect language-service plugin, and Oxlint with type-aware Effect rules.

  TypeScript peer/dev ranges are narrowed to `^7.0.2` (no more `^5` support): `every-plugin`, `better-near-auth`, and `@everything-dev/auth-plugin` now require TypeScript 7, and `everything-dev` moves its devDependency to `^7.0.2`. Builds are unaffected (rspack/rsbuild transpile); typechecks and the editor language service run on the patched TS 7 native compiler.

  TS 7 compatibility fixes: the test-plugin fixture consumes the built `every-plugin` declarations, and a new root `tsconfig.base.json` consolidates shared compiler options across parent-owned workspace tsconfigs (scaffolded `ui/`/`api/`/`plugins/*` tsconfigs stay self-contained since they are copied verbatim into child projects).

  Contract declarations move into the plugin build entirely: `every-plugin build`/`deploy`/`dev` regenerate `types/contract.d.ts` from `src/contract.ts` via the patched TypeScript 7 binary whenever it is stale (rspack watch keeps dev types fresh automatically), and `EmitPluginManifest` embeds the fresh file with a verified sha256. The per-workspace `tsconfig.contract.json` files are removed — `bos sync` migrates child projects, and `every-plugin types` regenerates manually. `bos typecheck` now regenerates client-stub types itself before type-checking, so the root `types:gen` script is gone. Remote plugin-manifest fetches during `types gen` retry on transient network failures.

### Minor Changes

- d57b8f4: Capture a real email after passkey or NEAR sign-in, and stop showing fabricated addresses:

  - Passkey sign-up creates its placeholder user with `emailVerified: false` (it was `true`); nobody verified a `passkey-<hex>@…` address, and the flip keeps NEAR sign-ins from firing "verify your email" at an unreachable mailbox.
  - The verification-email configuration is removed: no email is sent on sign-up, sign-in, or when an email changes. Password reset still sends. Email+password sign-up has no UI and was the only flow that used it.
  - New `/set-email` endpoint (session required) saves a real email directly — trimmed, lower-cased, rejected when the address is already registered. It refuses accounts whose email is already verified and not synthetic, marks a saved address `emailVerified: true`, and refreshes the session cookie. It works for legacy passkey users created before the `emailVerified` flip, with no migration.
  - Every surface that displayed the user's email now hides the fabricated shapes (`passkey-…@`, `temp-…@`, `…@near.email`): dashboard identity card, header identity, admin context row, organization member cards, and the settings pages. Sign-in methods and the dashboard's next steps offer an "Add email" affordance instead; a one-time toast with the same action follows a passkey sign-up onto the dashboard. The security tab no longer offers password change to accounts that have no password.

- d57b8f4: Rebuild the CityNode UI on its own design system.

  - Primitives move to shadcn's `base-maia` style (preset `b3ZN5L2h44`) on Base UI, with Phosphor icons, self-hosted Inter/Geist fonts, oklch tokens and larger 44px controls. Radix, lucide, clsx and tailwind-merge are removed; `cn` comes from shadcn's `cn` package.
  - `@shadcn/lint` is enforced through oxlint (layout-only `className` on components, semantic tokens, no arbitrary values). Every native control is now a design-system primitive.
  - Every route is rebuilt around its task: one signed-in shell with task-first navigation and named breadcrumbs, Home "Next steps", a real landing page, Explore with list/map, community and event pages, stepped Start a community and tenant creation flows, a simpler Stake flow, Organizations and Community settings with row menus and confirmations, a focused Admin, a guided node lifecycle, and a redesigned sign-in, onboarding and Settings in the auth plugin.
  - Fixes: dates render only on the client (SSR/browser timezone mismatches remounted pages), org page tabs are URL-addressable, Button-as-link keeps link semantics, non-admins are told why they were sent Home, and page titles use the runtime app name.
  - `ui/DESIGN.md` documents the system.

- d57b8f4: Add shared internationalization support for CityNode with English, Spanish, French, and Chinese catalogs.

  - Detect and persist a global locale across the main and auth UI bundles.
  - Localize login, public navigation, landing, discovery, and community application flows.
  - Save signed-in language preferences in account settings.
  - Format public dates and numbers with the active locale and document the translation workflow.

- d57b8f4: Upgrade build toolchain to Rspack 2.2 / Rsbuild 2.2 / Module Federation 2.9

  Version catalog bumps: @rspack/core + @rspack/cli → 2.2.6, @rsbuild/core → 2.2.8,
  @rsbuild/plugin-react → 2.1.0, @module-federation/\* → latest 2.x (enhanced 2.9.0,
  node 2.7.50). @module-federation/runtime-tools and @rspack/dev-server are now
  explicit dependencies where used.

  BREAKING (every-plugin): EveryPluginDevServer removed from every-plugin/build/rspack.
  Plugin dev serving is now standalone — `every-plugin-serve` (supervised
  `rspack build --watch` + plain node:http server with the same contract: health,
  remoteEntry statics, oRPC RPC/OpenAPI, sibling composition, effect context).
  Plugin dev scripts use `every-plugin-serve` instead of `rspack serve`.
  EveryPluginBuild carries the build-side responsibilities only.

  Deploy note: `bos mf check` compares host and remote pluginVersion exactly, so
  after the 2.9.0 host deploys, remote-only plugins must be redeployed on
  Module Federation 2.9.0 to stay compatible.

- d57b8f4: Harden Device Link sign-in from phone to desktop:

  - The device token endpoint now records a single-use claim for the session token it issues (stored hashed, bound to the client id, ~60s expiry). `/device-link/claim` now requires `client_id`, sets the cookie only for an unconsumed, unexpired claim issued to that client, and consumes it; arbitrary session tokens are refused. `bos login` sends its client id with the claim.
  - Device code requests are accepted only from the configured `deviceLink.clientId` and the bos CLI (`bos-cli`); any other client id is rejected.
  - The desktop session starts in the organization the member most recently joined.
  - The login redirect sanitizer allows the device approval path, so a signed-out phone signs in and returns to approval with its `user_code`; login redirects now navigate by `href` so query strings survive.
  - After a Device Link sign-in the desktop offers "add a passkey on this device"; dismissal is remembered per device.
  - The onboarding success screen replaces "Set up your NEAR wallet" with a "Continue on your computer" step pointing at the Gateway Origin.

- d57b8f4: Add mobile-to-desktop sign-in and passkey-based NEAR wallets:

  - RFC 8628 device authorization flow (official Better Auth `deviceAuthorization` plugin, first-party session path with a configurable `deviceLink.clientId` variable — default `everything-dev`, citynode.app overrides with `citynode-web`), a `/device-link/claim` endpoint that exchanges the polled session token for an httpOnly cookie, and auth-plugin UI pages for QR pairing (`/login` "sign in with phone"), `/device` code verification, and `/device/approve` approval.
  - Passkey sign-in through the official `@better-auth/passkey` plugin: session-less first-time registration (generated-email user via `registration.resolveUser`) with a sign-in orchestration that creates the credential on first use, plus "sign in with passkey" buttons on `/login` and `/onboard`.
  - NEP-616 deterministic (`0s…`) passkey wallet support: `/near/link-passkey-wallet` verifies a NEP-413 assertion against the user's stored passkey credentials server-side (challenge binding, user-verification enforced, nonce replay protection) and links the derived account — no public key crosses the wire, no on-chain lookup needed. `/near/verify` also accepts passkey wallet-contract accounts.
  - `siwnClient` gains a `wallets` option for registering near-connect sandbox wallet executors.
  - Organization onboarding stations: capped, expiring onboarding codes (named after an event) with QR pairing, live redemption status, and event-team membership. Station codes always grant plain membership — revocation now rejects prior redeemers too, and the plaintext code is displayed once at creation.

- d57b8f4: Event-linked Onboarding Codes, Organizers and a station view:

  - Onboarding Codes are tied to a Node Event. `createOnboardingCode` now requires `eventId` and `eventName` (a display snapshot) and takes an optional `expiresAt` in place of `expiresInHours`; codes for the same event share one Event Team, two events with the same title get separate teams, and renaming a team doesn't affect lookup. The raw code is stored encrypted at rest (HKDF-SHA256 → AES-256-GCM from `BETTER_AUTH_SECRET`) beside its hash. Migration `0007_onboarding_code_event` adds `event_id` and `encrypted_code`.
  - New API route `createEventOnboardingCode({ eventId, maxUses?, expiresAt? })` loads the Node Event, refuses non-event activities, nodes whose tenant has no organization, and organizations other than the caller's active one, then creates the code through the auth plugin in-process with a default expiry of event end + 48h.
  - Organizers — organization owners, admins, or members of a Team granted the new `events` Feature Area — can create, list and revoke codes and open a station. New auth procedure `getOnboardingStation` returns the decrypted code for an active code to an Organizer of its organization.
  - Redeeming a code sets the active organization only and no longer switches the Active Team. At the organization membership limit, redemption fails with "This organization is full". The limit is configurable through the auth plugin's `organizationMembershipLimit` variable (citynode sets 1000). `getOnboardingCodeInfo` reports `usedUp`.
  - UI: event rows in the activity editor get "Start onboarding", which opens a fullscreen station at `/onboarding/station/$codeId` (large QR on the Gateway Origin, live joined count, recent joiners), reopenable from the org Onboard tab for any active code. The free-text event name form is removed, and the onboarding page explains used-up codes.
  - UI: the activity editor lists events on a date timeline with Upcoming (default) and Past tabs and per-tab counts. Days get a sticky header in the viewer's timezone (year shown outside the current year), and cards show the start time with the event-local time when the event is in another offset, the organizer, venue, status badges and the existing actions. Posts keep the flat list.

- d57b8f4: Member email visibility is now gated behind an `email: ["read"]` permission check. Organization member lists, invitation rows, and member cards only render a member's email to viewers who hold that permission (or the member themselves, or a platform admin); everyone else sees no email instead of the raw address.
- d57b8f4: NEAR account management on the sign-in methods page, and a phone-free mobile login:

  - The "Sign in with your phone" option is now desktop-only — on mobile viewports the login page shows passkey and NEAR wallet only, and the "no passkey found" hint drops the phone suggestion.
  - The NEAR wallet section in Settings → Sign-in methods manages every linked NEAR account, not just the active one: make an account primary, unlink an account (with confirmation), or link another named account at any time.
  - When the user has a passkey and the network supports a Passkey Wallet, an account with no linked NEAR account can create one derived from their passkey (`auth.near.linkPasskeyWallet`) — no seed phrase. Linking now uses the dedicated `near.link` action instead of a full sign-in ceremony.
  - better-near-auth: exports `isDeterministicAccountId` so consumers can recognize Passkey Wallet (`0s…`) accounts without duplicating the NEP-616 format.

- d57b8f4: Onboarding capacity and post-onboarding build prompts: new onboarding codes default to 300 joins instead of 50 (the "Max joins" placeholder matches), and the link-onboarding success panel now offers two copy-prompt cards — "Integrate NEAR AI Private Inference" and "Integrate NEAR Intents" — each copying a ready-made prompt that installs the matching skill from near/agent-skills, grills the member about what they want to build, and routes existing/new-application guidance (confidential-model swap or TanStack AI / 1Click API).
- d57b8f4: Onboarding continuation fixes: redeeming an invitation link now activates the invite's organization even when the member already redeemed it before, the link-onboarding page skips the display-name step for returning members who already chose a name, the done panel points at a new `/build` page holding the two copy-prompt cards (NEAR AI private inference, NEAR Intents), and the "Continue on your computer" card points at a direct `/login?method=phone` deep link with concrete scan-and-approve instructions plus a copy-link action. The login page honors `?method=phone` by opening the pairing QR immediately (desktop only — mobile falls back to the sign-in view).
- d57b8f4: Require platform-admin approval for self-service organizations, expose pending and rejected request status, and prevent unapproved organizations from being activated or linked to tenants. Personal signup organizations remain active.

  Block direct member additions before approval and preserve shared organizations when the original requester's account is removed.

  Enforce organization approval through shared authorization middleware and infer organization status in the UI from the auth API contract.

- d57b8f4: Add organization onboarding stations: an owner/admin creates a capped, expiring onboarding code (named after an event) from the org page's new Onboard tab, and displays it as a QR. People scan it with a phone, land on `/onboard`, and join the organization — plus the event's team (find-or-create by event name) — by signing in with a passkey wallet or an existing NEAR wallet. Includes live redemption status (joined list polled every 2s), code revocation, idempotent redemption, and membership-capacity enforcement. Also fixes the stale `development` export condition for `everything-dev/ui/manifest-generator` left by the manifest refactor.
- d57b8f4: Single-ceremony passkey sign-up with a linked Passkey Wallet:

  - A passkey registration begun without a session now ends signed in, with the Passkey Wallet derived from the new credential linked as the member's primary NEAR account — one biometric prompt. It applies only to a user created by that registration who owns exactly that credential; "add a passkey" while signed in never mints a session or changes the primary NEAR account. The verify-registration response carries `passkeyWallet` (`linked` or `unavailable`).
  - Registration asks for a discoverable, user-verified ES256 or EdDSA credential; registrations and sign-ins without user verification, or with a key that cannot derive a Passkey Wallet, are refused (`PASSKEY_UNSUPPORTED_AUTHENTICATOR` / `PASSKEY_USER_VERIFICATION_REQUIRED`).
  - The passkey plugin accepts every configured Gateway Origin of the runtime's network (`passkey.gatewayOrigins.{mainnet,testnet}`), with the rpID unchanged. The network comes from the runtime account.
  - better-near-auth: Passkey Wallet linking is one operation (`linkPasskeyWalletFromCredential`) shared by `/near/link-passkey-wallet` and the sign-up hook. Linking uses the new `passkeyWalletNetwork` option instead of a hard-coded mainnet; a network with no passkey wallet factory skips linking and reports `PASSKEY_WALLET_UNAVAILABLE`. `getPasskeyWalletFactory` and `isPasskeyWalletAvailable` are exported.
  - everything-dev: `signInWithPasskey` no longer falls through to registration; use the new `createAccountWithPasskey` to create an account. `isPasskeyAutofillAvailable` and `isUnsupportedAuthenticatorError` support browser autofill and unsupported-authenticator messaging.
  - Users created by abandoned passkey registrations (older than an hour, with no passkey, NEAR account, account, session or phone number) are swept every 15 minutes, with their personal organization.
  - The login page offers passkey autofill and points to Sign in with phone or a NEAR wallet when no passkey is found; the onboarding page offers "Create account" and "I already have an account", notes when no passkey wallet exists on the network, and offers an optional display name after joining.

- d57b8f4: Session gas keys (NEP-611) are the primary gasless write path, and the legacy sub-account relayer-FCAK config is removed.

  New: `siwn({ sessionGasKey })` (flat or dual-network, like the relayer) — scope (`receiverId`/`methodNames`), top-up fund amount and threshold, per-user lifetime cap, and nonce-lane count. New session-gated endpoints: `POST /near/gas-key/fund` (Sponsor-signed `TransferToGasKey` under on-chain scope/balance verification and the lifetime cap, recorded in a `fundedGasKey` table), `POST /near/gas-key/info`, and `GET /near/gas-key/scope`. The client gains `addSessionGasKey` (wallet-signed Bootstrap `AddKey` with `gasKeyInfo`, refused for wallets whose manifest lacks `features.gasKeys`), `sendWithGasKey` (local signing on rotating nonce lanes through a wallet-less client), `refreshGasKeyInfo`, `ensureGasKeyFunded`, `isGasKeyWalletSupported`, and `getGasKeyScope`; a `gasKeyState` atom joins the client atoms. The wallet connector is now `@hot-labs/near-connect` (installed from the gas-key-capable fork `elliotBraem/near-connect#v0.12.0-fork.2` — the fork line gas-key wallets run); near-kit is bumped to ^0.20.2.

  Removed: `SubAccountConfig.addRelayerFCAK` / `relayerFCAK` and the `NEAR_SUB_ACCOUNT_PARENT_KEY_*` secret plumbing — session gas keys are the only key-sponsorship mechanism. Sub-account creation still works with an explicit relayer whose account is the parent, or a parent key passed directly via `siwn({ secrets: { parentKey } })`. See ADR 0017 for the model (session gas keys first, relayer fallback).

- d57b8f4: Complete organization teams and wallet invitations across the auth plugin, API, and dashboard. Team workspaces now carry feature-area context through node mutation authorization, and organization owners can invite either an email address or a NEAR account, target a team, and manage wallet-aware pending invitations. Invitees can accept email or wallet invitations from the dashboard or claim link and land in the targeted workspace.

### Patch Changes

- ea9e9f8: Adding a member directly now requires the caller's Better Auth `member:create` permission in the target organization (owners and admins), and only owners can add owners. Platform admins keep access.
- d57b8f4: Hydrate and paginate admin lists, batch node summary counts, resolve organization links, add signed-in Things navigation, and restore the Thing event stream.
- d57b8f4: The auth server's apiKey configurations (`user-keys`, `org-keys`) now allow key names up to 64 characters (Better Auth's default maximum is 32). The `bos login` device-link page mints keys named `bos login — <device> — <timestamp>`, which exceeded the 32-character default and failed key creation with `INVALID_NAME_LENGTH`; the api-key name inputs in the UI now cap at 64 to match the server limit. The apikey table column is unbounded `text`, so no migration.
- d57b8f4: The host's auth variables now include `baseUrl`, derived from bos.config.json (the host url in development, the domain in production). The host-driven Better Auth instance previously never received `baseUrl`, so `config.baseUrl` fell back to a hardcoded `http://localhost:3000` — making invite-email accept links, passkey RP-id derivation, and callback URLs wrong on any stack not running on port 3000 (e.g. the CI regression stack: host on :4100, invite links pointing at :3000).
- d57b8f4: Compile login catalogs before loading them into Lingui, preserve the NEP-413 callback URL throughout wallet signing and verification, and keep local plugin manifests and source-first runtime loading working on Windows.
- d57b8f4: Consume `better-near-auth` from the workspace via `catalog:` and align remaining hard-coded dependency versions (`drizzle-orm`, `pg`, `@electric-sql/pglite`, `@orpc/contract`, `@orpc/server`) with the root catalog.
- d57b8f4: Fix auth plugin remote load by resolving its MF container name from its `plugin.manifest.json` (mirrors the resolution `plugins.*` already use). Without this, in remote mode the host registered the auth remote under the slot key `"auth"` while the container's self-name was `everything-dev_auth-plugin`, causing `@module-federation/node`'s chunk-URL fallback to silently return empty chunks and throwing `ModuleFederationError: undefined is not an object (evaluating '__webpack_modules__[e].call')` — the only plugin to fail. Bos configs can set an explicit `app.auth.name` to pin the remote name.
- d57b8f4: `bos login` — sign in with your NEAR account through the hosted site via the OAuth 2.0 Device Flow (RFC 8628), the same flow the site's QR pairing uses: the CLI requests a device code, you approve at `/login/device` in any browser (same machine or not — it works over SSH and headless), and the CLI mints its credential from the approved session. `--key` exports a scoped FastKV publish key to `~/.near-credentials`; the gasless delegate key is approved in the browser on the same page (wallet signs the `addKey`). `bos logout` revokes the credential. `bos publish --wallet` publishes gaslessly via a NEP-366 delegate action through the platform relayer. New `publish.auth` config surface (`session` | `key` | `custody`). The auth server's device-authorization plugin now serves the flow at `/login/device` (moved from `/device` — nothing had shipped against the old path) and accepts any non-empty `client_id` (public-client device flow — user approval is the trust boundary; the code↔client binding is still enforced at the token endpoint). The site's `/login` now preserves full redirect targets including query strings.
- d57b8f4: Add a public /build page with the NEAR AI Cloud and NEAR Intents copy-paste prompts, and link it from the sidebar.

  - New `/build` route in the core UI (`_public`) with a "Ready to start building?" header and copy-to-clipboard prompt cards (NEAR AI Cloud private inference, NEAR Intents 1Click).
  - Sidebar gains a "Build" item in the main section, visible to signed-out visitors too.
  - Onboarding completion screen now points to `/build` with a CTA instead of inlining the prompts; prompt test ids moved from `onboard.prompt-*` to `build.prompt-*`.

- d57b8f4: Direct `auth.apiKey.create` calls (the CLI device-link handoff page and the personal Settings → API Keys form) no longer pass a `configId`, but the auth server's apiKey plugin registers only named configurations (`user-keys`, `org-keys`) — with no default config, Better Auth's `resolveConfiguration` rejected the request with `NO_DEFAULT_API_KEY_CONFIGURATION_FOUND`. Both call sites now pass `configId: "user-keys"`, unblocking `bos login` and personal API key creation.
- d57b8f4: User-owned tenant spawning plus dev passkeys on localhost.

  **api**

  - New `spawnTenant` route (`POST /tenants/spawn`): session-gated — creates a tenant owned by the signed-in user's linked NEAR account (wallet or passkey-derived `0s…`) with the given hostname as its verified-or-pending primary binding, in one transaction. Returns the tenant, binding, owner account, and a `publishStatus` of `pending_funding` (passkey-derived owner) or `ready`.
  - New `getSpawnStatus` route (`GET /tenants/spawn/{tenantId}`) for owner-scoped spawn polling.
  - `tenants.owner_user_id` column (migration included); `ownerKind` gains `"user"`; `authorizedTenant` authorizes user-owned tenants for their owner; `listTenants` returns a user's owned tenants without requiring an active organization.
  - Bindings whose hostname falls under a configured gateway zone are verified automatically (the platform owns that DNS; TXT verification stays for tenant-brought custom domains). Configure via the new `gatewayDomains` api variable (comma-separated).
  - The `requireOrganization` gate on `listTenants` is gone for organization-less users, who now get their personal tenant list instead of `FORBIDDEN`.

  **@everything-dev/auth-plugin**

  - Passkey RP ID resolves to the local hostname when the auth origin is `localhost`/`127.0.0.1` (dev), so passkey creation and assertion work in local development; production keeps the configured `passkey.rpID`. Override with `PASSKEY_RPID`.

- d57b8f4: Local stacks now export the host origin as `BASE_URL` (dev orchestrator env + regression stack env), so the auth plugin's Better Auth instance stops falling back to the hardcoded `http://localhost:3000`. Previously every baseURL-derived URL — invite-email accept links, passkey RP-id derivation, callback URLs — pointed at port 3000 while the stack actually ran on the configured host port, breaking any non-3000 deployment of a local stack.

  Regression test databases also get a DB-level `lock_timeout` (10s): postgres lock waits are unbounded by default, so one lingering transaction could stall every later request touching the same rows for minutes with no error.

- d57b8f4: Post-sign-in redirect loop fix ("Too many redirects" after a successful login). The login page navigated to the redirect target before the refreshed session landed in the query cache, and the authed route guards read that cache via `ensureQueryData`, which returns a stale value immediately — so the guard bounced the just-signed-in user back to `/login`, the login route bounced them forward again, and the two guards ping-ponged past TanStack Router's 20-redirect limit into a root-boundary "Application error". Three fixes:

  - The login page (and the device-pairing claim path) now refresh the session cache **authoritatively** — `getSession({ query: { disableCookieCache: true } })`, since the Better Auth session cookie cache can still serve the pre-sign-in signed-out snapshot for up to 5 minutes — and seed the `["session"]` query before navigating.
  - Route guards (`requireSession`/`requireAdmin`, `_authenticated`, `_admin`) read the session via `queryClient.query()`, which **awaits** the refetch when the cached value is stale instead of trusting it.
  - Banned users no longer ping-pong: the login route skips its authed-visitor redirect for banned sessions, breaking the `/login#banned` ↔ `/dashboard` cycle.

  Covered by router-level regression tests (plugins/auth/ui `login.test.tsx`, ui `auth-guards.test.ts`) and a browser regression in `tests/regression/browser/specs/auth-redirect.spec.ts`.

- d57b8f4: Fix stuck scrolling on focused auth/onboard pages: the public shell clips the content region (`overflow-hidden` + `min-h-0`), and AuthPanel owns scrolling (`overflow-y-auto` + `my-auto` centering) so short viewports and open keyboards can reach every step without a second document scrollbar.
- d57b8f4: Consolidate the migration runner and DB driver into `everything-dev/db` (advisor plan 008).

  **Root-cause fix for the boot race** (`duplicate key value violates unique constraint "pg_type_typname_nsp_index"` on `drizzle.__drizzle_migrations` when plugins booted concurrently against one shared database): `ensureMigrationTable`'s retry used `Effect.retry(..., until: isRetryableMigrationError)` — in Effect, `until` means _stop_ retrying when the predicate is true, so the race error the retry was built to absorb got zero retries (verified: 1 attempt with `until`, 4 with `while`). The shared runner now uses `while: isRetryableMigrationError`. `plugins/auth` had no retry at all and now inherits the shared one.

  **Shared runner** (`everything-dev/db`): `runMigrations(db, migrations, opts) => Effect<MigrationReport, DatabaseError>` with SAVEPOINT/ROLLBACK/RELEASE duplicate-DDL tolerance (fixes the proposals/votes bare-`continue` 25P02 aborted-transaction bug — the fix previously lived only in api and never propagated), retryable-SQLSTATE journal-init backoff, hash-tracked idempotence, and the duplicate-table preflight. `detectDrift`/`loadMigrations`/`loadMigrationsFromDisk` move with it; `loadMigrations` takes the bundler's virtual-module loader as an option so the shared package never names `virtual:drizzle-migrations.sql`.

  **Shared driver** (`everything-dev/db`): `createDatabaseDriver(url, schema, namespace?)` — engine by URL scheme (`pglite:`/`:memory:` → PGlite, else postgres), protocol-level `search_path`, **one-time** `CREATE SCHEMA` via `pool.connect()` (replaces votes/proposals' per-connection `on("connect")` handler that re-raced `CREATE SCHEMA IF NOT EXISTS` on every connection), env-driven pool config (`DB_POOL_MAX` etc.), idempotent close (drops auth's `pool.end()` stack-trace noise). Plus `pluginSchemaName(pluginId)` and a single shared `DatabaseError`.

  **Workspaces**: api/votes/proposals/auth `db/migrate.ts` and `db/index.ts` become thin sync-propagated adapters (< 40 lines; `bos sync` copies api's canonical copies verbatim into plugins). `plugins/_template` aligns fully to the standard flow: `migrator.ts` deleted (renamed to `migrate.ts`), canonical layer adopted, journal standardized to `drizzle.__drizzle_migrations` (pre-existing tables are auto-recorded by the preflight; the old in-schema `drizzle_migrations` table is frozen, matching 017/D6), and the `TemplateDatabase` alias is dropped. `adoptPublicTables` is deliberately **not** ported: it was a one-time boot-time `ALTER TABLE ... SET SCHEMA` relocation for pre-schema-isolation databases (live dev DB has zero `public` tables); legacy adoption stays with the fail-closed `detectDrift`/`bos db doctor` path, never boot-time magic.

  **Drivers stay excluded from the bundle graph**: the shared driver dynamic-imports engines (`pg`, `@electric-sql/pglite`, `drizzle-orm/*`) via bare specifiers, and everything-dev's tsdown config adds them to `deps.neverBundle`. This matters beyond hygiene: tsdown's unbundle mode otherwise rewrites dynamic imports into relative paths into its vendored `dist/node_modules/` copies, which (a) defeats rspack's `externals: ["pg", "@electric-sql/pglite"]` (externals match bare requests only), dragging pglite's `pglite.wasm`/`pglite.data`/`initdb.wasm` binaries into the MF dev bundles where they fail to resolve or parse as JS, and (b) makes node resolve `drizzle-orm` from the vendored `dist/node_modules/drizzle-orm` (nearest node_modules wins) whose copied layout breaks ESM resolution in the host process. Every workspace with a database already declares `@electric-sql/pglite` + `drizzle-orm` as its own dependencies, so bare runtime imports resolve everywhere — dev, prod MF bundles (via rspack externals), and `bos init` scaffolds.

  Regression suite added at `packages/everything-dev/tests/unit/db-run-migrations.test.ts`: fresh-schema, partial-overlap savepoint path (previously failed on proposals/votes with 25P02), duplicate-preflight journal recording, and a retry-semantics test pinning 3+ gen-runs on `23505`.

- d57b8f4: Fix the recurring post-sign-in redirect loop structurally: the session read path and auth redirect policy now have one owner (`everything-dev/ui/auth`), shared across the core ui and plugin ui remotes as a strict Module Federation singleton. A mixed deploy can no longer run two divergent session-read copies whose guard decisions disagree into "Too many redirects" — the login guard and the authenticated guard read through exactly one module, and a version mismatch fails loudly at load instead of silently loading a second copy. Child projects receive the consolidated guards via `bos sync` (`ui/src/lib/auth-guards.ts`, `ui/src/lib/plugin-path.ts`, and the plugin's drifted `session-cache.ts` copy exit sync ownership). See ADR 0018.

  Also kills the silent dist-staleness class for build tooling: the bundler-configuration factories (`every-plugin/ui/mf-build`, `every-plugin/build/rspack`) resolve from source under bun (the workspace runtime) while node/npm consumers resolve the immutable published dist, and the `everything-dev/ui/mf-build` re-export shim is deleted (`ui/rsbuild.config.ts` imports `every-plugin/ui/mf-build` directly, like the generated plugin configs already do). Shipped code still resolves dist, with `bos build`/`bos deploy` unconditionally staleness-checking the framework prerequisites before any target — the train is the only supported build path.

- d57b8f4: fix(auth): single authoritative session read path — post-sign-in redirect loop

  All session reads (route guards, the login route's beforeLoad, useQuery
  observers, the post-sign-in refresh) now share one queryFn that always calls
  `getSession({ query: { disableCookieCache: true } })`, so every redirect
  decision sees the same authoritative answer and the login ↔ dashboard
  ping-pong ("Too many redirects") is structurally impossible. The
  post-sign-in refresh (`refreshSessionCache`) overrides staleness so a fresh
  signed-out cache entry written by an observer moments earlier cannot
  short-circuit it. Removed the redundant authed-redirect triggers on the
  login page (component-level `<Navigate>`, loader prefetch), the dead
  `rejectAuthed` guard, and the bootstrap WeakSet bookkeeping in
  `resolveSessionFromCache`. The server-side better-auth session cookie cache
  is disabled outright: it was prod-only (dev and prod behaved differently)
  and delayed revocation/ban visibility for up to its maxAge. The login
  redirect sanitizer now rejects `/login…` targets, closing the last possible
  self-referential redirect loop.

- d57b8f4: Start-command regression stack fixes (the deployment-image path):

  - The regression container's fixture config now injects the auth plugin's `baseUrl` variable (`http://localhost:<port>`, the bos start ingress). The domain-derived `https://` baseURL made better-auth set Secure cookies that no http client (Go jar or browser) can send back: sign-in succeeded but every session-bearing request 401'd. The config variable wins over the host's domain derivation by construction — production stacks are untouched.
  - The auth plugin's better-auth core rate limiter can be disabled via `BETTER_AUTH_RATE_LIMIT_DISABLED=1` — production defaults it on with a single shared per-path bucket when no client IP is resolvable, which the regression suite's `/api/auth/*` traffic trips within seconds.
  - The regression container now forwards the harness's `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, and `BODY_LIMIT_MAX` into the image — without them the host's middlewares ran defaults, so the oversized-body pin got a 404 (no procedure match for a 70KB text body) instead of 413, and the rate-limit burst never saw a 429.

- d57b8f4: Bind wallet invitations to their NEAR network, guard invitation status transitions, and align wallet membership limits with email invitations. Refresh workspace state after team changes and invitation acceptance, and defer membership loading until the Teams tab is opened.

  Existing wallet invitations without a network must be reissued; email invitations are unaffected.

- d57b8f4: Make the organization's linked DAO the team wallet with the Trezu connection as the linking path: the prototype resolves the team from the org-linked DAO, then the application payload, then an account captured through a "connect team DAO" button that reuses the already-verified Trezu connection (no reconnect, no link prompt — linking happens silently and best-effort). Unset team and endowment inputs are replaced in place by connect buttons so the card stops shifting, the node name defaults to the title-cased organization name, and blockers read "connect your team DAO with Trezu". The auth plugin's `requireAuth` now prefers the host-injected session user and only falls back to resolving the session internally, fixing spurious "Authentication required" errors on `getDao`/`linkDao` and the rest of the `apiClient.auth.*` surface.
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [c520871]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [95261fe]
- Updated dependencies [c520871]
- Updated dependencies [4d8efd1]
- Updated dependencies [d57b8f4]
- Updated dependencies [1d0bfff]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [96928b0]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f9d2dce]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [95261fe]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [f151e1b]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f151e1b]
- Updated dependencies [4d8efd1]
- Updated dependencies [95261fe]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [95261fe]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [c520871]
- Updated dependencies [9191ab3]
- Updated dependencies [4d8efd1]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f151e1b]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [c520871]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f9d2dce]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f151e1b]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [c520871]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [784fcad]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [c520871]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f5f1a5f]
- Updated dependencies [f5f1a5f]
- Updated dependencies [f5f1a5f]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [c23dfb6]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [c520871]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [ed70808]
- Updated dependencies [8a06f6b]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f9d2dce]
- Updated dependencies [f9d2dce]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f9d2dce]
- Updated dependencies [f9d2dce]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [3e47fea]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
  - everything-dev@2.0.0-rc.0
  - every-plugin@3.0.0-rc.0
  - better-near-auth@2.0.0-rc.0

## 1.2.3

### Patch Changes

- 6dff104: Remove artificial startup timeout, fix TCP false-positive, and auth pglite initialization

  - `packages/everything-dev/src/dev-session.ts`: Remove the hardcoded 30-second `awaitReady` timeout so the host genuinely waits until local plugins (auth, api, template) finish rspack compilation and serve their remote entry.
  - `packages/everything-dev/src/orchestrator.ts`: Remove the TCP-port fallback in `spawnDevProcess` readiness probing. A plugin is now only considered "ready" when its HTTP endpoint returns 200, eliminating false positives where rspack opens its listen port before compilation is complete.
  - `plugins/auth/src/db/driver.ts`: Add `mkdirSync(..., { recursive: true })` before initializing `@electric-sql/pglite`, fixing "PGlite failed to initialize properly" errors caused by PGlite's internal non-recursive `mkdirSync`.

## 1.2.2

### Patch Changes

- 2e79fea: Fix init config ordering, parent plugin leakage, auth pglite resolution, and plugin selection

  - `packages/everything-dev/src/cli/init.ts`: Fix `bos.config.json` key ordering so `extends` is always first and trailing group (`app`, `plugins`, `shared`) is last. Prevent parent plugin leakage by writing `"plugins": {}` instead of deleting the key when no plugins are selected.
  - `packages/everything-dev/src/cli/prompts.ts`: Remove `registry` from `AVAILABLE_PLUGINS` since `.templatekeep` only includes `plugins/_template/**`.
  - `plugins/auth/package.json`, `host/package.json`, `package.json`: Move `@electric-sql/pglite` to runtime `dependencies` so the auth plugin can resolve it when loaded remotely via Module Federation.

## 1.2.1

### Patch Changes

- fd962b6: Clean up tracked generated types and old SQLite artifacts.

  - Added `types/` to `.gitignore` to prevent generated `.d.ts` files from being tracked
  - Removed previously tracked generated type declarations from git history
  - Removed leftover `auth.db` and `test-auth-sandbox.db` SQLite files from pre-PostgreSQL migration
  - No source code changes, no functional impact

## 1.2.0

### Minor Changes

- 2b542ae: Clean up PostgreSQL migration artifacts and tighten type safety.

  ### Auth Plugin

  - Remove stale `types/db/layer.d.ts` (source file was deleted in the PostgreSQL migration).
  - Replace `any` in Drizzle query callbacks with inferred types (`auth-instance.ts`, `index.ts`).
  - Tighten `AuthDatabase` type from `PgDatabase<any, ...>` to `PgDatabase<PgQueryResultHKT, ...>`.
  - Add `.gitignore` for local pglite artifacts (`auth-local.db`, `test-auth.db`).
  - Add `githubClientId` and `githubClientSecret` optional dev defaults to `plugin.dev.ts`.
  - Update README to reflect pglite instead of libsql.

## 1.1.6

### Patch Changes

- a0c5784: Upgrade `@hono/node-server` to `^2.0.1` across host and everything-dev packages.

  Bump dev dependencies group:

  - `@biomejs/biome` `2.4.10` → `2.4.14`
  - `@effect/language-service` `^0.84.3` → `^0.85.1`
  - `@electric-sql/pglite` `^0.2.0` → `^0.4.5`
  - `@vitest/ui` `4.1.2` → `4.1.5`

- Updated dependencies [a0c5784]
  - every-plugin@2.5.3

## 1.1.5

### Patch Changes

- Updated dependencies [a38288d]
  - every-plugin@2.5.2

## 1.1.4

### Patch Changes

- Updated dependencies [f185a6c]
  - every-plugin@2.5.1

## 1.1.3

### Patch Changes

- Updated dependencies [516376e]
  - every-plugin@2.5.0

## 1.1.2

### Patch Changes

- Updated dependencies [b20445f]
  - every-plugin@2.4.3

## 1.1.1

### Patch Changes

- Updated dependencies [fac9cf6]
  - every-plugin@2.4.2

## 1.1.0

### Minor Changes

- 0a67206: Refactor dev orchestrator to service-descriptor architecture; add NEAR auth contract routes (nonce, verify, profile, relay, view); consolidate session queries in UI; add source-map devtool for plugin builds

### Patch Changes

- Updated dependencies [0a67206]
  - every-plugin@2.4.1
