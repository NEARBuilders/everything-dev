import { getConnInfo } from "@hono/node-server/conninfo";
import { Config, Context, Effect, Layer } from "effect";
import type { Context as HonoContext, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { NONCE, secureHeaders } from "hono/secure-headers";
import { type ClientRateLimitInfo, rateLimiter, type Store } from "hono-rate-limiter";
import { createBindingResolver, type TenantBinding } from "../services/binding-resolver";
import { ConfigService, readCorsOrigins } from "../services/config";
import type { RuntimePlugin } from "../types";
import { logger } from "../utils/logger";
import { resolveDomain } from "../utils/normalize";
import { originMatches } from "../utils/origin-match";

export const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 900_000;
export const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 2000;
export const RATE_LIMIT_MUTATION_MAX = Number(process.env.RATE_LIMIT_MUTATION_MAX) || 60;
export const RATE_LIMIT_STORE_MAX_ENTRIES =
  Number(process.env.RATE_LIMIT_STORE_MAX_ENTRIES) || 10_000;
export const BODY_LIMIT_MAX = Number(process.env.BODY_LIMIT_MAX) || 10 * 1024 * 1024;
export const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS) || 30_000;

const DEFAULT_MAX_BUNDLE_UPLOAD_BYTES = 64 * 1024 * 1024;

export function bundleUploadBodyLimitBytes(): number {
  const raw = Number(process.env.BOS_MAX_BUNDLE_UPLOAD_BYTES);
  const decoded = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BUNDLE_UPLOAD_BYTES;
  return Math.ceil(decoded * 1.5);
}

const DEFAULT_STORAGE_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export function storageUploadTimeoutMs(): number {
  const raw = Number(process.env.BOS_STORAGE_UPLOAD_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STORAGE_UPLOAD_TIMEOUT_MS;
}

export const STATIC_ASSET_PATTERN =
  /\.(js|css|png|jpg|jpeg|gif|svg|ico|json|md|webmanifest|woff2?|ttf|eot|webp|avif|map|txt|xml)$/i;

/**
 * Edge-limited transports that own their throttling: oRPC (all procedure
 * calls are POSTs — a method-based mutation tier would collapse the whole
 * API into the strict bucket), Better-Auth (its core limiter is enabled in
 * production), and MCP (agents are legitimately chatty).
 */
const SENSITIVE_MUTATION_EXEMPT_PREFIXES = ["/api/rpc/", "/api/auth/", "/api/mcp"];

let warnedSocketFallback = false;

/**
 * The trusted-IP header for rate-limit identity, by precedence: the
 * `BOS_CLIENT_IP_HEADER` env override, then the authored config's
 * `auth.variables.ipAddress.ipAddressHeaders[0]` — the same source Better
 * Auth reads, so a runtime that declares its edge header gets correct
 * host-side behavior with zero operator action — else "" (the socket
 * fallback). Pure so the factory wiring and the decision stay separately
 * testable.
 */
export function resolveTrustedIpHeader(
  envValue: string | undefined,
  authVariables: unknown,
): string {
  const fromEnv = envValue?.trim();
  if (fromEnv) return fromEnv;
  const headers = (authVariables as { ipAddress?: { ipAddressHeaders?: unknown } } | undefined)
    ?.ipAddress?.ipAddressHeaders;
  const first = Array.isArray(headers) ? headers[0] : undefined;
  return typeof first === "string" ? first.trim() : "";
}

/**
 * Rate-limit identity resolution. The trusted header must be set by the edge,
 * which replaces any client-sent value — requests key on what the proxy wrote
 * (Better Auth's documented "a proxy puts the client address in its own
 * header" row). Without configuration the socket address is the identity:
 * spoof-proof on a directly exposed host, and a shared per-socket bucket
 * behind a proxy (Better Auth's documented "clients connect directly"
 * trade-off) — warn once in production so the misconfiguration surfaces
 * instead of silently collapsing all clients into one bucket.
 */
export function clientIpOf(
  headers: Record<string, string | undefined>,
  socketAddress: string,
  trustedHeader: string,
): string {
  if (trustedHeader) {
    const value = headers[trustedHeader.toLowerCase()]?.trim();
    if (value) return value;
  }
  return socketAddress;
}

export function clientKeyOf(c: HonoContext, trustedHeader: string): string {
  let socketAddress = "unknown";
  try {
    socketAddress = getConnInfo(c).remote.address ?? "unknown";
  } catch {
    socketAddress = "unknown";
  }
  const identity = clientIpOf(c.req.header(), socketAddress, trustedHeader);
  if (
    identity === socketAddress &&
    !trustedHeader &&
    !warnedSocketFallback &&
    process.env.NODE_ENV === "production"
  ) {
    warnedSocketFallback = true;
    logger.warn(
      "[Security] No trusted client-IP header is configured: rate limits key on the socket address. Behind a proxy this collapses all clients into one shared bucket — set BOS_CLIENT_IP_HEADER or author auth.variables.ipAddress.ipAddressHeaders in bos.app.ts to the header your edge overwrites (e.g. cf-connecting-ip).",
    );
  }
  return identity;
}

export class CappedStore implements Store {
  private readonly hits = new Map<string, ClientRateLimitInfo>();

  constructor(private readonly maxEntries: number) {}

  localKeys = true;

  increment = (key: string): ClientRateLimitInfo => {
    const now = Date.now();
    const existing = this.hits.get(key);
    if (!existing || (existing.resetTime?.getTime() ?? 0) <= now) {
      this.hits.delete(key);
      const fresh: ClientRateLimitInfo = {
        totalHits: 1,
        resetTime: new Date(now + RATE_LIMIT_WINDOW_MS),
      };
      this.hits.set(key, fresh);
      this.enforceCap();
      return fresh;
    }
    existing.totalHits += 1;
    return existing;
  };

  decrement = (key: string): void => {
    const entry = this.hits.get(key);
    if (entry && entry.totalHits > 0) entry.totalHits -= 1;
  };

  resetKey = (key: string): void => {
    this.hits.delete(key);
  };

  resetAll = (): void => {
    this.hits.clear();
  };

  get = (key: string): ClientRateLimitInfo | undefined => {
    const entry = this.hits.get(key);
    if (!entry) return undefined;
    if ((entry.resetTime?.getTime() ?? 0) <= Date.now()) {
      this.hits.delete(key);
      return undefined;
    }
    return entry;
  };

  private enforceCap(): void {
    if (this.hits.size <= this.maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of this.hits) {
      if ((entry.resetTime?.getTime() ?? 0) <= now) this.hits.delete(key);
      if (this.hits.size <= this.maxEntries) return;
    }
    for (const key of this.hits.keys()) {
      this.hits.delete(key);
      if (this.hits.size <= this.maxEntries) return;
    }
  }
}

export function isProbeOrStatic(c: HonoContext): boolean {
  if (c.req.path === "/health" && (c.req.method === "GET" || c.req.method === "HEAD")) {
    return true;
  }
  const { pathname } = new URL(c.req.url);
  const lastSegment = pathname.split("/").pop() ?? "";
  return STATIC_ASSET_PATTERN.test(lastSegment);
}

const SECRET_PROBE_SUFFIX =
  /\.(env|ya?ml|sql|bak|conf|cfg|ini|log|sh|pem|key|crt|p12|pfx|htaccess|htpasswd|gitignore|gitattributes|ds_store|npmrc|bashrc|zshrc)$/i;

const SECRET_PROBE_PREFIXES = ["/.env", "/.git", "/.aws", "/.ssh", "/.docker"];

/**
 * Paths secret-scanner bots probe (`.env`, compose files, key material,
 * VCS metadata). Served a cheap 404 before any SSR work; `/.well-known/`
 * stays exempt. Hono's `c.req.path` is decoded, so `/%2eenv` is caught.
 */
export function isSecretProbePath(path: string): boolean {
  if (path === "/.well-known" || path.startsWith("/.well-known/")) return false;
  if (SECRET_PROBE_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return SECRET_PROBE_SUFFIX.test(path);
}

export function isSensitiveMutation(c: HonoContext): boolean {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
    return false;
  }
  if (!c.req.path.startsWith("/api/")) {
    return false;
  }
  return !SENSITIVE_MUTATION_EXEMPT_PREFIXES.some(
    (prefix) =>
      c.req.path === prefix || c.req.path.startsWith(`${prefix}/`) || c.req.path.startsWith(prefix),
  );
}

/**
 * The session read is exempt from the general bucket (#634): a 429 here is
 * the "silently signed out" symptom — the UI interprets a failed session
 * fetch as no session. Abuse is covered by better-auth's own production
 * limiter; the exemption is GET-only.
 */
export function isSessionRead(c: HonoContext): boolean {
  return c.req.method === "GET" && c.req.path === "/api/auth/get-session";
}

export function rateLimitExceededResponse(c: HonoContext): Response {
  const acceptsHtml = (c.req.header("accept") ?? "").includes("text/html");
  if (acceptsHtml) {
    return c.html(rateLimitPage(c.req.path), 429);
  }
  return c.json({ error: "Too many requests, please try again later." }, 429);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rateLimitPage(path: string): string {
  const safePath = escapeHtml(path);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Too many requests</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d10;color:#e5e7eb;font-family:system-ui,-apple-system,sans-serif">
<main role="alert" style="text-align:center;padding:2rem;max-width:28rem">
<h1 style="font-size:1.5rem;font-weight:600;margin:0 0 .75rem">Too many requests</h1>
<p style="color:#9ca3af;margin:0 0 1.5rem">You&rsquo;re going faster than we can handle. Please wait a moment, then try again.</p>
<a href="${safePath}" style="color:#60a5fa">Try again</a>
</main>
</body>
</html>`;
}

export function getCspStrict(isDev: boolean): boolean {
  return process.env.CSP_STRICT === "false" ? false : !isDev;
}

export interface ResolveCorsOriginContext {
  allowedOrigins: string[];
  isDev: boolean;
  gatewayId: string;
  requestHost: string;
  bindingLookup: (hostname: string) => Promise<TenantBinding | null>;
}

/**
 * The CORS origin decision, extracted for testability. The trusted origin set
 * is: the configured CORS_ORIGIN allow-list, the gateway domain and its
 * subdomains, and active tenant bindings — never an unconditional wildcard.
 * First match wins; everything else gets no ACAO header (null).
 */
export async function resolveCorsOrigin(
  origin: string | undefined,
  ctx: ResolveCorsOriginContext,
): Promise<string | null | "*"> {
  if (!origin) return "*";

  const originUrl = URL.canParse(origin) ? new URL(origin) : null;

  if (originUrl && ctx.requestHost && ctx.requestHost.split(":")[0] === originUrl.hostname) {
    return origin;
  }

  if (ctx.allowedOrigins.some((entry) => originMatches(entry, origin))) return origin;

  const gatewayMatches =
    originMatches(`https://${ctx.gatewayId}`, origin) ||
    originMatches(`https://*.${ctx.gatewayId}`, origin);
  if (gatewayMatches) return origin;

  if (originUrl) {
    let binding: TenantBinding | null = null;
    try {
      binding = await ctx.bindingLookup(originUrl.hostname);
    } catch {
      binding = null;
    }
    if (binding?.status === "active") return origin;
  }

  if (ctx.isDev && origin.startsWith("http://")) return origin;

  return null;
}

export class SecurityMiddleware extends Context.Service<
  SecurityMiddleware,
  {
    cors: MiddlewareHandler;
    csrf: MiddlewareHandler;
    rateLimit: MiddlewareHandler;
    rateLimitMutation: MiddlewareHandler;
    csp: MiddlewareHandler;
  }
>()("host/SecurityMiddleware") {
  /**
   * Boot-frozen (atomic-deploys 06): the CORS allow-list and CSP origins are
   * derived from the boot `ConfigService` value, never from the
   * `RuntimeSnapshot` — API/auth surfaces do not hot-swap.
   */
  static Live = Layer.effect(
    SecurityMiddleware,
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const trustedIpHeader = resolveTrustedIpHeader(
        process.env.BOS_CLIENT_IP_HEADER,
        config.auth?.variables,
      );
      const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"));
      const isDev = nodeEnv !== "production";
      const corsOrigins = yield* readCorsOrigins;
      const uiConfig = config.ui!;

      if (corsOrigins.length === 0 && !isDev) {
        logger.warn(
          "[Security] CORS_ORIGIN is not set in production. Auth endpoints will reject cross-origin requests.",
        );
        logger.warn(
          "[Security] Set CORS_ORIGIN to your allowed origins (comma-separated), e.g.: CORS_ORIGIN=https://yourdomain.com,https://app.yourdomain.com",
        );
      }

      const allowedOrigins =
        corsOrigins.length > 0
          ? corsOrigins
          : [config.host?.url ?? "", ...(uiConfig.url ? [uiConfig.url] : [])];

      const bindingResolver = createBindingResolver(config);
      const gatewayId = resolveDomain(config.domain, config.host.url).toLowerCase();

      const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

      const csrf: MiddlewareHandler = async (c, next) => {
        if (SAFE_METHODS.has(c.req.method)) {
          return next();
        }

        const origin = c.req.header("origin");

        if (!origin) {
          return next();
        }

        const host = c.req.header("host");
        const originUrl = URL.canParse(origin) ? new URL(origin) : null;
        if (host && originUrl && host.split(":")[0] === originUrl.hostname) {
          return next();
        }

        logger.warn(`[CSRF] Blocked ${c.req.method} ${c.req.path} from origin=${origin}`);
        return c.json({ error: "CSRF validation failed: request origin is not allowed" }, 403);
      };

      const corsHandler: MiddlewareHandler = cors({
        origin: (origin, c) =>
          resolveCorsOrigin(origin, {
            allowedOrigins,
            isDev,
            gatewayId,
            requestHost: c.req.header("host") ?? "",
            bindingLookup: (hostname) => bindingResolver.resolve(hostname),
          }),
        credentials: true,
      });

      const rateLimit: MiddlewareHandler = rateLimiter({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: RATE_LIMIT_MAX,
        keyGenerator: (c) => clientKeyOf(c, trustedIpHeader),
        skip: (c) => isProbeOrStatic(c) || isSensitiveMutation(c) || isSessionRead(c),
        handler: (c) => rateLimitExceededResponse(c),
        message: { error: "Too many requests, please try again later." },
        store: new CappedStore(RATE_LIMIT_STORE_MAX_ENTRIES),
      });

      const rateLimitMutation: MiddlewareHandler = rateLimiter({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: RATE_LIMIT_MUTATION_MAX,
        keyGenerator: (c) => clientKeyOf(c, trustedIpHeader),
        skip: (c) => isProbeOrStatic(c) || !isSensitiveMutation(c),
        handler: (c) => rateLimitExceededResponse(c),
        message: { error: "Too many requests, please try again later." },
        store: new CappedStore(RATE_LIMIT_STORE_MAX_ENTRIES),
      });

      const remoteOrigins = [
        ...(uiConfig.url ? [new URL(uiConfig.url).origin] : []),
        ...(config.api?.url ? [new URL(config.api.url).origin] : []),
        ...(config.auth?.url ? [new URL(config.auth.url).origin] : []),
        ...Object.values(config.plugins ?? {}).flatMap((p: RuntimePlugin) => {
          if (p.url) return [new URL(p.url).origin];
          return [];
        }),
        ...Object.values(config.plugins ?? {}).flatMap((p: RuntimePlugin) =>
          p.ui?.url ? [new URL(p.ui.url).origin] : [],
        ),
      ];

      const uniqueOrigins = [...new Set(remoteOrigins)];

      const pluginConnectSrcs = [
        ...new Set(
          Object.values(config.plugins ?? {}).flatMap((p: RuntimePlugin) => p.connectSrc ?? []),
        ),
      ];

      const wsOrigins = isDev
        ? uniqueOrigins.filter((o) => o.startsWith("http:")).map((o) => o.replace(/^http:/, "ws:"))
        : [];

      const CSP_STRICT = getCspStrict(isDev);

      const cdnOrigins = ["https://cdn.jsdelivr.net", "https://unpkg.com"];

      const cspScriptSrc = CSP_STRICT
        ? [NONCE, "'strict-dynamic'", "'unsafe-eval'"]
        : ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", ...uniqueOrigins, ...cdnOrigins];

      const csp: MiddlewareHandler = (c, next) => {
        const frameAncestors = ["'none'"];

        const lastSegment = c.req.path.split("/").pop() ?? "";
        const isStaticAsset = STATIC_ASSET_PATTERN.test(lastSegment);

        return secureHeaders({
          crossOriginOpenerPolicy: "same-origin-allow-popups",
          crossOriginResourcePolicy: isStaticAsset ? "cross-origin" : "same-origin",
          contentSecurityPolicy: {
            defaultSrc: ["'self'"],
            scriptSrc: cspScriptSrc,
            styleSrc: ["'self'", "'unsafe-inline'", "https:", ...uniqueOrigins, ...cdnOrigins],
            imgSrc: [
              "'self'",
              "data:",
              "https:",
              ...(isDev ? ["http:"] : []),
              ...uniqueOrigins,
              ...(uiConfig.url ? [new URL(uiConfig.url).origin] : []),
            ],
            connectSrc: [
              "'self'",
              "https:",
              "wss:",
              ...uniqueOrigins,
              ...wsOrigins,
              ...cdnOrigins,
              ...pluginConnectSrcs,
            ],
            fontSrc: ["'self'", "https:", ...uniqueOrigins],
            manifestSrc: [
              "'self'",
              "https:",
              ...(uiConfig.url ? [new URL(uiConfig.url).origin] : []),
            ],
            frameSrc: ["'self'", "https:", ...uniqueOrigins],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors,
            workerSrc: ["'self'", "https:", ...uniqueOrigins],
          },
        })(c, next);
      };

      return { cors: corsHandler, csrf, rateLimit, rateLimitMutation, csp };
    }),
  );
}
