import { Context, Effect, Exit, Layer, Scope } from "effect";
import type {
  AnyPlugin,
  AnyPluginConstructor,
  InitializedPlugin,
  LoadedPlugin,
  PluginInstance,
  PluginRegistry,
  SecretsConfig,
} from "../../types";
import type { PluginRuntimeError } from "../errors";
import { toPluginRuntimeError } from "../errors";
import {
  ModuleFederationService,
  ModuleFederationServiceDefault,
} from "./module-federation.service";
import { PluginLifecycleService, PluginLifecycleServiceDefault } from "./plugin-lifecycle.service";
import {
  PluginLoaderService,
  PluginLoaderServiceDefault,
  PluginMapTag,
  PluginRegistryTag,
  RegistryServiceDefault,
} from "./plugin-loader.service";
import { SecretsConfigTag, SecretsServiceDefault } from "./secrets.service";

export interface PluginServiceShape {
  loadPlugin: (pluginId: string) => Effect.Effect<LoadedPlugin, PluginRuntimeError>;
  instantiatePlugin: <T extends AnyPlugin>(
    pluginId: string,
    loadedPlugin: LoadedPlugin<T>,
  ) => Effect.Effect<PluginInstance<T>, PluginRuntimeError>;
  initializePlugin: <T extends AnyPlugin>(
    pluginInstance: PluginInstance<T>,
    config: any,
    plugins?: Record<string, unknown>,
  ) => Effect.Effect<InitializedPlugin<T>, PluginRuntimeError>;
  registerPlugin: (plugin: InitializedPlugin<AnyPlugin>) => Effect.Effect<void>;
  shutdownPlugin: (plugin: InitializedPlugin<AnyPlugin>) => Effect.Effect<void>;
  /** Drop a remote plugin's Module Federation container so its next load
   * re-fetches fresh bytes — the dev reload's purge step (issue #942). */
  purgePluginModule: (
    pluginId: string,
    remoteUrl: string,
  ) => Effect.Effect<void, PluginRuntimeError>;
  cleanup: Effect.Effect<void>;
}

export class PluginService extends Context.Service<PluginService, PluginServiceShape>()(
  "PluginService",
) {}

export const PluginServiceDefault = Layer.effect(
  PluginService,
  Effect.gen(function* () {
    const loader = yield* PluginLoaderService;
    const lifecycle = yield* PluginLifecycleService;
    const moduleFederation = yield* ModuleFederationService;

    return {
      loadPlugin: loader.loadPlugin,
      instantiatePlugin: loader.instantiatePlugin,
      initializePlugin: loader.initializePlugin,
      registerPlugin: (plugin: InitializedPlugin<AnyPlugin>) => lifecycle.register(plugin),
      shutdownPlugin: (plugin: InitializedPlugin<AnyPlugin>) =>
        Scope.close(plugin.scope, Exit.succeed(undefined)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`Failed to shutdown plugin ${plugin.plugin.id}`, cause),
          ),
          Effect.ensuring(lifecycle.unregister(plugin)),
        ),
      purgePluginModule: (pluginId: string, remoteUrl: string) =>
        moduleFederation
          .unregisterRemote(pluginId, remoteUrl)
          .pipe(
            Effect.mapError((error) =>
              toPluginRuntimeError(error, pluginId, remoteUrl, "reload-purge"),
            ),
          ),
      cleanup: lifecycle.cleanup,
    };
  }),
);

export const PluginServiceLive = (
  registry: PluginRegistry,
  secrets: SecretsConfig,
  pluginMap: Record<string, AnyPluginConstructor> = {},
) => {
  const contextLayer = Layer.mergeAll(
    Layer.succeed(PluginRegistryTag, registry),
    Layer.succeed(SecretsConfigTag, secrets),
    Layer.succeed(PluginMapTag, pluginMap),
  );

  const servicesLayer = Layer.mergeAll(
    ModuleFederationServiceDefault,
    SecretsServiceDefault,
    RegistryServiceDefault,
    PluginLifecycleServiceDefault,
  ).pipe(Layer.provide(contextLayer));

  return PluginServiceDefault.pipe(
    Layer.provide(PluginLoaderServiceDefault),
    Layer.provide(servicesLayer),
  );
};
