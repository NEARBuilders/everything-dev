import type { QueryClient } from "@tanstack/react-query";
import type { AnyRouteMatch, AnyRouter, RouterHistory } from "@tanstack/react-router";
import type { ClientRuntimeConfig } from "../types";

export interface RouterContext<TSession = unknown> {
  queryClient: QueryClient;
  runtimeConfig?: Partial<ClientRuntimeConfig>;
  session?: TSession;
  cspNonce?: string;
}

export interface RouterContextWithApi<TApiClient = unknown, TSession = unknown>
  extends RouterContext<TSession> {
  apiClient?: TApiClient;
}

export interface CreateRouterOptions<TApiClient = unknown, TSession = unknown> {
  history?: RouterHistory;
  context?: Partial<RouterContextWithApi<TApiClient, TSession>>;
  basepath?: string;
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
