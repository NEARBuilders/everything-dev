import { getConnInfo } from "@hono/node-server/conninfo";
import { Context, Effect, Layer } from "every-plugin/effect";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { NONCE, secureHeaders } from "hono/secure-headers";
import { rateLimiter } from "hono-rate-limiter";
import { ConfigService, readCorsOrigins } from "../services/config";
import type { RuntimePlugin } from "../types";
import { logger } from "../utils/logger";

export const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 900_000;
export const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 300;
export const BODY_LIMIT_MAX = Number(process.env.BODY_LIMIT_MAX) || 10 * 1024 * 1024;
export const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS) || 30_000;

export const STATIC_ASSET_PATTERN =
  /\.(js|css|png|jpg|jpeg|gif|svg|ico|json|md|webmanifest|woff2?|ttf|eot|webp|avif|map|txt|xml)$/i;

export function getCspStrict(isDev: boolean): boolean {
  return process.env.CSP_STRICT === "false" ? false : !isDev;
}

export class SecurityMiddleware extends Context.Tag("host/SecurityMiddleware")<
  SecurityMiddleware,
  {
    cors: MiddlewareHandler;
    csrf: MiddlewareHandler;
    rateLimit: MiddlewareHandler;
    csp: MiddlewareHandler;
  }
>() {
  static Live = Layer.effect(
    SecurityMiddleware,
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const isDev = process.env.NODE_ENV !== "production";
      const corsOrigins = yield* readCorsOrigins();
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
        if (host && host.split(":")[0] === new URL(origin).hostname) {
          return next();
        }

        logger.warn(`[CSRF] Blocked ${c.req.method} ${c.req.path} from origin=${origin}`);
        return c.json({ error: "CSRF validation failed: request origin is not allowed" }, 403);
      };

      const corsHandler: MiddlewareHandler = cors({
        origin: (origin) => {
          if (!origin) return "*";
          if (allowedOrigins.includes(origin)) return origin;
          if (origin.startsWith("https://")) return origin;
          if (isDev && origin.startsWith("http://")) return origin;
          return null;
        },
        credentials: true,
      });

      const rateLimit: MiddlewareHandler = rateLimiter({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: RATE_LIMIT_MAX,
        keyGenerator: (c) => {
          const forwarded = c.req.header("x-forwarded-for");
          if (forwarded) {
            return forwarded.split(",")[0]!.trim();
          }
          try {
            const info = getConnInfo(c);
            return info.remote.address ?? "unknown";
          } catch {
            return "unknown";
          }
        },
        skip: (c) => {
          const { pathname } = new URL(c.req.url);
          const lastSegment = pathname.split("/").pop() ?? "";
          return STATIC_ASSET_PATTERN.test(lastSegment);
        },
        message: { error: "Too many requests, please try again later." },
      });

      const remoteOrigins = [
        ...(uiConfig.url ? [new URL(uiConfig.url).origin] : []),
        ...(config.api?.url ? [new URL(config.api.url).origin] : []),
        ...(config.auth?.url ? [new URL(config.auth.url).origin] : []),
        ...Object.values(config.plugins ?? {}).flatMap((p: RuntimePlugin) => {
          if (p.url) return [new URL(p.url).origin];
          return [];
        }),
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
              ...(isDev ? ["http:"] : ["https:"]),
              ...(uiConfig.url ? [new URL(uiConfig.url).origin] : []),
            ],
            connectSrc: [
              "'self'",
              "https:",
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

      return { cors: corsHandler, csrf, rateLimit, csp };
    }),
  );
}
