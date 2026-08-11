import type { Context } from "hono";
import { proxy } from "hono/proxy";
import type { AuthVariables } from "../lib/auth";
import { STATIC_ASSET_PATTERN } from "../middleware/security";
import type { RuntimeConfig } from "../services/config";
import { getTenantRuntimeErrorResponse, resolveRequestRuntime } from "../services/tenant-runtime";
import { logger } from "../utils/logger";

type HonoEnv = { Variables: AuthVariables };

export async function proxyRequest(
  req: Request,
  targetBase: string,
  rewriteCookies = false,
): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = `${targetBase}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.set("accept-encoding", "identity");

  if (rewriteCookies) {
    const cookieHeader = headers.get("cookie");
    if (cookieHeader) {
      const rewrittenCookies = cookieHeader.replace(/\bbetter-auth\./g, "__Secure-better-auth.");
      headers.set("cookie", rewrittenCookies);
    }
  }

  const proxyReq = new Request(targetUrl, {
    method: req.method,
    headers,
    body: req.body,
    duplex: "half",
  } as RequestInit);

  const response = await fetch(proxyReq);

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  if (rewriteCookies) {
    responseHeaders.delete("set-cookie");
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : (response.headers.get("set-cookie")?.split(/,(?=\s*(?:__Secure-|__Host-)?\w+=)/) ?? []);
    for (const cookie of setCookies) {
      const rewritten = cookie
        .replace(/^(__Secure-|__Host-)/i, "")
        .replace(/;\s*Domain=[^;]*/gi, "")
        .replace(/;\s*Secure/gi, "");
      responseHeaders.append("set-cookie", rewritten);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

function buildStaticAssetProxyHeaders(req: Request) {
  const headers = new Headers();

  for (const name of ["accept", "accept-language"]) {
    const value = req.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

export async function proxyStaticAssetRequest(req: Request, targetBase: string): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = `${targetBase}${url.pathname}${url.search}`;

  const response = await proxy(targetUrl, {
    raw: req,
    headers: buildStaticAssetProxyHeaders(req),
  });

  response.headers.delete("etag");
  response.headers.delete("last-modified");
  response.headers.set("cache-control", "public, max-age=14400, s-maxage=300");

  return response;
}

export function createStaticAssetProxyHandler(config: RuntimeConfig) {
  return async (c: Context<HonoEnv>, next: () => Promise<void>) => {
    const { pathname } = new URL(c.req.url);

    if (
      pathname === "/" ||
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/health"
    ) {
      return next();
    }

    const lastSegment = pathname.split("/").pop() ?? "";
    if (!STATIC_ASSET_PATTERN.test(lastSegment)) {
      return next();
    }

    try {
      const runtime = await resolveRequestRuntime(config, c.req.raw, {
        verification: "stale-while-revalidate",
      });
      return await proxyStaticAssetRequest(c.req.raw, runtime.config.ui.url);
    } catch (error) {
      const { message, status } = getTenantRuntimeErrorResponse(error);
      logger.error(`[Proxy Asset] ${c.req.method} ${c.req.path} — ${message}`);
      return c.text(message, { status: status as 404 | 500 | 502 });
    }
  };
}
