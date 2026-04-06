# ui

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
