# ui

## 2.0.0-rc.0

### Major Changes

- d57b8f4: Tenant creation on the admin dashboard now requires connecting a sputnik-dao account via the Trezu wallet (separate from the existing SIWN session wallet). The connected DAO account owns the new tenant: `tenants.accountId` is the DAO, `bos.config.json` is published at `bos://<dao>/<gateway>` and inherits the platform base. The API gains `requireAdmin` + a server-side `get_policy` view call that confirms the session user's primary NEAR account appears in an explicit DAO policy group before accepting the create. `tenants.owner_kind` (default `platform`) is added to flag DAO-owned rows and to gate the DAO-aware republish flow.

  The platform subaccount flow (`siwn.subAccount.*`, `NEAR_SUB_ACCOUNT_PARENT_KEY_*`) is removed. Existing tenants created before this update keep working — the host is account-agnostic — but the admin wizard is now DAO-only.

- d57b8f4: Manifest composition replaces route-tree grafting as the composed-SSR model (plan 034, ADR 0007/0008). The host constructs the ENTIRE route graph from generated manifests (`manifest.gen.json` + `routeConfig.gen.ts` per ui source) through the core ui's `./compose` engine; `defineUiPlugin`, the `./tree` expose, `composeApp`/`graftCopy`, the v1 mount registry, the homegrown digest, and the dedicated `ui-ssr`/`plugin-ui-ssr` dev servers are deleted. `bos dev --ssr` now composes from source manifests in the host process (no extra servers or probes); `BOS_UI_COMPOSE` is gone. Client runtime config changes shape: `ui.compose` is now `{ digest, remotes: [{key, name, entry}], manifests }` and `ui.composeDigest` is removed. Plugin ui remotes consume shared deps with `import: false` (the core provides); mounts are registry v2 (`public`/`authenticated`/`admin` implemented, `org`/`team` declared) and root-level pathless layouts.

### Minor Changes

- d57b8f4: Add platform-admin node structure and validator reporting pages, plus a proposal review queue with approve and reasoned reject actions. Ensure remote auth contracts without additional type exports receive a generated fallback so repository typechecks remain usable.
- d57b8f4: Redesign `Badge` so its variants read as status chips instead of mimicking `Button`'s solid dark fill: `default` is now a soft secondary chip, `secondary` a muted chip, `destructive` a soft danger tint (`border-destructive/40 bg-destructive/10 text-destructive`), and `outline` stays on `bg-card`. Adds `success` and `warning` status variants on the same soft-tint recipe. All variants keep the hard `border-outset` bevel. `Button` hover now dims the background color (`hover:bg-foreground/90`, `hover:bg-secondary/90`, `hover:bg-destructive/90`) instead of the whole element, keeping label text at full opacity.
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

- d57b8f4: Per-community dashboard bulletin. Community managers can author a short markdown announcement (Events & profile → Bulletin tab) that renders as a bluish bulletin card at the top of the main dashboard and the community overview page, with an UnderConstruction footer linking to the repository. Stored on the node's existing `metadata` jsonb (`bulletin` key) — no migration. Adds a merge-safe `PUT /nodes/{nodeId}/bulletin` route (same team-area + org-ownership gate as `updateNode`) that reads-modifies-writes metadata so other keys like `poolAccountId` are never clobbered. `Markdown` gains a `variant?: "default" | "compact"` prop with compact prose styling for card-sized content.
- d57b8f4: Show the team account's stake in the node's pool as available rewards on My Node.
- d57b8f4: Keep My Node team stake as a NEAR figure and add a Trezu proposal to unstake some of it back to the confidential treasury.
- d57b8f4: Redesign the public directory pages and align chrome/components on the landing style.

  - Landing page (`/`) is now left-aligned and minimal: "What are City Nodes" heading with lede copy, a "Directory" section rendering nodes as a borderless single-column table (hairline row dividers, `hover:bg-muted/50` + name underline), and a left-aligned Apply CTA. Healthy top spacing below the header bar (`pt-12 sm:pt-20`).
  - New shared pathless `NodeDirectory` component (`n/-node-directory.tsx`) owns the directory table, skeleton rows, and empty state, with optional validator badges.
  - Node page (`/n/$slug`) adopts the same language: `NodeDirectory` for child nodes (with validator badges), de-carded stake section (primary Button for own-validator, borderless hover rows for city stake links), matching skeleton/not-found states, and `default` container width.
  - Canonicalize `UserNav`/`NearBranding`/`ThemeToggle`/`OrgSwitcher` under `components/layout/`: `_public.tsx` and `auth-shell.tsx` now import the layout copies (the ones with ThemeToggle + outline-variant connect button), the barrel re-exports the layout copies, and the stale root-level duplicates are deleted.
  - Replace remaining hand-rolled inline-class buttons/links with `Button` variants across dashboard, admin, tenant, orgs, and things pages (including `icon-sm` outline back buttons), and swap a hardcoded rgb avatar border in orgs/$slug for the semantic `border-border-strong`.

- d57b8f4: The endowment re-stake flow runs from a member session without Trezu: the POC's endowment treasury field is now a typed input (the Trezu connect is a secondary action), the node name prefill uses the organization's `metadata.name` when set (falling back to the title-cased org name) and an empty saved draft no longer swallows it, the Endowment chain-state tab shows the lockup's available-to-stake balance (account balance minus the 2 NEAR storage reserve), the Sponsor NEAR field gains a Max fill of that available minus 1 NEAR, and the stake precheck refuses to stage a `deposit_and_stake` proposal larger than what the lockup can actually stake. The team unstake/withdraw dialog's Max fill now leaves the same 1 NEAR margin.
- d57b8f4: Event-linked Onboarding Codes, Organizers and a station view:

  - Onboarding Codes are tied to a Node Event. `createOnboardingCode` now requires `eventId` and `eventName` (a display snapshot) and takes an optional `expiresAt` in place of `expiresInHours`; codes for the same event share one Event Team, two events with the same title get separate teams, and renaming a team doesn't affect lookup. The raw code is stored encrypted at rest (HKDF-SHA256 → AES-256-GCM from `BETTER_AUTH_SECRET`) beside its hash. Migration `0007_onboarding_code_event` adds `event_id` and `encrypted_code`.
  - New API route `createEventOnboardingCode({ eventId, maxUses?, expiresAt? })` loads the Node Event, refuses non-event activities, nodes whose tenant has no organization, and organizations other than the caller's active one, then creates the code through the auth plugin in-process with a default expiry of event end + 48h.
  - Organizers — organization owners, admins, or members of a Team granted the new `events` Feature Area — can create, list and revoke codes and open a station. New auth procedure `getOnboardingStation` returns the decrypted code for an active code to an Organizer of its organization.
  - Redeeming a code sets the active organization only and no longer switches the Active Team. At the organization membership limit, redemption fails with "This organization is full". The limit is configurable through the auth plugin's `organizationMembershipLimit` variable (citynode sets 1000). `getOnboardingCodeInfo` reports `usedUp`.
  - UI: event rows in the activity editor get "Start onboarding", which opens a fullscreen station at `/onboarding/station/$codeId` (large QR on the Gateway Origin, live joined count, recent joiners), reopenable from the org Onboard tab for any active code. The free-text event name form is removed, and the onboarding page explains used-up codes.
  - UI: the activity editor lists events on a date timeline with Upcoming (default) and Past tabs and per-tab counts. Days get a sticky header in the viewer's timezone (year shown outside the current year), and cards show the start time with the event-local time when the event is in another offset, the organizer, venue, status badges and the existing actions. Posts keep the flat list.

- d57b8f4: Fix the tenant publish plane: the apps plugin no longer overrides the registry namespace, so tenant config publishes (including DAO-owned tenants via the Trezu flow) now target the global `dev.everything.near` registry that `bos://` resolution and the host's tenant loader actually read. Previously the wizard wrote configs into a project-local FastKV trie that the host could never resolve.

  Tenant discovery moves to the project database: a new public `GET /tenants/apps` route lists active tenants with their primary hostname and attached geographic node, and the landing-page directory is now powered by it (rows link via their stored binding hostname instead of deriving `slug.gateway`). The wizard's publish re-check reuses the shared `buildRegistryConfigUrl` helper, and a pinned test guards the publish contract against future namespace drift.

- d57b8f4: Framework UI files children receive as byte-identical copies move into the `everything-dev` package as ui subpaths — hydrate (client bootstrap), router-client (client router factory), router-server (SSR router module), entry (web entry runner), and router-error (the generic error boundary). Child copies shrink to thin wiring stubs that inject only the app's generated artifacts (`routeTree.gen`, `routeConfig.gen`, `styles.css`) and join the framework-owned sync set. The framework router/hydrate modules import the package's own api/auth/runtime/manifest surfaces; compose payload digest parity is unchanged (the hydrate suite ports to the package and keeps the digest-mismatch fallback coverage). `RouterContextWithApi` gains the optional `authClient` the routers already threaded. Closes #186.
- d57b8f4: Add the node-directory, country-aggregator, and stake-selector UI surfaces.

  - Public landing page is now a directory of root nodes: queries `listRootNodes` instead of `listValidators`, renders node cards (name, kind badge, slug) linking to `<slug>.<gateway>`, with skeleton loading and a "No nodes yet" empty state.
  - New public country page at `/n/$slug` acts as an aggregator: resolves the node by slug, lists direct children (`listChildren`), and renders a stake section that shows the country's own validator CTA or "stake to a city" links to children-with-validators (via `resolveStakingValidators` subtree). Includes "No child nodes yet" empty state.
  - Stake page rewritten around subtree validators: queries `resolveStakingValidators(nodeId)`, renders a selectable validator list with `isDefault` pre-selected, role badges (community styled secondary), protocol badge when not `near`, an inherited-validator banner when `sourceNodeId` differs from the node, and a no-validator state with child-node links. Node is resolved from a `?node=` search param (dev-testable) or the subdomain hostname (production). Stake transaction and onramp flows are unchanged; the broken admin CRUD affordances (throwing "being redesigned") were removed — management UI lands in a follow-up.

- d57b8f4: Organizations get a Homepage tab where a DAO member proposes a new community homepage (title, description, custom UI bundle) with their own session wallet, with the pending proposal's vote progress and a Trezu link shown while it awaits votes. Platform-owned communities publish the change directly.
- d57b8f4: Add authenticated in-app node applications, atomic administrator provisioning for approved node proposals, and typed proposal application dispatch for node and template resources.
- d57b8f4: Demonstrate the proposals and votes plugins end to end: submit new things for review, apply approved submissions to the thing registry, display proposal status and review history, add admin queue details and pending counts, and support optimistic thing upvotes.
- d57b8f4: Member email visibility is now gated behind an `email: ["read"]` permission check. Organization member lists, invitation rows, and member cards only render a member's email to viewers who hold that permission (or the member themselves, or a platform admin); everyone else sees no email instead of the raw address.
- d57b8f4: The hand-rolled JSON-RPC view-function wrapper (`ui/src/lib/near-rpc.ts`) is deleted. The stake-pool query call sites read contracts through near-kit (`Near.view`) instead of raw `fetch` against the public RPC endpoints — base64 arg encoding and byte-array result decoding are the library's job now. Failure parity is preserved: unsupported networks, timeouts, and malformed results resolve null and fall into the same clean query error state. Closes #185.
- d57b8f4: Add the organization-scoped My Node dashboard with node selection, structure and validator statistics, staking resolution, node proposals, and role-aware review actions. Add tenant filtering to `listNodes` so the dashboard resolves only nodes managed by the active organization. Refresh session data after organization switches so the dashboard immediately follows the selected organization.
- d57b8f4: Org node-config: auto-fill the custom UI bundle (URL + integrity) from a deployed app's published config — enter the NEAR account that ran `bos publish --deploy` and fetch, instead of pasting URLs and hashing manually. My Node dashboard surfaces a pending DAO config proposal ("Awaiting votes") with a direct link into the node-config tab for owners and admins.
- d57b8f4: Add geographic node discovery with published profiles, manual events, Luma calendar imports and social updates, activity filters, growth curation and moderation, and anonymous aggregate engagement reporting.
- d57b8f4: Rework the node lifecycle prototype at `/prototype-staking-poc` into a signer-aware clock with twelve ordered stations: apply, approve, publish the tenant, lock the endowment's NEAR, stake the pool from its lockup, stake the team's own NEAR, register the team wallet in veNEAR, assign the endowment's delegation, vote in House of Stake, unstake the pool, take the vote back, and unstake the team's stake. Each station declares its signer, so when the Trezu treasury changes between acts the row prompts you to connect before it can sign; one click runs everything the connected role can sign. DAO-signed actions are routed through the cycle as sputnik-dao proposals. Approving a staged proposal now always goes through the connected Trezu wallet — a mismatched treasury is disconnected and reconnected as the proposal's DAO before the vote is signed — and a station only reads done once none of its proposals still await votes; skipped stations say why. The admin "node applications" cleanup panel is gone.

  Tenant URLs across the dashboard, the public node page, the directory, the registry detail, and the prototype now build through a single dev-aware helper that resolves `<label>.localhost` against the host's binding resolver in development and `https://<label>.<gateway>` in production. The host's binding resolver now maps `<label>.localhost` onto the gateway alias when NODE_ENV is not production, so dev clicks on tenant links land on the right tenant instead of the base runtime. The server-side `buildOpenUrl` in the apps plugin refuses to fabricate a public URL for `*.localhost`/loopback hosts.

- d57b8f4: Add platform-admin node management with filtering, metadata editing, validator controls, and tenant domain bindings. Verify custom-domain ownership using DNS TXT records, scope verification and removal to the binding's tenant, and resolve verified custom hostnames without appending the platform gateway.
- d57b8f4: Generalize the node model beyond geography. The `nodes.kind` column and its `country`/`state`/`city` enum are gone — the kind label now lives in `nodes.metadata.kind` (geo specifics become plain metadata), `parentId` is the only hierarchy axis, and `nodes.tenantId` is nullable so standalone org/user/zone-root nodes can exist without a tenant. New org-scoped `spawnNode` route (`POST /nodes/spawn`) creates nodes of any kind under any parent with no kind-validated parentage or depth limit; `applyNodeProposal` keeps the strict geo ladder as the DAO provisioning path; the validator staking walk and `listTenantApps` are unchanged (already `parent_id`-driven) and now carry nullable, open-ended kind labels. UI kind displays fall back to a generic "Community" label for non-geo kinds, and standalone nodes can only be mutated by platform admins.
- d57b8f4: Show a "Propose homepage change" shortcut on a community's public page for members of the DAO-owned organization behind it.
- d57b8f4: Replace the legacy city-node model with nodes + validators + domain bindings.

  - Public landing directory and authenticated stake page now read from the new validator registry (`listValidators`, `resolveValidatorByAccountId`, `resolveStakingValidators`) instead of the legacy `listLegacyCityNodes` routes. Cards, query keys, and resolver state were renamed accordingly (`CityNodeCard` -> `ValidatorCard`, `selectedCityNode` -> `selectedValidator`).
  - Admin "Tenant / Node / Binding" wizard now collects node hierarchy, validators-per-node, and verified custom-domain bindings in three guided steps before creating the tenant. Empty state and the "Not authorized" affordance now reference the tenant's stable id instead of a subdomain host.
  - Removing the `NetworkToggle` from the auto-injected component barrel (the admin header still imports it directly) so the toggle is not eagerly bundled into every route.

- d57b8f4: Add organization onboarding stations: an owner/admin creates a capped, expiring onboarding code (named after an event) from the org page's new Onboard tab, and displays it as a QR. People scan it with a phone, land on `/onboard`, and join the organization — plus the event's team (find-or-create by event name) — by signing in with a passkey wallet or an existing NEAR wallet. Includes live redemption status (joined list polled every 2s), code revocation, idempotent redemption, and membership-capacity enforcement. Also fixes the stale `development` export condition for `everything-dev/ui/manifest-generator` left by the manifest refactor.
- d57b8f4: Consolidate app shells and align every route on one chrome + width system.

  - All layouts now use the shared layout components: `_layout.tsx` renders the extracted `<BetaBanner/>`; `_public` and `_anon` both render `PublicShell` (logo-left, UserNav-right header + NearBranding footer), with `_anon` passing `showConnect={false}` so the login page hides the connect CTA; `_authenticated` and `_admin` render `AppShell` (`AppSidebar` + `AppHeader` + `MobileTabBar` driven by `NAV_ITEMS`), replacing the monolithic `auth-shell.tsx`, which is deleted. The desktop icon rail gains an `orgs` entry, matching the mobile tab bar.
  - `UserNav` accepts `showConnect` (default `true`) to hide the connect button while keeping theme/network toggles.
  - Login page simplified: no brand element, no anonymous session option, single primary "connect with NEAR" CTA (with "Continue as …" when a wallet is detected), rendered in the same public header as every other public page.
  - Page widths are now consistent per shell: public children `default` (max-w-4xl), authenticated/admin children `wide` (max-w-6xl) — stake, apply, orgs/new, invites, things/new, tenant error state moved up; `admin/tenants/new` no longer double-nests a container inside the admin layout's.
  - `/dashboard` is now a layout route owning the wide `PageContainer` (mirroring `admin.tsx`), with its content moved to `dashboard/index.tsx`. URLs are unchanged.
  - The components barrel exports the full layout family (`AppShell`, `AppHeader`, `AppSidebar`, `MobileTabBar`, `BetaBanner`, `PublicShell`, `UserNav`, `NearBranding`, `NAV_ITEMS`, role helpers).

- d57b8f4: Collapsible sidebar nav groups: `SidebarItem` gains optional `children`, role filtering recurses through them (a group is dropped when no child passes), and `AppSidebar` renders groups as Radix collapsibles that expand for the active path, with chevron toggle and sub-item links. `AppShell` now passes the router `pathname` down instead of an `isActive` callback.

  Add `Popover` and `InfoPopover` primitives (`info`-icon trigger with title, body, and outlinks) exported from `@/components`.

  `dao-connect` hardening: new `verifyDaoAccount` re-syncs the zustand store against the connector before signing (stale Trezu sessions now reset the store and prompt reconnect) and `describeDaoError` maps connector failures to actionable messages; `fetchDaoPolicy` uses `btoa` instead of the Node `Buffer`.

  The tenant detail page guards a missing `domain`: when the active runtime resolves no gateway id it shows a "gateway not configured" card instead of publishing mutations that would fail, and it reads the runtime config from route context rather than the singleton.

- d57b8f4: - Public node page `/n/$slug` now shows live stake stats (total staked, fee, pool accounts, and a ranked sample of up to 50 accounts) per resolved validator, including inherited staking pools.
  - Keep stake links, show loading and unavailable states, and link to network-specific explorers.
  - Resolve child-node overview URLs and keep child navigation within the overview. Parent-scoped links distinguish duplicate city slugs; unscoped lookup preserves root URLs and avoids selecting an arbitrary duplicate child.
  - Preserve the selected node ID when entering staking and returning from sign-in.
- d57b8f4: Rework the node lifecycle prototype at `/prototype-staking-poc` to mirror the real on-chain deployment flow. Twelve stations across five phases — initialize (apply, admin approve + pool assignment, admin funds the team treasury), bootstrap (publish the tenant config, stake 1 NEAR into the team-owned pool, House of Stake setup via veNEAR registration + lockup deploy + lock-all), an optional sponsor phase for the endowment (lock its NEAR, stake the pool from its lockup, delegate all its veNEAR to the team — skipped when team and endowment are one account, never blocking the team's track), the team's House of Stake vote, and a refresh phase that unwinds both sides.

  Ordering is now declarative: each station lists exactly the chain facts it requires, replacing the implicit upstream walk — the bootstrap stations run in any order and a wrong requirement-blocker no longer gets overwritten. Steps carry their attached deposits, so the admin "Fund the team treasury" action computes `max(4 NEAR, remaining requirement + 1 NEAR buffer)` and the page shows the live treasury balance against the derived requirement. The vote deposit is corrected to `vote.dao`'s configured `vote_storage_fee` (0.00125 NEAR) instead of a hard-coded 5 NEAR, sensing proposals (status `Created`) are listed as votable, and a publish proposal that reports failed on trezu is treated as expected — the config-live FastKV check is the source of truth.

  The prototype's inputs move to TanStack Form with per-organization localStorage persistence, so a refresh restores the draft; the staking pool is prefilled from the admin-assigned default staking validator. `applyNodeProposal` now accepts an optional `poolAccountId` and persists it as the node's default staking validator plus node metadata at approval time.

- d57b8f4: Upgrade TanStack Router, Query, Devtools, and Table packages to latest so TanStack Intent agent skills ship in the repo: 11 router skills (router-core, router-plugin) and 30 table skills (react-table, table-core) are now loadable via `bunx @tanstack/intent@latest load`. Migrate the DataTable component and its consumers to react-table v9 (`useTable` with explicit `tableFeatures`, automatic core row model, `table.state`, `getPrePaginatedRowModel`, `getAllCells`).
- d57b8f4: The My Node team-stake card now walks the full unstake → withdraw cycle without breaking the staking pool's non-payable calls: the unstake proposal no longer attaches a deposit (the pool's `unstake`/`withdraw`/`unstake_all` methods reject any attached deposit with `ERR_METHOD_NOT_PAYABLE`), the card shows unstaked NEAR while it is locked in the ~2-day (4 epoch) release window, and once `can_withdraw` is true the same button becomes a withdraw proposal that returns the NEAR to the team treasury. The staking-POC's pool `unstake_all`/`withdraw` steps drop their 1-yocto deposits for the same reason.
- d57b8f4: Complete organization teams and wallet invitations across the auth plugin, API, and dashboard. Team workspaces now carry feature-area context through node mutation authorization, and organization owners can invite either an email address or a NEAR account, target a team, and manage wallet-aware pending invitations. Invitees can accept email or wallet invitations from the dashboard or claim link and land in the targeted workspace.
- d57b8f4: Tenant draft/url helpers move into the framework: `everything-dev/ui/tenant` is the single owner of the tenant origin construction (`buildTenantUrl`, `tenantLabel`, `isLocalHostname`), the node-config draft helpers (schema, diff, bundle entry resolution, sha384 integrity preflight), and the new `gatewayForAccount` — which derives the gateway for an owner account from the runtime config (the runtime's gateway when the account is on the runtime's network, null otherwise) instead of hardcoding per-network domains. The app-owned `ui/src/lib/tenant-url.ts` and `ui/src/lib/tenant-config-draft.ts` copies are deleted; call sites (tenant live site, node config, node directory, app detail runtime, staking poc) import from the package, so children stop receiving the copies via `bos init` and versions flow through the catalog / changeset release. Closes #184.
- d57b8f4: Add the tenant + node + binding creation wizard.

  - Rewrite the admin tenant creation page from a placeholder into a full wizard: inline org creation (if no active org), node details (kind, cascading parent dropdown via `listRootNodes` + `listChildren`, slug, name), tenant + binding form (auto-generated hostname `<slug>.<gateway>` with live `bindingPreflight` validation).
  - On submit: `createTenant` → `createNode` → `createBinding` (blocking, with rollback via `deleteNode` + `deleteTenant` on failure), then non-blocking deploy steps for NEAR subaccount (`auth.near.createSubAccount`) and registry config publish (reuses the `publishTenantConfig` pattern with the binding hostname). Failed deploy steps show "partial success" with retry.
  - Export `StepList` and `useStepper` from `@/components` barrel (previously built but unused).
  - Extend `api/tests/setup.ts` to accept an optional plugins map and a role parameter on `orgContext` (enables `requireOrgRole` middleware in integration tests).
  - Add `api/tests/integration/wizard.test.ts` — 5 tests covering the full creation chain, rollback on duplicate hostname, nested country→state→city hierarchy with bindings, and bindingPreflight availability before/after creation.

- d57b8f4: Tenant pages are addressable by slug, NEAR account id, or internal UUID: `/tenant/<slug>` resolves through the tenant's primary domain binding (falling back to the node slug), `/tenant/<accountId>` through the public account resolver, and `/tenant/<uuid>` keeps working for existing links. Tenant detail pages gain a breadcrumb showing the directory slug, and all tenant links the UI generates (admin tenants list, wizard post-creation) now prefer the slug over the opaque UUID.
- d57b8f4: Add a dedicated anonymous mount and reorganize organization routes.

  - Add a `/_layout/_anon` pathless layout for pre-auth pages. Move login from the public layout into it; the layout redirects authenticated users to `/dashboard` and provides the theme toggle header.
  - Rename the organization route group from `/organizations` to `/orgs` (`/orgs`, `/orgs/new`, `/orgs/$slug`) and move invitation acceptance to `/orgs/invites/$id`.
  - Remove the stale nostr entry from the authenticated sidebar.

- f9d2dce: Invert router control: the app's authored router factory is now load-bearing. The client hydrator accepts `createRouter` and `createQueryClient` (framework factories remain the fallback), and the SSR router module mints each request's router through the same factory — so notFound/pending/error components, scroll behavior, and query timings are app-customizable for the first time, with server/client parity.
- f9d2dce: The core ui's bootstrap stubs are now generated, not authored: the web entry, hydrate bootstrap, SSR router module, compose expose, and globals are emitted as `.gen`-suffixed, gitignored files by the framework's code-artifact generation pass (`bos dev`/`build`/`typecheck`), regenerated from the installed package version. The build surface retargets to the generated paths and core-ui detection no longer requires an entry stub. Sync drops the retired stub files from its ownership list and tolerates templates that no longer ship a file. Per ADR 0023.
- d57b8f4: Reorganize UI routes into mount-point layouts and rename the authenticated workspace.

  - Move admin routes under a new `/_layout/_admin` pathless layout that gates on the admin role and redirects non-admins to `/dashboard`. The tenant admin dashboard (`admin/admin/index.tsx`) and system page (`admin/admin/system.tsx`) now render as children of the admin layout through an `Outlet`.
  - Rename the authenticated `/home` route to `/dashboard`, updating the sidebar, mobile tab bar, user nav, and login redirect fallbacks.
  - Move the apps and things routes under the public layout (`_layout/_public/apps`, `_layout/_public/things`) so they render inside the shared public shell instead of the top-level layout.

- d57b8f4: UI reset & simplification — strip platform cruft, surface the CityNodes product.

  - Landing page reset: hero now asks "What are CityNodes?" with explainer copy; the root-node directory list is kept (cards with Globe icon); account-badge pill and "Get started" CTA removed; new Apply button links to the internal `/apply` route.
  - New `/apply` route that externally redirects to `https://citynode.app/apply` (structured for a per-tenant apply page to replace the redirect later).
  - Apps browser removed: deleted `/apps`, `/$accountId/apps`, and the apps tab from the account profile layout — platform cruft outside the CityNodes flow.
  - Things index refactored into a typed `DataTable<Thing>` demo with `ColumnDef` columns (id, type, created, updated, view action), wired to `apiClient.template.listThings`.
  - Mobile responsive fixes: removed double safe-area padding on `auth-shell` main (the fixed MobileTabBar already handles the inset); added `min-w-0`/`shrink-0` guards to `simple-header` to prevent overflow on narrow viewports.
  - `README.md` rewritten as the CityNodes product explainer (rendered by the about page's README fetcher); `skill.md` rewritten for the simplified CityNodes route structure.

- d57b8f4: The core UI rsbuild config is synthesized when the ui workspace has no local `rsbuild.config.ts` — the every-plugin generated-config model. The ui package's dev/build/preview scripts route through the new `bos-ui` bin (`everything-dev/ui-build`), which honors a local `rsbuild.config.ts` as an override and otherwise generates one from the shared `every-plugin/ui/mf-build` factory (provider role, `CORE_UI_PLUGIN_KEY`, the web/node exposes, public copy, and the `APP_NAME`/`APP_ACCOUNT` defines derived from the resolved runtime config). The config drops from the scaffold: `bos init` no longer copies it and `bos sync` treats an existing child config as app-owned. Closes #187. Also raises the ui lib target to ES2024 (`Promise.withResolvers`).
- d57b8f4: `UnderConstruction` outlinks now resolve from the runtime config context instead of a hardcoded fallback: the widget links to `repository` from the injected config (or the caller-provided `runtimeConfig`) — e.g. `repository` + `/blob/main/<sourceFile>` — and becomes inert (no tooltip link affordance, no navigation) when no repository is configured. Explicit `url` props are unaffected. Removes the silent fallback to the parent platform repository (`nearbuilders/everything-dev`).

### Patch Changes

- d57b8f4: Hydrate and paginate admin lists, batch node summary counts, resolve organization links, add signed-in Things navigation, and restore the Thing event stream.
- d57b8f4: Audit and fix agent information flow for first-load discovery.

  - Rewrote `ui/public/skill.md` with two explicit agent modes: talk to the app via MCP/REST (with API key auth instructions), and clone & modify (with AGENTS.md reference, architecture notes about Module Federation code bundles, and regression test info).
  - Expanded `ui/public/llms.txt` to include API, MCP, auth, and repository source sections.
  - Added `/.well-known/mcp.json` host route for MCP discovery (server name, endpoint, transport, auth scheme).
  - Deleted stale `LLM.txt` (superseded by AGENTS.md).
  - Created `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md` to resolve dangling AGENTS.md references.
  - Added agent communication surface section and `.agents/skills/` workflow skills mention to AGENTS.md.
  - Added `/settings/api-keys` route with API key create/list/delete UI and API Keys tab in settings layout.
  - Exposed auth and plugin router routes as MCP tools (in addition to base API) in `mountMcpRoute`.
  - Updated `buildChildAgentsInstructions` in init.ts with MCP/API-key sections and "remotes are code bundles" note.
  - Added child `llms.txt` and `skill.md` template generation in init.ts `personalizeConfig`.
  - Added MCP endpoint regression test (`mcp_test.go`), agent surface content tests (`agent_surface_test.go`), and browser test for settings API keys page.

- d57b8f4: `bos login` — sign in with your NEAR account through the hosted site via the OAuth 2.0 Device Flow (RFC 8628), the same flow the site's QR pairing uses: the CLI requests a device code, you approve at `/login/device` in any browser (same machine or not — it works over SSH and headless), and the CLI mints its credential from the approved session. `--key` exports a scoped FastKV publish key to `~/.near-credentials`; the gasless delegate key is approved in the browser on the same page (wallet signs the `addKey`). `bos logout` revokes the credential. `bos publish --wallet` publishes gaslessly via a NEP-366 delegate action through the platform relayer. New `publish.auth` config surface (`session` | `key` | `custody`). The auth server's device-authorization plugin now serves the flow at `/login/device` (moved from `/device` — nothing had shipped against the old path) and accepts any non-empty `client_id` (public-client device flow — user approval is the trust boundary; the code↔client binding is still enforced at the token endpoint). The site's `/login` now preserves full redirect targets including query strings.
- d57b8f4: Build output hardening for the platform deploy path.

  - Show all stdout during deploy builds (not just chunks matching a provider regex). Chunks can split across boundaries so a filtered URL never matched — deploy builds now pass all stdout through unconditionally.
  - Extract build-result classification as a pure function from the build attempt, making the exit-code classification testable without spawning processes.
  - Fix variable shadowing where inner `const result` shadowed the outer `await run(...)` binding.
  - Remove the unnecessary per-workspace env copy.

- d57b8f4: Add a public /build page with the NEAR AI Cloud and NEAR Intents copy-paste prompts, and link it from the sidebar.

  - New `/build` route in the core UI (`_public`) with a "Ready to start building?" header and copy-to-clipboard prompt cards (NEAR AI Cloud private inference, NEAR Intents 1Click).
  - Sidebar gains a "Build" item in the main section, visible to signed-out visitors too.
  - Onboarding completion screen now points to `/build` with a CTA instead of inlining the prompts; prompt test ids moved from `onboard.prompt-*` to `build.prompt-*`.

- d57b8f4: Sharpen the /build prompts: frame TanStack AI as an optional recommendation with its URL in the NEAR AI Cloud prompt, drop the irrelevant TanStack AI note from the NEAR Intents prompt, and add setup context for each — cloud.near.ai (register, claim credits, API key), cloud.near.ai/models, docs.near.ai for NEAR AI Cloud; partners.near-intents.org, docs.near-intents.org and the 1Click OpenAPI spec for Intents — plus a note to check the open skill-sync PRs on near/agent-skills when the published skill lags upstream. Each prompt card also gains a direct subtext link row to its portals/docs (cloud.near.ai, cloud.near.ai/models, docs.near.ai; docs.near-intents.org).
- d57b8f4: Update `buildSignedDelegateAction` callbacks in the citynode UI to the two-argument `(builder, receiverId)` form required by `better-near-auth` 1.10.x and the documented `near-connect` skill, and pass `receiverId` into `functionCall` in place of the previously hard-coded `prepared.data.contractId`. This matches the new callback signature in both signature shape and behaviour since `buildSignedDelegateAction` forwards its receiverId to the builder callback.

  Make `init.full.test.ts` permissive about custom UI/API implementations: it now scaffolds `["template"]` only (no proposals, votes, apps), writes a permissive gen-file stub after `types:gen` runs, and only typechecks `api` and `plugins/_template`. The full UI scaffold typecheck moved out of the regression because `ContractRouterClient<T>` reproduces its conditional shape for any stubbed `T`, and pinning the typecheck against citynode-specific plugin-namespace calls would couple the regression to a specific configuration.

  Restore the missing `checkCdnProviderDeployable` export from `packages/everything-dev/src/build.ts` so the framework tarball build (a prerequisite of the test) no longer fails on the pre-existing broken `publish.ts → build` re-export.

- d57b8f4: Direct `auth.apiKey.create` calls (the CLI device-link handoff page and the personal Settings → API Keys form) no longer pass a `configId`, but the auth server's apiKey plugin registers only named configurations (`user-keys`, `org-keys`) — with no default config, Better Auth's `resolveConfiguration` rejected the request with `NO_DEFAULT_API_KEY_CONFIGURATION_FOUND`. Both call sites now pass `configId: "user-keys"`, unblocking `bos login` and personal API key creation.
- d57b8f4: Pass the page CSP nonce to the DAO (Trezu) `NearConnector` in `ui/src/lib/dao-connect.ts`. Under strict CSP (`script-src 'nonce-…' 'strict-dynamic'`), the sandboxed wallet iframe's inline `srcdoc` scripts were blocked on `/apply` and the tenant wizard because the singleton DAO connector was created without `cspNonce` — unlike the SIWN login connector, which already receives it via `createAuthClient`. The nonce now flows from `window.__CSP_NONCE__` (via `getCspNonce()` from `@/app`) into `NearConnectorOptions.cspNonce`, matching `@hot-labs/near-connect`'s supported propagation path. No behavior change in relaxed-CSP environments (nonce is `undefined`).
- d57b8f4: Lock the Trezu DAO connection to the trezu-wallet only and bind its session to the signed-in SIWN identity: the connect flow now always targets the Trezu wallet explicitly (the near-connect selector popup — where injected wallets like HOT could appear — never opens), wallet metadata comes from the official near-connect registry so executor updates no longer require a redeploy, and the Trezu session is torn down when the auth account changes or signs out instead of silently persisting the previous login's account.
- d57b8f4: Rebuild the dashboard shell on shadcn's `Sidebar` primitive and fix the double-header layout bug introduced by the earlier auth-guard/dashboard-layout route split.

  - Replaced hand-rolled `AppShell`/`AppSidebar`/`AppHeader`/`MobileTabBar` with shadcn's `Sidebar`/`SidebarProvider`/`SidebarInset` composition (Radix flavor, adapted to this project's React 19 function-component + `data-slot` conventions). Sidebar defaults expanded with icon+label, collapsible to icon-only via trigger or `cmd+b`.
  - Mobile navigation is now the sidebar's built-in off-canvas sheet, replacing the persistent bottom tab bar.
  - Split `OrgSwitcher`/`UserNav` into shell-appropriate variants: compact avatar dropdown for non-sidebar shells (`OrgSwitcher`, `UserNav`), full `SidebarHeader`/`SidebarFooter` row versions for the dashboard (`SidebarOrgSwitcher`, `SidebarUserNav`) — both share session/org/profile/sign-out logic via a new `useIdentity` hook.
  - Reverted an interim "global header" experiment that caused a double-header render on dashboard routes (sidebar not spanning full height, breadcrumb bar visually disconnected from the identity nav above it). `UserNav` moved back into `PublicShell`'s own header for non-sidebar routes (`/`, `/things/*`, `/login`, `/things/new`).
  - Added `Breadcrumb` (shadcn primitive) to `AppHeader`, replacing plain `account / path` text with proper `BreadcrumbLink`/`BreadcrumbPage` semantics.
  - Rebuilt `NetworkToggle` on shadcn's `ToggleGroup`/`ToggleGroupItem` instead of raw template-literal ternary classes; moved from `components/ui/` to `components/layout/` (app-specific, not a generic primitive).
  - Added `ui/toggle.tsx`, `ui/toggle-group.tsx`, `ui/breadcrumb.tsx`, `ui/sidebar.tsx` shadcn primitives.

  No URL changes. The auth-guard vs. dashboard-layout route separation from the prior change (`_authenticated`/`_admin` as pure guards, `_dashboard` pathless layout for chrome) is unaffected — this only changes what renders inside it.

- d57b8f4: Rename the discovery studio page to /discover, remove the beta database banner, and keep the explorer map mounted while searching so it no longer flashes on each keystroke.
- d57b8f4: Parse NEAR transfer amounts exactly and reject invalid amounts, incompatible validator protocols, and wallet network mismatches before staking.
- d57b8f4: The `?? "citynode.app"` gateway default is gone from all seven route sites (`_public/index`, `_public/n/$slug`, `_public/stake`, `apply`, the staking POC lifecycle, proposal review, tenant wizard). Every gateway now derives from the runtime config via the new `getGatewayId()` accessor (`@/app`), which returns null when the config is missing or mis-shapen — routes then render an explicit error state, disable dependent queries, or fail the mutation with a clear message, instead of silently impersonating the platform gateway. Node directories link through a node's own hostname when present, and the tenant wizard's "Extends" row shows the configured gateway rather than a hardcoded one.
- d57b8f4: Post-sign-in redirect loop fix ("Too many redirects" after a successful login). The login page navigated to the redirect target before the refreshed session landed in the query cache, and the authed route guards read that cache via `ensureQueryData`, which returns a stale value immediately — so the guard bounced the just-signed-in user back to `/login`, the login route bounced them forward again, and the two guards ping-ponged past TanStack Router's 20-redirect limit into a root-boundary "Application error". Three fixes:

  - The login page (and the device-pairing claim path) now refresh the session cache **authoritatively** — `getSession({ query: { disableCookieCache: true } })`, since the Better Auth session cookie cache can still serve the pre-sign-in signed-out snapshot for up to 5 minutes — and seed the `["session"]` query before navigating.
  - Route guards (`requireSession`/`requireAdmin`, `_authenticated`, `_admin`) read the session via `queryClient.query()`, which **awaits** the refetch when the cached value is stale instead of trusting it.
  - Banned users no longer ping-pong: the login route skips its authed-visitor redirect for banned sessions, breaking the `/login#banned` ↔ `/dashboard` cycle.

  Covered by router-level regression tests (plugins/auth/ui `login.test.tsx`, ui `auth-guards.test.ts`) and a browser regression in `tests/regression/browser/specs/auth-redirect.spec.ts`.

- d57b8f4: Add UnderConstruction link to the DNS verification section of admin node domain bindings, pointing to the NEAR DNS discussion.
- d57b8f4: Route My Node empty states to organization creation, node creation, or node proposals based on the missing resource and viewer role.
- d57b8f4: Fix stuck scrolling on focused auth/onboard pages: the public shell clips the content region (`overflow-hidden` + `min-h-0`), and AuthPanel owns scrolling (`overflow-y-auto` + `my-auto` centering) so short viewports and open keyboards can reach every step without a second document scrollbar.
- d57b8f4: Onboarding capacity and post-onboarding build prompts: new onboarding codes default to 300 joins instead of 50 (the "Max joins" placeholder matches), and the link-onboarding success panel now offers two copy-prompt cards — "Integrate NEAR AI Private Inference" and "Integrate NEAR Intents" — each copying a ready-made prompt that installs the matching skill from near/agent-skills, grills the member about what they want to build, and routes existing/new-application guidance (confidential-model swap or TanStack AI / 1Click API).
- d57b8f4: Convert the new organization form to TanStack Form with per-field validation, auto-generated slugs that yield to manual edits, and inline errors via the new FieldError/FieldDescription barrel exports.
- d57b8f4: Require platform-admin approval for self-service organizations, expose pending and rejected request status, and prevent unapproved organizations from being activated or linked to tenants. Personal signup organizations remain active.

  Block direct member additions before approval and preserve shared organizations when the original requester's account is removed.

  Enforce organization approval through shared authorization middleware and infer organization status in the UI from the auth API contract.

- d57b8f4: Pin the node lifecycle prototype to the organization: the node slug is now the active organization's slug (read-only), the team wallet is the DAO linked to the organization via the new inline connect-and-link flow (`linkDao`), and form state resets when the organization changes. Conflict preflights against `resolveTenant` (by DAO) and `resolveTenantByOrgId` turn the previous mid-run 409s into upfront blockers, and an org that already owns its node resumes instead of failing. A Refresh phase can unwind the endowment's stake and delegation (unstake, withdraw, release pool, clear delegations), admins get a cleanup panel that rejects superseded node applications (the proposals plugin now allows rejecting approved proposals that were never applied, and the prototype records apply failures via `markApplyFailed`), the misleading "add members on trezu" hint only renders on DAO-membership blockers, and organization creation gains live slug availability checking with a shared `suggestAvailableSlug` numeric-suffix helper. The apply/provision paths drop the platform audit-seat enforcement and the DAO-membership rejection now names the missing member and links to the DAO's Trezu members page.
- d57b8f4: Require the connected wallet account and network to match the platform tenant owner before publishing configuration.
- d57b8f4: Proposal privacy hardening: non-admin readers no longer receive `createdBy` identities or `payload` contents from `getProposals` (both replaced with `[hidden]`/`null`), `getAuditLog` now requires a platform admin, and new audit-log rows stop falling back to the actor's email as the label. The node proposal detail page renders the payload's motivation field instead of dumping the raw payload JSON. A data migration scrubs existing email-shaped labels from `proposal_audit_log.actor_label`.
- d57b8f4: Clean up ui/public placeholder icons and stale docs.

  - Renamed `near.svg` → `icon.svg` and `logo.png` → `icon-512.png` (placeholder dot icons, named for replacement); updated `site.webmanifest` icon srcs.
  - Removed dead public files: `README.md` (about route fetches from GitHub raw, not public), `near_rev.svg` (unreferenced), `bos.png` (orphan).
  - Rewrote `llms.txt` to follow the standard llms.txt format (H1, blockquote summary, single Skill link).
  - Removed `/README.md` from `skill.md` public entry points and raw doc endpoints.
  - Updated host integration test `/near.svg` → `/icon.svg`.

- d57b8f4: Keep proposal, profile, tenant, Thing, and stake views fresh after mutations; preserve the current session when revoking other sessions; and clean up live subscriptions safely. Split complex dashboard, admin, and settings components while preserving workflow state, and improve shared loading, error, accessibility, and bootstrap behavior.

  Sync the shared document and router fallback components into existing child projects alongside the framework router updates.

- d57b8f4: Add `MotionConfig reducedMotion="user"` (a11y), fix a `rules-of-hooks` footgun in `useRelayerInfoQuery`, lift 5 dead-state handlers to module scope, and replace 4 `transition-all` Tailwind classes (header, theme toggle, admin banner) with named properties. Clears the 2 ERROR-severity and 9 of the most-cited WARN findings in the `ui` react-doctor report (83 → 72, both ERROR rules to 0).
- d57b8f4: Fix the "Buy with Ping" button (and wallet badge) staying disabled after signing in with a NEAR wallet. The SIWN near account is now read reactively via a new `useNearAccount` hook that subscribes to the auth client's `nearState` atom instead of reading `getAccountId()` once at render, so pages re-render when the wallet/session restore completes after mount.
- d57b8f4: Remove the statistics card row from the My Node dashboard.
- d57b8f4: Remove header branding from public and anon layouts — the public header now shows only the user nav. Point the Built on NEAR footer badge to nearbuilders.org. Rename the unused BrandElement component to Logo (city icon) for future reuse.
- d57b8f4: Clear authenticated query state on sign-out and consume bootstrap session data only once so stale sessions cannot reappear.
- d57b8f4: Fix the recurring post-sign-in redirect loop structurally: the session read path and auth redirect policy now have one owner (`everything-dev/ui/auth`), shared across the core ui and plugin ui remotes as a strict Module Federation singleton. A mixed deploy can no longer run two divergent session-read copies whose guard decisions disagree into "Too many redirects" — the login guard and the authenticated guard read through exactly one module, and a version mismatch fails loudly at load instead of silently loading a second copy. Child projects receive the consolidated guards via `bos sync` (`ui/src/lib/auth-guards.ts`, `ui/src/lib/plugin-path.ts`, and the plugin's drifted `session-cache.ts` copy exit sync ownership). See ADR 0018.

  Also kills the silent dist-staleness class for build tooling: the bundler-configuration factories (`every-plugin/ui/mf-build`, `every-plugin/build/rspack`) resolve from source under bun (the workspace runtime) while node/npm consumers resolve the immutable published dist, and the `everything-dev/ui/mf-build` re-export shim is deleted (`ui/rsbuild.config.ts` imports `every-plugin/ui/mf-build` directly, like the generated plugin configs already do). Shipped code still resolves dist, with `bos build`/`bos deploy` unconditionally staleness-checking the framework prerequisites before any target — the train is the only supported build path.

- d57b8f4: Fix dashboard sidebar width not applying under Tailwind v4.

  `ui/components/ui/sidebar.tsx` and the `SidebarOrgSwitcher`/`SidebarUserNav` dropdown menus used Tailwind v3's arbitrary-value bracket syntax for referencing CSS custom properties (e.g. `w-[--sidebar-width]`, `w-[--radix-dropdown-menu-trigger-width]`). Tailwind v4 replaced that syntax with the arbitrary-property shorthand `w-(--sidebar-width)` — the bracket form is no longer recognized as a variable reference, so the sidebar and its dropdown menus silently fell back to no explicit width. Updated all affected classes (including the `calc()` variants using `theme(spacing.4)`, itself removed in v4, now `--spacing(4)`) to v4 syntax.

- d57b8f4: Resolve the signed-in NEAR account through better-near-auth (`useNearAccountId`) so the apply prerequisites and Settings → Auth Methods pages reflect the SIWN login instead of showing "not linked".
- d57b8f4: Fix React 19 hydration mismatch on every server-rendered page.

  - The root route rendered a server-only inline `<script>` (`window.__EVERYTHING_DEV_SSR__=true`, gated on `typeof window === "undefined"`) into `<head>`. During hydration the client rendered the head without it, misaligning the head script children and producing a full-tree hydration failure on all SSR pages.
  - The SSR marker is now a `data-everything-ssr` attribute on `<html>`, rendered only during SSR. `<html>` already carries `suppressHydrationWarning`, so the attribute-only difference is tolerated without any child-tree mismatch.
  - `isServerRendered()` in the client bootstrap reads the marker attribute (keeping the `window.__EVERYTHING_DEV_SSR__` and `$_TSR` fallbacks for backcompat).

- d57b8f4: Scope the stake directory to the signed-in user's active organization or connected organization memberships, while preserving the full public directory for anonymous visitors.
- d57b8f4: Bind wallet invitations to their NEAR network, guard invitation status transitions, and align wallet membership limits with email invitations. Refresh workspace state after team changes and invitation acceptance, and defer membership loading until the Teams tab is opened.

  Existing wallet invitations without a network must be reissued; email invitations are unaffected.

- d57b8f4: Make tenant publish state observable end to end on the node lifecycle prototype: the publish station's open-tenant link is now gated on the config actually being live in FastKV (a `config live` badge appears with it, otherwise a "config not published yet" hint links to the DAO's Trezu proposals), a successful publish toasts the tenant URL, and the awaiting-votes log line records the DAO's latest proposal id. The sidebar Tenant card renders as soon as an application exists and reports the three creation layers explicitly — DB record (name + status), domain binding (hostname with primary/verified badges), and published config (live / awaiting votes #N / not published, with a view-on-FastKV link) — with the hostname link and open button only enabled once the config is live. Stuck `approved/applying` node applications in the admin cleanup panel gain a "mark applied" action that first verifies that row's DAO has a published config, and when the config is live but the session is not an admin the publish station surfaces the mark-applied requirement as a blocked reason instead of deferring silently. Tenant visits identify themselves through the landing page's document title, which now uses the active runtime's title (the tenant's node name) — a rendered tenant page means its config is live, a 404 means it is not.
- d57b8f4: Fix tenant UI bundle integrity verification: the node-config verify/fill helper now hashes the module entry (`<base>/remoteEntry.js`, matching the deploy pipeline and host) instead of the bundle base URL, which serves an HTML landing page and always mismatched. Adds SSR bundle verification (`<base>/remoteEntry.server.js`), an SSR verify/fill button, publish preflight for the SSR pair, and normalizes pasted entry URLs back to base URLs before publishing.
- d57b8f4: Make tenant deployment follow the active NEAR network and configured subaccount parent, use the connected wallet's public key for subaccount creation, and pass the testnet parent key into the auth runtime.
- d57b8f4: Make the organization's linked DAO the team wallet with the Trezu connection as the linking path: the prototype resolves the team from the org-linked DAO, then the application payload, then an account captured through a "connect team DAO" button that reuses the already-verified Trezu connection (no reconnect, no link prompt — linking happens silently and best-effort). Unset team and endowment inputs are replaced in place by connect buttons so the card stops shifting, the node name defaults to the title-cased organization name, and blockers read "connect your team DAO with Trezu". The auth plugin's `requireAuth` now prefers the host-injected session user and only falls back to resolving the session internally, fixing spurious "Authentication required" errors on `getDao`/`linkDao` and the rest of the `apiClient.auth.*` surface.
- f9d2dce: Trim the core ui's declared MF surface to consumed exposes (drop `./providers` and `./hooks`), construct the core-only tree on the client when a deployment carries no compose payload or a malformed one (plugin-free CSR apps no longer crash on "no route tree"), and correct ownership headers. The ui globals ambient file is trimmed to the rsbuild types reference.
- d57b8f4: Keep User Nav in the top-right of both the public and app shells. Dashboard and admin chrome now mount the same header account menu instead of a sidebar footer row, matching public pages and trezu.app.
- d57b8f4: Atomic deploys tickets 09-10: the MF integrity fetch hook now treats an SRI mismatch like an origin failure — last-known-good bytes from the bundle cache serve instead (with `x-bundle-cache: stale`) and corrupted origin bytes are never written into the cache; the host process installs the outbound bundle-fetch tier (staged own-namespace reads + stale-if-error). The host serves `GET /.well-known/version` with the deploy fingerprint, which rides the client config; a soft-refresh banner (`version-refresh-banner`) polls it for signed-in sessions and offers a reload when a newer deploy is served.
- d57b8f4: Version observability (atomic-deploys 12): `GET /.well-known/version` now returns the per-slot manifest pins from the adopted pointer and the watch fiber's last-tick outcome beside the fingerprint; `pointerFingerprint`/`slotPins` are shared so CLI and host compute the same identity. Every publish writes the per-deploy manifest key (audit trail, previously wallet-only), prints the fingerprint + pins, and returns them. `bos deploy --status` lists recent publishes newest-first from the manifests key family; `bos status` reports the deployed-vs-served fingerprint delta — the split-brain detector. The admin dashboard gains a version card (`admin-version-card`) reading the version endpoint, and `/llms.txt` + `/skill.md` document the surface for agents.
- Updated dependencies [d57b8f4]
- Updated dependencies [c520871]
- Updated dependencies [4d8efd1]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f5f1a5f]
- Updated dependencies [d57b8f4]
  - better-near-auth@2.0.0-rc.0

## 1.9.1

### Patch Changes

- f5fb888: Fix login redirect loop after successful sign-in by invalidating the session query before navigating. Use the typed `detectNearAccount` (removes `as any`) and `getNearClient()` for direct wallet transactions.

## 1.9.0

### Minor Changes

- ada1cd2: Add a tenant creation flow and make primary screens tenant-aware, alongside new reusable UI primitives.

  - Add a new `/_layout/_authenticated/tenant/new` route with a multi-step `Stepper` flow for creating a tenant; create redirects to the new tenant detail page
  - Add a `/_layout/_authenticated/tenant/$tenantId` detail page with inline name/subdomain editing, status badge, suspend/reactivate/delete actions (which republish the tenant config with the matching status), a standalone "republish config" retry button, and links to the org and live site
  - Run a tenant preflight check on the creation form (reserved/taken subdomain warnings, disabled submit until available)
  - Make the home page, layout, settings, and organizations screens tenant-aware; replace the `wikiAccountId` org-metadata coupling with `resolveTenantByOrgId`
  - Add reusable UI primitives: `field`, `info-row`, `network-toggle`, `spinner`, `stepper`, `textarea`, `app-detail-content`, and `json-highlight`
  - Polish existing primitives (`button`, `checkbox`, `label`, `radio-group`, `separator`, `sonner`, `brand-element`, `theme-toggle`)

### Patch Changes

- ada1cd2: Route the things UI through the namespaced `template` plugin client and enforce auth on thing writes.

  - Things routes in the UI now call `apiClient.template.createThing`, `apiClient.template.getThing`, `apiClient.template.deleteThing`, and `apiClient.template.listThings` instead of the removed top-level `api` client methods; `live.tsx` no longer needs a cast to reach the template client
  - The parent API now proxies thing routes to the template plugin through the in-process `templateClient`, keeping `createThing`/`deleteThing` auth-protected at the API boundary with `requireAuth` while `getThing`/`listThings` remain public
  - The template plugin's `createThing` and `deleteThing` handlers no longer enforce auth themselves (auth is enforced by the parent API), so direct plugin-to-plugin calls don't depend on per-call auth context

- ada1cd2: Reorder the tenant creation pipeline to create the Better-Auth organization _before_ the irreversible NEAR subaccount, and roll back the org if subaccount creation or tenant registration fails. Add `parentHasFullAccess` and `minDeposit` subaccount config to the SIWN auth runtime variables.

  Make the FastKV config + metadata publish relayer-aware: use delegate action + relay when the relayer is configured, fall back to a direct transaction signed by the user's wallet as the new subaccount when the relayer is unavailable.

- ada1cd2: Scope tenant routes to the active organization via the `requireOrganization` auth middleware.

  - `listTenants` and `createTenant` now require an active organization (401/403 when unauthenticated or no active org selected)
  - `createTenant` derives the tenant's `orgId` from `context.organization.activeOrganizationId` instead of trusting a client-supplied `orgId`, which was removed from the contract input
  - Reorder the tenant creation UI flow so the new organization is set active before the tenant is registered, and roll back the org if activating it fails

## 1.8.4

### Patch Changes

- d03dd58: Inline `<script>` JSON is now escaped (`</script>`, U+2028, U+2029) to prevent XSS and script-breakage; the CSP nonce is serialized null-safe. Hydration failures now clear `__EVERYTHING_DEV_HYDRATE_PROMISE__` so a retry can succeed instead of permanently returning a rejected promise. An explicit `__EVERYTHING_DEV_SSR__` flag is injected during server render for reliable SSR detection. The `.env.example` template is expanded with all secret placeholders grouped by app section.

## 1.8.3

### Patch Changes

- b7f97e5: Fix React error #418 (hydration mismatch on the navigation progress bar) by wrapping the progress bar in `ClientOnly`. During SSR, `router.state.status` is `"pending"` (set by `router.beforeLoad()` during `router.load()` and never reset to `"idle"`), causing `isNavigating = true` and rendering the progress bar. On the client, the router is created fresh with `status: "idle"` and the `hydrate()` function only sets matches from dehydrated data without resetting status, so the progress bar is not rendered during hydration. This structural mismatch caused React to throw a hydration error. `ClientOnly` suppresses the progress bar during both SSR and initial hydration so they match, while still allowing it to appear during client-side navigation.

## 1.8.2

### Patch Changes

- 9a0220e: Fix React error #310 ("Rendered more hooks than during the previous render") on first render by adding `defaultErrorComponent`, `defaultNotFoundComponent`, and `defaultPendingComponent` to the client router factory (`router.tsx`). The SSR router (`router.server.tsx`) already set these, but the client router did not, causing TanStack Router's `Match` component to resolve `ResolvedSuspenseBoundary` to `React.Suspense` on the server and `SafeFragment` on the client. This component-type mismatch at the same tree position during hydration forced React into a recovery path that triggered the hooks error.

## 1.8.1

### Patch Changes

- 58272ad: Fix metadata files being blocked by narrowed static asset regex; standardize public file structure; renderClientShell delegates head data to UI's getRouteHead.

  - `host/src/program.ts`: Added `md` and `webmanifest` to `staticAssetPattern` (fixes regression from DDoS narrowing that blocked `.md` and `.webmanifest` from being proxied as static assets). DRY'd inline regex copy to use the named constant.
  - `host/src/program.ts`: Refactored `renderClientShell` to accept `HeadData` from the MF-loaded UI router module via `getRouteHead`. Host no longer hardcodes metadata (favicon, manifest, OG tags) — the UI's `__root.tsx` `head()` is the single source of truth. Minimal fallback shell (charset, viewport, title, boot scripts) when module is unavailable.
  - `packages/everything-dev/src/ui/router.ts`: Added `serializeHeadData` helper to convert structured `HeadData` (meta/links/scripts) to HTML strings for the raw shell.
  - `ui/public/`: Standardized on 15-file public structure. Renamed icon.svg→near.svg, icon_rev.svg→near_rev.svg, android-chrome-192x192.png→web-app-manifest-192x192.png, android-chrome-512x512.png→web-app-manifest-512x512.png. Generated favicon-96x96.png, logo.png. Removed legacy files (favicon-16x16.png, favicon-32x32.png, logo192.png, logo512.png, logo_rev.svg, logo.svg, manifest.json). Replaced manifest.json with site.webmanifest as single PWA manifest.
  - `ui/src/routes/__root.tsx`: Updated icon and manifest references to match new filenames.
  - `ui/public/site.webmanifest`: Merged richer icon set and fields from old manifest.json.

## 1.8.0

### Minor Changes

- 86eaf89: Replace theme toggle colored circle with Sun/Moon icons from lucide-react
- 1368467: Remove auto-generated plugin-sidebar system in favor of manual sidebar items in `_layout.tsx`

  Deleted the entire `sidebar.ts` code generator, `SidebarItem`/`SidebarRole` types, all
  `sidebar` fields from config/resolution schemas, the `plugin-sidebar.gen.ts` generated file,
  and all sidebar migration/passthrough logic in the CLI, host runtime, and tenant runtime.
  Sidebar items are now defined inline in `ui/src/routes/_layout.tsx`.

### Patch Changes

- 86eaf89: Fix CSS chunk filename collision by overriding `CssExtractRspackPlugin.chunkFilename` to `static/css/async/[name].[contenthash].css`

  Async CSS chunks (e.g., from lazy-loaded `@uiw/react-md-editor`) were all emitting
  to the same path `static/css/async/style.css`. The plugin override gives each async
  chunk a unique, content-hashed filename while keeping the entry CSS at `style.css`.

## 1.7.0

### Minor Changes

- 4772e1f: Simplify API to a thin orchestration layer: replaces the upvotes table with a `things` registry (`thingId`, `pluginId`, `createdAt`, `updatedAt`), adds Effect service layers (Registry, Votes), and introduces plugin dispatch via `getThingProvider()` so the API delegates to plugins by `pluginId`. Adds `createThing`, `getThing`, `deleteThing` (admin-only), `subscribeThings` endpoints with SSE filtering by `pluginId`/`type`/`action`. Adds `deleteThing` to `_template` plugin contract/service/handler. Extracts `ApiContextSchema`, `pluginContext`, `runEffect` into `lib/context.ts`. Renames service files `thing-registry`→`registry`, `thing-votes`→`votes` with matching symbol renames. Removes obsolete `lib/plugins.ts`. Adds frontend thing registry routes under `/things/` (index, create, detail with vote controls, admin delete, live SSE stream). Improves DB Layer with idempotent migrator. Updates api-and-auth and plugin-development skill docs.

### Patch Changes

- 7cb0733: Remove `settings` and `projects` plugins, UI routes, and related component. Replace plugin IDs in tests with `example`.
- 7cb0733: `createApiClient` now accepts optional `headers` parameter for SSR cookie forwarding, allowing child projects to forward request cookies during server-side rendering. Also silences SSR-side console errors in the oRPC error interceptor and fixes the `sonner` shadcn import path in `__root.tsx`.

## 1.6.7

### Patch Changes

- caf22b7: Stop overwriting CONTRIBUTING.md during `bos sync`/`bos upgrade`

  Remove `CONTRIBUTING.md` from `FRAMEWORK_OWNED_SYNC_FILES` so user-customized
  contributing guides survive sync and upgrade operations. It is still scaffolded
  for new projects via `bos init`.

  Also add a `DO NOT MODIFY` warning to `ui/src/app.ts` with guidance that imports
  within the file must use relative paths (`./lib/...`), never `@/app`.

## 1.6.6

### Patch Changes

- 4bffb87: Update the UI auth client to a single options object that carries `runtimeConfig`, `headers`, and `cspNonce`, remove the deprecated `auth-utils` helper module during upgrades, and drop the direct `@hot-labs/near-connect` dependency from the UI package.

## 1.6.5

### Patch Changes

- d51b221: Update the UI auth client to a single options object that carries `runtimeConfig`, `headers`, and `cspNonce`, remove the deprecated `auth-utils` helper module during upgrades, and drop the direct `@hot-labs/near-connect` dependency from the UI package.

## 1.6.4

### Patch Changes

- 36b6cd7: Tighten CSP nonce handling across SSR, hydration, and fallback shells, and fix the BOS viewer bootstrap path.
- 36b6cd7: Restore public plugin RPC routing for the browser API contract and keep SSR/client hydration aligned under strict CSP.

## 1.6.3

### Patch Changes

- 3af34db: Version asset URLs to prevent stale-cache chunk failures

  Client boot assets (`remoteEntry.js`, `style.css`, plugin UI remote entries) now include a `?v=<integrity>` query parameter matching the SSR pattern. This ensures browsers and CDNs serve the correct asset set after each deploy, eliminating `ChunkLoadError` caused by cached `remoteEntry.js` referencing async chunks that no longer exist on the upstream deployment.

  Also fixes the `_viewer` regex from invalid `/^/+/` to `/^\/+/`.

## 1.6.2

### Patch Changes

- 684bcab: Fix production CSP, viewer, and sign-out bugs

  - **CSP nonce**: pass `cspNonce` to `ThemeProvider` so the `next-themes` inline bootstrap script satisfies `script-src 'nonce-...'`. Without this, the browser blocks the script, causing a React hydration mismatch (#418) and cascading failures.
  - **Viewer regex**: fix invalid regex `/^/+/` in `_viewer` HTML template to `/^\/+/` so `widgetPath` leading slashes are correctly stripped instead of causing a SyntaxError.
  - **Sign-out navigation**: add `router.invalidate()` before `navigate()` in both `UserNav` and `SecuritySettings` sign-out handlers. Without this, TanStack Router's `beforeLoad` auth guards read stale session state and redirect back to the login page instead of the home page.

## 1.6.1

### Patch Changes

- 8ef8f56: Replace UI asset 302 redirects with reverse proxy to fix Cloudflare 403 errors

  The host now proxies all UI public assets (images, CSS, JS, fonts, favicons) through the host origin instead of 302-redirecting browsers to the Zephyr CDN. This eliminates cross-origin requests that Cloudflare blocks with 403 errors.

  **Breaking changes:**

  - `RenderOptions.assetsUrl` removed from `everything-dev/ui/types` — assets are now served from the host origin via root-relative paths
  - `RouterContext.assetsUrl` removed from `everything-dev/ui/types` — no longer needed since assets resolve through the host proxy
  - `getRemoteEntryScript()` removed from `everything-dev/ui/head` — use `getRemoteScripts()` which now returns `{ src: "/remoteEntry.js" }`
  - `RemoteScriptsOptions.assetsUrl` removed — `getRemoteScripts()` no longer needs an assets URL
  - `UnderConstruction` component: `assetsUrl` prop removed — images use rspack module imports directly
  - `ClientRuntimeConfig.assetsUrl` now set to the host origin (`requestUrl.origin`) instead of the CDN URL — existing consumers should note this value change

  **What changed:**

  - Host: `isUiPublicAssetPath()` deleted, logic inlined; `redirectUiAssetRequest()` replaced with `proxyUiAssetRequest()` using `proxyRequest()`
  - Host: `renderClientShell()` uses root-relative paths (`/favicon.ico`, `/remoteEntry.js`) instead of CDN URLs
  - Host: Plugin UI `<script>` tags use `/__mf/plugin-ui/${key}/remoteEntry.js` proxy paths
  - Host: `buildRuntimeClientConfig` sets `assetsUrl` to `requestUrl.origin`
  - UI: All `${assetsUrl}/path` references replaced with `/path` root-relative paths
  - UI: `new URL(importedAsset, assetsUrl)` pattern removed — rspack module imports used directly
  - UI: `/skill.md` fetched via root-relative path, no `assetsUrl` construction needed

## 1.6.0

### Minor Changes

- dea876c: Remove `cspNonce` from ClientRuntimeConfig, fix SSR asset URLs, dissolve style-chrome

  - **everything-dev**: Remove `cspNonce` from `ClientRuntimeConfigSchema` (was leaking server-only value to client). Add `cspNonce` to `RouterContext`. Remove from `CreateRouterOptions`.
  - **ui**: Fix SSR asset URL mismatch — server `assetPrefix` now uses `bosConfig.app.ui.production` CDN URL instead of `/`, so imported assets resolve to the same absolute URL on both SSR and client. Dissolve `style-chrome.tsx` into `_layout.tsx`. Remove all `useClientValue` calls for runtime config reads (now use `runtimeConfig` from route context directly). Move `cspNonce` from L1 prop into `RouterContext`. Remove `getCspNonce()` from auth client. Add `runtimeConfig` prop to `UnderConstruction`.
  - **host**: Stop merging `cspNonce` into `runtimeConfig` for client shell.

## 1.5.2

### Patch Changes

- d26ed95: Pass CSP nonce through SSR pipeline and redirect UI assets instead of proxying to fix Cloudflare Error 1000

  **CSP nonce passthrough (production CSP script/style blocking fix):**

  The host generated a CSP nonce per request but never forwarded it to TanStack Router's SSR renderer, causing all inline scripts and styles to be blocked by `script-src 'nonce-...' 'strict-dynamic'` in production.

  - **everything-dev/types**: Add `cspNonce?: string` to `CreateRouterOptions` and `RenderOptions` interfaces
  - **everything-dev/types**: Add `cspNonce` to `RenderOptionsWithApi` (inherited from `RenderOptions`)
  - **ui/router.server**: Forward `cspNonce` to TanStack Router as `ssr: { nonce }` in `createRouter` and `renderToStream`
  - **ui/\_\_root**: Apply `nonce` from `useRouter().options.ssr?.nonce` to the `<style>` tag for base styles
  - **host/program**: Remove `as any` cast from `renderToStream` call — `cspNonce` is now a typed property
  - **host/tests**: Add regression tests verifying nonce appears on `<script>` and `<style>` tags when `cspNonce` is provided

  **Cloudflare Error 1000 fix (static asset 403s):**

  When both the host (Railway behind Cloudflare) and UI deployment (Zephyr Cloud behind Cloudflare) are orange-clouded, server-to-server proxying triggers Cloudflare Error 1000 "DNS points to prohibited IP". Browser requests to Zephyr Cloud work fine; only the host's `fetch()` proxy was blocked.

  - **host/program**: Replace `proxyUiAssetRequest` (server-to-server `fetch` proxy) with `redirectUiAssetRequest` (HTTP 302 redirect). The browser follows the redirect directly to the Zephyr Cloud origin, bypassing the Cloudflare-to-Cloudflare proxy loop
  - **ui/style-chrome**: Prefix rspack-imported `built_on.png` and `built_on_rev.png` with `assetsUrl` from runtime config so images load directly from the UI deployment origin instead of through the host
  - **ui/skill**: Use `assetsUrl` instead of `hostUrl` to fetch `/skill.md` directly from the UI origin
  - **host/tests**: Update `ui-public-assets.test.ts` — all UI asset tests now verify 302 redirect behavior instead of proxied content

## 1.5.1

### Patch Changes

- dd5a7d4: Fix production SSR by keeping the UI auth client local during server rendering and by resolving SSR-imported asset URLs from the UI remote instead of the host origin.

## 1.5.0

### Minor Changes

- b662086: Replace manual EventSource SSE with oRPC MemoryPublisher + eventIterator. Eliminates MaxListenersExceededWarning from Node EventTarget, stabilizes query keys to prevent refetch cascades, and adds typed streaming via VoteEventSchema contract.

### Patch Changes

- b662086: Move the homepage BOS viewer into an isolated iframe surface backed by a host-rendered `/_viewer` page.

  - Update `ui/src/routes/_layout/index.tsx` to load the landing viewer through `/_viewer` while preserving `?path=` support.
  - Add a dedicated host-rendered `/_viewer` endpoint with scoped CSP framing rules so the viewer can run in production without weakening the rest of the app.
  - Bootstrap the NEAR BOS web component from the host page so the requested widget path is forwarded correctly into the viewer runtime.

- b662086: Fix sidebar navigation to derive from plugin sidebar items and include projects

  - Updated `ui/src/routes/_layout.tsx` to properly consume generated `pluginSidebarItems` instead of using hardcoded navigation.
  - Fixed `packages/everything-dev/src/sidebar.ts` so the core `home` item points to `/home` (logo/dot still links to `/` for repository markdown render).
  - Added `plugins.projects.sidebar` to `bos.config.json` so the projects plugin appears in generated navigation.
  - Regenerated `ui/src/lib/plugin-sidebar.gen.ts` via `bos types gen` to include the `projects` sidebar item.
  - Fixed unbalanced JSX structure in `_layout.tsx` and removed stale/unused imports.

- b662086: Add a public skill surface for agents and builders, including a rendered `/skill` page, an updated raw `/skill.md` prompt, links from the about page, and a floating home-screen assistant that opens quick actions for the skill and related docs.
- b662086: Refactor the shared app shell by extracting the existing `_layout` chrome into `ui/src/components/style-chrome.tsx` without changing the intended authenticated and unauthenticated UI behavior.

## 1.5.3

### Patch Changes

- 0e72704: Add notFoundComponent and errorComponent to root route, use shared sessionQueryKey constant, and improve OG image alt text.

## 1.5.2

### Patch Changes

- ef4a77b: Tighten the host CSP in production by switching to nonce-based script loading with `strict-dynamic` while keeping `unsafe-eval` for Module Federation. Also pass the host-provided CSP nonce into the NEAR auth client so wallet iframe scripts continue to run under the stricter policy.

## 1.5.1

### Patch Changes

- 212ea6f: Clean up test infrastructure: proxy mock, dead env plumbing, and type cast

  - **host/tests**: Replace 80-line manual `AuthClient` mock with an 8-line
    `Proxy`-based mock that auto-implements any property, making it resilient
    to auth client API changes.
  - **host/tests**: Remove dead `vitest.setup.ts` and its `setupFiles` entry
    from `vitest.config.ts`. The `BOS_UI_URL`/`BOS_UI_SSR_URL` env var
    plumbing was unused after switching `loadTestRuntimeConfig` to read
    production URLs from `bos.config.json`. Simplify `global-setup.ts` to
    just build the UI dist (no HTTP server or env var setup needed).
  - **ui**: Remove unnecessary type cast in `renderToStream` —
    `renderOptions.authClient` is now typed directly via `RenderOptions`.
    Remove unused `AuthClient` type import.

- 521f85e: Fix SSR auth client injection, proxy test mock shape, and test config resolution

  - **host**: Pass `authClient` to SSR `renderToStream` so the host's pre-resolved auth client
    is reused instead of creating a new one from config. Export `toAuthClientContext` for use
    in program.ts. Proxy test mock updated to use correct `initialized.context` shape instead
    of putting handler directly on `initialized`.

  - **everything-dev**: Add optional `authClient` field to `RenderOptionsWithApi` type so
    callers can provide a pre-configured auth client for SSR rendering.

  - **ui**: `renderToStream` now uses `authClient` from render options when provided, falling
    back to `createAuthClient(runtimeConfig)` when not specified.

  - **host/tests**: Replace `process.env`-based `BOS_UI_URL`/`BOS_UI_SSR_URL` with production
    URL fallbacks from `bos.config.json` (`app.ui.production`, `app.ui.ssr`). Add
    `createMockAuthClient` helper returning a null-session auth client for SSR tests. Pass
    `session: null` and `authClient` in test render options to match production SSR semantics.

## 1.5.0

### Minor Changes

- 81f2599: Add `title` and `description` fields to `bos.config.json`, runtime config, and `ClientRuntimeInfo`. SEO head metadata now reads `title`/`description` from `runtimeConfig.runtime` instead of hardcoded defaults. Also removes a debug console.log, fixes an outdated comment in app.ts, adds a Dockerfile comment, and adds a workflow comment for FCAK creation.

## 1.4.9

### Patch Changes

- ffa8200: Catalog-ify rspack/rsbuild packages and propagate via bos upgrade/sync

  - Add @rspack/core, @rspack/cli, @rsbuild/core, @rsbuild/plugin-react to root package.json catalog
  - Convert all workspace package.json rspack/rsbuild deps from version ranges to catalog: refs
  - Change every-plugin @rspack/core peerDep from exact 1.7.4 to range ^1.7.4
  - Add CATALOG_TOOL_PACKAGES to manifest-normalizer for catalog: conversion during init/sync
  - Extend bos upgrade to also bump catalog tool packages to latest npm versions
  - Extend bos status to report catalog tool package versions

## 1.4.8

### Patch Changes

- 6425196: Upgrade hono to >=4.12.18 to resolve 5 security vulnerabilities (CSS injection, JWT validation, cache leakage, XSS, bodyLimit bypass). Soften CI audit step to warn instead of fail on high/critical findings for build-time-only dependencies.
- 519ded7: Fix sidebar active state: use TanStack Router `useLocation()` for reactivity and segment-boundary matching to prevent false positives

## 1.4.7

### Patch Changes

- 09a1405: Restore the UI app barrel helpers used by route code so the build keeps working with runtime-config-driven pages.

## 1.4.6

### Patch Changes

- 21836cb: Remove legacy UI generator plumbing and tighten the scaffold surface so fresh projects and upgrades do not ship references to missing files.

## 1.4.5

### Patch Changes

- 482cca9: Expand shared UI auth dependency policy so downstream apps inherit singleton better-auth, better-near-auth, and Better Auth client addons through template sync. Declare the UI's direct Better Auth addon dependencies explicitly to avoid duplicate installs and nominal type mismatches.

## 1.4.4

### Patch Changes

- 9b69858: Expand the shared auth dependency policy so downstream apps inherit singleton `better-auth`, `better-near-auth`, and Better Auth client addons through template sync. Also declare the UI's direct Better Auth addon dependencies explicitly to avoid duplicate installs and nominal type mismatches.

## 1.4.3

### Patch Changes

- e2a3d4a: Move theme toggle to fixed bottom-left position when not authenticated, keeping it always visible independent of page content.

## 1.4.2

### Patch Changes

- f64f1a8: Fix theme toggle positioning: sticky sidebar on desktop with internal scrolling, add toggle to mobile bottom nav, and make it visible on desktop header when not authenticated.

## 1.4.1

### Patch Changes

- cd7692f: Strengthen the generated auth surface and remove duplicate client facades so downstream packages rely on the canonical typed auth client.

## 1.4.0

### Minor Changes

- b06192b: Consolidate auth-client and session into single auth.ts with router context singleton pattern. Add useAuthClient() hook, remove runtimeConfig prop threading from components, upgrade better-near-auth to 1.4.0.

### Patch Changes

- 05c9fe2: Fix changeset CI errors: replace catalog: protocol for every-plugin dependency so changesets can resolve versions

## 1.3.4

### Patch Changes

- d920486: Export `Auth` type from generated auth-types.gen.ts for inferAdditionalFields

  The `auth-types.gen.ts` file now re-exports `Auth` from better-auth so
  the UI can use `inferAdditionalFields<Auth>()` instead of
  `inferAdditionalFields<typeof createAuthInstance>()`.

## 1.3.3

### Patch Changes

- 76c152b: Fix SSR runtime config errors by passing runtimeConfig to all auth clients

  `getAuthClient()` and `sessionQueryOptions()` were being called without `runtimeConfig` during server-side rendering, which caused `getRuntimeConfig()` to throw "Runtime config is only available in the browser". This propagated as repeated SSR 500 errors across all routes.

  Updated all route components and `UserNav` to read `runtimeConfig` from `Route.useRouteContext()` and pass it explicitly to `getAuthClient(runtimeConfig)` and `sessionQueryOptions(undefined, runtimeConfig)`. Also updated the `_layout.tsx` `beforeLoad` and `login.tsx` `beforeLoad`/`loader` to pass `context.runtimeConfig` into `sessionQueryOptions`.

  Files changed: `_layout.tsx`, `login.tsx`, `$gatewayId.tsx`, `home.tsx`, `settings.tsx`, `organizations/$id.tsx`, `organizations/index.tsx`, `organizations/new.tsx`, `projects/index.tsx`, `projects/$id.tsx`, and `user-nav.tsx`.

## 1.3.2

### Patch Changes

- 2c58902: Remove stale `auth-client.gen.ts` and fix UI implicit-any TypeScript errors.

  - **everything-dev**: Removed `api/src/auth-client.gen.ts` from the `typesGen` generated file list in `plugin.ts`. This file was consolidated into `plugins-client.gen.ts` in a previous release but the metadata still referenced it, causing confusion when the stale file was left in workspaces.

  - **ui**: Added explicit type annotations to callback parameters in:
    - `src/routes/_layout/login.tsx`: `onError` callbacks for NEAR sign-in, passkey, anonymous, email, phone OTP, and GitHub social login.
    - `src/routes/_layout/apps/$accountId/$gatewayId.tsx`: `TransactionBuilder` parameter in two `buildSignedDelegateAction` calls.

  These fixes resolve `noImplicitAny` errors under `strict` mode without changing runtime behavior.

## 1.3.1

### Patch Changes

- b1adcb2: Fix SSR crash: pass runtimeConfig from router context to auth client instead of reading window.**RUNTIME_CONFIG** during server-side route matching

## 1.3.0

### Minor Changes

- c5fecc9: Switch from PGlite to Docker Postgres for development, fix multi-instance WASM crash, add auto-migration and infinite scroll for projects

  The host was crashing with `RuntimeError: Aborted()` because multiple PGlite WASM instances cannot coexist in a single Node.js process. This replaces in-process PGlite with Docker Postgres for development, and adds several related fixes:

  - Add `docker-compose.yml` with 3 postgres:17-alpine services (api:5432, auth:5433, projects:5434)
  - Add `dev:postgres`, `dev:postgres:down`, `dev:postgres:reset` convenience scripts
  - Declare `API_DATABASE_URL` and `PROJECTS_DATABASE_URL` secrets in `bos.config.json` so the host injects them into plugins
  - Conditionally disable SSL for localhost connections in `createDatabaseDriver` (3 files)
  - Add auto-migration to API and projects plugins on startup (matching auth plugin's existing pattern)
  - Fix projects `listProjects` pagination: move visibility filter from JS post-filter to SQL WHERE clause, add offset-based cursor pagination
  - Add infinite scroll with IntersectionObserver to projects list UI
  - Default project visibility to `public` instead of `private`
  - Show all visible projects (public/unlisted from everyone + own private) instead of filtering to current user only
  - Fix CI: replace broken `file:./api-test.db` with postgres service container

- f3f9e64: Migrate projects and API plugins to PostgreSQL with pglite fallback, add generic upvote system with SSE live ranking, and redesign projects page as a real-time ranked leaderboard.

  ### What Changed

  **API Plugin**

  - Migrated from SQLite to PostgreSQL (`pg` production, `pglite` local fallback)
  - Added `upvotes` table with unique constraint on `(thing_id, user_id)`
  - New upvote endpoints: `upvoteThing`, `downvoteThing`, `getUpvoteCount`, `getUpvoteFeed`
  - Real-time SSE stream at `/api/upvotes/stream` with in-memory pub/sub
  - Unified database defaults to `pglite:.bos/<plugin>/:memory:`

  **Projects Plugin**

  - Migrated from SQLite/libsql to PostgreSQL (same driver pattern as auth)
  - Dropped KV store (`kvStore` table, `KvService`, and all KV routes)
  - Regenerated Drizzle schema with `pgTable` and `timestamp with time zone`
  - Unified database defaults to `pglite:.bos/projects/:memory:`

  **Auth Plugin**

  - Updated default `AUTH_DATABASE_URL` to `pglite:.bos/auth/:memory:`
  - Driver now detects `:memory:` basename for true in-memory mode

  **UI**

  - Complete redesign of projects list page
  - Full-width horizontal cards with rank numbers (`#1`, `#2`, etc.)
  - Vote stack on right (↑ count ↓)
  - Projects sorted by upvote count descending
  - Framer Motion `Reorder.Group` for smooth rank transitions
  - SSE integration pushes live vote updates that trigger re-sorting
  - Removed legacy `keys/` KV test routes and UI

  **Config**

  - Updated `.env.example` with new PostgreSQL default comments
  - Removed `keys/**` from `bos.config.json` projects plugin routes

- 89c20cb: Remove opencode plugin and related UI routes

  ### What Changed

  - **Deleted** `plugins/opencode/` — the opencode plugin is no longer part of the project
  - **Deleted** `ui/src/routes/_layout/opencode.tsx` — removed the `/opencode` route page
  - **Updated** `ui/src/routes/_layout/_authenticated/_admin/dashboard.tsx` — replaced opencode-specific server/prompt tabs with a simple admin placeholder
  - **Updated** `ui/src/routes/_layout/about.tsx` — removed the `/opencode` link
  - **Updated** `ui/public/llms.txt` and `ui/public/skill.md` — removed `/opencode` from public paths
  - **Updated** `AGENTS.md` and `CONTRIBUTING.md` — removed opencode plugin references
  - **Updated** `bos.config.json` — removed the `opencode` plugin entry

### Patch Changes

- 033f41f: Add projects link to sidebar and mobile nav, fix missing useQuery import

## 1.2.1

### Patch Changes

- e53af6e: Add CSP with feature flag, integrity registry, on-chain attestation, and safe plugin client factory

  CSP: Add `CSP_STRICT` const (default false) that toggles between relaxed mode (`'unsafe-inline'` + `'unsafe-eval'`) and strict mode (nonce + `'strict-dynamic'`). Relaxed mode is the default because Module Federation requires `'unsafe-eval'`, making strict inline script enforcement moot. All other CSP directives (object-src, base-uri, frame-ancestors, connect-src, etc.) remain enforced regardless of mode. When strict mode is enabled, nonces are injected into HTML script tags and the runtime config.

  Integrity: Add `IntegrityRegistry` class for SRI hash tracking, `installIntegrityFetchHook` for MF lifecycle fetch interception, `verifyConfigAgainstChain` for on-chain attestation checks, and `startIntegrityMonitor` for periodic background re-verification.

  Safety: Wrap plugin client factories with `createSafeClientFactory` to prevent arbitrary context injection. Merge CSP headers into SSR responses.

- 0a67206: Refactor dev orchestrator to service-descriptor architecture; add NEAR auth contract routes (nonce, verify, profile, relay, view); consolidate session queries in UI; add source-map devtool for plugin builds
- 34207e4: Reorganize dev port assignments: host=3000, api=3001, auth=3002, ui=3003, ui-ssr=3004, plugins=3010+

  Fix dev TUI display: host always shows "running" with port, remote non-host services show "loaded" without port. Strip ANSI codes from log files, only tag stderr as [ERR] when content is actually error-like, and replace Effect.logInfo with console.log in host logger for clean output.

## 1.2.0

### Minor Changes

- c0452e7: Renamed `productionIntegrity` to `integrity` across all schemas, build configs, and `bos.config.json`. Added `name` and `version` fields to `BosPluginRef`. Enhanced `bos plugin add` with `bos://account/plugins/name` registry resolution, manifest validation, and automatic integrity computation. Enhanced `bos plugin publish` with manifest validation, integrity computation, and FastKV plugin registry writes. Added generic KV routes (`kvGet`, `kvList`, `kvPrepareWrite`, `kvRelayWrite`) to the registry plugin.
- db3ba6b: Remove near-kit dependency from UI. Delete near-client.ts wrapper and refactor gateway page to use authClient.near (buildSignedDelegateAction, relayTransaction) directly via better-near-auth.
- c29e058: Migrate auth from plugin to app-level infrastructure. Host mounts only the raw Better Auth handler; authClient is injected separately from pluginsClient. Plugins receive auth context per-request, not via injected clients. Projects plugin cleaned of auth-proxying routes. Deleted every-plugin/context.ts.
- 6428994: Switch from npm better-near-auth v0.6.0 to local file:../../lib/better-near-auth. Replaces @fastnear/wallet and @fastnear/near-connect with @hot-labs/near-connect + near-kit, removing the "Receiving connection details…" wallet modal hang. Also fixes session race condition in login redirect and NEAR sign-in pending state timing.
- 772b71e: Remove session.ts, adopt getAuthClient() and useSession() hook

  Delete centralized session.ts (query options, helpers, action wrappers). Replace authClient proxy export with getAuthClient() function. Switch from useQuery(sessionQueryOptions()) to authClient.useSession() hook throughout. Inline query/mutation definitions in components. Refactor login page from 8 useMutation hooks to async handlers with shared isPending state.

### Patch Changes

- a483214: Fix build and test issues after switching to local better-near-auth

  - Added `@hot-labs/near-connect@0.11.2` as a root dependency and override to resolve missing prebuilt artifacts from the GitHub version
  - Fixed duplicate `"clsx"` key in `ui/package.json` that caused `bun install` warnings
  - Updated `better-near-auth` API usage in `$gatewayId.tsx` to match new `buildSignedDelegateAction(receiverId, builderFn)` signature and `relayTransaction({ payload })` shape
  - Fixed `deposit` → `attachedDeposit: 0n` to satisfy `AmountInput` type requirements
  - Removed unused `normalizePath` function in `plugins/auth/rspack.config.js`
  - Fixed `EmitPluginManifest` `srcPath` from `"types/auth-export.d.ts"` to `"auth-export.d.ts"` (plugin already prefixes `types/`)
  - Added `--root .` to `api` vitest scripts to prevent test discovery leaking into other workspace packages

- 069cb6a: Upgrade better-near-auth from local file import to published v1.0.0

  Switches the workspace catalog entry from `file:../../lib/better-near-auth` to `^1.0.0`, consuming the official npm release. The v1.0.0 package already includes the near-kit + @hot-labs/near-connect migration and the relay API shape used by the gateway page, so no source code changes are required.

  - `relayer: {}` in server config continues to use all defaults (ephemeral auto-generated keypair)
  - Client `siwnClient({ recipient, networkId })` remains valid
  - `auth.near.buildSignedDelegateAction()` and `auth.near.relayTransaction({ payload })` APIs unchanged

## 1.1.3

### Patch Changes

- d96b5d3: Enforce effect and zod as singleton shared dependencies across Module Federation runtime

  - Add `effect` and `zod` as direct dependencies in api, host, and ui packages with catalog-pinned exact versions
  - Move `every-plugin` from devDependencies to dependencies in api and ui (runtime import)
  - Add `effect` and `zod` to `bos.config.json` `shared.ui` as singleton MF shared deps to prevent duplicate runtime instances
  - Pin `effect`, `zod`, and `@orpc/*` to exact versions in workspace catalog and add overrides to eliminate version drift
  - Unify `@orpc/*` version refs across api, host, and ui to use catalog instead of mixed ranges
  - Update `every-plugin` mf-config to resolve effect/zod versions from installed packages instead of hardcoded ranges
  - Merge `overrides` field in sync flow's `mergePackageJson` to preserve user overrides during upgrade

## 1.1.2

### Patch Changes

- f199d5e: Remove stale `./types` Module Federation expose pointing to non-existent `src/types/index.ts`, fixing build error

## 1.1.1

### Patch Changes

- aeab5ce: Remove demo routes and fix plugin routing. API shell now only exposes `ping` and `authHealth` (with `requireAuth` middleware). Plugin-specific routes are registered before the base API catch-all in Hono, fixing 404s on `/api/rpc/{plugin}/*`. OpenAPI spec includes the current domain as an available server.

## 1.1.0

### Minor Changes

- 4efd2db: ## Extract business logic into plugins

  ### Breaking changes (api)

  All business routes have been removed from the `api` package. The API is now a thin structural shell with only health and error routes:

  - **Removed**: `listRegistryApps`, `getRegistryApp`, `getRegistryAppsByAccount`, `getRegistryAppByHost`, `getRegistryStatus`, `prepareRegistryMetadataWrite`, `relayRegistryMetadataWrite` (moved to `plugins/registry/`)
  - **Removed**: `listKeys`, `getValue`, `setValue`, `deleteKey` (moved to `plugins/projects/`)
  - **Removed**: `listProjects`, `getProject`, `createProject`, `updateProject`, `deleteProject`, `listProjectApps`, `linkAppToProject`, `unlinkAppFromProject`, `listProjectsForApp` (moved to `plugins/projects/`)
  - **Removed**: `listApiKeys`, `createApiKey`, `deleteApiKey` (moved to `plugins/projects/`)
  - **Removed**: `listOrgMembers`, `listOrgInvitations`, `cancelInvitation`, `resendInvitation` (moved to `plugins/projects/`)
  - **Kept**: `ping`, `authHealth`, `publicError`, `protectedError`
  - **Kept**: `requireAuth`, `requireNearAccount`, `requireOrgRole` middleware (duplicated in plugins)

  ### New: registry plugin (`@everything-dev/registry-plugin`)

  FastKV app discovery, metadata publish/relay. No database required.

  - All registry routes from the API are now under `apiClient.registry.*`
  - Configuration via `REGISTRY_RELAY_*` secrets and optional `registryNamespace` variable

  ### New: projects plugin (`@everything-dev/projects-plugin`)

  Projects CRUD, KV store, org management, API keys. SQLite via libsql.

  - All projects/KV/org/API key routes from the API are now under `apiClient.projects.*`
  - Configuration via `PROJECTS_DATABASE_URL` and `PROJECTS_DATABASE_AUTH_TOKEN` secrets

  ### UI changes

  Stale route files for organizations, keys, apps, and settings pages were removed. Project pages (detail, list, new) were later restored to work with the namespaced projects plugin client.

  All `apiClient` calls to business routes must now use namespaced access:

  - `apiClient.listRegistryApps()` → `apiClient.registry.listRegistryApps()`
  - `apiClient.getProject()` → `apiClient.projects.getProject()`
  - `apiClient.listKeys()` → `apiClient.projects.listKeys()`
  - etc.

- d4df05d: ## Infrastructure: CI optimization, Docker hardening, staging environments, config-driven architecture

  ### CI/CD improvements

  - **Consolidated lint + typecheck** into a single job (was 2 sequential), removing ~1-2 minutes per CI run
  - **Replaced `bun lint` + `bun format:check`** with single `biome ci .` command
  - **Pinned Bun version** to `"1.4"` in all workflows (was `latest`)
  - **Added native caching** via `setup-bun@v2` cache option (removed redundant `actions/cache`)
  - **Upgraded `actions/checkout`** from v6 to v4
  - **Parallelized typecheck** across packages using background processes (`& wait`)
  - **Staging deployment workflow** (`.github/workflows/staging.yml`) — builds `:staging` image on merge to main
  - **Preview deployment workflow** (`.github/workflows/preview.yml`) — builds `:pr-N` image per PR, comments preview URL
  - **CI workflows read domain from `bos.config.json`** via `jq` instead of hardcoding

  ### Docker hardening

  - **Non-root user**: Container now runs as `appuser` (UID 1001) instead of root
  - **Layer caching**: Dependencies installed before source code copy for better cache hits
  - **Bun 1.4**: Updated base image from `oven/bun:1.3.9-alpine` to `oven/bun:1.4-alpine`
  - **Added `curl` and `/health` healthcheck** with 30s interval
  - **Removed `Dockerfile.dev`**: Development flow uses `bos dev`, not a dev Docker image
  - **Added `railway.json`** for Railway deployment configuration with health checks

  ### Staging environment support

  - **Added `staging` field** to `BosConfigSchema` for staging domain configuration
  - **Added `--env` flag** to CLI start command supporting `production` and `staging` environments
  - **Updated `start` script** to accept `APP_ENV` environment variable for environment selection
  - **Staging mode** sets `GATEWAY_DOMAIN` from `config.staging.domain` and labels process as "Staging Mode"

  ### Config-driven architecture

  `bos.config.json` is now the single source of truth. All hardcoded values have been eliminated in favor of deriving from config at runtime or build time:

  - **Removed hardcoded defaults** from `package.json` start script — `--account` and `--domain` no longer have shell fallbacks; config is read from `bos.config.json`
  - **`BETTER_AUTH_URL`** now defaults to `config.hostUrl` instead of hardcoded `localhost:3000`
  - **`fastkv.ts`** mainnet fallback uses the actual `accountId` parameter instead of hardcoded `"dev.everything.near"`
  - **Host page title** uses `config.domain` instead of hardcoded `"everything.dev"`
  - **UI app name** is injected at build time from `bos.config.json` via rsbuild `source.define` (was hardcoded `"everything.dev"` in 15+ route files)
  - **UI `about.tsx`** registry query params use `activeRuntime.accountId`/`gatewayId` instead of hardcoded values

  ### Breaking changes

  - `BOS_ACCOUNT` and `GATEWAY_DOMAIN` are no longer default-encoded in Docker image — config comes from `bos.config.json`
  - Docker `CMD` no longer passes `--account` / `--domain` — use `APP_ENV` env var to switch environments
  - `BosConfigSchema` now includes optional `staging` field — existing configs are unaffected
  - `StartOptionsSchema` now includes optional `env` field — existing invocations are unaffected
  - UI `branding.ts` `APP_NAME` now reads from `import.meta.env.APP_NAME` with `"everything.dev"` fallback

- 8e378e3: Add opencode integration page, skill, and runtime config hot-swap design

  - New `/opencode` route with integration status and configuration
  - Admin dashboard updates for opencode management
  - Runtime config hot-swap design documentation

### Patch Changes

- 7e1286a: ## Security hardening: SRI integrity, CORS tightening, and config cleanup

  ### Subresource Integrity (SRI) for remote entries

  - **New `everything-dev/integrity` module** with `computeSriHash`, `computeSriHashForUrl`, and `verifySriForUrl` — single source of truth for all integrity operations
  - **Deploy hooks** now compute SHA-384 hashes of `remoteEntry.js` and write `productionIntegrity`/`ssrIntegrity` to `bos.config.json` on deploy
  - **Client-side SRI**: `<script>` tags for remote entries now include `integrity` and `crossorigin="anonymous"` attributes
  - **Server-side SRI verification** before loading SSR modules, API plugins, and UI federation remotes
  - **Integrity plumbing**: `productionIntegrity` and `ssrIntegrity` fields flow through `BosConfig` → `RuntimeConfig` → `ClientRuntimeConfig` → HTML rendering

  ### CORS hardening

  - **`host/src/services/auth.ts`**: Better Auth `trustedOrigins` now falls back to `[hostUrl, ...uiUrl]` instead of `[]` when `CORS_ORIGIN` is unset, aligning with Hono CORS middleware
  - **`host/src/program.ts`**: Production warning when `CORS_ORIGIN` is unset; fixed bug where empty `uiConfig.url` could be included as a CORS origin
  - **`packages/everything-dev/src/host.ts`**: CORS origins now include UI URL in fallback; production warning added
  - **Production warning** added for missing `BETTER_AUTH_SECRET`

  ### Config / type cleanup

  - **Removed `resolvedConfig` and `canonicalConfigUrl`** from `ClientRuntimeInfo` — these leaked arbitrary config data to the client
  - **Renamed `ActiveRuntimeInfo`** to `ClientRuntimeInfo` everywhere for consistency
  - **Deduplicated `SharedDepConfigSchema`** — now an alias for `SharedConfigSchema`
  - **Added `productionIntegrity`** to `BosConfigInput` interface, removing `as any` cast
  - **Added `testnet`** to `BosConfigSchema`

  ### Bug fixes

  - Fixed trailing slash inconsistency in host's SSR URL construction
  - Fixed SRI integrity check being inside Effect retry scope (now fails fast, only module loading is retried)
  - Added `integrity` verification to API plugin loading (`everything-dev/src/api.ts` and `host/src/services/plugins.ts`)

  ### Breaking changes

  - `ActiveRuntimeInfo` type removed — use `ClientRuntimeInfo`
  - `resolvedConfig` and `canonicalConfigUrl` removed from `ClientRuntimeInfo`
  - `BetterAuth` `trustedOrigins` default changed from `[]` to `[hostUrl, ...uiUrl]`

- 8e378e3: Restore project pages, remove stale organization/key/app pages

  - Restored projects detail, list, and new pages
  - Removed stale organization, keys, and apps route files

## 1.0.1

### Patch Changes

- d4a584d: Refactor navigation to use TanStack Router best practices

  - Replace internal navigation `<a>` tags with `<Link>` components for automatic intent-based preloading
  - Remove `as never` type casts from route definitions to restore proper TypeScript inference
  - Fix route param types for dynamic routes (organizations, projects, apps)
  - Fix optional search params type inference for `/apps` route
  - Improve type safety and autocomplete for route navigation
  - Preserve external links as `<a>` tags (API endpoint, external domains, static files)

  This enables automatic route preloading on hover/focus, improving navigation performance and user experience.

## 1.0.0

### Major Changes

- f080b87: Release v1.0.0 of the everything-dev toolchain.

  - Promote api, ui, everything-dev, and every-plugin to stable 1.0.0
  - Promote the plugin template package to stable 1.0.0

### Minor Changes

- a4327aa: Early 2000s Google-inspired theme redesign with 3D beveled components

  - Switched from Red Hat Mono to Inter font for modern sans-serif typography
  - Implemented Google-inspired color palette (light and dark mode)
  - Added 3D beveled borders (outset/inset) for classic early 2000s aesthetic
  - Refactored all UI components to use Button, Input, and Card components
  - Updated all routes to use styled components instead of inline Tailwind classes
  - Added modern hover effects and smooth transitions
  - Maintained accessibility with focus rings and keyboard navigation
  - Full dark mode support with appropriate color adjustments

- 2c93dbb: Multi-tenant organization support with Better Auth integration

  - Added Better Auth organization plugin with teams support
  - Implemented all authentication methods: NEAR, email/password, phone OTP, passkey, anonymous
  - Personal organization auto-created for every non-anonymous user
  - Organization management UI: browse, create, switch, invite members
  - Real invitation flow with email notifications
  - Dev-preview email/SMS transport (logs to .dev-preview/ directory)
  - Account settings page for managing auth methods and security
  - Removed placeholder org RPCs - now using Better Auth directly
  - Added API key plugin support
  - Updated milestone-1 documentation

- 77191cd: Add a published runtime registry with host-aware runtime resolution and explorer flows.

  - Add registry discovery, detail, metadata preparation, and relay APIs for published BOS configs
  - Resolve active runtimes in the host so published apps can run from canonical host URLs or `_runtime` overrides
  - Add UI pages for browsing published apps, inspecting runtime config, and publishing registry metadata

- 9cb973d: Abstract UI runtime into everything-dev package

  - Moved router creation, SSR rendering, and hydration into everything-dev/ui
  - Split package exports into ./ui/client (browser-safe) and ./ui/server (SSR)
  - Added networkId derivation from account suffix (testnet/mainnet)
  - Created canonical ui/src/app.ts barrel for apiClient, authClient, runtime helpers
  - Deleted ui/src/remote/\* indirection layer
  - Added API contract manifest with checksum for type sync
  - Added everything-dev types sync CLI command

- 1f8ac1a: Add user-owned projects for organizing NEAR apps

  - Add projects database schema with projects and project_apps tables
  - Add ProjectService with Effect pattern for proper dependency injection
  - Add 8 project API endpoints: list, get, create, update, delete, list apps, link/unlink apps
  - Add UI pages for project detail, project creation, and project listings
  - Add "My Projects" section to home page
  - Add "In Projects" section to app detail page showing which projects contain the app

### Patch Changes

- 44393e7: Fix published app discovery and FastKV publish flow so registry reads use the stored manifest data, publish can succeed after FastKV indexing, and the app explorer links directly to the FastKV config record.
- 44393e7: Refresh the splash-based social metadata and brand assets so the UI ships a stable preview image and matching black-dot favicon set.
- 44393e7: Add under construction page with NEAR CLI integration for session management and development tooling
