import { platform } from "node:os";
import { BOS_CLI_CLIENT_ID } from "better-near-auth";
import { Context, Effect, Layer } from "effect";
import { execa } from "execa";
import { formatUnknownError } from "../../utils/errors";
import type { CustodyWalletRecord } from "./session";
import {
  parseSiteErrorDetail,
  authPost as realAuthPost,
  getJson as realGetJson,
  rpcPost as realRpcPost,
  SiteClient,
  type SiteClientShape,
} from "./site-client";

const realSiteClient = {
  authPost: realAuthPost,
  rpcPost: realRpcPost,
  getJson: realGetJson,
} as Pick<SiteClientShape, "authPost" | "rpcPost" | "getJson">;

const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export const DEVICE_LINK_CLIENT_ID = BOS_CLI_CLIENT_ID;
const DEFAULT_CLIENT_ID = DEVICE_LINK_CLIENT_ID;
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
  /** custody mode — the approval page also registers an OutLayer custody wallet under the user's account */
  custody?: { network: "mainnet" | "testnet" };
  /** seconds the minted API key stays valid (login mode) */
  expiresIn?: number;
  /** deploy-key mode — the mint switches to the auth plugin's server-side route and bakes bundle-write permissions plus account/gateway scope into the key */
  deployKey?: { account: string; gateway: string };
}

export interface DeviceApproval {
  sessionToken: string;
  /** the NEAR account signed in on the approving browser (login mode) */
  accountId: string | null;
  /** the minted CLI credential (login mode) */
  apiKey: { key: string; id: string } | null;
  /** the custody wallet registered during approval (custody mode) — null when it could not be fetched */
  custodyWallet: CustodyWalletRecord | null;
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

/**
 * CLI login via the OAuth 2.0 Device Flow (RFC 8628) — the same flow the
 * site's QR pairing uses. The CLI requests a device code, the user approves
 * at `/login/device` in any browser (same machine or not), and the CLI polls
 * the token endpoint until the grant completes. All HTTP goes through the
 * site client; the returned handle drives the poll loop from the handler.
 */
export async function startDeviceLogin(
  opts: DeviceLoginOptions,
  client: Pick<SiteClientShape, "authPost" | "rpcPost" | "getJson"> = realSiteClient,
): Promise<DeviceLoginHandle> {
  const siteUrl = opts.siteUrl.replace(/\/$/, "");
  const clientId = DEFAULT_CLIENT_ID;

  const codeResponse = await client.authPost(siteUrl, "/device/code", { client_id: clientId });
  if (codeResponse.status >= 400) {
    const detail = parseSiteErrorDetail(codeResponse.status, codeResponse.json);
    throw new Error(
      `Device login could not start (${codeResponse.status})` +
        `${detail ? `: ${detail}` : ` — is ${siteUrl} running the platform auth plugin?`}`,
    );
  }
  const code = codeResponse.json as DeviceCodeResponse;

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

      const { status, json } = await client.authPost(siteUrl, "/device/token", {
        grant_type: DEVICE_CODE_GRANT_TYPE,
        device_code: code.device_code,
        client_id: clientId,
      });

      if (status === 200) {
        const { access_token: sessionToken } = json as DeviceTokenSuccess;
        return await completeLogin(siteUrl, sessionToken, opts, client);
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

/** The device login as a Context.Service tag (ticket #423) — the login
 * handler yields it; tests provide fake site clients. */
export class DeviceLoginService extends Context.Service<
  DeviceLoginService,
  {
    start: (opts: DeviceLoginOptions) => Effect.Effect<DeviceLoginHandle, Error>;
  }
>()("everything-dev/auth/device-login") {
  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const client = yield* SiteClient;
      return DeviceLoginService.of({
        // Without a catch, Effect.tryPromise wraps every rejection in
        // UnknownError("An error occurred in Effect.tryPromise") and the
        // handler's error.message loses the real cause — unwrap it here.
        start: (opts) =>
          Effect.tryPromise({
            try: () => startDeviceLogin(opts, client),
            catch: (cause) =>
              cause instanceof Error ? cause : new Error(formatUnknownError(cause)),
          }),
      });
    }),
  );
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
  if (opts.custody) {
    params.set("custody", "1");
    params.set("network", opts.custody.network);
  }
  return url.toString();
}

async function completeLogin(
  siteUrl: string,
  sessionToken: string,
  opts: DeviceLoginOptions,
  client: Pick<SiteClientShape, "authPost" | "rpcPost" | "getJson">,
): Promise<DeviceApproval> {
  // The token endpoint returns the raw session token; Better Auth session
  // cookies carry an HMAC signature, so exchange the token for a signed
  // session cookie via the device-link claim endpoint (the QR pairing path).
  const claim = await client.authPost(siteUrl, "/device-link/claim", {
    token: sessionToken,
    client_id: DEFAULT_CLIENT_ID,
  });
  if (claim.status !== 200) {
    const detail = parseSiteErrorDetail(claim.status, claim.json);
    throw new Error(
      `Approved session could not be claimed${detail ? `: ${detail}` : ` (${claim.status})`}`,
    );
  }
  const cookiePair = claim.setCookie?.split(";")[0];
  if (!cookiePair?.includes("=")) {
    throw new Error("Session claim returned no session cookie");
  }

  const apiKey = await (opts.deployKey
    ? mintDeployKey(siteUrl, cookiePair, opts, client)
    : mintApiKey(siteUrl, cookiePair, opts, client));
  const accountId = await resolveNearAccount(siteUrl, cookiePair, client);
  const custodyWallet = opts.custody
    ? await fetchCustodyCredential(siteUrl, cookiePair, opts.custody.network, client).catch(
        () => null,
      )
    : null;
  return { sessionToken, accountId, apiKey, custodyWallet };
}

interface CustodyCredentialResponse {
  apiKey: string;
  walletId: string;
  nearAccountId: string;
  network: string;
  handoffUrl: string | null;
  registeredAt?: string;
}

async function fetchCustodyCredential(
  siteUrl: string,
  cookiePair: string,
  network: "mainnet" | "testnet",
  client: Pick<SiteClientShape, "authPost">,
): Promise<CustodyWalletRecord> {
  const { status, json } = await client.authPost(
    siteUrl,
    "/custody/credential",
    { network },
    cookiePair,
  );
  if (status !== 200) {
    const detail = parseSiteErrorDetail(status, json);
    throw new Error(
      `Custody wallet credential could not be fetched${detail ? `: ${detail}` : ` (${status})`}`,
    );
  }
  const data = json as CustodyCredentialResponse;
  if (!data.apiKey?.startsWith("wk_")) {
    throw new Error("Custody wallet credential returned no API key");
  }
  if (data.network !== "mainnet" && data.network !== "testnet") {
    throw new Error(`Custody wallet credential returned unknown network "${data.network}"`);
  }
  return {
    apiKey: data.apiKey,
    walletId: data.walletId,
    nearAccountId: data.nearAccountId,
    network: data.network,
    handoffUrl: data.handoffUrl ?? null,
    registeredAt: data.registeredAt ?? new Date().toISOString(),
  };
}

async function mintApiKey(
  siteUrl: string,
  cookiePair: string,
  opts: DeviceLoginOptions,
  client: Pick<SiteClientShape, "authPost">,
): Promise<DeviceApproval["apiKey"]> {
  const { status, json } = await client.authPost(
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
    const detail = parseSiteErrorDetail(status, json);
    throw new Error(
      `CLI credential could not be created${detail ? `: ${detail}` : ` (${status})`}`,
    );
  }
  const created = json as ApiKeyCreated;
  if (!created.key) throw new Error("API key creation returned no key");
  return { key: created.key, id: created.id };
}

/**
 * Deploy-key mint: only the auth plugin's server-side route may set
 * `permissions` (better-auth rejects client-set permissions with
 * SERVER_ONLY_PROPERTY), so the scoped bundle-write key is minted through the
 * plugin's oRPC route instead of better-auth's client endpoint. The oRPC
 * envelope error body (`{ json: { code, message, data } }`) is parsed by the
 * site client — the server's FORBIDDEN detail surfaces verbatim.
 */
async function mintDeployKey(
  siteUrl: string,
  cookiePair: string,
  opts: DeviceLoginOptions,
  client: Pick<SiteClientShape, "rpcPost">,
): Promise<DeviceApproval["apiKey"]> {
  const deployKey = opts.deployKey;
  if (!deployKey) throw new Error("Deploy-key mint requested without account scope");
  const response = await client.rpcPost(
    siteUrl,
    "/api/rpc/auth/createDeployKey",
    {
      account: deployKey.account,
      gateway: deployKey.gateway,
      name: `bos deploy — ${opts.device ?? "cli"} — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      ...(opts.expiresIn ? { expiresIn: opts.expiresIn } : {}),
    },
    cookiePair,
  );
  if (response.status !== 200) {
    const detail = parseSiteErrorDetail(response.status, response.json);
    throw new Error(
      `Deploy key could not be created${detail ? `: ${detail}` : ` (${response.status})`}`,
    );
  }
  const created = (response.json as { json?: ApiKeyCreated }).json;
  if (!created?.key) throw new Error("Deploy key creation returned no key");
  return { key: created.key, id: created.id };
}

async function resolveNearAccount(
  siteUrl: string,
  cookiePair: string,
  client: Pick<SiteClientShape, "getJson">,
): Promise<string | null> {
  try {
    const data = (await client.getJson(
      `${siteUrl.replace(/\/$/, "")}/api/auth/near/list-accounts`,
      cookiePair,
    )) as NearAccountsResponse;
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
