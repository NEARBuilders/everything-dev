import { createRouterClient } from "@orpc/server";
import { Cause, Effect, Exit, Hash, ManagedRuntime, Option } from "effect";
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
import { PluginService } from "./services/plugin.service";

export class PluginRuntime<R = RegisteredPlugins> {
  readonly __registryType?: R;

  private pluginCache = new Map<
    string,
    Effect.Effect<InitializedPlugin<AnyPlugin>, PluginRuntimeError>
  >();

  constructor(
    private runtime: ManagedRuntime.ManagedRuntime<PluginService, never>,
    private registry: PluginRegistry,
  ) {}

  private generateCacheKey(pluginId: string, config: unknown): string {
    const configHash = Hash.structure(config as object).toString();
    return `${pluginId}:${configHash}`;
  }

  private validatePluginId(pluginId: string): Effect.Effect<string, PluginRuntimeError> {
    if (!(pluginId in this.registry)) {
      return Effect.fail(
        new PluginRuntimeError({
          pluginId: String(pluginId),
          operation: "validate-plugin-id",
          cause: new Error(`Plugin ID '${String(pluginId)}' not found in registry.`),
          retryable: false,
        }),
      );
    }
    return Effect.succeed(String(pluginId));
  }

  private async runPromise<A, E>(effect: Effect.Effect<A, E, PluginService>): Promise<A> {
    const exit = await this.runtime.runPromiseExit(effect);

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
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
      const operation = Effect.gen(this, function* () {
        const pluginService = yield* PluginService;
        const validatedId = yield* this.validatePluginId(pluginId);

        // Load → Instantiate → Initialize → Register
        const ctor = yield* pluginService.loadPlugin(validatedId);
        const instance = yield* pluginService.instantiatePlugin(pluginId, ctor);
        const initialized = yield* pluginService.initializePlugin(instance, config, plugins);
        yield* pluginService.registerPlugin(initialized);

        return initialized;
      }).pipe(Effect.annotateLogs({ plugin: pluginId }), Effect.provide(this.runtime));

      cachedPlugin = Effect.cached(operation).pipe(Effect.flatten);
      this.pluginCache.set(cacheKey, cachedPlugin);
    }

    let initialized: InitializedPlugin<AnyPlugin>;
    try {
      initialized = await this.runPromise(cachedPlugin);
    } catch (error) {
      // Evict failed initializations so the next call retries instead
      // of returning the permanently-cached failure from Effect.cached.
      this.pluginCache.delete(cacheKey);
      throw error;
    }

    // Construct the router once per plugin instance, not per client/request.
    const router = initialized.plugin.createRouter(initialized.context) as PluginRouterType<R[K]>;

    // Create client factory that accepts request context
    const createClient = (context?: any) => createRouterClient(router, { context: context ?? {} });

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
    }).pipe(Effect.annotateLogs({ plugin: pluginId }));
    return this.runPromise(effect) as Promise<LoadedPlugin<RegisteredPlugin<K, R>>>;
  }

  async instantiatePlugin<K extends keyof R & string>(
    pluginId: K,
    loadedPlugin: LoadedPlugin<RegisteredPlugin<K, R>>,
  ): Promise<PluginInstance<RegisteredPlugin<K, R>>> {
    const effect = Effect.gen(function* () {
      const pluginService = yield* PluginService;
      return yield* pluginService.instantiatePlugin(pluginId, loadedPlugin);
    }).pipe(Effect.annotateLogs({ plugin: pluginId }));
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
    }).pipe(Effect.annotateLogs({ plugin: instance.plugin.id }));
    return this.runPromise(effect);
  }

  async shutdown(): Promise<void> {
    const effect = Effect.gen(function* () {
      const pluginService = yield* PluginService;
      yield* pluginService.cleanup();
    });
    await this.runPromise(effect);
    await this.runtime.dispose();
  }

  async evictPlugin<K extends keyof R & string>(
    pluginId: K,
    config: PluginConfigInput<R[K]>,
    plugins?: Record<string, unknown>,
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(pluginId, { ...config, __plugins: plugins ?? {} });

    const effect = Effect.gen(this, function* () {
      const pluginService = yield* PluginService;
      const cachedPlugin = this.pluginCache.get(cacheKey);

      if (cachedPlugin) {
        this.pluginCache.delete(cacheKey);

        const pluginResult = yield* cachedPlugin.pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (pluginResult) {
          yield* pluginService
            .shutdownPlugin(pluginResult)
            .pipe(
              Effect.catchAll((error) =>
                Effect.logWarning(`Failed to shutdown evicted plugin ${pluginId}`, error),
              ),
            );
        }
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.logWarning(`Plugin eviction failed for ${pluginId}`, error),
      ),
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

  const layer = PluginService.Live(normalizedRegistry, secrets, pluginMap);
  const runtime = ManagedRuntime.make(layer);

  return new PluginRuntime(runtime, normalizedRegistry) as PluginRuntime<
    InferRegistryFromEntries<TRegistry>
  >;
}
