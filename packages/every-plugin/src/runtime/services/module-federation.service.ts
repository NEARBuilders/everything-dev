import { createInstance, getInstance } from "@module-federation/enhanced/runtime";
import { setGlobalFederationInstance } from "@module-federation/runtime-core";
import { Context, Effect, Layer } from "effect";
import { DEV_ENTRY_FILENAME } from "../../build/artifact-names";
import type { AnyPlugin } from "../../types";
import { ModuleFederationError } from "../errors";
import { type CoreSharedDepName, MF_CORE_SHARED_DEPS } from "../mf-config";
import { getNormalizedRemoteName } from "./normalize";
import {
  compareSharedIdentity,
  describeSharedIdentityMismatch,
  fetchRemoteIdentityManifest,
} from "./shared-identity";

function expectedSharedIdentity(): Map<string, string> {
  return new Map(
    Object.entries(MF_CORE_SHARED_DEPS).map(([name, config]) => [name, config.version]),
  );
}

type RemoteModule = (new () => AnyPlugin) | { default: new () => AnyPlugin };

export const loadEveryPluginSharedModule = () => import("../../index");

const coreModuleLoaders: Record<CoreSharedDepName, () => Promise<unknown>> = {
  // Keep the host-provided framework share on the same source graph as the
  // runtime. A package self-import can resolve the published entry when a
  // workspace script is launched through its package manager shim.
  "every-plugin": loadEveryPluginSharedModule,
  effect: () => import("effect"),
  zod: () => import("zod"),
  "@orpc/contract": () => import("@orpc/contract"),
  "@orpc/client": () => import("@orpc/client"),
  "@orpc/server": () => import("@orpc/server"),
};

function buildSharedConfig(): Record<
  string,
  {
    version: string;
    shareScope: string;
    get: () => Promise<() => unknown>;
    shareConfig: (typeof MF_CORE_SHARED_DEPS)[CoreSharedDepName]["shareConfig"];
  }
> {
  return Object.fromEntries(
    (
      Object.entries(MF_CORE_SHARED_DEPS) as [
        CoreSharedDepName,
        (typeof MF_CORE_SHARED_DEPS)[CoreSharedDepName],
      ][]
    ).map(([name, config]) => {
      const load = coreModuleLoaders[name];

      if (!load) {
        throw new Error(`Missing core shared module loader for ${name}`);
      }

      return [
        name,
        {
          version: config.version,
          shareScope: config.shareScope,
          get: () => load().then((mod) => () => mod),
          shareConfig: config.shareConfig,
        },
      ];
    }),
  );
}

const createModuleFederationInstance = Effect.cached(
  Effect.sync(() => {
    try {
      const shared = buildSharedConfig();
      let instance = getInstance();

      if (!instance) {
        instance = createInstance({
          name: "host",
          remotes: [],
          shared,
        });

        setGlobalFederationInstance(instance);
      } else {
        instance.registerShared(shared);
      }

      return instance;
    } catch (error) {
      throw new Error(`Failed to initialize Module Federation: ${String(error)}`);
    }
  }),
);

// A built container's runtime code looks up its own chunks through the node
// runtime's entry-URL fallback keyed by the container's SELF name
// (`mf-manifest.json` metaData.name — the composition key, e.g.
// "everything-dev_registry-plugin"), while the host registers the remote
// under the plugin id ("registry"). When those differ, the fallback misses,
// resolveUrl returns null, and the node runtime hands back an empty chunk as
// if it had loaded — the exposed module then requires ids nothing registered
// ("__webpack_modules__[r] is not a function"). Registering and loading the
// remote under the container's own name keeps that lookup a hit.
const remoteSelfNames = new Map<string, string>();

const resolveRemoteSelfName = (pluginId: string, url: string) =>
  Effect.gen(function* () {
    const memoKey = `${pluginId}@${url}`;
    const memo = remoteSelfNames.get(memoKey);
    if (memo) return memo;

    let selfName: string | null = null;
    try {
      const manifest = yield* Effect.promise(() => fetchRemoteIdentityManifest(url));
      selfName = manifest?.metaData?.name?.trim() || null;
    } catch {
      selfName = null;
    }

    const resolved = selfName ?? getNormalizedRemoteName(pluginId);
    remoteSelfNames.set(memoKey, resolved);
    return resolved;
  });

export interface ModuleFederationServiceShape {
  registerRemote: (pluginId: string, url: string) => Effect.Effect<void, ModuleFederationError>;
  loadRemoteConstructor: (
    pluginId: string,
    url: string,
  ) => Effect.Effect<new () => AnyPlugin, ModuleFederationError>;
}

export class ModuleFederationService extends Context.Service<
  ModuleFederationService,
  ModuleFederationServiceShape
>()("ModuleFederationService") {}

export const ModuleFederationServiceDefault = Layer.effect(
  ModuleFederationService,
  Effect.gen(function* () {
    const mf = yield* Effect.flatten(createModuleFederationInstance);
    const expectedIdentity = expectedSharedIdentity();

    const buildSharedIdentityError = async (
      pluginId: string,
      url: string,
    ): Promise<ModuleFederationError | null> => {
      let manifest: Awaited<ReturnType<typeof fetchRemoteIdentityManifest>> | null = null;
      try {
        manifest = await fetchRemoteIdentityManifest(url);
      } catch (error) {
        console.warn(
          `[SharedIdentity] Could not fetch mf-manifest.json for plugin "${pluginId}" at ${url} (${error instanceof Error ? error.message : String(error)}); proceeding without identity verification`,
        );
        return null;
      }
      if (!manifest) return null;
      const mismatches = compareSharedIdentity(manifest.shared, expectedIdentity);
      if (mismatches.length === 0) return null;
      const warnOnly = process.env.BOS_MF_IDENTITY === "warn";
      if (warnOnly) {
        console.warn(
          `${describeSharedIdentityMismatch(pluginId, mismatches, "this runtime")} (BOS_MF_IDENTITY=warn: loading anyway)`,
        );
        return null;
      }
      return new ModuleFederationError({
        pluginId,
        remoteUrl: url,
        cause: new Error(describeSharedIdentityMismatch(pluginId, mismatches, "this runtime")),
      });
    };

    return {
      registerRemote: (pluginId: string, url: string) =>
        Effect.gen(function* () {
          const remoteName = yield* resolveRemoteSelfName(pluginId, url);
          yield* Effect.logDebug(`[MF][${pluginId}] Registering as "${remoteName}"`);

          const type = url.endsWith("/mf-manifest.json")
            ? ("manifest" as const)
            : url.endsWith(`/${DEV_ENTRY_FILENAME}`)
              ? ("script" as const)
              : undefined;

          yield* Effect.try({
            try: () =>
              mf.registerRemotes([
                {
                  name: remoteName,
                  entry: url,
                  ...(type ? { type } : {}),
                },
              ]),
            catch: (error): ModuleFederationError =>
              new ModuleFederationError({
                pluginId,
                remoteUrl: url,
                cause: error instanceof Error ? error : new Error(String(error)),
              }),
          });

          yield* Effect.logInfo(`[MF][${pluginId}] ✅ Registered`);
        }),

      loadRemoteConstructor: (pluginId: string, url: string) =>
        Effect.gen(function* () {
          const remoteName = yield* resolveRemoteSelfName(pluginId, url);
          yield* Effect.logDebug(`[MF][${pluginId}] Loading remote ${remoteName}`);

          const identityError = yield* Effect.promise(() =>
            buildSharedIdentityError(pluginId, url),
          );
          if (identityError) {
            yield* Effect.logError(
              `[MF][${pluginId}] ❌ shared identity mismatch: ${
                identityError.cause instanceof Error
                  ? identityError.cause.message
                  : String(identityError.cause ?? "shared identity mismatch")
              }`,
            );
            return yield* identityError;
          }

          const modulePath = `${remoteName}/plugin`;

          const pluginConstructor = yield* Effect.tryPromise({
            try: async () => {
              const container = await mf.loadRemote<RemoteModule>(modulePath);
              if (!container) {
                throw new Error(`No container returned for ${modulePath}`);
              }

              // Support multiple export patterns: direct function, default export, named exports
              let Constructor: any;

              if (typeof container === "function") {
                // Direct function export
                Constructor = container;
              } else if (container.default) {
                // Default export
                Constructor = container.default;
              } else {
                // Named export fallback - prioritize exports with 'binding' property (plugin classes)
                Constructor = Object.values(container).find(
                  (exp) => typeof exp === "function" && (exp as any).binding !== undefined,
                );

                // Fallback to any function export if no binding found
                if (!Constructor) {
                  Constructor = Object.values(container).find(
                    (exp) => typeof exp === "function" && exp.prototype?.constructor === exp,
                  );
                }
              }

              if (!Constructor || typeof Constructor !== "function") {
                const containerInfo =
                  typeof container === "object"
                    ? `Available exports: ${Object.keys(container).join(", ")}`
                    : `Container type: ${typeof container}`;

                throw new Error(
                  `No valid plugin constructor found for '${pluginId}'.\n` +
                    `Supported patterns:\n` +
                    `  - export const YourPlugin = createPlugin({...})\n` +
                    `  - export default createPlugin({...})\n` +
                    `${containerInfo}`,
                );
              }

              // Validate it looks like a plugin constructor (has binding property)
              if (!(Constructor as any).binding) {
                const containerInfo =
                  typeof container === "object"
                    ? `Found exports: ${Object.keys(container).join(", ")}`
                    : `Container type: ${typeof container}`;

                throw new Error(
                  `Invalid plugin constructor for '${pluginId}'. ` +
                    `The exported value must be created with createPlugin(). ` +
                    `Found a function but it's missing the required 'binding' property.\n` +
                    `${containerInfo}`,
                );
              }

              return Constructor;
            },
            catch: (error): ModuleFederationError =>
              new ModuleFederationError({
                pluginId,
                remoteUrl: url,
                cause: error instanceof Error ? error : new Error(String(error)),
              }),
          });

          yield* Effect.logInfo(`[MF][${pluginId}] ✅ Loaded constructor`);
          return pluginConstructor;
        }),
    };
  }),
);
