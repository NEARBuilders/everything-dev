import type { QueryClient } from "@tanstack/react-query";
import type { AnyRoute, AnyRouteMatch, AnyRouter, RouterHistory } from "@tanstack/react-router";
import type { NavManifest } from "every-plugin/ui/manifest";
import type { ClientRuntimeConfig } from "../types";

export interface RouterContext<TSession = unknown> {
  queryClient: QueryClient;
  runtimeConfig?: Partial<ClientRuntimeConfig>;
  session?: TSession;
  cspNonce?: string;
  /** nav manifest derived from composed routes' staticData.nav */
  pluginNav?: NavManifest;
}

export interface RouterContextWithApi<TApiClient = unknown, TSession = unknown>
  extends RouterContext<TSession> {
  apiClient?: TApiClient;
  /** auth client — concrete apps narrow this to their bound AuthClient type. */
  authClient?: unknown;
}

export interface CreateRouterOptions<TApiClient = unknown, TSession = unknown> {
  history?: RouterHistory;
  context?: Partial<RouterContextWithApi<TApiClient, TSession>>;
  basepath?: string;
  /** composed route tree — manifest construction passes it here; the bundled tree stays the core-only fallback. */
  routeTree?: unknown;
}

export type HeadMeta = NonNullable<AnyRouteMatch["meta"]>[number];
export type HeadLink = NonNullable<AnyRouteMatch["links"]>[number];
export type HeadScript = NonNullable<AnyRouteMatch["headScripts"]>[number];

export interface HeadData {
  meta: HeadMeta[];
  links: HeadLink[];
  scripts: HeadScript[];
}

export interface RenderOptions<TSession = unknown> {
  runtimeConfig: Partial<ClientRuntimeConfig>;
  basepath?: string;
  session?: TSession;
  cspNonce?: string;
  /** composed route tree — server composition only. */
  routeTree?: AnyRoute;
  /** nav manifest derived from composed routes — server composition only. */
  pluginNav?: NavManifest;
  /** correlation id from the host request — appears in SSR error logs. */
  requestId?: string;
}

export interface RenderOptionsWithApi<TApiClient = unknown, TSession = unknown>
  extends RenderOptions<TSession> {
  apiClient: TApiClient;
  authClient?: unknown;
}

export interface RenderResult {
  stream: ReadableStream;
  statusCode: number;
  headers: Headers;
}

export interface RouterModule<TApiClient = unknown, TSession = unknown> {
  createRouter: (opts?: CreateRouterOptions<TApiClient, TSession>) => {
    router: AnyRouter;
    queryClient: QueryClient;
  };
  getRouteHead: (
    pathname: string,
    context?: Partial<RouterContextWithApi<TApiClient, TSession>>,
  ) => Promise<HeadData>;
  renderToStream: (
    request: Request,
    options: RenderOptionsWithApi<TApiClient, TSession>,
  ) => Promise<RenderResult>;
}
