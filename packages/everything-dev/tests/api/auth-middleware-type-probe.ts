import type { Middleware } from "@orpc/server";
import { os } from "@orpc/server";
import { type AuthContextShape, createAuthMiddleware } from "../../src/api/auth-middleware";

type IsAny<T> = 0 extends 1 & T ? true : false;

type AssertNotAny<T, Msg extends string> = IsAny<T> extends true ? Msg : true;

type MiddlewareOutContext<TMiddleware> =
  TMiddleware extends Middleware<any, infer OutContext, any, any, any> ? OutContext : never;

type Expect<T extends boolean, Msg extends string> = true extends T ? true : Msg;

type ChildContext = AuthContextShape & { "effect/context": { fiber: unknown } };

const childBuilder = os.$context<ChildContext>();
const { requireAuth, requireAuthOrApiKey, requirePermission } =
  createAuthMiddleware<ChildContext>(childBuilder);

type OrApiKeyOut = MiddlewareOutContext<typeof requireAuthOrApiKey>;
type PermissionOut = MiddlewareOutContext<ReturnType<typeof requirePermission>>;

export const requireAuthOrApiKeyAddsNoContextKeys: Expect<
  [keyof OrApiKeyOut] extends [never] ? true : false,
  "requireAuthOrApiKey declares real output keys — oRPC IntersectPick forces every context key through (issue #464)"
> = true;

export const requirePermissionAddsNoContextKeys: Expect<
  [keyof PermissionOut] extends [never] ? true : false,
  "requirePermission declares real output keys — oRPC IntersectPick forces every context key through (issue #464)"
> = true;

export const requireAuthOrApiKeyIsNotAny: AssertNotAny<
  typeof requireAuthOrApiKey,
  "requireAuthOrApiKey collapsed to any (issue #464)"
> = true;

export const requirePermissionIsNotAny: AssertNotAny<
  typeof requirePermission,
  "requirePermission collapsed to any (issue #464)"
> = true;

export const authOrApiKeyRoute = childBuilder
  .use(requireAuthOrApiKey)
  .handler(({ context }) => context["effect/context"].fiber);

export const permissionRoute = childBuilder
  .use(requirePermission("thing", "read"))
  .handler(({ context }) => context["effect/context"].fiber);

export const narrowedThenPassThroughRoute = childBuilder
  .use(requireAuth)
  .use(requireAuthOrApiKey)
  .handler(({ context }) => context["effect/context"].fiber);
