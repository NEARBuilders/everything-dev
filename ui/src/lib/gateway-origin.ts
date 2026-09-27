const LOCALHOST_SUFFIX = ".localhost";

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname.endsWith(LOCALHOST_SUFFIX);
}

export function getGatewayOrigin(
  gatewayId: string | undefined,
  current: URL = new URL(window.location.href),
): string {
  if (isLocalHostname(current.hostname)) {
    return `${current.protocol}//localhost${current.port ? `:${current.port}` : ""}`;
  }
  return gatewayId ? `https://${gatewayId}` : current.origin;
}

export function onboardingUrl(gatewayOrigin: string, code: string): string {
  return `${gatewayOrigin}/onboard?code=${encodeURIComponent(code)}`;
}
