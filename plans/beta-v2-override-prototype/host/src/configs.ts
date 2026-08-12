import { resolveApp, type AppDescriptor, type ResolvedApp } from "./resolver";

/**
 * App configurations — the prototype stand-in for `app.ts` / `bos.config.json`
 * authoring. Plugins are keyed by namespace; each entry is a `source` URI:
 *
 *   local://path    → local workspace (resolved to dev port / CDN URL)
 *   bos://...       → published reference (resolved via extendsResolver)
 *
 * The `tenant` config EXTENDS the base's API surface (same `plugins.dashboard.api`)
 * but SWAPS the dashboard UI (`plugins.dashboard.ui` → `local://remote-tenant-dashboard-ui`).
 * `landing` is inherited unchanged.
 *
 *   base:   api { dashboard: base-api }   ui { dashboard: base-ui,   landing }
 *   tenant: api { dashboard: base-api }   ui { dashboard: tenant-ui, landing }
 */
export const apps: Record<string, AppDescriptor> = {
  base: {
    id: "base",
    plugins: {
      dashboard: {
        api: "local://remote-dashboard-api",
        ui: "local://remote-dashboard-ui",
      },
    },
    ui: {
      landing: "local://remote-landing",
    },
  },
  tenant: {
    id: "tenant",
    plugins: {
      // SAME dashboard API as base — inherited from the extends chain.
      dashboard: {
        api: "local://remote-dashboard-api",
        // dashboard UI SWAPPED to the tenant's own frontend
        ui: "local://remote-tenant-dashboard-ui",
      },
    },
    ui: {
      // landing inherited unchanged
      landing: "local://remote-landing",
    },
  },
};

export { resolveApp };
export type { AppDescriptor, ResolvedApp };

export const configs: Record<string, ResolvedApp> = {};
