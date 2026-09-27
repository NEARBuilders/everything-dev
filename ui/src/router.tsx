/**
 * Client router — thin stub injecting the app's generated route tree into the
 * framework router factory, keeping full route-type inference for the app.
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import { createRouter as createCoreRouter } from "everything-dev/ui/router-client";
import type { ApiClient, CreateRouterOptions, SessionData } from "./app";
import { routeTree } from "./routeTree.gen";

export type {
  ClientRuntimeConfig,
  CreateRouterOptions,
  RouterContext,
  RouterModule,
} from "./app";

export function createRouter(opts: CreateRouterOptions) {
  return createCoreRouter<ApiClient, SessionData, typeof routeTree>({
    ...opts,
    defaultRouteTree: routeTree,
  });
}

export { routeTree };

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>["router"];
  }
}
