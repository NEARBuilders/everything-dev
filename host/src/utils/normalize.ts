export function normalizeUrl(url?: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}

export function resolveDomain(domain: string | undefined, fallbackHostUrl: string): string {
  if (domain && domain.length > 0) {
    return domain;
  }

  try {
    return new URL(fallbackHostUrl).hostname;
  } catch {
    return (
      fallbackHostUrl
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
        .split(":")[0] ?? ""
    );
  }
}

export function toProtocolUrl(domain: string | undefined, env: string): string | undefined {
  if (!domain) return domain;
  if (/^https?:\/\//.test(domain)) return domain;
  if (env === "development" && /^(localhost|127\.0\.0\.1)/.test(domain)) {
    return `http://${domain}`;
  }
  return `https://${domain}`;
}
