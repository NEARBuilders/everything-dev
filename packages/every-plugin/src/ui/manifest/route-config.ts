/**
 * routeConfig.gen.ts contract — the generated import map (ADR 0008 §2).
 *
 * The generator emits one module per ui source exposing a loader per route
 * record: a dynamic import of that route's file, destructured to the option
 * bundle construction needs. Options and component live in the same route
 * file (standard authoring), so both arrive via the same per-route chunk.
 * The host consumes this module — source-resolved from disk in dev,
 * MF-exposed (`./routeConfig`) in production.
 */

import type { ReactNode } from "react";

export interface RouteHeadData {
  meta?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  scripts?: Array<Record<string, unknown>>;
}

export interface RouteOptionsBundle {
  validateSearch?: any;
  search?: { middlewares?: Array<(...args: Array<any>) => any> };
  params?: any;
  loaderDeps?: (...args: Array<any>) => any;
  context?: (...args: Array<any>) => any;
  ssr?: any;
  staleTime?: number;
  gcTime?: number;
  preloadStaleTime?: number;
  pendingMs?: number;
  pendingMinMs?: number;
  shouldReload?: boolean | ((...args: Array<any>) => any);
  loader?: (...args: Array<any>) => any;
  beforeLoad?: (...args: Array<any>) => any;
  head?: (...args: Array<any>) => RouteHeadData;
  staticData?: Record<string, unknown>;
  component?: (props: any) => ReactNode;
  errorComponent?: (props: any) => ReactNode;
  pendingComponent?: (props: any) => ReactNode;
  notFoundComponent?: (props: any) => ReactNode;
}

export type RouteConfigRef = () => Promise<RouteOptionsBundle>;

export type RouteConfigModule = {
  routeConfigLoaders: Record<string, RouteConfigRef>;
  /** Lifted `__root` meta, when the source declares it. */
  rootMeta?: RouteOptionsBundle;
};

/**
 * Every authored route option carried from a route file onto its constructed
 * route. The generated `pick` and `constructTree` both read this list, and
 * the type check below fails when `RouteOptionsBundle` gains a key that is
 * not listed here.
 */
export const ROUTE_OPTION_KEYS = [
  "validateSearch",
  "search",
  "params",
  "loaderDeps",
  "context",
  "ssr",
  "staleTime",
  "gcTime",
  "preloadStaleTime",
  "pendingMs",
  "pendingMinMs",
  "shouldReload",
  "loader",
  "beforeLoad",
  "head",
  "staticData",
  "component",
  "errorComponent",
  "pendingComponent",
  "notFoundComponent",
] as const satisfies ReadonlyArray<keyof RouteOptionsBundle>;

type UnlistedRouteOptionKey = Exclude<keyof RouteOptionsBundle, (typeof ROUTE_OPTION_KEYS)[number]>;
const everyRouteOptionKeyListed: [UnlistedRouteOptionKey] extends [never] ? true : never = true;
void everyRouteOptionKeyListed;
