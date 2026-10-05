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
 * `/bundles` itself. The upload origin is the env, the `bos login` session's
 * siteUrl, or the runtime's own gateway. A session pinned to a local site is
 * a hard error (the origin can only ever be a squatter's port); an env-pinned
 * local origin is deliberate local testing and only warns. Config-only
 * publishes (`uploadsPlanned: false`) ship the committed config verbatim —
 * no origins are resolved and nothing is required.
 */
export function resolveCdnDeployInputs(input: {
  env: Record<string, string | undefined>;
  bosConfig: { cdn?: { origin?: string } } | null;
  session: SessionCredentialLike | null;
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
    storageOrigin = `https://${input.gateway}`;
  }

  if (!apiKey) {
    return {
      cdnOrigin,
      storageOrigin,
      apiKey,
      warning,
      error:
        "CDN deploy requires bundle-upload credentials — run `bos login --key` and add the printed key " +
        "to GitHub secrets as BOS_STORAGE_API_KEY (or run `bos login` for interactive deploys)",
    };
  }
  if (input.session?.accountId && input.session.accountId !== input.account) {
    return {
      cdnOrigin,
      storageOrigin,
      apiKey,
      warning,
      error: `The CLI session was created for ${input.session.accountId}, but the configured account is ${input.account}. Re-run bos login under the matching account.`,
    };
  }
  return { cdnOrigin, storageOrigin, apiKey, warning };
}

/**
 * Pre-upload probe: the storage origin must actually be the platform API.
 * `/.well-known/mcp.json` is the cheapest unauthenticated platform
 * fingerprint — a random service squatting the port (or a stale session
 * pointing at the wrong server) fails here before megabytes move.
 */
export async function probeStorageOrigin(
  storageOrigin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const probeUrl = `${storageOrigin.replace(/\/$/, "")}/.well-known/mcp.json`;
  let response: Response;
  try {
    response = await fetchImpl(probeUrl, { headers: { accept: "application/json" } });
  } catch (error) {
    return `unreachable (${error instanceof Error ? error.message : error})`;
  }
  if (!response.ok) {
    return `GET /.well-known/mcp.json responded ${response.status}`;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return "did not return the platform MCP descriptor (non-JSON response)";
  }
  if (!body || typeof body !== "object") {
    return "did not return the platform MCP descriptor";
  }
  return undefined;
}
