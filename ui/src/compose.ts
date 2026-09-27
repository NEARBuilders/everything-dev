/**
 * Construction shim — the manifest-composition engine executing INSIDE the
 * core ui's module graph (production: the `./compose` MF expose; dev: source
 * import). Constructed route objects are minted by the same react/router
 * instance the core's Router renders with — one module graph by construction.
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

export type {
  ConstructedTree,
  ConstructInput,
  ConstructPluginRef,
  GateUser,
  HostContext,
  NavManifest,
  PluginManifest,
  ResolvedPlugin,
  RouteConfigModule,
  RouteOptionsBundle,
} from "everything-dev/ui/manifest";
export {
  CORE_UI_PLUGIN_KEY,
  ComposePayloadSchema,
  constructTree,
} from "everything-dev/ui/manifest";
