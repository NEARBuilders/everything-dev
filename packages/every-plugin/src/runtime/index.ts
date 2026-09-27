import "@orpc/experimental-effect/extensions/effect";
import "@orpc/openapi/extensions/route";

import { createRouterClient } from "@orpc/server";
import { Cause, Effect, Exit, ManagedRuntime, Option } from "effect";
import type {
  AnyPlugin,
  AnyPluginConstructor,
  InferRegistryFromEntries,
  InitializedPlugin,
  LoadedPlugin,
  PluginConfigInput,
  PluginInstance,
  PluginRegistry,
  PluginRegistryEntry,
  PluginRouterType,
  PluginRuntimeConfig,
  RegisteredPlugin,
  RegisteredPlugins,
  UsePluginResult,
} from "../types";
import { PluginRuntimeError } from "./errors";
import { PluginService, PluginServiceLive } from "./services/plugin.service";

const MAX_CACHE_KEY_DEPTH = 32;

export class PluginRuntime<R = RegisteredPlugins> {
  readonly __registryType?: R;

  private pluginCache = new Map<string, Promise<InitializedPlugin<AnyPlugin>>>();
  private routerCache = new Map<string, PluginRouterType<any>>();
  private cacheLeafIds = new WeakMap<object, number>();
  private nextCacheLeafId = 0;

  constructor(
    private runtime: ManagedRuntime.ManagedRuntime<PluginService, never>,
    private registry: PluginRegistry,
  ) {}

  /**
   * Cache key for plugin instances: JSON-equal configs share one plugin
   * instance (variables and secrets originate from bos.config.json, so they
   * are JSON values). Values outside the JSON domain follow Effect's Hash
   * semantics — symbols key by description, functions and class instances by
   * reference identity — and the host creates its pluginsClient map once per
   * boot, making identity the correct equivalence for function-bearing
   * configs.
   */
  private generateCacheKey(pluginId: string, config: unknown): string {
    return `${pluginId}:${this.canonicalizeConfig(config, 0, new Set())}`;
  }

  private canonicalizeConfig(value: unknown, depth: number, ancestors: Set<object>): string {
    switch (typeof value) {
      case "undefined":
        return "undefined";
      case "string":
        return `string:${JSON.stringify(value)}`;
      case "number":
        return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
      case "bigint":
        return `bigint:${value.toString()}`;
      case "boolean":
        return `boolean:${value}`;
      case "symbol":
        return `symbol:${String(value)}`;
      case "function":
        return `ref:${this.getCacheLeafId(value)}`;
      case "object": {
        if (value === null) return "null";
        if (ancestors.has(value) || depth >= MAX_CACHE_KEY_DEPTH) {
          return `ref:${this.getCacheLeafId(value)}`;
        }

        if (Array.isArray(value)) {
          ancestors.add(value);
          const serialized = `[${value
            .map((item) => this.canonicalizeConfig(item, depth + 1, ancestors))
            .join(",")}]`;
          ancestors.delete(value);
          return serialized;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          return `ref:${this.getCacheLeafId(value)}`;
        }

        const record = value as Record<string, unknown>;
        ancestors.add(value);
        const serialized = `{${Object.keys(record)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${this.canonicalizeConfig(record[key], depth + 1, ancestors)}`,
          )
          .join(",")}}`;
        ancestors.delete(value);
        return serialized;
      }
    }
  }

  private getCacheLeafId(value: object): number {
    const existing = this.cacheLeafIds.get(value);
    if (existing !== undefined) return existing;
    const id = this.nextCacheLeafId++;
    this.cacheLeafIds.set(value, id);
    return id;
  }

  private validatePluginId(pluginId: string): Effect.Effect<string, PluginRuntimeError> {
    if (!(pluginId in this.registry)) {
      return Effect.fail(
        new PluginRuntimeError({
          pluginId: String(pluginId),
          operation: "validate-plugin-id",
          cause: new Error(`Plugin ID '${String(pluginId)}' not found in registry.`),
        }),
      );
    }
    return Effect.succeed(String(pluginId));
  }

  private async runPromise<A, E>(effect: Effect.Effect<A, E, PluginService>): Promise<A> {
    const exit = await this.runtime.runPromiseExit(effect);

    if (Exit.isFailure(exit)) {
      const error = Cause.findErrorOption(exit.cause);
      if (Option.isSome(error)) {
        throw error.value;
      }
      throw Cause.squash(exit.cause);
    }

    return exit.value;
  }

  async usePlugin<K extends keyof R & string>(
    pluginId: K,
    config: PluginConfigInput<R[K]>,
    plugins?: Record<string, unknown>,
  ): Promise<UsePluginResult<K, R>> {
    const cacheKey = this.generateCacheKey(pluginId, { ...config, __plugins: plugins ?? {} });

    let cachedPlugin = this.pluginCache.get(cacheKey);
    if (!cachedPlugin) {
      const operation = Effect.gen({ self: this }, function* () {
        const pluginService = yield* PluginService;
        const validatedId = yield* this.validatePluginId(pluginId);

        // Load → Instantiate → Initialize → Register
        const ctor = yield* pluginService.loadPlugin(validatedId);
        const instance = yield* pluginService.instantiatePlugin(pluginId, ctor);
        const initialized = yield* pluginService.initializePlugin(instance, config, plugins);
        yield* pluginService.registerPlugin(initialized);

        return initialized;
      });

      cachedPlugin = this.runPromise(operation);
      this.pluginCache.set(cacheKey, cachedPlugin);
    }

    let initialized: InitializedPlugin<AnyPlugin>;
    try {
      initialized = await cachedPlugin;
    } catch (error) {
      if (this.pluginCache.get(cacheKey) === cachedPlugin) {
        this.pluginCache.delete(cacheKey);
        this.routerCache.delete(cacheKey);
      }
      throw error;
    }

    // Construct the router once per plugin instance, not per client/request.
    let router = this.routerCache.get(cacheKey);
    if (!router) {
      try {
        router = initialized.plugin.createRouter(plugins ?? {}) as PluginRouterType<R[K]>;
        this.routerCache.set(cacheKey, router);
      } catch (error) {
        await this.evictPlugin(pluginId, config, plugins);
        throw error;
      }
    }

    // Create client factory that accepts request context. The plugin's
    // Effect context is injected so `.effect()` handlers resolve services
    // on in-process (server-side / SSR) calls.
    const createClient = (context?: any) =>
      createRouterClient(router, {
        context: {
          ...context,
          "effect/context": initialized.effectContext,
        },
      });

    return {
      createClient: createClient as any,
      router,
      metadata: initialized.metadata,
      initialized: initialized as InitializedPlugin<RegisteredPlugin<K, R>>,
    } as UsePluginResult<K, R>;
  }

  async loadPlugin<K extends keyof R & string>(
    pluginId: K,
  ): Promise<LoadedPlugin<RegisteredPlugin<K, R>>> {
    const effect = Effect.gen(function* () {
      const pluginService = yield* PluginService;
      return yield* pluginService.loadPlugin(pluginId);
    });
    return this.runPromise(effect) as Promise<LoadedPlugin<RegisteredPlugin<K, R>>>;
  }

  async instantiatePlugin<K extends keyof R & string>(
    pluginId: K,
    loadedPlugin: LoadedPlugin<RegisteredPlugin<K, R>>,
  ): Promise<PluginInstance<RegisteredPlugin<K, R>>> {
    const effect = Effect.gen(function* () {
      const pluginService = yield* PluginService;
      return yield* pluginService.instantiatePlugin(pluginId, loadedPlugin);
    });
    return this.runPromise(effect) as Promise<PluginInstance<RegisteredPlugin<K, R>>>;
  }

  async initializePlugin<T extends AnyPlugin>(
    instance: PluginInstance<T>,
    config: any,
    plugins?: Record<string, unknown>,
  ): Promise<InitializedPlugin<T>> {
    const effect = Effect.gen(function* () {
      const pluginService = yield* PluginService;
      const initialized = yield* pluginService.initializePlugin(instance, config, plugins);
      yield* pluginService.registerPlugin(initialized);
      return initialized;
    });
    return this.runPromise(effect);
  }

  async shutdown(): Promise<void> {
    const effect = Effect.gen(function* () {
      const pluginService = yield* PluginService;
      yield* pluginService.cleanup();
    });
    try {
      await this.runPromise(effect);
    } finally {
      this.pluginCache.clear();
      this.routerCache.clear();
      await this.runtime.dispose();
    }
  }

  async evictPlugin<K extends keyof R & string>(
    pluginId: K,
    config: PluginConfigInput<R[K]>,
    plugins?: Record<string, unknown>,
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(pluginId, { ...config, __plugins: plugins ?? {} });

    const effect = Effect.gen({ self: this }, function* () {
      const pluginService = yield* PluginService;
      const cachedPlugin = this.pluginCache.get(cacheKey);

      if (cachedPlugin) {
        this.pluginCache.delete(cacheKey);
        this.routerCache.delete(cacheKey);

        const pluginResult = yield* Effect.tryPromise({
          try: () => cachedPlugin,
          catch: (error) => error,
        }).pipe(Effect.catch(() => Effect.succeed(null)));

        if (pluginResult) {
          yield* pluginService
            .shutdownPlugin(pluginResult)
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning(`Failed to shutdown evicted plugin ${pluginId}`, error),
              ),
            );
        }
      }
    }).pipe(
      Effect.catch((error) => Effect.logWarning(`Plugin eviction failed for ${pluginId}`, error)),
    );

    return this.runPromise(effect);
  }
}

/**
 * Normalizes a remote URL to ensure it points to remoteEntry.js
 * If the URL doesn't end with a file extension, appends /remoteEntry.js
 */
function normalizeRemoteUrl(url: string): string {
  if (!url) return url;
  if (url.endsWith(".js") || url.endsWith(".json")) return url;
  return `${url.endsWith("/") ? url.slice(0, -1) : url}/remoteEntry.js`;
}

/**
 * Extract plugin map (module constructors) from registry entries
 */
function extractPluginMap(
  registry: Record<string, PluginRegistryEntry>,
): Record<string, AnyPluginConstructor> {
  const pluginMap: Record<string, AnyPluginConstructor> = {};

  for (const [pluginId, entry] of Object.entries(registry)) {
    if ("module" in entry && entry.module) {
      pluginMap[pluginId] = entry.module;
    }
  }

  return pluginMap;
}

/**
 * Normalize registry entries - ensure remote URLs are properly formatted
 */
function normalizeRegistry(registry: Record<string, PluginRegistryEntry>): PluginRegistry {
  const normalized: Record<string, PluginRegistryEntry> = {};

  for (const [pluginId, entry] of Object.entries(registry)) {
    if ("module" in entry) {
      normalized[pluginId] = {
        ...entry,
        remote: entry.remote ? normalizeRemoteUrl(entry.remote) : undefined,
      };
    } else {
      normalized[pluginId] = {
        ...entry,
        remote: normalizeRemoteUrl(entry.remote),
      };
    }
  }

  return normalized as PluginRegistry;
}

/**
 * Creates a plugin runtime with support for both module and remote plugin entries.
 *
 * @example
 * ```typescript
 * // With module entries (types inferred automatically)
 * const runtime = createPluginRuntime({
 *   registry: {
 *     telegram: { module: TelegramPlugin },
 *     gopher: { remote: "https://cdn.example.com/gopher/remoteEntry.js" }
 *   },
 *   secrets: { API_KEY: "..." }
 * });
 *
 * // Types are automatically inferred from module entries!
 * const { router } = await runtime.usePlugin("telegram", config);
 * ```
 */
export function createPluginRuntime<TRegistry extends Record<string, PluginRegistryEntry>>(
  config: PluginRuntimeConfig<TRegistry>,
): PluginRuntime<InferRegistryFromEntries<TRegistry>> {
  const secrets = config.secrets || {};
  const normalizedRegistry = normalizeRegistry(config.registry);
  const pluginMap = extractPluginMap(config.registry);

  const layer = PluginServiceLive(normalizedRegistry, secrets, pluginMap);
  const runtime = ManagedRuntime.make(layer);

  return new PluginRuntime(runtime, normalizedRegistry) as PluginRuntime<
    InferRegistryFromEntries<TRegistry>
  >;
}
