<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@hot-labs/near-connect#near-connect-quickstart"
    run: "bunx @tanstack/intent@latest load @hot-labs/near-connect#near-connect-quickstart"
    for: "Install and set up @hot-labs/near-connect for NEAR blockchain wallet connection. Covers NearConnector initialization, connect/disconnect, wallet:signIn and wallet:signOut events, feature filtering, WalletConnect configuration, and manifest auto-updating. Use when adding NEAR wallet support to a dapp, configuring WalletConnect for mobile wallets, or troubleshooting wallet visibility issues."
  - id: "@hot-labs/near-connect#near-connect-transactions"
    run: "bunx @tanstack/intent@latest load @hot-labs/near-connect#near-connect-transactions"
    for: "Send transactions and sign messages with @hot-labs/near-connect. Covers ConnectorAction format (FunctionCall, Transfer, etc.), @near-js Action compatibility, signAndSendTransaction, signAndSendTransactions, signMessage, signInAndSignMessage, signDelegateActions, and function call access key parameters. Use when a dapp needs to call a NEAR contract, sign a message for authentication, or add a limited-access key."
  - id: "@tanstack/devtools#devtools-app-setup"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools#devtools-app-setup"
    for: "Install TanStack Devtools, pick framework adapter (React/Vue/Solid/Preact), register plugins via plugins prop, configure shell (position, hotkeys, theme, hideUntilHover, requireUrlFlag, eventBusConfig). TanStackDevtools component, defaultOpen, localStorage persistence."
  - id: "@tanstack/devtools#devtools-marketplace"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools#devtools-marketplace"
    for: "Publish plugin to npm and submit to TanStack Devtools Marketplace. PluginMetadata registry format, plugin-registry.ts, pluginImport (importName, type), requires (packageName, minVersion), framework tagging, multi-framework submissions, featured plugins."
  - id: "@tanstack/devtools#devtools-plugin-panel"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools#devtools-plugin-panel"
    for: "Build devtools panel components that display emitted event data. Listen via EventClient.on(), handle theme (light/dark), use @tanstack/devtools-ui components. Plugin registration (name, render, id, defaultOpen), lifecycle (mount, activate, destroy), max 3 active plugins. Two paths: Solid.js core with devtools-ui for multi-framework support, or framework-specific panels."
  - id: "@tanstack/devtools#devtools-production"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools#devtools-production"
    for: "Handle devtools in production vs development. removeDevtoolsOnBuild, devDependency vs regular dependency, conditional imports, NoOp plugin variants for tree-shaking, non-Vite production exclusion patterns."
  - id: "@tanstack/devtools-event-client#devtools-bidirectional"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-bidirectional"
    for: "Two-way event patterns between devtools panel and application. App-to-devtools observation, devtools-to-app commands, time-travel debugging with snapshots and revert. structuredClone for snapshot safety, distinct event suffixes for observation vs commands, serializable payloads only."
  - id: "@tanstack/devtools-event-client#devtools-event-client"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-event-client"
    for: "Create typed EventClient for a library. Define event maps with typed payloads, pluginId auto-prepend namespacing, emit()/on()/onAll()/onAllPluginEvents() API. Connection lifecycle (5 retries, 300ms), event queuing, enabled/disabled state, SSR fallbacks, singleton pattern. Unique pluginId requirement to avoid event collisions."
  - id: "@tanstack/devtools-event-client#devtools-instrumentation"
    run: "bunx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-instrumentation"
    for: "Analyze library codebase for critical architecture and debugging points, add strategic event emissions. Identify middleware boundaries, state transitions, lifecycle hooks. Consolidate events (1 not 15), debounce high-frequency updates, DRY shared payload fields, guard emit() for production. Transparent server/client event bridging."
  - id: "@tanstack/react-table#create-table-hook"
    run: "bunx @tanstack/intent@latest load @tanstack/react-table#create-table-hook"
    for: "Build reusable React table infrastructure with createTableHook, useAppTable, createAppColumnHelper, shared features/defaults, component registries, AppTable/AppCell/AppHeader wrappers, and typed context hooks. Load for recurring application table conventions, scoped contexts, HMR cycles, or table prop drilling."
  - id: "@tanstack/react-table#getting-started"
    run: "bunx @tanstack/intent@latest load @tanstack/react-table#getting-started"
    for: "Create and render a TanStack React Table v9 table with useTable, tableFeatures, stable data and columns, row/header models, and table.FlexRender. Load for a first React table, headless rendering, or when v8 useReactTable examples are producing the wrong setup."
  - id: "@tanstack/react-table#migrate-v8-to-v9"
    run: "bunx @tanstack/intent@latest load @tanstack/react-table#migrate-v8-to-v9"
    for: "Perform a complete @tanstack/react-table v8-to-v9 migration: hook and feature architecture, row-model slots, React state and subscriptions, rendering, composable tables, type helpers, and every shared API rename and semantic change. Use for migration plans, implementation, or audits. Treat useLegacyTable only as a deprecated temporary bridge."
  - id: "@tanstack/react-table#table-state"
    run: "bunx @tanstack/intent@latest load @tanstack/react-table#table-state"
    for: "Read, select, subscribe to, and control React Table V9 state with useTable selectors, table.state, table.Subscribe, table.atoms, table.store, and external TanStack Store atoms. Load for controlled state, render performance, or React Compiler builder-method subscription problems."
  - id: "@tanstack/react-table#with-tanstack-query"
    run: "bunx @tanstack/intent@latest load @tanstack/react-table#with-tanstack-query"
    for: "Compose React Table v9 with TanStack Query for server filtering, sorting, pagination, and infinite data. Load for query-key table state, manual* processing boundaries, server rowCount, keepPreviousData, or avoiding duplicated query-result state."
  - id: "@tanstack/react-table#with-tanstack-virtual"
    run: "bunx @tanstack/intent@latest load @tanstack/react-table#with-tanstack-virtual"
    for: "Virtualize final React Table row or column models with TanStack Virtual. Load for useVirtualizer counts, scroll elements, stable keys, data-index measurement, dynamic heights, sticky headers/columns, grid/flex geometry, or infinite fetching; Virtual is renderer composition, not a Table feature."
  - id: "@tanstack/router-core#router-core"
    run: "bunx @tanstack/intent@latest load @tanstack/router-core#router-core"
    for: "Framework-agnostic core concepts for TanStack Router: route trees, createRouter, createRoute, createRootRoute, createRootRouteWithContext, addChildren, Register type declaration, route matching, route sorting, file naming conventions. Entry point for all router skills."
  - id: "@tanstack/router-core#router-core/auth-and-guards"
    run: "bunx @tanstack/intent@latest load @tanstack/router-core#router-core/auth-and-guards"
    for: "Route protection with beforeLoad, redirect()/throw redirect(), isRedirect helper, authenticated layout routes (_authenticated), non-redirect auth (inline login), RBAC with roles and permissions, auth provider integration (Auth0, Clerk, Supabase), router context for auth state."
  - id: "@tanstack/router-core#router-core/code-splitting"
    run: "bunx @tanstack/intent@latest load @tanstack/router-core#router-core/code-splitting"
    for: "Automatic code splitting (autoCodeSplitting), .lazy.tsx convention, createLazyFileRoute, createLazyRoute, lazyRouteComponent, getRouteApi for typed hooks in split files, codeSplitGroupings per-route override, splitBehavior programmatic config, critical vs non-critical properties."
  - id: "@tanstack/router-core#router-core/data-loading"
    run: "bunx @tanstack/intent@latest load @tanstack/router-core#router-core/data-loading"
    for: "Route loader option, loaderDeps for cache keys, staleTime/gcTime/ defaultPreloadStaleTime SWR caching, pendingComponent/pendingMs/ pendingMinMs, errorComponent/onError/onCatch, beforeLoad, router context and createRootRouteWithContext DI pattern, router.invalidate, Await component, deferred data loading with unawaited promises."
  - id: "@tanstack/router-core#router-core/navigation"
    run: "bunx @tanstack/intent@latest load @tanstack/router-core#router-core/navigation"
    for: "Link component, useNavigate, Navigate component, router.navigate, ToOptions/NavigateOptions/LinkOptions, from/to relative navigation, activeOptions/activeProps, preloading (intent/viewport/render), preloadDelay, navigation blocking (useBlocker, Block), createLink, linkOptions helper, scroll restoration, MatchRoute."
  - id: "@tanstack/router-core#router-core/not-found-and-errors"
    run: "bunx @tanstack/intent@latest load @tanstack/router-core#router-core/not-found-and-errors"
    for: "notFound() function, notFoundComponent, defaultNotFoundComponent, notFoundMode (fuzzy/root), errorComponent, CatchBoundary, CatchNotFound, isNotFound, NotFoundRoute (deprecated), route masking (mask option, createRouteMask, unmaskOnReload)."
  - id: "@tanstack/router-core#router-core/path-params"
    run: "bunx @tanstack/intent@latest load @tanstack/router-core#router-core/path-params"
    for: "Dynamic path segments ($paramName), splat routes ($ / _splat), optional params ({-$paramName}), prefix/suffix patterns ({$param}.ext), useParams, params.parse/stringify, pathParamsAllowedCharacters, i18n locale patterns."
  - id: "@tanstack/router-core#router-core/search-params"
    run: "bunx @tanstack/intent@latest load @tanstack/router-core#router-core/search-params"
    for: "validateSearch, search param validation with Zod/Valibot/ArkType adapters, fallback(), search middlewares (retainSearchParams, stripSearchParams), custom serialization (parseSearch, stringifySearch), search param inheritance, loaderDeps for cache keys, reading and writing search params."
  - id: "@tanstack/router-core#router-core/ssr"
    run: "bunx @tanstack/intent@latest load @tanstack/router-core#router-core/ssr"
    for: "Non-streaming and streaming SSR, RouterClient/RouterServer, renderRouterToString/renderRouterToStream, createRequestHandler, defaultRenderHandler/defaultStreamHandler, HeadContent/Scripts components, head route option (meta/links/styles/scripts), ScriptOnce, automatic loader dehydration/hydration, memory history on server, data serialization, document head management."
  - id: "@tanstack/router-core#router-core/type-safety"
    run: "bunx @tanstack/intent@latest load @tanstack/router-core#router-core/type-safety"
    for: "Full type inference philosophy (never cast, never annotate inferred values), Register module declaration, from narrowing on hooks and Link, strict:false for shared components, getRouteApi for code-split typed access, addChildren with object syntax for TS perf, LinkProps and ValidateLinkOptions type utilities, as const satisfies pattern."
  - id: "@tanstack/router-plugin#router-plugin"
    run: "bunx @tanstack/intent@latest load @tanstack/router-plugin#router-plugin"
    for: "TanStack Router bundler plugin for route generation and automatic code splitting. Supports Vite, Webpack, Rspack, and esbuild. Configures autoCodeSplitting, routesDirectory, target framework, and code split groupings."
  - id: "@tanstack/table-core#aggregation"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#aggregation"
    for: "Aggregate TanStack Table columns independently of grouping, including grand totals, caller-selected row totals, multiple keyed aggregations, custom context-based definitions, grouped merges, manual values, and worker constraints."
  - id: "@tanstack/table-core#api-not-found"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#api-not-found"
    for: "Diagnose missing TanStack Table v9 exports, options, state slices, and instance methods. Load before inventing an API when code sees a type error, undefined feature method, absent object key, adapter mismatch, or v8-shaped example."
  - id: "@tanstack/table-core#cell-selection"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#cell-selection"
    for: "Select, add, and subtract rectangular cell ranges with cellSelectionFeature: ordered include/exclude operations keyed by row and column id, modifier dragging, final positive bounds, selection edges, render-order resolution under pinning, and autoResetCellSelection. Load for spreadsheet-style selection, “select all except” behavior, unexpected range changes after sorting or reordering, drag performance, or copy-to-clipboard."
  - id: "@tanstack/table-core#cell-spanning"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#cell-spanning"
    for: "Merge adjacent body cells with cellSpanningFeature: value-based rowSpan opt-in per column via spanRows, per-row colSpan via spanColumns, and the covered-cell convention where a span of 0 means skip the cell. Load for merged data grids, spans that disappear after sorting or paginating, ragged table rows, or a cell that unexpectedly merges down the whole tbody."
  - id: "@tanstack/table-core#client-vs-server"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#client-vs-server"
    for: "Choose client or server ownership for filtering, grouping, sorting, expanding, and pagination in TanStack Table v9. Load for manual* flags, mixed pipelines, server counts, or deciding which dataset each row-model stage receives."
  - id: "@tanstack/table-core#column-faceting"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#column-faceting"
    for: "Build faceted filter UIs with columnFacetingFeature, facetedRowModel, facetedUniqueValues, and facetedMinMaxValues. Load for facet counts, numeric ranges, own-filter exclusion, or server-page facet completeness."
  - id: "@tanstack/table-core#column-filtering"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#column-filtering"
    for: "Filter columns with columnFilteringFeature, filteredRowModel, filterFns, filterMeta, nested-row direction, and manualFiltering. Load for accessor compatibility, controlled filter updaters, fuzzy metadata, or client/server ownership."
  - id: "@tanstack/table-core#column-ordering"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#column-ordering"
    for: "Control TanStack Table v9 leaf columnOrder with stable IDs while accounting for pinning regions, visibility, and groupedColumnMode precedence. Load for drag-and-drop columns or rendered order that differs from state."
  - id: "@tanstack/table-core#column-pinning"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#column-pinning"
    for: "Pin columns into logical start, center, and end regions with columnPinningFeature and renderer-owned sticky CSS. Load for RTL offsets, z-index, backgrounds, overflow, widths, gaps, or overlaps."
  - id: "@tanstack/table-core#column-resizing"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#column-resizing"
    for: "Wire columnResizingFeature, header.getResizeHandler, resize mode and direction, pointer or touch events, and performant CSS-variable updates. Load when resize state changes but widths do not, or large tables resize slowly."
  - id: "@tanstack/table-core#column-sizing"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#column-sizing"
    for: "Use columnSizingFeature numeric size, minSize, maxSize, getSize, getStart, getAfter, and total-size APIs in table, grid, or flex CSS. Load for auto or percentage misconceptions and sizing/pinning layout mismatch."
  - id: "@tanstack/table-core#column-visibility"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#column-visibility"
    for: "Hide columns with columnVisibilityFeature while rendering visibility-aware header, column, and cell collections. Load when hidden columns remain in the DOM, false-versus-absent state is confused, or enableHiding is misunderstood."
  - id: "@tanstack/table-core#core"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#core"
    for: "Use TanStack Table v9 as a headless data-grid state and row-processing engine. Load for first-table architecture, stable data and columns, row numbering with getDisplayIndex, semantic rendering, framework adapter choice, or deciding what Table owns versus the renderer."
  - id: "@tanstack/table-core#custom-features"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#custom-features"
    for: "Author a TanStack Table v9 feature plugin across every FeatureMap and API installation surface: state, options, column definitions, table, column, row, cell, header, row-model functions/caches, defaults, prototypes, and table/row/column instance data lifecycles. Load for initTableInstanceData, resetTableInstanceData, constructTableAPIs, or reusable behavior not covered by built-ins, meta, or option composition."
  - id: "@tanstack/table-core#expanding"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#expanding"
    for: "Expand hierarchical subrows or custom detail panels with rowExpandingFeature, expandedRowModel, getSubRows, getRowCanExpand, manualExpanding, and paginateExpandedRows. Load when expansion state changes but no UI appears."
  - id: "@tanstack/table-core#global-filtering"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#global-filtering"
    for: "Apply globalFilter across eligible columns with globalFilteringFeature, columnFilteringFeature, filteredRowModel, globalFilterFn, and manual server filtering. Load when columns unexpectedly participate or a global filter changes state without changing rows."
  - id: "@tanstack/table-core#grouping"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#grouping"
    for: "Group rows with columnGroupingFeature, groupedRowModel, groupedColumnMode, and manualGrouping. Load for grouped or placeholder cells and grouping interactions with expansion or pagination."
  - id: "@tanstack/table-core#migrate-v8-to-v9"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#migrate-v8-to-v9"
    for: "Perform a complete TanStack Table v8-to-v9 migration audit: feature registration, row-model and function-registry slots, state/store changes, prototype methods, column pinning and resizing renames, sorting and selection semantics, removed internals, helpers, meta typing, and generic changes. Load this shared inventory before the installed framework adapter's migration skill."
  - id: "@tanstack/table-core#pagination"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#pagination"
    for: "Paginate with rowPaginationFeature and paginatedRowModel or manualPagination. Load for pageIndex/pageSize state, rowCount/pageCount, unknown next-page limits, already-paginated server data, or autoResetPageIndex surprises."
  - id: "@tanstack/table-core#row-pinning"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#row-pinning"
    for: "Pin stable row IDs into top, center, and bottom collections with rowPinningFeature and keepPinnedRows. Load for filtering/pagination visibility, explicit region rendering, or renderer-owned sticky CSS."
  - id: "@tanstack/table-core#row-selection"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#row-selection"
    for: "Maintain rowSelection ID state with stable getRowId, single, multi, subrow, and Shift-range rules, selected row models, handler anchors, and manual-pagination semantics. Load when implementing getToggleSelectedHandler, enableRowRangeSelection, selectChildren, deselectParents, or selected IDs that outlive loaded Row objects."
  - id: "@tanstack/table-core#sorting"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#sorting"
    for: "Sort with rowSortingFeature, sortedRowModel, sortFns, multi-sort and removal options, sortUndefined, and manualSorting. Load for comparator direction, incoming server order, or product-specific sorting cycles."
  - id: "@tanstack/table-core#table-features"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#table-features"
    for: "Register TanStack Table v9 tableFeatures, feature plugins, create*RowModel factories, and function registries in prerequisite order. Load when an option, state slice, or instance API is missing, or when choosing explicit features versus stockFeatures."
  - id: "@tanstack/table-core#typescript"
    run: "bunx @tanstack/intent@latest load @tanstack/table-core#typescript"
    for: "Preserve TanStack Table v9 inference with createColumnHelper, columns(), tableOptions, tableFeatures, and metaHelper. Load for ColumnDef errors, reusable tables, typed meta, named registries, or unnecessary manual feature generics."
  - id: "@tanstack/virtual-file-routes#virtual-file-routes"
    run: "bunx @tanstack/intent@latest load @tanstack/virtual-file-routes#virtual-file-routes"
    for: "Programmatic route tree building as an alternative to filesystem conventions: rootRoute, index, route, layout, physical, defineVirtualSubtreeConfig. Use with TanStack Router plugin's virtualRouteConfig option."
  - id: "better-near-auth#auth-plugin"
    run: "bunx @tanstack/intent@latest load better-near-auth#auth-plugin"
    for: "Mount and consume the @everything-dev/auth-plugin in an everything-dev or every-plugin project. Register it in bos.config.json, wire the Better Auth client into the UI with siwnClient/passkey/API-key/organization plugins, protect routes with session checks, compose with the auth plugin in-process via createPlugin.withPlugins, and use the auth context (getContext) in your own oRPC middleware. Sub-account creation is supported in bos.config.json for scalar fields (parentHasFullAccess, minDeposit, deploy.fromPublished, init with static args). Load when adding auth to an everything.dev app, configuring SIWN recipients from runtime config, calling auth endpoints from another plugin, or debugging auth context resolution. As of better-near-auth 1.8.2 the client uses getNearClient() (not .client) and signIn.near / near.link refresh the session atomically."
  - id: "better-near-auth#client"
    run: "bunx @tanstack/intent@latest load better-near-auth#client"
    for: "Set up the siwnClient plugin for Better Auth client, configure NEAR wallet connection via NearConnect, use authClient.near actions for sign-in, profile lookup, account management, delegate action building with TransactionBuilder, and relay submission. Load when implementing NEAR wallet sign-in on the client, using authClient.near.* methods, or building delegate actions for gasless relay."
  - id: "better-near-auth#relay"
    run: "bunx @tanstack/intent@latest load better-near-auth#relay"
    for: "Configure the gasless NEP-366 delegate action relayer in ephemeral or explicit mode, relay signed delegate actions on-chain, enforce contract whitelisting and gas/deposit limits, check relay status and history, and use the contract view endpoint. Load when setting up relayer config or debugging relay failures."
  - id: "better-near-auth#siwn"
    run: "bunx @tanstack/intent@latest load better-near-auth#siwn"
    for: "Set up the SIWN server plugin for Better Auth, configure NEP-413 authentication with recipient and API key, handle nonce generation, signature verification, account linking and unlinking, and NEAR profile lookup. Load when adding NEAR wallet sign-in to a Better Auth server, configuring siwn() plugin options, or debugging NEP-413 verify or nonce issues."
  - id: "better-near-auth#subaccount"
    run: "bunx @tanstack/intent@latest load better-near-auth#subaccount"
    for: "Configure sub-account creation with parent ownership, contract deployment, init calls, composable transaction hooks, and lifecycle callbacks with automatic rollback. Load when setting up subAccount config, deploying contracts to new sub-accounts, or handling post-creation side effects. Sub-account creation surface has been stable since 1.7.0; the 1.8.x client improvements (getNearClient, detectNearAccount, session-signal notify) do not change the createSubAccount / checkSubAccountAvailability endpoints."
  - id: "better-near-auth#tanstack"
    run: "bunx @tanstack/intent@latest load better-near-auth#tanstack"
    for: "Integrate better-near-auth with TanStack Router (SSR or CSR). Set up auth client as a router context singleton, useAuthClient hook, session query options, inferred types from AuthClient, and ensureConnected before signing. Load when scaffolding a new TanStack Router app with better-near-auth, wiring auth into router context, or debugging wallet state loss after sign-in in SSR/CSR TanStack apps."
  - id: "dotenv#dotenv"
    run: "bunx @tanstack/intent@latest load dotenv#dotenv"
    for: "Load environment variables from a .env file into process.env for Node.js applications. Use when configuring apps with secrets, setting up local development environments, managing API keys and database uRLs, parsing .env file contents, or populating environment variables programmatically. Always use this skill when the user mentions .env, even for simple tasks like \"set up dotenv\" — the skill contains critical gotchas (encrypted keys, variable expansion, command substitution) that prevent common production issues."
  - id: "dotenv#dotenvx"
    run: "bunx @tanstack/intent@latest load dotenv#dotenvx"
    for: "Use dotenvx to run commands with environment variables, manage multiple .env files, expand variables, and encrypt env files for safe commits and CI/CD."
  - id: "every-plugin#plugin-client"
    run: "bunx @tanstack/intent@latest load every-plugin#plugin-client"
    for: "Connect to and consume deployed everything.dev plugins from an external app, child project, or script. Use when creating API/auth clients, reading runtime config, authenticating with API keys or sessions, or calling plugin routes programmatically."
  - id: "every-plugin#plugin-development"
    run: "bunx @tanstack/intent@latest load every-plugin#plugin-development"
    for: "Build every-plugin modules with oRPC contracts, Effect services, and Module Federation. Use when creating or modifying plugins under plugins/ or the _template scaffold."
  - id: "every-plugin#plugin-testing"
    run: "bunx @tanstack/intent@latest load every-plugin#plugin-testing"
    for: "Test every-plugin modules with vitest and the plugin runtime. Use when writing or modifying plugin tests under plugins/*/src/__tests__/ or plugins/*/tests/."
  - id: "everything-dev#api-and-auth"
    run: "bunx @tanstack/intent@latest load everything-dev#api-and-auth"
    for: "API architecture, oRPC contracts, auth middleware, plugin-client composition, session handling, and client-side auth. Use when adding API routes, creating middleware, calling other plugins in-process, or integrating auth in routes and UI."
  - id: "everything-dev#cli-reference"
    run: "bunx @tanstack/intent@latest load everything-dev#cli-reference"
    for: "Quick reference for all bos CLI commands — flags, options, environment settings, and links to detailed guidance in related skills. Use when any bos command comes up or the user needs a CLI overview."
  - id: "everything-dev#code-style"
    run: "bunx @tanstack/intent@latest load everything-dev#code-style"
    for: "Code style conventions for everything-dev projects — component file naming (kebab-case, lowercase), CSS (semantic Tailwind only, no hardcoded colors), no comments in implementation, import/export conventions, and following neighboring file patterns."
  - id: "everything-dev#dev-workflow"
    run: "bunx @tanstack/intent@latest load everything-dev#dev-workflow"
    for: "Development workflow for everything-dev projects using bos dev, bos start, and the Module Federation runtime. Use when starting dev servers, debugging hot reload, or understanding the service-descriptor architecture."
  - id: "everything-dev#extends-config"
    run: "bunx @tanstack/intent@latest load everything-dev#extends-config"
    for: "How bos.config.json extends chains work, deep merge semantics, resolved config lifecycle, env-specific extends, and canonical field ordering. Use when debugging extends inheritance, configuring per-environment parents, understanding what dev writes vs publish writes, or reasoning about config merging."
  - id: "everything-dev#init-upgrade"
    run: "bunx @tanstack/intent@latest load everything-dev#init-upgrade"
    for: "bos init, bos sync, and bos upgrade workflows — template download, snapshot-based conflict detection, package version bumps, and how init/sync select and own files. Use when scaffolding new projects, syncing upstream changes, or upgrading framework packages."
  - id: "everything-dev#plugin-development"
    run: "bunx @tanstack/intent@latest load everything-dev#plugin-development"
    for: "Build, register, and deploy plugins within everything.dev. Covers the _template scaffold, contract/service/index pattern, database setup with Drizzle, bos.config.json registration, plugin UI/sidebar, and CLI workflow. Use when creating new plugins, adding database-backed routes, or deploying plugins to production."
  - id: "everything-dev#publish-sync"
    run: "bunx @tanstack/intent@latest load everything-dev#publish-sync"
    for: "Publish bos.config.json to the FastKV registry, sync from upstream, and upgrade workspace packages. Use when deploying, syncing, or managing runtime configuration across projects."
  - id: "everything-dev#registry"
    run: "bunx @tanstack/intent@latest load everything-dev#registry"
    for: "Read and write the FastKV config registry efficiently — key layout, namespace=signer semantics, integrity, and composing published runtimes into local bos.config.json. Use when publishing configs, composing another runtime's UI/host/api/plugins, or debugging why a published config doesn't resolve."
  - id: "everything-dev#super-app"
    run: "bunx @tanstack/intent@latest load everything-dev#super-app"
    for: "Build shared-host, shared-API super apps with tenant-specific UI composition. Use when setting up a base runtime plus custom tenant apps, configuring fixed-core multi-tenancy, reasoning about extends-based runtime lineage, or deciding what tenants can override today."
  - id: "everything-dev#ui-integration"
    run: "bunx @tanstack/intent@latest load everything-dev#ui-integration"
    for: "Route creation, API client usage, auth client, SSR hydration, sidebar system, and the @/app module surface. Use when adding new UI routes, fetching data from the API, implementing auth flows, or customizing sidebar navigation."
<!-- intent-skills:end -->

# Agent Instructions

This document provides operational guidance for AI agents working in the parent `everything.dev` repository.

## Quick Reference

**Start Development:**
```bash
bun install
bun run dev

# bos dev creates .env from .env.example on first run (with a generated BETTER_AUTH_SECRET)
# and auto-starts docker compose when the DB preflight finds local Postgres down.
# Or combined: bun run dev:postgres  ==  docker compose up -d --wait && bun run dev

# Pin individual service ports (explicitly-passed flags are pinned; unset services derive from the base; only explicit choices persist in .bos/infra-state.json — see ADR 0012)
bos dev --port 3100 --api-port 3101 --ui-port 3103 --auth-port 3102 --plugin-port-start 3110
```

`docker-compose.yml` is committed and provisions four Postgres 17 services — two for dev, two for tests:
- `postgres-api` (port 5432, db `api_db`) — shared by the API and all local plugins; each plugin isolates its tables in a `plugin_<pluginId>` schema (set via `search_path` on every connection, see `api/src/db/layer.ts`).
- `postgres-auth` (port 5433, db `auth_db`) — auth database.
- `postgres-api-test` (port 5434, db `api_test_db`) — test-only API/plugin database.
- `postgres-auth-test` (port 5435, db `auth_test_db`) — test-only auth database.

**Dev/test isolation:** a committed `.env.test` (generated alongside `.env.example` and `docker-compose.yml` by `bos dev`) maps every `*_DATABASE_URL` and `BETTER_AUTH_SECRET` to the test databases. Test suites load `.env.test` instead of `.env`: the regression stack (`tests/regression/lib/start-stack.mjs`) injects it into spawned stacks, `tests/regression/lib/regression-env.mjs` resolves it with fail-fast guards that refuse to run against dev URLs or the dev auth secret (override deliberately with `REGRESSION_ALLOW_DEV_DB=1`), and api unit/integration tests pin to in-memory pglite unless `TEST_DATABASE=postgres` opts into `.env.test`. Start the test databases with `bun run test:db:up` (or `bun run test:db:reset` for a clean slate).

The API and plugins auto-apply migrations on boot, so `bun db:migrate` is optional (use it to migrate without starting the dev server). `bun run dev` runs `bos dev`'s preflight, which probes the localhost DB ports and — when every failure is a down local service, `docker-compose.yml` exists, docker is reachable, and it is not a test-mode stack — starts the compose services itself (`docker compose up -d --wait`) and re-probes once before failing. Test-mode stacks (`NODE_ENV=test` / `BOS_TEST=1` / `BOS_NO_PERSIST_PORTS=1`) never auto-start compose. Bootstrap-phase INFO logs (e.g. `[env] ... updated` port-drift lines) are suppressed on the console by default — pass `--log-level info` (or set `BOS_LOG_LEVEL` / `DEBUG=1`) to see them; warnings and errors always print.

Port allocation is atomic block allocation (ADR 0012): the layout derives deterministically from one base port (`--port N` → api N+1, auth N+2, ui N+3, plugins N+10+), the whole block is validated before anything spawns, and only explicitly-passed port flags persist to `.bos/infra-state.json` under `devPorts` (drift is never persisted — a busy block moves +100 with a prominent notice naming the holders, and restarts re-try the preferred base). Explicitly-passed flags are pinned: if that exact port is occupied, allocation fails loudly instead of silently moving. `bos kill` escalates SIGTERM → 5s → SIGKILL, reaps orphaned children of dead sessions, and verifies ports actually freed; new sessions adopt-and-reap orphaned children from dead same-project sessions at boot. Test-spawned stacks never persist ports (`BOS_NO_PERSIST_PORTS=1`, plus `NODE_ENV=test` / `BOS_TEST=1` are honored), so test runs can never repin your dev ports.
`CORS_ORIGIN` in `.env.example` is derived from the actual resolved host port in development.
A global PID registry at `~/.cache/everything-dev/pids.json` tracks running `bos dev` sessions.

**Builds — the train is the build path:**
```bash
bun run build          # bos build — all workspaces (staleness-checked prerequisites first)
bun run build ui       # bos build ui — one target + fresh prerequisites
bun run deploy         # bos deploy — the full deploy train (also runs on merge, via CI)
```
`bun run build <targets>` first gives every target's local workspace dependencies fresh dists — the prerequisite graph is derived from each workspace's declared `dependencies`/`devDependencies` resolved against the bun workspace members (`every-plugin`, `everything-dev`, `better-near-auth` for `ui`), staleness-checked per member and cheap no-ops when fresh; failures are loud (ADR 0022). Raw per-workspace builds (`cd ui && bun run build`) bypass the prerequisite train and are unsupported — use the train.

Two resolution rules keep this safe (ADR 0018): **bundler-configuration code resolves from source** — `every-plugin/build/ui` and `every-plugin/build/rspack` (the generated plugin configs' factories) resolve `src` in every condition, so the config chain cannot go stale; **shipped code resolves from dist** — runtime subpaths (`everything-dev/ui/auth`, `db`, …) resolve built dists, whose freshness the prerequisite train guarantees.

**Dev overlays (`bos.dev.ts`):** authored config lives in `bos.app.ts` (published); dev-only overrides live in `bos.dev.ts` (optional, child-wins merged over the resolved config when the environment is development, **never published** — same role as `.env` vs `.env.example` at the config level). Each unit gets the pair; `plugin.dev.ts` is the legacy name being retired. The app root (the directory holding the `bos.app.ts`/`bos.dev.ts` pair) is distinct from the bun workspace root — see ADR 0022 for the two-roots model and which CLI concerns anchor to which root.

**Sync and Publish:**
```bash
bos sync              # Pull updates from published config/template state
bos upgrade           # Check for new versions, update, then sync
bos publish           # Re-publish bos.config.json to the FastKV registry (config-only, no build)
bos deploy            # Full train: preflight → build → upload bundles → publish config → image → Railway
```

**Check Status:**
```bash
bos ps        # List tracked development processes (PID, role, ports, age)
bos kill      # SIGTERM processes owned by the cwd
bos kill --all              # SIGTERM across all config directories
bos kill --signal SIGKILL    # Force kill
bos status    # Project health check
bos config    # Show configuration
```

## Architecture

This is the parent **Module Federation monorepo** for `everything.dev`. The host is in this repository under `host/`. You may work across `/host`, `/ui`, `/api`, `/plugins`, and `/packages`.

```
┌─────────────────────────────────────────────────────────┐
│                    Host (Server)                        │
│  - Hono.js + oRPC router                               │
│  - Runtime config loader (authored bos.app.ts)          │
│  - Module Federation host                               │
│  - every-plugin runtime                                │
└─────────────────────────────────────────────────────────┘
            ↓                ↓                ↓
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│       UI         │ │  Auth Plugin     │ │  API + Plugins   │
│  - React 19      │ │  - every-plugin  │ │  - every-plugin  │
│  - TanStack      │ │  - Better-Auth   │ │  - oRPC contract │
│  - Module Fed.   │ │  - NEAR SIWN     │ │  - Effect svc    │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

The host loads UI and API at runtime from URLs in the authored config (`bos.app.ts`), published to the FastKV registry by `bos publish`/`bos deploy`. In production today, the host still boots one base `RuntimeConfig` snapshot at startup, but it can resolve tenant-specific UI overrides per request while keeping the server core fixed.

### Runtime Config

Authored configuration lives in `bos.app.ts` (committed); the resolved `bos.config.json` is generated under `.bos/` and never committed. The UI reads `window.__RUNTIME_CONFIG__` to get account, gateway, API base URL, etc. The host uses the same config to wire Module Federation remotes, auth, plugins, and SSR.

Use these helpers from `@/app`:
- `getAppName()` — active runtime title (falls back to account)
- `getAccount()` — NEAR account from config
- `getRepository()` — repository URL from config
- `getActiveRuntime()` — active runtime info (accountId, gatewayId, title)
- `getRuntimeConfig()` — full client config

Important: fixed-core tenant runtime composition now lives primarily in:
- `host/src/services/tenant-runtime.ts`
- `host/src/program.ts`
- `host/src/services/federation.server.ts`

Tenant model:
- `extends` is the lineage edge between runtimes
- `account` is the tenant namespace root for the active runtime
- `domain` is the public ingress for that runtime
- a runtime can extend another runtime and still become a new tenant root on its own domain

Current fixed-core host rules:
- the shared host still boots once from one base runtime snapshot
- child runtime config must extend the active BOS runtime
- supported request-scoped overrides are `ui` and existing `plugins.<id>.ui`
- tenant SSR is gated per-tenant by the `allowSsr` column on the tenant record; the host's BindingResolver reads permissions from the API's `GET /tenants/bindings` endpoint (cached for 30s)
- nested label routing and account-relative tenant derivation are the intended architecture direction, but not the complete resolver behavior today

For full per-request host/plugin/auth/api swapping, see `plans/` for design docs.

## Development Workflow

### Typical Session
1. `bun run dev` to start development
2. UI available at http://localhost:3003, API at http://localhost:3001, Auth at http://localhost:3002
3. Check `.bos/logs/` for process logs if issues occur
4. Use `bos kill` to clean up processes when done

### Debugging Issues

**API not responding:**
- Check `bos ps` to see if API process is running
- Check `.bos/logs/api.log` for errors

**UI not loading:**
- Verify host is running: `bos ps`
- Check browser console for Module Federation errors
- Clear browser cache and retry

**Type errors:**
- Run `bun typecheck`
- Effect-rule diagnostics (floating effects, tag Self mismatches, …) come from `bun run lint:effect` (oxlint type-aware) — run it when `tsc` is clean but Effect lint flags something
- Ensure `api/src/contract.ts` is in sync with UI usage

### Self-Deployed Development

You don't need to wait for a PR to merge and run through CI/CD to see your changes in production. The architecture supports independent self-deployment: publish your own config on-chain under your own NEAR account and run your own host instance, all while inheriting the base platform via `extends`.

**Local dev (no NEAR account needed):**

```bash
bun run dev    # hot reload, all services local
```

**Runtime tiers (ADR 0020/0021):**

| Tier | Instance | Bundle bytes |
|------|----------|--------------|
| Root runtime (`everything.dev`) | the universal image (`ghcr.io/nearbuilders/everything-dev`), self-contained tier | image stages the boot namespace (`BOS_BUNDLE_DIR`); distribution serves from the CDN (`cdn.everything.dev`) |
| `*.<root>` — shared-host tenants | no instance — the root host resolves them per-request via `BindingResolver` | base workspaces from the root; own UI overrides from the CDN |
| `.<child-domain>` — own instance | the universal image with `BOS_ACCOUNT`/`BOS_GATEWAY` set (registry tier, auto-detected) | host/api/auth logic fetched from the base; own workspaces uploaded to the base storage at publish |
| Sandbox (`*.*.<child>`) | plan 032 — platform image on provisioned machines, dists staged into the instance | staged at runtime from the same store |

One image, published by the root to GHCR; children never ship images. `BOS_BUNDLE_DIR` identity mismatches auto-degrade to registry tier (network fetch + stale-if-error cache via `BOS_BUNDLE_CACHE_DIR`) — never 404.

**Self-deployed production (step-by-step):**

1. **Install near-cli-rs** (needed for account management and `bos key generate`; `bos publish` signs via near-kit, falling back to the near-cli-rs OS keychain for local interactive use):
   ```bash
   curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/download/v0.23.5/near-cli-rs-installer.sh | sh
   near --version    # verify
   ```

2. **Create a NEAR account** via near-cli-rs (testnet for experimentation, mainnet for production). Named accounts (e.g. `myorg.near`) can own subaccounts; implicit hex accounts cannot:
   ```bash
   near account create-account fund-my-account <your-account>.testnet use-faucet network-config testnet
   # or for mainnet, fund via a wallet transfer
   ```

3. **Generate a publish access key** — a function-call key scoped to the FastKV registry contract (`__fastdata_kv` on `dev.everything.near`). This is the key that signs `bos publish` transactions:
   ```bash
   bos key generate
   # Output includes: NEAR_PRIVATE_KEY=ed25519:...
   ```
   Add the key to your account via near-cli-rs (interactive keychain signing). Then set `NEAR_PRIVATE_KEY` in your `.env` or CI secrets.

4. **Update `bos.config.json`** — set `account` to your NEAR account and add `extends` to inherit the base platform:
   ```json
   {
     "extends": "bos://v1.citynode.near/citynode.app",
     "account": "<your-account>.near",
     "domain": "citynode.app"
   }
   ```
   Keep `domain` as `citynode.app` (the gateway). See "Same gateway, own account" below.

5. **Deploy:**
   ```bash
   bos deploy
   # preflight (fail fast on config/signing/storage credentials) → build →
   # upload your workspaces to the base storage (POST /api/storage/bundles,
   # account-pinned) → write bundle URLs at the CDN origin (cdn.everything.dev)
   # → publish bos.config.json to FastKV at bos://<your-account>/citynode.app
   # → build + push the runtime image and deploy it to Railway when configured
   ```
   No CDN provider account — the base runtime stores and serves your bytes; you inherit host/api/auth logic from the base's own bundles. Upload credentials come from `BOS_STORAGE_API_KEY` or a `bos login` session (mint once with `bos login --key`, then put the printed key in GitHub repo secrets as `BOS_STORAGE_API_KEY` for CI; the device-flow session works for interactive deploys). See ADR 0020 for the storage design. (Without a CDN origin the deploy stays image-native and writes gateway URLs — the flip is the `BOS_BUNDLE_CDN_ORIGIN`/`BOS_STORAGE_ORIGIN` env pair.)
   The runtime image leg resolves the image name from `ci.image` in `bos.config.json` → `BOS_IMAGE` env → derived from `repository` (`ghcr.io/<owner>/<repo>`); it only runs when docker is available. The first `bos deploy` populates the R2 bucket for the first time — the committed `cdn.everything.dev` bundle URLs become true only once that run completes.

6. **Run the universal image** — pull `ghcr.io/nearbuilders/everything-dev` (Railway: one-click template or `railway up`; the deploy train deploys the pushed SHA tag). No image build of your own — ever. Set these environment variables on your instance:
   | Variable | Value |
   |----------|-------|
   | `BOS_ACCOUNT` | `<your-account>.near` |
   | `BOS_GATEWAY` | `citynode.app` |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |

7. **Your instance boots** `bos start`, fetches your published config from FastKV at `bos://<your-account>/citynode.app`, loads host/api/auth logic from the base's bundles (stale-if-error cached under `BOS_BUNDLE_CACHE_DIR`), and serves your version live at the Railway-assigned URL. Changes take minutes, not hours.

**Same gateway, own account:**

`BOS_GATEWAY` (`domain` in `bos.config.json`) is the **FastKV lookup key**, not the DNS domain your Railway instance serves on. By keeping `BOS_GATEWAY=citynode.app` while using your own `BOS_ACCOUNT`, your config lives at a separate FastKV path (`bos://<your-account>/citynode.app`) that `extends` the base runtime (`bos://v1.citynode.near/citynode.app`). You inherit the full platform — host, API, auth, plugins — and override only what you change. Your Railway URL is the ingress; point your own domain's DNS at it if you want a custom domain.

**near-cli-rs quick reference:**

| Command | Purpose |
|---------|---------|
| `near account create-account fund-my-account <id> ...` | Create a new NEAR account |
| `near account list-keys <id> network-config <net> now` | List access keys on an account |
| `near account add-key <id> grant-function-call-access ...` | Add a function-call access key (used by `bos key generate`) |
| `near account delete-keys <id> public-keys <keys> ...` | Remove access keys |
| `near account export-account <id> explicitly-provide-private-key ...` | Export a full access key |
| `near contract call-function as-transaction <contract> <method> ...` | Submit a contract call (used internally by `bos key generate`; `bos publish` signs in-process via near-kit) |

The `bos` CLI wraps near-cli-rs for account and key management — you normally don't invoke `near` directly except for account creation and key export. `bos publish` signs its transaction in-process via near-kit; `bos key generate` handles publish-key minting.

## Code Changes

### Making Changes
- **Host Changes**: Edit `host/src/` when changing runtime resolution, auth wiring, SSR, proxying, or plugin mounting
- **UI Changes**: Edit `ui/src/` files → hot reload automatically
- **API Changes**: Edit `api/src/` files → hot reload automatically
- **CLI/Scaffolding Changes**: Edit `packages/everything-dev/` when changing init/dev/publish flows or child-project scaffolding
- **New Components**: Create in `ui/src/components/ui/`, export from `ui/src/components/index.ts`
- **New Routes**: Create file in `ui/src/routes/`, TanStack Router auto-generates tree

### Style Requirements
- Use semantic Tailwind classes: `bg-background`, `text-foreground`, `text-muted-foreground`
- No hardcoded colors like `bg-blue-600`
- No code comments in implementation
- Component file naming: lowercase kebab-case (`data-table.tsx`, `user-profile.tsx`)
- File/directory naming: kebab-case for all files and directories
- Follow existing patterns in neighboring files

### Adding API Endpoints
App-level routes live in the slim `api/` plugin shell; feature routes live in
their plugins. For the api shell:
1. Define in `api/src/contract.ts` — the oRPC route definitions and Zod schemas
2. Implement in `api/src/index.ts` — the `createPlugin` router
3. Use in UI via `apiClient` from `useApiClient()` in `@/app`

**Handler convention (required for new routes):** write handlers as Effect-native
`.effect(function* ...)` generators (see `plugins/_template/src/index.ts`) and access
services with `yield* Tag` — the tag must be exposed from the plugin's returned
`initialize` layer. Auth checks fail via `Effect.fail(errors.UNAUTHORIZED(...))` /
`errors.FORBIDDEN(...)` inside the generator (note: the shared `every-plugin/errors`
shapes constrain the `data` payload — e.g. `UNAUTHORIZED` requires
`{ apiKeyProvided: boolean }`, all-optional shapes still need explicit `data: {}`).
`Context.get(context["effect/context"], Tag)` is reserved for streaming
(async-generator) handlers. Do not introduce new plain `.handler(async)` routes with
inline `Context.get` service access, and do not use the `createAuthMiddleware`
middlewares via `.use()` for new routes — their `DecoratedMiddleware` typing does not
currently compose with the `.use()` builder (see proposals plugin's local middleware
for the workaround pattern).

### Plugin Architecture

Business logic is organized into independent plugins loaded via Module Federation. A plugin entry in `bos.config.json` can be **remote-only** (no `development: local:…` key) — the host/API consume it via `pluginsClient` and HTTP, and types resolve from the deployed manifest (see "Generated types" below). Plugin source does not need to live in this repo.
- **`api/`** — Slim API shell scaffolded from the advanced starter: ping/error routes + DB layer
- **`plugins/registry/`** — Registry/discovery, FastKV app metadata (local in dev)
- **`plugins/_template/`** — Scaffold for creating new plugins
- **`plugins/auth/`** — Local auth plugin (Better-Auth, NEAR SIWN, organizations, API keys, passkeys)
- **`plugins/proposals/`** — Proposal lifecycle (local)
- **`plugins/votes/`** — Voting feed (local)
- **`plugins/ai/`** — OpenAI-compatible chat (local)

Each plugin is self-contained with its own:
- `contract.ts` — oRPC route definitions and Zod schemas
- `index.ts` — `createPlugin` with variables, secrets, context, router
- 3-line rspack config composed from `every-plugin` defaults (docs/adr/0002); builds/scripts run via the `every-plugin` CLI (docs/adr/0003)

The UI accesses plugin routes via namespaced clients: `apiClient.registry.listRegistryApps()`, etc.

**Scoped resources**: `initialize` returns an Effect `Layer` — the runtime builds it against the plugin's lifecycle scope, so scoped resources (database pools, repository layers, caches, publishers) release when the plugin shuts down. Build scoped services with `buildScoped(tag, layer)` (or `buildScopedContext(layer)` for multi-service layers) from `"every-plugin"` inside `initialize`; resources release when the plugin shuts down. Compose dependent layers with `Layer.mergeAll(...).pipe(Layer.provide(dep))` and return the result (do not build/extract them in plugin code). Do not use `Effect.provide(Tag, Layer.effect(...))` for persistent dependencies — it creates a transient scope that releases the resource immediately. Handlers access services via the injected oRPC context: `yield* Tag` in `.effect()` generator handlers, or `Context.get(context["effect/context"], Tag)` in plain async and streaming (async-generator) handlers. Services use `Context.Service<Self, Shape>()("id")` class tags (Effect 4 removed `Context.Tag`). `shutdown` is gone — teardown lives in Layer finalizers. To expose services to the host (outside oRPC), set `servicesTag` on the plugin definition.

### Plugin Client (pluginsClient)

The API plugin receives typed entries for all other plugins via `createPlugin.withPlugins<PluginsClient>()` — each entry carries `{ client, router }` (a client factory plus the raw implemented router for cross-plugin merging), enabling in-process composition without HTTP roundtrips.

**Two-phase loading**: The host loads non-API plugins first (Phase 1), creates a `pluginsClient` map, then loads the API with that map injected (Phase 2). The host is generic — no plugin-specific code.

**Generated types**: `api/src/lib/plugins-types.gen.ts`, `api/src/lib/auth-types.gen.ts`, `ui/src/lib/api-types.gen.ts`, and `ui/src/lib/auth-types.gen.ts` are generated by `bos types gen` from `bos.config.json`. These files are gitignored and auto-regenerated by `bos typecheck` (which generates before type-checking), `bos dev`, `bos build`, and `bos pluginAdd`/`pluginRemove` — `bun typecheck` is self-sufficient, no separate generation step needed.

Plugin types resolve in two ways:
- `local:plugins/<name>` → reads `src/contract.ts` directly from disk
- Remote URL → fetches bundled types from the deployed plugin manifest

If you hand-edit `bos.config.json`, run `bos types gen` or restart `bos dev` to regenerate.

**Contract declarations** (the per-plugin `types/contract.d.ts` published in `plugin.manifest.json`) are generated inside `every-plugin build`/`deploy`/`dev` itself — the rspack `EmitPluginManifest` hook regenerates whenever `src/contract.ts` is newer than the emitted file (patched TS 7 binary, explicit flags, no config file). `every-plugin types` forces regeneration manually. There is no `tsconfig.contract.json` anywhere and `bos sync` no longer ships one.

## Parent vs Child

This repo is the parent platform, not a generated child project.

- Prefer changing `host/` and `packages/everything-dev/` when the request is about runtime resolution, domain routing, config loading, CLI behavior, or scaffolding.
- Prefer changing child project repos when the request is about project-specific content, shell navigation, or app-specific plugin composition.
- Do not assume the host is remote-only or out of tree; that is true for many child repos, not for this one.

## Changesets

**When to add a changeset:**
- Any user-facing change (features, fixes, deprecations)
- Breaking changes
- Skip for: docs-only changes, internal refactors, test-only changes

**Release flow:**
- CI is the validation workflow. On successful push to `main`, the Deploy workflow triggers automatically via `workflow_run` and checks out the exact SHA CI validated.
- `release.yml` is manual (`workflow_dispatch`): it consumes changesets, creates the `chore: version packages` PR when pending, and publishes to npm when no changesets remain.
- `deploy.yml` runs `bun run bos deploy` — the single command runs the whole train: preflight (config/signing/storage credentials, fail fast before any build), workspace builds, bundle upload to the R2-backed storage, FastKV publish with read-back confirmation, the `runtime` image stage pushed to GHCR by SHA + `latest` tags (`ci.image` in `bos.config.json`), and a pull-only Railway deploy pinned to the pushed digest (generated thin `FROM <image>@sha256:<digest>` Dockerfile — ADR 0021). Nothing is committed back — the runtime fetches the published config from FastKV.
- Generated child repos use a simpler flow: both Release and Deploy trigger directly from CI success via `workflow_run` (no npm publish, no Docker).

**Create changeset:**
```bash
bun run changeset
# Follow prompts to select packages and describe changes
```

## Testing & Quality

**Before committing:**
```bash
bun run test    # Run all tests (root script — NOT `bun test`, which uses Bun's native runner)
bun typecheck   # Type check all packages (TS 7 native, ~4-6x faster than the TS 5.9 tsc it replaced)
bun lint        # Run linting (Biome format/style + Effect rules via `bun run lint:effect`)
```

Host tests specifically use vitest via the workspace script:
```bash
bun run --cwd host test    # NODE_ENV=production vitest run
```
Always use `bun run test` / `bun run --cwd host test` — never `bun test`, which invokes Bun's built-in runner and produces different (and misleading) results.

### Test value rules

- **Never write tautology tests.** Don't assert a mock returns what it was configured to return, don't spy on trivial wrappers/loaders to assert call arguments, and don't render mocked data to assert it appears.
- **Prefer E2E for user-observable behavior.** Add browser regression specs under `tests/regression/browser/` (data-testid selectors per the conventions above; end specs with a verifiable, repeatable artifact — a Playwright trace).
- **Unit tests are reserved for what E2E can't reach:** crypto/protocol verification, pure state machines and calculation logic, fault injection, DB/migration behavior, CLI contracts. Before writing one, write down the failure modes first, then test exactly those.

## Effect DevTools

The repo standardizes on the Effect v4 dev toolchain ([docs](https://effect.website/docs/v4/getting-started/devtools)):

- **TypeScript 7 (native, Go port) + Effect LSP** — `typescript` is `^7` in the catalog. `@effect/tsgo` is a root devDependency; `bun install` runs `prepare: effect-tsgo patch --oxlint`, which patches the native `tsc` and Oxlint with Effect diagnostics. Every workspace tsconfig enables the language-service plugin with `diagnostics: false` (Oxlint reports Effect rules to avoid duplication; `tsc --noEmit` still surfaces them as regular TS diagnostics).
- **Effect lint** — `bun lint` = Biome (format/style) + `bun run lint:effect` (`oxlint --type-aware`, Effect rules from `@effect/tsgo`'s recommended preset in `.oxlintrc.json`; CI runs the same script). "Effect parity" rules that demand rewriting imperative code (`node-builtin-import`, `async-function`, `global-console`, `process-env`, `global-date`, `global-fetch`, `new-promise`, `crypto-random-uuid`, `global-timers`, `global-random`) are intentionally off — this is a mixed Effect/non-Effect codebase. Note `node-builtin-import`, `async-function`, and `new-promise` have no `-in-effect` variants in the preset, so turning them off removes even in-Effect coverage for those. Rules that are **errors** must be fixed in code, not suppressed.
- **CI** — because CI installs with `--ignore-scripts`, the `lint-and-typecheck` job runs `bun run prepare` explicitly before lint/typecheck. `oxlint` and `oxlint-tsgolint` are version-locked to `@effect/tsgo` (e.g. tsgo 0.45.0 supports exactly oxlint 1.81/1.82 and oxlint-tsgolint 7.0.2001) — bump all three **together**; a Renovate/renovate-style PR bumping one alone breaks the `prepare` patch and must be rejected.
- **Editor** — install the Effect VS Code/Cursor extension (`effectful-tech.effect-vscode`, recommended in `.vscode/extensions.json`) for fiber inspection, span stack, and pause-on-defect. The language service requires the **workspace** TypeScript version, not the editor-bundled one.
- When adding Effect code, follow the enforced conventions: `Context.Service<TagName, Shape>()` tags, `return yield* Effect.fail(...)` for definitive failure exits inside `Effect.gen`.

## Vendored Repositories

This project vendors the Effect v4 monorepo (tag `effect@4.0.0-rc.112`, matching the catalog pin) under `repos/effect` as a **gitignored local clone**, restored automatically by `bun run prepare` (safe to re-run; skips the clone when it already exists).

- Treat `repos/effect` as **read-only reference material**. Never edit files under it and never import from it — application code imports from normal package dependencies.
- Always read `repos/effect/LLMS.md` before writing Effect code.
- For idiomatic v4 patterns (`Context.Service`, `Layer`, scoped resources, `Effect.gen`), study the source and tests under `repos/effect/packages/effect/src` and treat them as the source of truth over documentation, generated guesses, or web search.
- `bun run prepare` also symlinks `node_modules/@effect/oxc` → the vendored `packages/tools/oxc` workspace package (not published to npm); the patched Oxlint requires it to load the `effecttsgo` plugin — deleting `repos/` without re-running `prepare` breaks `bun lint`.
- Update the clone deliberately when bumping the `effect` catalog pin: `git -C repos/effect fetch --tags && git -C repos/effect checkout effect@<new-tag>`, or delete `repos/` and re-run `bun run prepare` (adjust the tag in the `prepare` script).
- Pattern references live in `docs/agents/effect-patterns.md`.

## TypeScript configuration (TS 7)

Parent-owned workspace tsconfigs (`host/`, `packages/*`) extend the root `tsconfig.base.json` (strict flags, `module`/`target` ESNext, `moduleResolution: bundler`, and the `@effect/language-service` plugin entry). **Scaffolded tsconfigs** — `ui/`, `api/`, `plugins/*` — are copied verbatim into generated child projects by `bos init`/`bos sync`, so they must stay **self-contained** (no `extends` into the parent repo; the child has no parent base file). Rules that keep the repo TS 7-compatible:

- **`extends` does not merge arrays** — a child that declares its own `plugins` or `types` array replaces the base's entirely. Parent-owned tsconfigs must not redefine `plugins`; `types` is intentionally per-workspace (TS 7 no longer auto-includes `@types/*`, so every workspace that touches Node globals declares `"types": ["node"]` explicitly).
- **`baseUrl` is removed in TS 7** — never use it; `paths` entries resolve relative to the tsconfig file.
- **Emitting configs** (`outDir`/`emitDeclarationOnly`) must set an explicit `rootDir` — TS 7 no longer infers the common source directory — and an explicit `types`. Emitting configs must not use `paths` that point at sibling workspaces' **sources** (pulls files outside `rootDir`); resolve sibling packages through their `exports` map / built declarations instead. Source-mapped `paths` are only allowed in `noEmit` typecheck configs.
- **Known local nuisance** — building `packages/every-plugin` regenerates stray `src/**/*.d.ts`(+`.map`) files beside the sources (tsdown outDir quirk). They are untracked build artifacts: never commit them; delete them (`git clean`-style) if `bun lint` starts failing on them. Root fix tracked as a follow-up to the tsdown config.
- `plans/prototypes/*` pin their own TypeScript 5 and are exempt.

## Common Patterns

### Authentication Check
Routes requiring auth use `_authenticated.tsx` layout:
```typescript
export const Route = createFileRoute('/_layout/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session?.user) {
      throw redirect({ to: '/login', search: { redirect: location.pathname } });
    }
  },
});
```

### API Middleware (Server-side)
Routes requiring auth use typed middleware that narrows the request context —
no non-null assertions needed:

```typescript
import { createAuthMiddleware } from "./lib/auth";

const { requireAuth } = createAuthMiddleware(builder);

builder.myRoute.use(requireAuth).handler(async ({ input, context }) => {
  context.userId; // string — narrowed by middleware
  context.user;   // RequestAuthUser — non-null after requireAuth
});
```

Available middlewares: `requireAuth`, `requireAuthOrApiKey`, `requireRole`,
`requireAdmin`, `requireOrganization`, `requireOrgRole`, `requireApiKey`.
Pass an optional Zod schema for org metadata: `createAuthMiddleware(builder, { orgMetaSchema })`.

### API Client Usage
```typescript
import { useApiClient } from "@/app";

function MyComponent() {
  const apiClient = useApiClient();
  const { data } = await apiClient.ping();
  const { data } = await apiClient.registry.listRegistryApps({ limit: 24 });
}
```

### App Name in UI
```typescript
import { getAppName } from "@/app";

// In a component (client-side only)
const appName = useClientValue(() => getAppName(), "app");

// In a head() function (server-side, from loaderData)
const { runtimeConfig } = Route.useLoaderData();
const appName = getActiveRuntime(runtimeConfig)?.title ?? getAccount(runtimeConfig);
```

### Gasless writes: session gas keys first, relayer fallback

Two sponsorship models share the same funded account. The **Sponsor** is the ephemeral relayer account in its funding role; the **relayer** is the same account's NEP-366 role. See ADR 0017 (`docs/adr/0017-session-gas-keys.md`) and the "Gasless transactions" vocabulary in `CONTEXT.md`.

**Session Gas Keys (primary, NEP-611):** when the connected wallet advertises `features.gasKeys` (Meteor verified on testnet), the user opts in via the `EnableGaslessWrites` affordance; the wallet signs a one-time Bootstrap `AddKey` with `gasKeyInfo` that installs a `GasKeyFunctionCall` key scoped to the FastKV namespace's `__fastdata_kv` method on the user's account. The Sponsor funds it via `TransferToGasKey` (`POST /near/gas-key/fund`), which verifies the on-chain key scope and balance against the top-up threshold and enforces a per-user lifetime cap before signing. The browser signs platform writes locally (`authClient.near.sendWithGasKey`) on rotating nonce Lanes — no relayer on the hot path. Config: `sessionGasKey` block (dual-network) beside `relayer` in `bos.config.json → app.auth.variables.siwn`. Key material lives in browser IndexedDB per `network:account` — nothing server-side; a cleared cache re-Bootstraps a new key (old keys are recorded in `fundedGasKey` rows for later cleanup).

**Relayer (fallback, NEP-366):** the auth plugin's `siwn({ relayer: ... })` block is **ephemeral mode** — the rich-object shape with `whitelistedContracts`, `maxGasPerTransaction`, and `maxDepositPerTransaction` but no `accountId` / `privateKey`. On first startup the server generates an ED25519 keypair per network, derives an implicit hex account from the public key, and encrypts the private key with `BETTER_AUTH_SECRET` (HKDF-SHA256 → AES-256-GCM) into the `relayerKey` table. Same keypair recovers on every restart. **Fund that account with NEAR** — it pays gas both for relayed delegates and for Session Gas Key top-ups; the `/admin/relayer` page surfaces the funding banner. `NEAR_RELAYER_PRIVATE_KEY` is vestigial in ephemeral mode and is omitted from `.env.example`; only reintroduce (plus explicit `relayer: { accountId, privateKey }`) when moving to `RelayerExplicitConfig`. The mode is observable at runtime: `getRelayerInfo()` returns `{ accountId, mode: "ephemeral", publicKey, balance, enabled }`.

**Protocol rules (gas keys):** a gas key cannot sign NEP-366 delegate actions, and `WithdrawFromGasKey` is refused inside a delegate — the two paths never compose. Deleting a gas key **burns** any remaining balance (`DeleteKey` refuses above 1 NEAR), so drain with `WithdrawFromGasKey` before deleting. The wallet connector is `@hot-labs/near-connect`, installed from the gas-key-capable fork `elliotBraem/near-connect#v0.12.0-fork.2` (replaces the `@fastnear/near-connect` swap, which required a tracked CSP patch — that patch is gone). The legacy sub-account relayer-FCAK config (`addRelayerFCAK`/`relayerFCAK`) has been removed; session gas keys are the only key-sponsorship mechanism.

To switch to `RelayerExplicitConfig`, replace the rich-object shape with `relayer: { accountId: "relayer.<your-domain>.near", privateKey: process.env.RELAYER_PRIVATE_KEY, whitelistedContracts: [...], maxGasPerTransaction: "...", maxDepositPerTransaction: "0" }` and re-add the env var. The ephemeral key in the `relayerKey` table is ignored once an explicit key is provided.

## Security

### Shared Singleton Trust Model

Module Federation shares React, TanStack Query, and TanStack Router as singletons across remotes. A compromise of these packages affects all remotes simultaneously. Defense:

- **Catalog pinning** — versions are locked in root `package.json` catalogs. Bump versions deliberately, not reactively.
- **Renovate `minimumReleaseAge`** — 3 days general, 5 days for `@tanstack/*`. Malicious versions detected within hours are blocked from auto-merge.
- **Minor bumps never automerged** — supply chain attacks typically ship as minor version bumps. All minor updates require manual review.

### Dependency Security

- **Renovate** manages dependency updates for this parent repo (not Dependabot). Config: `.github/renovate.json`. New generated child repos no longer scaffold that config by default.
- **`--ignore-scripts`** — all CI workflows use `bun install --frozen-lockfile --ignore-scripts`. Lifecycle scripts (the TanStack attack vector) never execute during install.
- **Renovate `vulnerabilityAlerts`** — enabled in `.github/renovate.json`, opens PRs for dependencies with known vulnerabilities.
- **`bun audit`** runs in CI on every push, PR, and manual dispatch. It fails the build on critical/high findings only when the `AUDIT_STRICT=true` GitHub secret is set; otherwise it emits a warning.
- **GitHub Actions pinned to commit SHAs** — all `uses:` references are SHA-pinned to prevent tag-hijacking attacks (e.g. tj-actions).

### Supply Chain Incident Response

If a dependency is compromised:

1. **Catalog pin protects all remotes** — all workspaces resolve from the same catalog, so pinning one version secures everything.
2. **Independent deployment enables instant containment** — update the compromised remote's URL in `bos.config.json` and publish. No host rebuild needed.
3. **On-chain config is verifiable** — `bos.config.json` is published to FastKV. URL changes are inspectable and auditable on-chain.
4. **Runtime isolation limits blast radius** — a compromised UI dep cannot access API database secrets or auth keys. Remotes run in separate processes.

### CI Hardening

- No `pull_request_target` in any workflow — prevents the "Pwn Request" cache-poisoning pattern used in the TanStack compromise.
- Secrets scoped to individual steps, not job-level env — limits exposure if any step is compromised.
- `id-token: write` removed from job-level permissions — only granted where explicitly needed.
- `permissions:` set to minimum required on every workflow.

## Troubleshooting

**Process won't start:**
```bash
bos kill        # Kill all tracked processes
bun install     # Ensure dependencies
bun run dev     # Restart
```

**Module Federation errors:**
- Check `bos.config.json` URLs are accessible
- Verify shared dependency versions match in package.json
- Clear browser cache

**Browser regression tests time out on `page.waitForURL` after clicking a `<Link>`:**
TanStack Router uses client-side navigation (`history.pushState`). `page.waitForURL` defaults to `waitUntil: "load"`, which never fires for client-side nav and produces a 10 s `TimeoutError` even though the URL already matches. Always pass `{ waitUntil: "commit" }` (or `{ waitUntil: "domcontentloaded" }`) when waiting for a route change triggered by a TanStack `<Link>` click.

**Browser regression tests break when UI chrome text changes:**
Prefer `data-testid` over `getByRole("heading", { name: ... })` / `getByText("...")` selectors for UI chrome (page headings, buttons, links in nav/sidebar/forms). The convention:
- `<PageHeader headerTestId="<page>.heading">` — page h1 region
- `<SectionHeader sectionTestId="<section>">` — section h2 region
- Interactives: `data-testid="<area>-<purpose>"` (e.g., `settings-tab-api-keys`, `near.signin-button`, `account.signout-menuitem`, `sidebar-nav-my-node`).
See `tests/regression/browser/specs/admin.spec.ts` and `settings-api-keys.spec.ts` for examples.

**Plugin fails to load with `ModuleFederationError` / `__webpack_modules__[e].call`:**
- The plugin's deployed `mf-manifest.json` reports a `metaData.pluginVersion` older than the host's. Each plugin bundle is built against a specific `@module-federation/runtime`; the host and each plugin must agree on that version, and the plugin's bundle must provide every `shared[]` dependency the host requires (`requiredVersion: ^X.Y.Z`).
- Run `bos mf check` to see which plugin is behind. Redeploy it via `cd plugins/<key> && bos plugin publish <key>` (runs the same train as `bos deploy` scoped to the one plugin: preflight → build → upload → version-manifest pin → FastKV publish; or `bos deploy` from the repo root), then re-run `bos mf check`.
- See `packages/everything-dev/skills/publish-sync` (Federation runtime compatibility section) for the full failure mode and recovery workflow.

**Database issues:**
```bash
bun run db:push   # Push schema changes
bun run db:studio # Open Drizzle Studio
```

## Environment

**Required files:**
- `.env` - Secrets (see `.env.example`)
- `bos.app.ts` - Authored runtime configuration (committed)

**Key ports:**
- 3003 - UI dev server
- 3001 - API dev server

## Agent communication surface

The host exposes several surfaces for programmatic agent access:

| Surface | Endpoint | Auth | Use |
|---------|----------|------|-----|
| MCP | `POST /api/mcp` | `x-api-key` header or session cookie | MCP clients (Claude, etc.) — auto-generated tools from OpenAPI spec, stateless Streamable HTTP transport |
| REST/OpenAPI | `GET/POST/... /api/{path}` | `x-api-key` header or session cookie | Standard REST; Scalar docs at `GET /api`, spec at `GET /api/spec.json` |
| oRPC RPC | `POST /api/rpc/{procedure}` | `x-api-key` header or session cookie | Typed JSON-RPC for all API procedures |
| Plugin RPC | `POST /api/rpc/{plugin}/{procedure}` | `x-api-key` header or session cookie | Per-plugin RPC (e.g. `/api/rpc/auth/getSession`) |
| MCP discovery | `GET /.well-known/mcp.json` | None | JSON descriptor with server name, endpoint, and auth scheme |

### Authentication for agents

1. Sign in with your NEAR wallet (SIWN) at the website.
2. Navigate to **Settings → API Keys** at `/settings/api-keys`.
3. Create a new key — the full secret (`api_...`) is shown once. Copy it immediately.
4. Pass it on every request: `x-api-key: api_your_key_here`

The `x-api-key` header works for all API surfaces. The session middleware resolves the key via Better-Auth `getContext()`, populating `context.apiKey` with `{ id, name, permissions }`.

### MCP tool generation

The MCP server (`host/src/services/mcp.ts`) generates tools from the API's OpenAPI spec. The base API router composes all plugin routes (auth, registry, proposals, votes) via `pluginsClient`, so every API operation — including auth, NEAR SIWN, relay, and API key management — becomes an MCP tool. Auth context flows through `AsyncLocalStorage` into every tool invocation.

### Agent entry points (URL-served)

- `/llms.txt` — LLM overview (links to `/skill.md`)
- `/skill.md` — full agent skill prompt (two modes: talk via MCP, clone & modify)
- `/skill` — HTML rendering of skill.md
- `/.well-known/mcp.json` — MCP discovery descriptor
- `/api` — Scalar OpenAPI docs
- `/api/spec.json` — OpenAPI JSON spec

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`; published to GitHub (repo read fresh from `bos.config.json` `repository`) once ready. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles map to labels of the same name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: root `CONTEXT-MAP.md` pointing to per-context `CONTEXT.md` files, with `docs/adr/` at the root for system-wide decisions. See `docs/agents/domain.md`.

### Workflow skills

This repo includes ~35 Matt Pocock workflow skills in `.agents/skills/`. These are general-purpose agent skills for TDD, code review, bug diagnosis, planning, and more. Run `/setup-matt-pocock-skills` before first use to configure the issue tracker, triage labels, and domain doc layout. Key skills:

- `/grill-with-docs` — sharpen an idea by interview, leaving a paper trail in `CONTEXT.md` and ADRs
- `/implement` — build a piece of work based on a spec or ticket, driving TDD internally
- `/code-review` — two-axis review (Standards + Spec) of the diff since a fixed point
- `/tdd` — test-driven development, red-green-refactor
- `/diagnosing-bugs` — diagnosis loop for hard bugs and performance regressions
- `/wayfinder` — chart a shared map of decision tickets for huge, foggy efforts
- `/everything-dev-app` — orientation glue for child repos; `bos init` scaffolds the whole set (verbatim skills + this glue) into generated projects

See `.agents/skills/ask-matt/SKILL.md` for the full flow map.
