import { Context, Effect, Layer, Scope } from "effect";

export const buildScopedContext = <A, E, R>(
  layer: Layer.Layer<A, E, R>,
): Effect.Effect<Context.Context<A>, E, Scope.Scope | R> =>
  Effect.flatMap(Effect.scope, (scope) => Layer.buildWithScope(layer, scope));

export const buildScoped = <S, A, E, R>(
  tag: Context.Service<S, A>,
  layer: Layer.Layer<S, E, R>,
): Effect.Effect<A, E, Scope.Scope | R> =>
  Effect.map(buildScopedContext(layer), (context) => Context.get(context, tag));
