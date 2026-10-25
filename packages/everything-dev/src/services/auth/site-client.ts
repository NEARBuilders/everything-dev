import { Context, Layer } from "effect";

/**
 * The ONE site HTTP client (ticket #423): every CLI→site call — better-auth
 * `/api/auth/*` routes, oRPC `/api/rpc/*` routes, and plain account reads —
 * goes through here, with error parsing that understands every payload shape
 * the server emits. Previously three fetch styles hand-parsed three shapes;
 * the oRPC envelope (`{ json: { defined, code, message, data } }`) was the
 * one nobody parsed, so the server's FORBIDDEN detail was lost behind a bare
 * "Deploy key could not be created (403)".
 */

export interface SiteResponse {
  status: number;
  json: unknown;
  setCookie: string | null;
}

/** Extract the human detail from any error body shape the server emits —
 * undefined when nothing recognizable is present. */
export function parseSiteErrorDetail(status: number, json: unknown): string | undefined {
  if (json === null || json === undefined || typeof json !== "object") return undefined;
  const body = json as Record<string, unknown>;

  // oRPC envelope: the error object rides in `json` (success payloads ride
  // there too), carrying { defined, code, message, data }
  const inner = typeof body.json === "object" && body.json !== null ? body.json : body;
  const innerBody = inner as Record<string, unknown>;

  const message = pickErrorMessage(innerBody) ?? pickErrorMessage(body);
  const detail = pickDetail(innerBody);
  if (message && detail && detail !== message) return `${message} — ${detail}`;
  void status;
  return message ?? detail;
}

const DETAIL_KEYS = ["detail", "detailFull"] as const;

function pickErrorMessage(body: Record<string, unknown>): string | undefined {
  if (typeof body.message === "string" && body.message.trim() !== "") return body.message;
  if (
    typeof body.error === "object" &&
    body.error !== null &&
    !Array.isArray(body.error) &&
    typeof (body.error as Record<string, unknown>).message === "string"
  ) {
    return (body.error as { message: string }).message;
  }
  if (Array.isArray(body.error)) {
    const first = body.error[0] as Record<string, unknown> | undefined;
    if (first && typeof first.message === "string") return first.message;
  }
  return undefined;
}

function pickDetail(body: Record<string, unknown>): string | undefined {
  return DETAIL_KEYS.map((key) => body[key]).find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
}

export interface SiteClientShape {
  /** POST to a better-auth `/api/auth/*` route (origin header included for
   * cookie-bearing requests). */
  authPost: (
    siteUrl: string,
    path: string,
    body: unknown,
    cookiePair?: string,
    extraHeaders?: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<SiteResponse>;
  /** POST to an oRPC `/api/rpc/*` route — the input is wrapped in the RPC
   * `json` envelope; errors parse through `parseSiteErrorDetail`. */
  rpcPost: (
    siteUrl: string,
    path: string,
    input: unknown,
    cookiePair?: string,
    extraHeaders?: Record<string, string>,
  ) => Promise<SiteResponse>;
  /** Plain GET returning parsed JSON (account resolution). */
  getJson: (url: string, cookiePair?: string) => Promise<unknown>;
}

export class SiteClient extends Context.Service<SiteClient, SiteClientShape>()(
  "everything-dev/auth/site-client",
) {
  static readonly Live = Layer.succeed(
    this,
    SiteClient.of({
      authPost: (siteUrl, path, body, cookiePair, extraHeaders, signal) =>
        authPost(siteUrl, path, body, cookiePair, extraHeaders, signal),
      rpcPost: (siteUrl, path, input, cookiePair, extraHeaders) =>
        rpcPost(siteUrl, path, input, cookiePair, extraHeaders),
      getJson: (url, cookiePair) => getJson(url, cookiePair),
    }),
  );
}

export async function authPost(
  siteUrl: string,
  path: string,
  body: unknown,
  cookiePair?: string,
  extraHeaders?: Record<string, string>,
  signal?: AbortSignal,
): Promise<SiteResponse> {
  // Better Auth's origin check demands an Origin on cookie-bearing
  // requests — present the site's own origin, exactly as a browser would.
  const origin = new URL(siteUrl).origin;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin,
    ...extraHeaders,
  };
  if (cookiePair) headers.cookie = cookiePair;
  const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/auth${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  return {
    status: response.status,
    json: await response.json().catch(() => ({})),
    setCookie: response.headers.get("set-cookie"),
  };
}

export async function rpcPost(
  siteUrl: string,
  path: string,
  input: unknown,
  cookiePair?: string,
  extraHeaders?: Record<string, string>,
): Promise<SiteResponse> {
  const origin = new URL(siteUrl).origin;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin,
    ...(extraHeaders ?? {}),
  };
  if (cookiePair) headers.cookie = cookiePair;
  const response = await fetch(`${siteUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ json: input }),
  });
  return {
    status: response.status,
    json: await response.json().catch(() => ({})),
    setCookie: response.headers.get("set-cookie"),
  };
}

export async function getJson(url: string, cookiePair?: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: cookiePair ? { cookie: cookiePair } : {},
  });
  return (await response.json().catch(() => ({}))) as unknown;
}
