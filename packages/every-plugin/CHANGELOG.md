# every-plugin

## 2.2.3

### Patch Changes

- 2b86efd: Fix npm manifests — resolve workspace/catalog refs for published packages

## 2.2.2

### Patch Changes

- 1859d7f: Fix npm trusted publishing provenance verification by aligning package repository metadata with the GitHub repository URL.

## 2.2.1

### Patch Changes

- 01aec75: Fix npm publish: `main`, `module`, and `types` fields must be strings

  npm requires `main`, `module`, and `types` to be plain strings, not conditional objects. The conditional resolution is handled by the `exports` field, so these fields now point to production defaults (`./dist/*`).

## 2.2.0

### Minor Changes

- 5edf2fa: Rewrite package exports to dual conditional format (`development` → source, default → dist). Add `buildEverythingDevQuietly()` to CLI to ensure dist is built before workspace builds. Add missing tsdown entries for `every-plugin/orpc/client` and `every-plugin/orpc/openapi`. Add `prepublishOnly` and `customConditions: ["development"]` to all consumer tsconfigs. Move re-exported `@orpc/*` packages to `peerDependencies` in `every-plugin`.

## 2.1.0

### Minor Changes

- d1a56cb: ## API pluginsClient: in-process plugin composition

  The API plugin receives a `pluginsClient` map of typed client factories via `createPlugin.withPlugins<PluginsClient>()`, enabling in-process calls to other plugin routers without HTTP roundtrips.

  - **New**: `createPlugin.withPlugins<P>()` on `every-plugin` — pre-binds the plugins type generic, eliminating the `plugins: null as unknown as P` hack
  - **New**: Generated types now live alongside their consumers — `api/src/plugins-client.gen.ts` and `ui/src/api-contract.gen.ts` instead of `.bos/generated/`
  - **New endpoint**: `GET /api/demo/plugins` — demonstrates variable flow from `bos.config.json` and in-process plugin client usage
  - **Config-driven**: API variables (`app.api.variables`) and plugin variables (`plugins.{key}.variables`) configured in `bos.config.json`
  - **Generic host**: No plugin-specific code in the host — it loads plugins from config and injects client factories

  ### Usage

  ```typescript
  import type { PluginsClient } from "./plugins-client.gen";

  export default createPlugin.withPlugins<PluginsClient>()({
    initialize: (config, plugins) =>
      Effect.sync(() => ({
        plugins,
        demoMessage: config.variables.demoMessage,
      })),
    createRouter: (services, builder) => ({
      pluginDemo: builder.pluginDemo.handler(async () => {
        const status = await services.plugins.registry().getRegistryStatus();
        return {
          apiVariable: services.demoMessage,
          registryStatus: status,
          availablePlugins: Object.keys(services.plugins),
        };
      }),
    }),
  });
  ```

### Patch Changes

- 8e378e3: Update plugin build system: rspack config format and shared-deps resolution

  - Rspack config format changes for plugin template
  - Shared dependencies resolution updates

## 2.0.0

### Major Changes

- 5524246: Refactor CLI and plugin orchestration: remove standalone `packages/cli`, absorb its responsibilities into `everything-dev`, restructure the BOS plugin and contract generation pipeline, overhaul the API registry, and update the plugin build system with a new rspack config format and data-URI fix.

## 1.0.0

### Major Changes

- f080b87: Release v1.0.0 of the everything-dev toolchain.

  - Promote api, ui, everything-dev, and every-plugin to stable 1.0.0
  - Promote the plugin template package to stable 1.0.0

### Patch Changes

- 44393e7: Add plugin support with improved module federation service, shared dependencies handling, and auth client integration
