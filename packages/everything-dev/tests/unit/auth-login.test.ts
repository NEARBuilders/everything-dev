import { afterEach, describe, expect, it, vi } from "vitest";
import { startDeviceLogin } from "../../src/auth-login";

type FetchCall = { url: string; init: RequestInit };

const SITE = "http://localhost:3000";

function deviceCodeResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    device_code: "device-code-1",
    user_code: "ABCD-EFGH",
    verification_uri: `${SITE}/login/device`,
    verification_uri_complete: `${SITE}/login/device?user_code=ABCD-EFGH`,
    expires_in: 600,
    interval: 0,
    ...overrides,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function stubFetchSequence(
  responses: Array<{
    match: string;
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
  }>,
) {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const call = { url: url.toString(), init: init ?? {} };
    calls.push(call);
    const spec = responses[index];
    if (!spec || !call.url.includes(spec.match)) {
      return jsonResponse(404, { error: "unexpected fetch" });
    }
    index += 1;
    return jsonResponse(spec.status, spec.body ?? {}, spec.headers);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const CLAIMED_COOKIE = "better-auth.session_token=signed.token.abc=.sig";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("device login client", () => {
  it("requests a device code, opens the verification URL with flow params, and completes the handoff", async () => {
    const { calls } = stubFetchSequence([
      { match: "/api/auth/device/code", status: 200, body: deviceCodeResponse() },
      { match: "/api/auth/device/token", status: 400, body: { error: "authorization_pending" } },
      {
        match: "/api/auth/device/token",
        status: 200,
        body: { access_token: "session-token-1", token_type: "Bearer" },
      },
      {
        match: "/api/auth/device-link/claim",
        status: 200,
        body: { success: true },
        headers: { "set-cookie": `${CLAIMED_COOKIE}; Path=/; HttpOnly; SameSite=Lax` },
      },
      {
        match: "/api/auth/api-key/create",
        status: 200,
        body: { id: "key-1", key: "edk_test_key" },
      },
      {
        match: "/api/auth/near/list-accounts",
        status: 200,
        body: {
          accounts: [{ accountId: "alice.near" }],
          activeAccount: { accountId: "alice.near" },
        },
      },
    ]);

    const login = await startDeviceLogin({
      siteUrl: SITE,
      device: "workstation",
      account: "v1.citynode.near",
      expiresIn: 3600,
    });

    expect(login.userCode).toBe("ABCD-EFGH");
    expect(login.verificationUrl).toContain("user_code=ABCD-EFGH");
    expect(login.verificationUrl).toContain("account=v1.citynode.near");
    expect(login.verificationUrl).toContain("/login/device");

    const approval = await login.waitForApproval();

    expect(approval.apiKey).toEqual({ key: "edk_test_key", id: "key-1" });
    expect(approval.accountId).toBe("alice.near");

    const claim = calls.find((call) => call.url.includes("/device-link/claim"));
    expect(JSON.parse(String(claim?.init.body ?? "{}"))).toMatchObject({
      token: "session-token-1",
      client_id: "bos-cli",
    });

    const keyCreate = calls.find((call) => call.url.includes("/api-key/create"));
    const keyHeaders = new Headers(keyCreate?.init.headers);
    expect(keyHeaders.get("cookie")).toBe(CLAIMED_COOKIE);
    expect(keyHeaders.get("origin")).toBe(SITE);

    const keyBody = JSON.parse(String(keyCreate?.init.body ?? "{}")) as {
      configId: string;
      name: string;
      expiresIn: number;
    };
    expect(keyBody.configId).toBe("user-keys");
    expect(keyBody.name).toContain("bos login — workstation");
    expect(keyBody.expiresIn).toBe(3600);
  });

  it("reuses the claimed session cookie for https sites too", async () => {
    const { calls } = stubFetchSequence([
      {
        match: "/api/auth/device/code",
        status: 200,
        body: deviceCodeResponse({
          verification_uri: "https://citynode.app/login/device",
          verification_uri_complete: "https://citynode.app/login/device?user_code=ABCD-EFGH",
        }),
      },
      {
        match: "/api/auth/device/token",
        status: 200,
        body: { access_token: "session-token-1", token_type: "Bearer" },
      },
      {
        match: "/api/auth/device-link/claim",
        status: 200,
        body: { success: true },
        headers: {
          "set-cookie": "__Secure-better-auth.session_token=signed.value; Path=/; Secure; HttpOnly",
        },
      },
      { match: "/api/auth/api-key/create", status: 200, body: { id: "key-1", key: "edk_k" } },
      {
        match: "/api/auth/near/list-accounts",
        status: 200,
        body: { accounts: [], activeAccount: null },
      },
    ]);

    const login = await startDeviceLogin({ siteUrl: "https://citynode.app" });
    await login.waitForApproval();

    const keyCreate = calls.find((call) => call.url.includes("/api-key/create"));
    const keyHeaders = new Headers(keyCreate?.init.headers);
    expect(keyHeaders.get("cookie")).toBe("__Secure-better-auth.session_token=signed.value");
    expect(keyHeaders.get("origin")).toBe("https://citynode.app");
  });

  it("carries delegate params on the verification URL and completes through the claim", async () => {
    const { calls } = stubFetchSequence([
      { match: "/api/auth/device/code", status: 200, body: deviceCodeResponse() },
      {
        match: "/api/auth/device/token",
        status: 200,
        body: { access_token: "session-token-1", token_type: "Bearer" },
      },
      {
        match: "/api/auth/device-link/claim",
        status: 200,
        body: { success: true },
        headers: { "set-cookie": `${CLAIMED_COOKIE}; Path=/; HttpOnly` },
      },
      { match: "/api/auth/api-key/create", status: 200, body: { id: "key-1", key: "edk_k" } },
      {
        match: "/api/auth/near/list-accounts",
        status: 200,
        body: { accounts: [], activeAccount: null },
      },
    ]);

    const login = await startDeviceLogin({
      siteUrl: SITE,
      delegate: { pubKey: "ed25519:PUBKEY", contract: "v1.citynode.near", network: "mainnet" },
    });

    expect(login.verificationUrl).toContain("pubKey=ed25519%3APUBKEY");
    expect(login.verificationUrl).toContain("contract=v1.citynode.near");
    await login.waitForApproval();
    expect(calls.some((call) => call.url.includes("/api-key/create"))).toBe(true);
  });

  it("surfaces access_denied as a login failure", async () => {
    stubFetchSequence([
      { match: "/api/auth/device/code", status: 200, body: deviceCodeResponse() },
      { match: "/api/auth/device/token", status: 400, body: { error: "access_denied" } },
    ]);

    const login = await startDeviceLogin({ siteUrl: SITE });
    await expect(login.waitForApproval()).rejects.toThrow(/denied/i);
  });

  it("surfaces expired_token as a timeout failure", async () => {
    stubFetchSequence([
      { match: "/api/auth/device/code", status: 200, body: deviceCodeResponse() },
      { match: "/api/auth/device/token", status: 400, body: { error: "expired_token" } },
    ]);

    const login = await startDeviceLogin({ siteUrl: SITE });
    await expect(login.waitForApproval()).rejects.toThrow(/expired/i);
  });

  it("fails fast when the site cannot start a device flow", async () => {
    stubFetchSequence([
      { match: "/api/auth/device/code", status: 404, body: { error: "not_found" } },
    ]);

    await expect(startDeviceLogin({ siteUrl: SITE })).rejects.toThrow(/could not start/i);
  });

  it("rejects when aborted while waiting", async () => {
    stubFetchSequence([
      { match: "/api/auth/device/code", status: 200, body: deviceCodeResponse() },
      { match: "/api/auth/device/token", status: 400, body: { error: "authorization_pending" } },
    ]);

    const login = await startDeviceLogin({ siteUrl: SITE });
    const waiting = login.waitForApproval();
    login.abort("Login aborted by the operator");
    await expect(waiting).rejects.toThrow(/aborted/i);
  });
});
