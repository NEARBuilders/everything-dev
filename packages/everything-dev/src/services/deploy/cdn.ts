interface SessionCredentialLike {
  apiKey?: string;
  siteUrl?: string;
  accountId?: string | null;
}

export interface CdnDeployInputs {
  cdnOrigin: string | undefined;
  storageOrigin: string;
  apiKey: string | undefined;
  warning?: string;
  error?: string;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "local"]);

/**
 * The platform CDN and its standalone write path (ADR 0027). A runtime whose
 * effective `cdn.origin` is the platform CDN uploads bundles through the
 * platform upload service — never through an app site, which only serves the
 * platform API and 404s the upload route.
 */
export const PLATFORM_CDN_ORIGIN = "https://cdn.everything.dev";
export const PLATFORM_UPLOAD_ORIGIN = "https://upload.everything.dev";

/** Local/private destinations can never serve production bundles. */
export function isLocalOrigin(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return true;
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      LOCAL_HOSTNAMES.has(host) ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      /^127\.\d+\.\d+\.\d+$/.test(host) ||
      /^10\.\d+\.\d+\.\d+$/.test(host) ||
      /^192\.168\.\d+\.\d+$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host) ||
      host.startsWith("169.254.") ||
      (host.includes(":") &&
        (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")))
    );
  } catch {
    return true;
  }
}

/**
 * Deploy origin resolution (ADR 0020, as amended): the CDN origin comes from
 * the env or the authored `cdn.origin` (inherited via extends) — a hard
 * requirement when uploads are planned, because the host never serves
 * `/bundles` itself. The upload origin is the env, the platform upload
 * service when the effective CDN is the platform CDN (an app-site session
 * URL is not an upload origin by design), the `bos login` session's siteUrl,
 * or the runtime's own gateway. A session pinned to a local site is a hard
 * error (the origin can only ever be a squatter's port); an env-pinned local
 * origin is deliberate local testing and only warns. Config-only publishes
 * (`uploadsPlanned: false`) ship the committed config verbatim — no origins
 * are resolved and nothing is required.
 */
export function resolveCdnDeployInputs(input: {
  env: Record<string, string | undefined>;
  bosConfig: { cdn?: { origin?: string } } | null;
  session: SessionCredentialLike | null;
  custodyAccount?: string;
  account: string;
  gateway: string;
  uploadsPlanned: boolean;
}): CdnDeployInputs {
  const envCdnOrigin = input.env.BOS_BUNDLE_CDN_ORIGIN?.replace(/\/$/, "");
  const configCdnOrigin = input.bosConfig?.cdn?.origin?.replace(/\/$/, "");
  const storageEnvOrigin = input.env.BOS_STORAGE_ORIGIN?.replace(/\/$/, "");
  const sessionSite = input.session?.siteUrl?.replace(/\/$/, "");
  const apiKey = input.env.BOS_STORAGE_API_KEY ?? input.session?.apiKey;
  const uploadsPlanned = input.uploadsPlanned;

  const storageOriginDefault = storageEnvOrigin ?? sessionSite ?? `https://${input.gateway}`;

  if (!uploadsPlanned) {
    return { cdnOrigin: undefined, storageOrigin: storageOriginDefault, apiKey };
  }

  let cdnOrigin: string | undefined;
  let warning: string | undefined;
  if (envCdnOrigin) {
    cdnOrigin = envCdnOrigin;
    if (isLocalOrigin(envCdnOrigin)) {
      warning = `BOS_BUNDLE_CDN_ORIGIN is a local URL (${envCdnOrigin}) — deploying to a local stack, published bundle URLs will not resolve publicly.`;
    }
  } else if (configCdnOrigin) {
    if (isLocalOrigin(configCdnOrigin)) {
      return {
        cdnOrigin,
        storageOrigin: storageOriginDefault,
        apiKey,
        error:
          `the authored config sets cdn.origin to the local URL ${configCdnOrigin} — deploy bundle ` +
          "origins must be publicly reachable. Set BOS_BUNDLE_CDN_ORIGIN for a local deploy, " +
          "or fix cdn.origin (inherited via extends).",
      };
    }
    cdnOrigin = configCdnOrigin;
  } else {
    return {
      cdnOrigin,
      storageOrigin: storageOriginDefault,
      apiKey,
      error:
        "CDN deploy requires a bundle origin — set `cdn.origin` in bos.config.json " +
        "(children inherit it from the base runtime via extends) or BOS_BUNDLE_CDN_ORIGIN " +
        "in the environment.",
    };
  }

  let storageOrigin: string;
  if (storageEnvOrigin) {
    storageOrigin = storageEnvOrigin;
    if (isLocalOrigin(storageEnvOrigin) && !warning) {
      warning = `BOS_STORAGE_ORIGIN is a local URL (${storageEnvOrigin}) — uploading to a local stack.`;
    }
  } else if (cdnOrigin === PLATFORM_CDN_ORIGIN) {
    storageOrigin = PLATFORM_UPLOAD_ORIGIN;
  } else if (sessionSite) {
    if (isLocalOrigin(sessionSite)) {
      return {
        cdnOrigin,
        storageOrigin: sessionSite,
        apiKey,
        error:
          `The CLI session pins uploads to ${sessionSite} — a local site can never receive ` +
          "production bundles. Re-run `bos login` against the production site, or set " +
          "BOS_STORAGE_ORIGIN explicitly.",
      };
    }
    storageOrigin = sessionSite;
  } else {
    return {
      cdnOrigin,
      storageOrigin: storageOriginDefault,
      apiKey,
      warning,
      error:
        `Bundle uploads require an upload-service origin — the gateway (${input.gateway}) no longer serves ` +
        "uploads (ADR 0027: the upload service is standalone at upload.everything.dev). Set BOS_STORAGE_ORIGIN " +
        "in the environment (CI) or re-run `bos login` against the production site so the session pins it.",
    };
  }

  if (!apiKey) {
    return {
      cdnOrigin,
      storageOrigin,
      apiKey,
      warning,
      error:
        "CDN deploy requires bundle-upload credentials — run `bos login --key` and add the printed key " +
        "to GitHub secrets as BOS_STORAGE_API_KEY (the deploy key also serves interactive deploys)",
    };
  }
  const uploadIdentities = new Set(
    [input.session?.accountId, input.custodyAccount].filter((id): id is string => !!id),
  );
  if (uploadIdentities.size > 0 && !uploadIdentities.has(input.account)) {
    const sessionAccount = input.session?.accountId;
    return {
      cdnOrigin,
      storageOrigin,
      apiKey,
      warning,
      error: sessionAccount
        ? `The CLI session was created for ${sessionAccount}, but the configured account is ${input.account}. Re-run bos login under the matching account.`
        : `The configured account is ${input.account}, but the custody publish identity is ${input.custodyAccount}. Set the authored config's account to the custody wallet account.`,
    };
  }
  return { cdnOrigin, storageOrigin, apiKey, warning };
}

/**
 * Pre-upload probe: the storage origin must actually be the bundle-upload
 * service.
 * `/health` is the readiness check, with MCP kept as a compatibility fallback
 * for older fixtures and legacy hosts — but an app host running the platform
 * API answers both without serving uploads (issue #666), so the upload route
 * itself is probed last: the upload service guards `POST /api/storage/bundles`
 * behind auth (401/400), while an app host 404s it. Only 404/405 fail the
 * probe.
 */
export async function probeStorageOrigin(
  storageOrigin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const base = storageOrigin.replace(/\/$/, "");
  const healthUrl = `${base}/health`;
  const mcpUrl = `${base}/.well-known/mcp.json`;
  let healthOk = false;
  let healthStatus = 0;
  let response: Response;
  try {
    response = await fetchImpl(healthUrl, { headers: { accept: "text/plain" } });
  } catch (error) {
    return `unreachable (${String(error instanceof Error ? error.message : error)})`;
  }
  healthStatus = response.status;
  if (response.ok) {
    const body = await response.text().catch(() => "");
    healthOk = body.trim() === "OK" || body.trim().length === 0;
  }
  if (!healthOk) {
    let mcpResponse: Response;
    try {
      mcpResponse = await fetchImpl(mcpUrl, { headers: { accept: "application/json" } });
    } catch {
      return `GET /health responded ${healthStatus}; fallback /.well-known/mcp.json unreachable`;
    }
    if (!mcpResponse.ok) {
      return `GET /health responded ${healthStatus}; GET /.well-known/mcp.json responded ${mcpResponse.status}`;
    }
    try {
      const body = await mcpResponse.json();
      if (!body || typeof body !== "object") {
        return "did not return the platform MCP descriptor";
      }
    } catch {
      return "did not return the platform MCP descriptor (non-JSON response)";
    }
  }
  let uploadProbe: Response;
  try {
    uploadProbe = await fetchImpl(`${base}/api/storage/bundles`, { method: "POST" });
  } catch (error) {
    return `the platform API answered, but POST /api/storage/bundles was unreachable (${String(error instanceof Error ? error.message : error)})`;
  }
  if (uploadProbe.status === 404 || uploadProbe.status === 405) {
    return (
      `POST /api/storage/bundles responded ${uploadProbe.status} — this origin is an app host, ` +
      "not the platform upload service. Set BOS_STORAGE_ORIGIN=https://upload.everything.dev " +
      "(the platform CDN's write path) or re-run `bos login` against the production site."
    );
  }
  return undefined;
}
