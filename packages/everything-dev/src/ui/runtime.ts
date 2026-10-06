import type { ClientRuntimeConfig } from "../types";

export type { ClientRuntimeInfo } from "../types";

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: ClientRuntimeConfig;
    __CSP_NONCE__?: string;
  }
}

export function getRuntimeConfig(): ClientRuntimeConfig {
  if (typeof window === "undefined") {
    throw new Error("Runtime config is only available in the browser");
  }

  if (!window.__RUNTIME_CONFIG__) {
    throw new Error("Missing runtime config");
  }

  return window.__RUNTIME_CONFIG__;
}

export function getCspNonce() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.__CSP_NONCE__;
}

export function getAppName(config?: Partial<ClientRuntimeConfig>): string {
  const runtimeConfig =
    config ?? (typeof window === "undefined" ? undefined : window.__RUNTIME_CONFIG__);
  return runtimeConfig?.runtime?.title ?? runtimeConfig?.account ?? "";
}

export function buildRuntimeHref(pathname: string, runtimeConfig?: Partial<ClientRuntimeConfig>) {
  const basePath = runtimeConfig?.runtime?.runtimeBasePath ?? "/";
  if (basePath === "/") {
    return pathname;
  }

  if (!pathname.startsWith("/")) {
    return `${basePath}/${pathname}`;
  }

  return pathname === "/" ? basePath : `${basePath}${pathname}`;
}

export function buildPublishedAccountHref(accountId: string) {
  return `/apps/${encodeURIComponent(accountId)}`;
}

export function buildPublishedGatewayHref(accountId: string, gatewayId: string) {
  return `${buildPublishedAccountHref(accountId)}/${encodeURIComponent(gatewayId)}`;
}
