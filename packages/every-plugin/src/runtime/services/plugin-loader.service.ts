import type { InferSchemaInput, InferSchemaOutput } from "@orpc/contract";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import type { z } from "zod";
import { PluginIdTag } from "../../plugin";
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

export class PluginRegistryTag extends Context.Service<PluginRegistryTag, PluginRegistry>()(
  "PluginRegistry",
) {}

export class PluginMapTag extends Context.Service<
  PluginMapTag,
  Record<string, AnyPluginConstructor>
>()("PluginMap") {}

export interface RegistryServiceShape {
  get: (
    pluginId: string,
  ) => Effect.Effect<
    { constructor: (new () => AnyPlugin) | null; metadata: PluginMetadata },
    PluginRuntimeError
  >;
  getModule: (pluginId: string) => Effect.Effect<AnyPluginConstructor | null>;
}

export class RegistryService extends Context.Service<RegistryService, RegistryServiceShape>()(
  "RegistryService",
) {}

export const RegistryServiceDefault = Layer.effect(
  RegistryService,
  Effect.gen(function* () {
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
);

export interface PluginLoaderServiceShape {
  loadPlugin: (pluginId: string) => Effect.Effect<LoadedPlugin, PluginRuntimeError>;
  instantiatePlugin: <T extends AnyPlugin>(
    pluginId: string,
    loadedPlugin: LoadedPlugin<T>,
  ) => Effect.Effect<PluginInstance<T>, PluginRuntimeError>;
  initializePlugin: <T extends AnyPlugin>(
    pluginInstance: PluginInstance<T>,
    config: {
      variables: InferSchemaInput<T["configSchema"]["variables"]>;
      secrets: InferSchemaInput<T["configSchema"]["secrets"]>;
    },
    plugins?: Record<string, unknown>,
  ) => Effect.Effect<InitializedPlugin<T>, PluginRuntimeError>;
}

export class PluginLoaderService extends Context.Service<
  PluginLoaderService,
  PluginLoaderServiceShape
>()("PluginLoaderService") {}

export const PluginLoaderServiceDefault = Layer.effect(
  PluginLoaderService,
  Effect.gen(function* () {
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
              }),
            );
          }

          const resolvedUrl = resolveUrl(url);

          yield* moduleFederationService.registerRemote(pluginId, resolvedUrl).pipe(
            Effect.tapError((error) =>
              Effect.logError(`Plugin ${pluginId} failed during register-remote: ${error}`),
            ),
            Effect.mapError((error) =>
              toPluginRuntimeError(error, pluginId, undefined, "register-remote"),
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
                toPluginRuntimeError(error, pluginId, undefined, "load-remote"),
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
              toPluginRuntimeError(error, pluginId, undefined, "instantiate-plugin"),
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
                }),
            ),
          );

          // Create a long-lived scope for this plugin instance. Initialize
          // returns a Layer which is built against this scope, so scoped
          // resources (DB pools, caches) release on plugin shutdown.
          const scope = yield* Scope.make();

          // Build the plugin's Layer within the scope.
          // On failure, close the scope immediately so scoped resources
          // (DB pools, caches) are released — otherwise every failed
          // initialization leaks until the process exits.
          const effectContext = yield* Effect.gen(function* () {
            const layer = yield* plugin
              .initialize({ variables: _variables, secrets: hydratedConfig.secrets }, plugins ?? {})
              .pipe(
                Effect.provideService(PluginIdTag, plugin.id),
                Effect.provideService(Scope.Scope, scope),
              );

            return yield* Layer.buildWithScope(layer as Layer.Layer<any, Error>, scope).pipe(
              Effect.provideService(PluginIdTag, plugin.id),
            );
          }).pipe(
            Effect.onExit((exit) =>
              Exit.isSuccess(exit)
                ? Effect.void
                : Scope.close(scope, exit).pipe(
                    Effect.catchCause((closeCause) =>
                      Effect.logWarning(
                        `Failed to close scope for plugin ${plugin.id} after initialize error`,
                        closeCause,
                      ),
                    ),
                  ),
            ),
            Effect.tapError((error) =>
              Effect.logError(`Plugin ${plugin.id} failed during initialize-plugin: ${error}`),
            ),
            Effect.mapError((error) =>
              toPluginRuntimeError(error, plugin.id, undefined, "initialize-plugin"),
            ),
          );

          return {
            plugin,
            metadata: pluginInstance.metadata,
            config: { variables: _variables, secrets: hydratedConfig.secrets },
            effectContext,
            scope,
          } satisfies InitializedPlugin<T>;
        }),
    };
  }),
);
