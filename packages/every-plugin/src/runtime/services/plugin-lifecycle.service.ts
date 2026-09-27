import { Context, Effect, Exit, Layer, Ref, Scope } from "effect";
import type { AnyPlugin, InitializedPlugin } from "../../types";
import type { PluginRuntimeError } from "../errors";

export interface PluginLifecycleServiceShape {
  register: <T extends AnyPlugin>(plugin: InitializedPlugin<T>) => Effect.Effect<void>;
  unregister: (plugin: InitializedPlugin<AnyPlugin>) => Effect.Effect<void>;
  shutdown: (plugin: InitializedPlugin<AnyPlugin>) => Effect.Effect<void, PluginRuntimeError>;
  cleanup: () => Effect.Effect<void>;
}

export class PluginLifecycleService extends Context.Service<
  PluginLifecycleService,
  PluginLifecycleServiceShape
>()("PluginLifecycleService") {}

export const PluginLifecycleServiceDefault = Layer.effect(
  PluginLifecycleService,
  Effect.gen(function* () {
    const activePlugins = yield* Ref.make(new Set<InitializedPlugin<AnyPlugin>>());

    return {
      register: <T extends AnyPlugin>(plugin: InitializedPlugin<T>) =>
        Ref.update(activePlugins, (plugins) =>
          new Set(plugins).add(plugin as InitializedPlugin<AnyPlugin>),
        ),

      unregister: (plugin: InitializedPlugin<AnyPlugin>) =>
        Ref.update(activePlugins, (plugins) => {
          const newSet = new Set(plugins);
          newSet.delete(plugin);
          return newSet;
        }),

      shutdown: (plugin: InitializedPlugin<AnyPlugin>) =>
        Effect.gen(function* () {
          yield* Ref.update(activePlugins, (plugins) => {
            const newSet = new Set(plugins);
            newSet.delete(plugin);
            return newSet;
          });

          yield* Scope.close(plugin.scope, Exit.succeed(undefined)).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`Failed to close scope for plugin ${plugin.plugin.id}`, cause),
            ),
          );
        }),

      cleanup: () =>
        Effect.gen(function* () {
          const plugins = yield* Ref.get(activePlugins);
          if (typeof process !== "undefined" && process.env?.EVERY_PLUGIN_DEBUG_SCOPES === "1") {
            yield* Effect.logWarning(
              `[PluginLifecycle] cleaning up ${plugins.size} active plugin(s)`,
            );
          }

          yield* Effect.forEach(
            plugins,
            (plugin) =>
              Scope.close(plugin.scope, Exit.succeed(undefined)).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning(`Failed to shutdown plugin ${plugin.plugin.id}`, cause),
                ),
              ),
            { concurrency: "unbounded" },
          );

          yield* Ref.set(activePlugins, new Set());
        }).pipe(Effect.catchCause((cause) => Effect.logWarning("Plugin cleanup failed", cause))),
    };
  }),
);
