import { createInstance, getInstance } from "@module-federation/enhanced/runtime";
import { setGlobalFederationInstance } from "@module-federation/runtime-core";
import { Effect } from "effect";
import type { AnyPlugin } from "../../types";
import { ModuleFederationError } from "../errors";
import { type CoreSharedDepName, MF_CORE_SHARED_DEPS } from "../mf-config";
import { getNormalizedRemoteName } from "./normalize";

type RemoteModule = (new () => AnyPlugin) | { default: new () => AnyPlugin };

const coreModuleLoaders: Record<CoreSharedDepName, () => Promise<unknown>> = {
  "every-plugin": () => import("every-plugin"),
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
      throw new Error(`Failed to initialize Module Federation: ${error}`);
    }
  }),
);

export class ModuleFederationService extends Effect.Service<ModuleFederationService>()(
  "ModuleFederationService",
  {
    effect: Effect.gen(function* () {
      const mf = yield* Effect.flatten(createModuleFederationInstance);

      return {
        registerRemote: (pluginId: string, url: string) =>
          Effect.gen(function* () {
            console.log(`[MF] Registering ${pluginId}`);

            const remoteName = getNormalizedRemoteName(pluginId);
            const type = url.endsWith("/mf-manifest.json")
              ? ("manifest" as const)
              : url.endsWith("/remoteEntry.js")
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

            console.log(`[MF] ✅ Registered ${pluginId}`);
          }),

        loadRemoteConstructor: (pluginId: string, url: string) =>
          Effect.gen(function* () {
            const remoteName = getNormalizedRemoteName(pluginId);
            console.log(`[MF] Loading remote ${remoteName}`);
            const modulePath = `${remoteName}/plugin`;

            return yield* Effect.tryPromise({
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

                console.log(`[MF] ✅ Loaded constructor for ${pluginId}`);
                return Constructor;
              },
              catch: (error): ModuleFederationError =>
                new ModuleFederationError({
                  pluginId,
                  remoteUrl: url,
                  cause: error instanceof Error ? error : new Error(String(error)),
                }),
            });
          }),
      };
    }),
  },
) {}
