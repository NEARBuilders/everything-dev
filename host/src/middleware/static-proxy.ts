import { proxy } from "hono/proxy";

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
