import { platform } from "node:os";
import { execa } from "execa";

const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_CLIENT_ID = "bos-cli";
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_PENALTY_SECONDS = 5;

export interface DeviceLoginOptions {
  siteUrl: string;
  /** label for the approving device, shown on the approval page */
  device?: string;
  /** the NEAR account the CLI expects to authenticate as (approval-page copy only) */
  account?: string;
  /** delegate mode — the approval page adds this scoped function-call key to the user's account */
  delegate?: { pubKey: string; contract: string; network: string };
  /** seconds the minted API key stays valid (login mode) */
  expiresIn?: number;
}

export interface DeviceApproval {
  sessionToken: string;
  /** the NEAR account signed in on the approving browser (login mode) */
  accountId: string | null;
  /** the minted CLI credential (login mode) */
  apiKey: { key: string; id: string } | null;
}

export interface DeviceLoginHandle {
  userCode: string;
  verificationUrl: string;
  waitForApproval: (timeoutMs?: number) => Promise<DeviceApproval>;
  abort: (reason?: string) => void;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

interface DeviceTokenSuccess {
  access_token: string;
  token_type: "Bearer";
}

interface DeviceTokenError {
  error:
    | "authorization_pending"
    | "slow_down"
    | "expired_token"
    | "access_denied"
    | "invalid_grant"
    | "invalid_request"
    | "invalid_client";
  error_description?: string;
}

interface ApiKeyCreated {
  id: string;
  key: string;
}

interface NearAccountsResponse {
  accounts: { accountId: string }[];
  activeAccount: { accountId: string } | null;
}

async function authFetch(
  siteUrl: string,
  path: string,
  body: unknown,
  cookiePair?: string,
): Promise<{ status: number; json: unknown; setCookie: string | null }> {
  // Better Auth's origin check demands an Origin on cookie-bearing
  // requests — present the site's own origin, exactly as a browser would.
  const origin = new URL(siteUrl).origin;
  const headers: Record<string, string> = { "content-type": "application/json", origin };
  if (cookiePair) headers.cookie = cookiePair;
  const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/auth${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: await response.json().catch(() => ({})),
    setCookie: response.headers.get("set-cookie"),
  };
}

/**
 * CLI login via the OAuth 2.0 Device Flow (RFC 8628) — the same flow the
 * site's QR pairing uses. The CLI requests a device code, the user approves
 * at `/login/device` in any browser (same machine or not), and the CLI polls
 * the token endpoint until the grant completes.
 */
export async function startDeviceLogin(opts: DeviceLoginOptions): Promise<DeviceLoginHandle> {
  const siteUrl = opts.siteUrl.replace(/\/$/, "");
  const clientId = DEFAULT_CLIENT_ID;

  const codeResponse = await fetch(`${siteUrl}/api/auth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!codeResponse.ok) {
    throw new Error(
      `Device login could not start (${codeResponse.status}) — is ${siteUrl} running the platform auth plugin?`,
    );
  }
  const code = (await codeResponse.json()) as DeviceCodeResponse;

  const verificationUrl = buildVerificationUrl(siteUrl, code, opts);

  let abortReason: string | null = null;
  let rejectPending!: (reason?: Error) => void;
  const pendingReject = new Promise<never>((_, reject) => {
    rejectPending = reject;
  });

  const waitForApproval = (timeoutMs = 10 * 60_000): Promise<DeviceApproval> => {
    const deadline = Date.now() + timeoutMs;
    let intervalSeconds = code.interval ?? DEFAULT_POLL_INTERVAL_SECONDS;

    const poll = async (): Promise<DeviceApproval> => {
      if (abortReason) throw new Error(abortReason);
      if (Date.now() > deadline) {
        throw new Error("Login timed out — the device code expired before approval");
      }

      const { status, json } = await authFetch(siteUrl, "/device/token", {
        grant_type: DEVICE_CODE_GRANT_TYPE,
        device_code: code.device_code,
        client_id: clientId,
      });

      if (status === 200) {
        const { access_token: sessionToken } = json as DeviceTokenSuccess;
        return await completeLogin(siteUrl, sessionToken, opts);
      }

      const error = (json as DeviceTokenError).error;
      if (error === "authorization_pending") {
        // keep polling
      } else if (error === "slow_down") {
        intervalSeconds += SLOW_DOWN_PENALTY_SECONDS;
      } else if (error === "expired_token") {
        throw new Error("Login timed out — the device code expired before approval");
      } else if (error === "access_denied") {
        throw new Error("Login request was denied on the approval page");
      } else {
        throw new Error(
          (json as DeviceTokenError).error_description ?? `Login failed (${error ?? status})`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
      return poll();
    };

    return Promise.race([pendingReject, poll()]);
  };

  return {
    userCode: code.user_code,
    verificationUrl,
    waitForApproval,
    abort: (reason) => {
      abortReason = reason ?? "Login aborted";
      rejectPending(new Error(abortReason));
    },
  };
}

function buildVerificationUrl(
  siteUrl: string,
  code: DeviceCodeResponse,
  opts: DeviceLoginOptions,
): string {
  const base = code.verification_uri_complete ?? code.verification_uri ?? "/login/device";
  const url = new URL(base, siteUrl);
  const params = url.searchParams;
  params.set("user_code", code.user_code);
  if (opts.account) params.set("account", opts.account);
  if (opts.device) params.set("device", opts.device);
  if (opts.delegate) {
    params.set("pubKey", opts.delegate.pubKey);
    params.set("contract", opts.delegate.contract);
    params.set("network", opts.delegate.network);
  }
  return url.toString();
}

async function completeLogin(
  siteUrl: string,
  sessionToken: string,
  opts: DeviceLoginOptions,
): Promise<DeviceApproval> {
  // The token endpoint returns the raw session token; Better Auth session
  // cookies carry an HMAC signature, so exchange the token for a signed
  // session cookie via the device-link claim endpoint (the QR pairing path).
  const claim = await authFetch(siteUrl, "/device-link/claim", {
    token: sessionToken,
    client_id: DEFAULT_CLIENT_ID,
  });
  if (claim.status !== 200) {
    const detail = (claim.json as { message?: string }).message;
    throw new Error(
      `Approved session could not be claimed${detail ? `: ${detail}` : ` (${claim.status})`}`,
    );
  }
  const cookiePair = claim.setCookie?.split(";")[0];
  if (!cookiePair?.includes("=")) {
    throw new Error("Session claim returned no session cookie");
  }

  const apiKey = await mintApiKey(siteUrl, cookiePair, opts);
  const accountId = await resolveNearAccount(siteUrl, cookiePair);
  return { sessionToken, accountId, apiKey };
}

async function mintApiKey(
  siteUrl: string,
  cookiePair: string,
  opts: DeviceLoginOptions,
): Promise<DeviceApproval["apiKey"]> {
  const { status, json } = await authFetch(
    siteUrl,
    "/api-key/create",
    {
      configId: "user-keys",
      name: `bos login — ${opts.device ?? "cli"} — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      ...(opts.expiresIn ? { expiresIn: opts.expiresIn } : {}),
    },
    cookiePair,
  );
  if (status !== 200) {
    const detail = (json as { message?: string }).message;
    throw new Error(
      `CLI credential could not be created${detail ? `: ${detail}` : ` (${status})`}`,
    );
  }
  const created = json as ApiKeyCreated;
  if (!created.key) throw new Error("API key creation returned no key");
  return { key: created.key, id: created.id };
}

async function resolveNearAccount(siteUrl: string, cookiePair: string): Promise<string | null> {
  try {
    const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/auth/near/list-accounts`, {
      headers: { cookie: cookiePair },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as NearAccountsResponse;
    return data.activeAccount?.accountId ?? null;
  } catch {
    return null;
  }
}

export async function openInBrowser(url: string): Promise<void> {
  const os = platform();
  try {
    if (os === "darwin") {
      await execa("open", [url], { stdio: "ignore" });
    } else if (os === "win32") {
      await execa("cmd", ["/c", "start", "", url], {
        stdio: "ignore",
        windowsVerbatimArguments: true,
      });
    } else {
      await execa("xdg-open", [url], { stdio: "ignore" });
    }
  } catch {
    throw new Error(`Failed to open browser. Open this URL manually:\n  ${url}`);
  }
}
