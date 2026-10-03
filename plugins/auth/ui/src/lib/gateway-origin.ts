import type { RouterContext } from "@/context";

const LOCALHOST_SUFFIX = ".localhost";

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname.endsWith(LOCALHOST_SUFFIX);
}

export function getGatewayOrigin(
  runtimeConfig: RouterContext["runtimeConfig"],
  current: URL = new URL(window.location.href),
): string {
  if (isLocalHostname(current.hostname)) {
    return `${current.protocol}//localhost${current.port ? `:${current.port}` : ""}`;
  }
  const gatewayId = runtimeConfig?.runtime?.gatewayId;
  return gatewayId ? `https://${gatewayId}` : current.origin;
}
