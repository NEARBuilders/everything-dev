import { Context, Effect, Layer, type Scope } from "effect";

/**
 * Builds a layer with the current scope and returns the built context.
 *
 * Resources are released when the plugin's scope closes. Use inside
 * `initialize` for multi-service layers; resolve individual services from
 * the returned context with `Context.get`.
 */
export const buildScopedContext = <A, E, R>(
  layer: Layer.Layer<A, E, R>,
): Effect.Effect<Context.Context<A>, E, Scope.Scope | R> =>
  Effect.flatMap(Effect.scope, (scope) => Layer.buildWithScope(layer, scope));

/**
 * Builds a layer with the current scope and resolves one service from it.
 *
 * Equivalent to `buildScopedContext` + `Context.get` for single-service
 * layers: `const db = yield* buildScoped(DatabaseTag, DatabaseLive(url))`.
 */
export const buildScoped = <Identifier, Shape, E, R>(
  tag: Context.Service<Identifier, Shape>,
  layer: Layer.Layer<Identifier, E, R>,
): Effect.Effect<Shape, E, Scope.Scope | R> =>
  buildScopedContext(layer).pipe(Effect.map((context) => Context.get(context, tag)));
