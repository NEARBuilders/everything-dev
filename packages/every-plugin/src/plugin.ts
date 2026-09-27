import type { AnyContractRouter, AnySchema, InferSchemaOutput } from "@orpc/contract";
import type { WithEffectContext } from "@orpc/experimental-effect";
import "@orpc/experimental-effect/extensions/effect";
import type { ContractedRouter, Implementer } from "@orpc/server";
import { implement } from "@orpc/server";
import type { Scope } from "effect";
import { Context, Effect, Layer } from "effect";

type ContextOutput<T> = T extends AnySchema ? InferSchemaOutput<T> : Record<string, never>;

export type PluginConfigFor<
  V extends AnySchema,
  S extends AnySchema,
  TRequestContext extends AnySchema | undefined,
> = {
  variables: V;
  secrets: S;
  context: TRequestContext;
};

type PluginInitializeInput<V extends AnySchema, S extends AnySchema> = {
  variables: InferSchemaOutput<V>;
  secrets: InferSchemaOutput<S>;
};

export class PluginIdTag extends Context.Service<PluginIdTag, string>()("PluginId") {}

/**
 * The `initialize` effect's environment: the plugin lifecycle scope plus the
 * framework-assigned plugin id.
 */
export type PluginEnv = Scope.Scope | PluginIdTag;

type PluginDefinition<
  V extends AnySchema,
  S extends AnySchema,
  TContract extends AnyContractRouter,
  TRequestContext extends AnySchema | undefined,
  P extends Record<string, unknown>,
> = {
  variables: V;
  secrets: S;
  contract: TContract;
  context?: TRequestContext;
  /**
   * Optional tag under which `initialize` exposes the plugin's services.
   * The host uses it to read services (e.g. the auth plugin's Better Auth
   * handler) from the built Effect context without importing the plugin
   * module statically.
   */
  servicesTag?: Context.Key<any, any>;
  /**
   * Initialize the plugin by returning an Effect `Layer`.
   *
   * The runtime builds the Layer against the plugin's lifecycle scope —
   * scoped resources (db pools, repositories, caches, publishers) release
   * when the plugin shuts down. Services are provided to `.effect()`
   * handlers via the oRPC context (`yield* Tag`).
   */
  initialize?: (
    config: PluginInitializeInput<V, S>,
    plugins: P,
  ) => Effect.Effect<Layer.Layer<any, any, any>, Error, PluginEnv>;
  /**
   * Creates the strongly-typed oRPC router for this plugin.
   * Services come from the Effect context — access them with
   * `yield* Tag` in `.effect()` handlers, or
   * `Context.get(context["effect/context"], Tag)` in plain handlers.
   * Sibling plugin entries in `plugins` carry `{ client, router }`.
   */
  createRouter: (
    builder: Implementer<TContract, ContextOutput<TRequestContext> & WithEffectContext<any>>,
    plugins: P,
  ) => ContractedRouter<TContract, any>;
};

/**
 * Loaded plugin with static binding property
 */
export interface LoadedPluginWithBinding<
  TContract extends AnyContractRouter,
  TVariables extends AnySchema,
  TSecrets extends AnySchema,
  TRequestContext extends AnySchema | undefined,
> {
  new (): Plugin<TContract, TVariables, TSecrets, TRequestContext>;
  binding: {
    contract: TContract;
    variables: TVariables;
    secrets: TSecrets;
    context: TRequestContext;
    servicesTag?: Context.Key<any, any>;
  };
}

/**
 * Plugin interface
 */
export interface Plugin<
  TContract extends AnyContractRouter,
  TVariables extends AnySchema,
  TSecrets extends AnySchema,
  TRequestContext extends AnySchema | undefined,
> {
  readonly id: string;
  readonly contract: TContract;
  readonly configSchema: PluginConfigFor<TVariables, TSecrets, TRequestContext>;
  readonly servicesTag?: Context.Key<any, any>;

  initialize(
    config: PluginInitializeInput<TVariables, TSecrets>,
    plugins: Record<string, unknown>,
  ): Effect.Effect<Layer.Layer<any, any, any>, unknown, PluginEnv>;

  /**
   * Creates the strongly-typed oRPC router for this plugin.
   * The router's procedure types are inferred directly from the contract.
   * @param plugins Sibling plugin entries (`{ client, router }`) for
   * cross-plugin composition
   * @returns A router with procedures matching the plugin's contract
   */
  createRouter(plugins: Record<string, unknown>): ContractedRouter<TContract, any>;
}

export interface CreatePluginFn {
  <
    V extends AnySchema,
    S extends AnySchema,
    TContract extends AnyContractRouter,
    TRequestContext extends AnySchema | undefined = undefined,
    P extends Record<string, unknown> = Record<string, never>,
  >(
    config: PluginDefinition<V, S, TContract, TRequestContext, P>,
  ): LoadedPluginWithBinding<TContract, V, S, TRequestContext>;

  withPlugins: <P extends Record<string, unknown>>() => CreatePluginWithPlugins<P>;
}

export const createPlugin: CreatePluginFn = function createPlugin<
  V extends AnySchema,
  S extends AnySchema,
  TContract extends AnyContractRouter,
  TRequestContext extends AnySchema | undefined = undefined,
  P extends Record<string, unknown> = Record<string, never>,
>(config: PluginDefinition<V, S, TContract, TRequestContext, P>) {
  const configSchema: PluginConfigFor<V, S, TRequestContext> = {
    variables: config.variables,
    secrets: config.secrets,
    context: config.context as TRequestContext,
  };

  class CreatedPlugin implements Plugin<TContract, V, S, TRequestContext> {
    /** set during instantiation - registry key */
    id!: string;
    readonly contract = config.contract;
    readonly configSchema = configSchema;
    readonly servicesTag = config.servicesTag;

    initialize(
      pluginConfig: PluginInitializeInput<V, S>,
      plugins: Record<string, unknown> = {},
    ): Effect.Effect<Layer.Layer<any, any, any>, unknown, PluginEnv> {
      const init =
        config.initialize ??
        (() => Effect.succeed(Layer.empty as unknown as Layer.Layer<any, any, any>));

      return init(pluginConfig, plugins as P) as Effect.Effect<
        Layer.Layer<any, any, any>,
        unknown,
        PluginEnv
      >;
    }

    createRouter(plugins: Record<string, unknown>): ContractedRouter<TContract, any> {
      const builder = implement(config.contract).$context<
        ContextOutput<TRequestContext> & WithEffectContext<any>
      >();
      return config.createRouter(builder as any, plugins as P) as ContractedRouter<TContract, any>;
    }
  }

  const PluginConstructor = CreatedPlugin as unknown as {
    new (): Plugin<TContract, V, S, TRequestContext>;
    binding: {
      contract: TContract;
      variables: V;
      secrets: S;
      context: TRequestContext;
      servicesTag?: Context.Key<any, any>;
    };
  };

  PluginConstructor.binding = {
    contract: config.contract,
    variables: config.variables,
    secrets: config.secrets,
    context: config.context as TRequestContext,
    servicesTag: config.servicesTag,
  };

  return PluginConstructor as LoadedPluginWithBinding<TContract, V, S, TRequestContext>;
};

export type CreatePluginWithPlugins<P extends Record<string, unknown>> = <
  V extends AnySchema,
  S extends AnySchema,
  TContract extends AnyContractRouter,
  TRequestContext extends AnySchema | undefined = undefined,
>(
  config: PluginDefinition<V, S, TContract, TRequestContext, P>,
) => LoadedPluginWithBinding<TContract, V, S, TRequestContext>;

export function withPlugins<P extends Record<string, unknown>>(): CreatePluginWithPlugins<P> {
  return <
    V extends AnySchema,
    S extends AnySchema,
    TContract extends AnyContractRouter,
    TRequestContext extends AnySchema | undefined = undefined,
  >(
    config: PluginDefinition<V, S, TContract, TRequestContext, P>,
  ) => createPlugin<V, S, TContract, TRequestContext, P>(config as any);
}

createPlugin.withPlugins = withPlugins;
