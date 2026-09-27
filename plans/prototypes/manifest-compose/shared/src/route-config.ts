/**
 * route-config.gen.ts contract — generated import map (ADR 0008 §2).
 *
 * The generator emits one module per plugin exposing a loader per route
 * record: a dynamic import of that route's file, destructured to the option
 * bundle the host needs for construction. Options and component live in the
 * same route file (standard authoring), so both arrive via the same
 * per-route chunk; navigation-deferred component splitting (TanStack
 * auto-split style) is a production optimization layered on this contract.
 *
 * This module type is what the host consumes — source-resolved from disk in
 * dev, MF-exposed (`./route-config`) in production.
 */

export interface RouteOptionsBundle {
  loader?: (...args: Array<any>) => any;
  beforeLoad?: (...args: Array<any>) => any;
  head?: (...args: Array<any>) => any;
  staticData?: Record<string, unknown>;
  component?: (props: any) => any;
  errorComponent?: (props: any) => any;
  pendingComponent?: (props: any) => any;
  notFoundComponent?: (props: any) => any;
}

export type RouteConfigRef = () => Promise<RouteOptionsBundle>;

export type RouteConfigModule = {
  routeConfigLoaders: Record<string, RouteConfigRef>;
  /** Lifted `__root` meta, when the plugin declares it. */
  rootMeta?: RouteOptionsBundle;
};
