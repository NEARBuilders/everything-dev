import type { InferSchemaInput, InferSchemaOutput } from "@orpc/contract";
import { Context, Effect, Context as EffectContext, Exit, Layer, Scope } from "effect";
import type { z } from "zod";
import type { PluginServicesTools } from "../../plugin";
import type {
  AnyPlugin,
  AnyPluginConstructor,
  InitializedPlugin,
  LoadedPlugin,
  PluginInstance,
  PluginMetadata,
  PluginRegistry,
} from "../../types";
import { PluginRuntimeError, toPluginRuntimeError } from "../errors";
import { validate } from "../validation";
import { ModuleFederationService } from "./module-federation.service";
import { SecretsService } from "./secrets.service";

export class PluginRegistryTag extends Context.Tag("PluginRegistry")<
  PluginRegistryTag,
  PluginRegistry
>() {}

export class PluginMapTag extends Context.Tag("PluginMap")<
  PluginMapTag,
  Record<string, AnyPluginConstructor>
>() {}

export class RegistryService extends Effect.Service<RegistryService>()("RegistryService", {
  effect: Effect.gen(function* () {
    const registry = yield* PluginRegistryTag;
    const pluginMap = yield* PluginMapTag;

    return {
      get: (pluginId: string) =>
        Effect.gen(function* () {
          const entry = registry[pluginId];

          if (!entry) {
            return yield* Effect.fail(
              new PluginRuntimeError({
                pluginId,
                operation: "validate-plugin-id",
                cause: new Error(`Plugin ${pluginId} not found in registry`),
                retryable: false,
              }),
            );
          }

          if ("module" in entry) {
            return {
              constructor: entry.module,
              metadata: {
                remoteUrl: entry.remote || "",
                version: entry.version,
                description: entry.description,
              } as PluginMetadata,
            };
          }

          return {
            constructor: null,
            metadata: {
              remoteUrl: entry.remote,
              version: entry.version,
              description: entry.description,
            } as PluginMetadata,
          };
        }),

      getModule: (pluginId: string) => Effect.succeed(pluginMap[pluginId] || null),
    };
  }),
}) {}

export class PluginLoaderService extends Effect.Service<PluginLoaderService>()(
  "PluginLoaderService",
  {
    effect: Effect.gen(function* () {
      const moduleFederationService = yield* ModuleFederationService;
      const secretsService = yield* SecretsService;
      const registryService = yield* RegistryService;

      const resolveUrl = (baseUrl: string, version?: string): string =>
        version && version !== "latest" ? baseUrl.replace("@latest", `@${version}`) : baseUrl;

      return {
        loadPlugin: (pluginId: string) =>
          Effect.gen(function* () {
            const entry = yield* registryService.get(pluginId);

            if (entry.constructor) {
              yield* Effect.logDebug("Loading plugin from direct module", { pluginId });

              return {
                ctor: entry.constructor,
                metadata: entry.metadata,
              } satisfies LoadedPlugin;
            }

            const url = entry.metadata.remoteUrl;
            if (!url) {
              return yield* Effect.fail(
                new PluginRuntimeError({
                  pluginId,
                  operation: "load-plugin",
                  cause: new Error(`Plugin ${pluginId} has no module or remote URL configured`),
                  retryable: false,
                }),
              );
            }

            const resolvedUrl = resolveUrl(url);

            yield* moduleFederationService.registerRemote(pluginId, resolvedUrl).pipe(
              Effect.tapError((error) =>
                Effect.logError(`Plugin ${pluginId} failed during register-remote: ${error}`),
              ),
              Effect.mapError((error) =>
                toPluginRuntimeError(error, pluginId, undefined, "register-remote", true),
              ),
            );

            yield* Effect.logDebug("Loading plugin from remote", { pluginId, url: resolvedUrl });

            const ctor = yield* moduleFederationService
              .loadRemoteConstructor(pluginId, resolvedUrl)
              .pipe(
                Effect.tapError((error) =>
                  Effect.logError(`Plugin ${pluginId} failed during load-remote: ${error}`),
                ),
                Effect.mapError((error) =>
                  toPluginRuntimeError(error, pluginId, undefined, "load-remote", false),
                ),
              );

            return {
              ctor,
              metadata: entry.metadata,
            } satisfies LoadedPlugin;
          }),

        instantiatePlugin: <T extends AnyPlugin>(pluginId: string, loadedPlugin: LoadedPlugin<T>) =>
          Effect.gen(function* () {
            const instance = yield* Effect.try(() => new loadedPlugin.ctor()).pipe(
              Effect.tapError((error) =>
                Effect.logError(`Plugin ${pluginId} failed during instantiate-plugin: ${error}`),
              ),
              Effect.mapError((error) =>
                toPluginRuntimeError(error, pluginId, undefined, "instantiate-plugin", false),
              ),
            );

            (instance.id as string) = pluginId;

            return {
              plugin: instance,
              metadata: loadedPlugin.metadata,
            } satisfies PluginInstance<T>;
          }),

        initializePlugin: <T extends AnyPlugin>(
          pluginInstance: PluginInstance<T>,
          config: {
            variables: InferSchemaInput<T["configSchema"]["variables"]>;
            secrets: InferSchemaInput<T["configSchema"]["secrets"]>;
          },
          plugins?: Record<string, unknown>,
        ) =>
          Effect.gen(function* () {
            const { plugin } = pluginInstance;

            // Validate and hydrate config
            const validatedVariables = yield* validate(
              plugin.configSchema.variables as z.ZodSchema<
                InferSchemaOutput<T["configSchema"]["variables"]>
              >,
              config.variables,
              plugin.id,
              "config",
            ).pipe(
              Effect.mapError(
                (validationError) =>
                  new PluginRuntimeError({
                    pluginId: plugin.id,
                    operation: "validate-config",
                    cause: validationError.zodError,
                    retryable: false,
                  }),
              ),
            );

            // Validate secrets
            const validatedSecrets = yield* validate(
              plugin.configSchema.secrets as z.ZodSchema<
                InferSchemaOutput<T["configSchema"]["secrets"]>
              >,
              config.secrets,
              plugin.id,
              "config",
            ).pipe(
              Effect.mapError(
                (validationError) =>
                  new PluginRuntimeError({
                    pluginId: plugin.id,
                    operation: "validate-secrets",
                    cause: validationError.zodError,
                    retryable: false,
                  }),
              ),
            );

            // Hydrate secrets in variables
            const hydratedConfig = yield* secretsService.hydrateSecrets({
              variables: validatedVariables,
              secrets: validatedSecrets,
            });

            const _variables = yield* validate(
              plugin.configSchema.variables as z.ZodSchema<
                InferSchemaOutput<T["configSchema"]["variables"]>
              >,
              hydratedConfig.variables,
              plugin.id,
              "config",
            ).pipe(
              Effect.mapError(
                (validationError) =>
                  new PluginRuntimeError({
                    pluginId: plugin.id,
                    operation: "validate-hydrated-config",
                    cause: validationError.zodError,
                    retryable: false,
                  }),
              ),
            );

            // Create a long-lived scope for this plugin instance
            const scope = yield* Scope.make();

            // Create a per-plugin MemoMap so tool-built layers are memoized
            const memoMap = yield* Layer.makeMemoMap;

            const tools: PluginServicesTools = {
              buildService: (tag: any, layer: any) =>
                (Layer.buildWithMemoMap(layer, memoMap, scope) as any).pipe(
                  Effect.map((ctx: any) => EffectContext.get(ctx, tag)) as any,
                ),
            };

            // Initialize plugin within the scope.
            // If initialize fails, close the scope immediately so scoped
            // resources (DB pools, caches) are released — otherwise every
            // failed initialization leaks until the process exits.
            const context = yield* plugin
              .initialize(
                { variables: _variables, secrets: hydratedConfig.secrets },
                plugins ?? {},
                tools,
              )
              .pipe(
                Effect.provideService(Scope.Scope, scope),
                Effect.tapError(() =>
                  Scope.close(scope, Exit.succeed(undefined)).pipe(
                    Effect.catchAll((closeError) =>
                      Effect.logWarning(
                        `Failed to close scope for plugin ${plugin.id} after initialize error`,
                        closeError,
                      ),
                    ),
                  ),
                ),
                Effect.tapError((error) =>
                  Effect.logError(`Plugin ${plugin.id} failed during initialize-plugin: ${error}`),
                ),
                Effect.mapError((error) =>
                  toPluginRuntimeError(error, plugin.id, undefined, "initialize-plugin", false),
                ),
              );

            return {
              plugin,
              metadata: pluginInstance.metadata,
              config: { variables: _variables, secrets: hydratedConfig.secrets },
              context,
              scope,
            } satisfies InitializedPlugin<T>;
          }),
      };
    }),
  },
) {}
