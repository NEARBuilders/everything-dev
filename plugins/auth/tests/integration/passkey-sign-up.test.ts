import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import type { PluginServices } from "../../src/service-types";
import { createTestServices, createTestUser } from "../helpers";
import {
  type AuthenticationOptionsJSON,
  type AuthenticatorCurve,
  createSoftwareAuthenticator,
  type RegistrationOptionsJSON,
} from "../passkey-authenticator";

const ORIGIN = "http://localhost:3000";

class CookieJar {
  private cookies = new Map<string, string>();

  constructor(initial = "") {
    for (const pair of initial.split(/;\s*/).filter(Boolean)) {
      const [name, ...value] = pair.split("=");
      if (name) this.cookies.set(name, value.join("="));
    }
  }

  absorb(res: Response) {
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, ...value] = (pair ?? "").split("=");
      if (name) this.cookies.set(name, value.join("="));
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function authRequest(path: string, init: { method: string; body?: unknown; jar?: CookieJar }) {
  const headers = new Headers({ "Content-Type": "application/json", origin: ORIGIN });
  const cookie = init.jar?.header();
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: init.method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

function setsSessionCookie(res: Response) {
  return res.headers.getSetCookie().some((cookie) => cookie.includes("session_token="));
}

async function registerPasskey(
  services: PluginServices,
  jar: CookieJar,
  options: { curve?: AuthenticatorCurve; userVerified?: boolean } = {},
) {
  const authenticator = createSoftwareAuthenticator(options.curve);
  const optionsRes = await services.handler(
    authRequest("/passkey/generate-register-options", { method: "GET", jar }),
  );
  expect(optionsRes.status).toBe(200);
  jar.absorb(optionsRes);
  const registrationOptions = (await optionsRes.json()) as RegistrationOptionsJSON;
  const verifyRes = await services.handler(
    authRequest("/passkey/verify-registration", {
      method: "POST",
      jar,
      body: {
        response: authenticator.register(registrationOptions, {
          origin: ORIGIN,
          userVerified: options.userVerified,
        }),
      },
    }),
  );
  jar.absorb(verifyRes);
  return { authenticator, registrationOptions, verifyRes };
}

async function getJson<T>(services: PluginServices, path: string, jar: CookieJar): Promise<T> {
  const res = await services.handler(authRequest(path, { method: "GET", jar }));
  return (await res.json()) as T;
}

describe("passkey sign-up", () => {
  let services: PluginServices;

  beforeEach(async () => {
    ({ services } = await createTestServices());
  });

  it("signs a new member in and links their Passkey Wallet as primary in one ceremony", async () => {
    const jar = new CookieJar();
    const { verifyRes } = await registerPasskey(services, jar);

    expect(verifyRes.status).toBe(200);
    expect(setsSessionCookie(verifyRes)).toBe(true);
    const body = (await verifyRes.json()) as {
      passkeyWallet: { status: string; accountId: string; network: string };
    };
    expect(body.passkeyWallet).toMatchObject({ status: "linked", network: "mainnet" });
    expect(body.passkeyWallet.accountId).toMatch(/^0s[0-9a-f]{40}$/);

    const session = await getJson<{ user: { id: string } } | null>(services, "/get-session", jar);
    expect(session?.user.id).toBeTruthy();

    const accounts = await getJson<{ activeAccount: { accountId: string; isPrimary: boolean } }>(
      services,
      "/near/list-accounts",
      jar,
    );
    expect(accounts.activeAccount).toMatchObject({
      accountId: body.passkeyWallet.accountId,
      isPrimary: true,
    });
  });

  it("adds a passkey for a signed-in member without minting a session or changing their primary NEAR account", async () => {
    const member = await createTestUser(services);
    await services.db.insert(schema.nearAccount).values({
      id: crypto.randomUUID(),
      userId: member.userId,
      accountId: "alice.near",
      network: "mainnet",
      publicKey: "ed25519:placeholder",
      isPrimary: true,
      createdAt: new Date(),
    });
    const jar = new CookieJar(member.cookie);

    const { verifyRes } = await registerPasskey(services, jar);

    expect(verifyRes.status).toBe(200);
    expect(setsSessionCookie(verifyRes)).toBe(false);
    expect(await verifyRes.json()).not.toHaveProperty("passkeyWallet");
    const sessions = await getJson<unknown[]>(services, "/list-sessions", jar);
    expect(sessions).toHaveLength(1);
    const accounts = await getJson<{ activeAccount: { accountId: string } }>(
      services,
      "/near/list-accounts",
      jar,
    );
    expect(accounts.activeAccount.accountId).toBe("alice.near");
  });

  it("asks for a discoverable, user-verified ES256 or EdDSA credential", async () => {
    const res = await services.handler(
      authRequest("/passkey/generate-register-options", { method: "GET" }),
    );
    const options = (await res.json()) as {
      authenticatorSelection: Record<string, unknown>;
      pubKeyCredParams: Array<{ alg: number }>;
    };

    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    });
    expect(options.pubKeyCredParams.map(({ alg }) => alg).sort((a, b) => a - b)).toEqual([-8, -7]);
  });

  it("signs a new member up with an Ed25519 passkey", async () => {
    const { verifyRes } = await registerPasskey(services, new CookieJar(), { curve: "ed25519" });

    expect(verifyRes.status).toBe(200);
    expect(setsSessionCookie(verifyRes)).toBe(true);
    expect(await verifyRes.json()).toMatchObject({ passkeyWallet: { status: "linked" } });
  });

  it("refuses a registration without user verification", async () => {
    const { verifyRes } = await registerPasskey(services, new CookieJar(), {
      userVerified: false,
    });

    expect(verifyRes.status).toBe(400);
    expect(setsSessionCookie(verifyRes)).toBe(false);
  });

  it("refuses a passkey whose key cannot derive a Passkey Wallet", async () => {
    const { verifyRes } = await registerPasskey(services, new CookieJar(), { curve: "rsa" });

    expect(verifyRes.status).toBe(400);
    expect(setsSessionCookie(verifyRes)).toBe(false);
    expect(await verifyRes.json()).toMatchObject({ code: "PASSKEY_UNSUPPORTED_AUTHENTICATOR" });
  });

  it("refuses a passkey sign-in without user verification", async () => {
    const { authenticator } = await registerPasskey(services, new CookieJar());
    const jar = new CookieJar();
    const optionsRes = await services.handler(
      authRequest("/passkey/generate-authenticate-options", { method: "GET", jar }),
    );
    jar.absorb(optionsRes);
    const signInRes = await services.handler(
      authRequest("/passkey/verify-authentication", {
        method: "POST",
        jar,
        body: {
          response: authenticator.authenticate(
            (await optionsRes.json()) as AuthenticationOptionsJSON,
            {
              origin: ORIGIN,
              userVerified: false,
            },
          ),
        },
      }),
    );

    expect(signInRes.status).toBe(400);
    expect(setsSessionCookie(signInRes)).toBe(false);
  });

  it("signs a returning member in with their passkey", async () => {
    const { authenticator } = await registerPasskey(services, new CookieJar());
    const jar = new CookieJar();
    const optionsRes = await services.handler(
      authRequest("/passkey/generate-authenticate-options", { method: "GET", jar }),
    );
    jar.absorb(optionsRes);
    const signInRes = await services.handler(
      authRequest("/passkey/verify-authentication", {
        method: "POST",
        jar,
        body: {
          response: authenticator.authenticate(
            (await optionsRes.json()) as AuthenticationOptionsJSON,
            { origin: ORIGIN },
          ),
        },
      }),
    );

    expect(signInRes.status).toBe(200);
    expect(setsSessionCookie(signInRes)).toBe(true);
  });

  it("signs a new member in on testnet and reports that no Passkey Wallet is available", async () => {
    ({ services } = await createTestServices({ network: "testnet" }));
    const jar = new CookieJar();

    const { verifyRes } = await registerPasskey(services, jar);

    expect(setsSessionCookie(verifyRes)).toBe(true);
    expect(await verifyRes.json()).toMatchObject({
      passkeyWallet: { status: "unavailable", network: "testnet" },
    });
    const accounts = await getJson<{ accounts: unknown[] }>(services, "/near/list-accounts", jar);
    expect(accounts.accounts).toEqual([]);
  });

  it("mints no session when a registration begun while signed in is verified without the session", async () => {
    const member = await createTestUser(services);
    const jar = new CookieJar(member.cookie);
    const authenticator = createSoftwareAuthenticator();
    const optionsRes = await services.handler(
      authRequest("/passkey/generate-register-options", { method: "GET", jar }),
    );
    const challengeOnly = new CookieJar();
    challengeOnly.absorb(optionsRes);

    const verifyRes = await services.handler(
      authRequest("/passkey/verify-registration", {
        method: "POST",
        jar: challengeOnly,
        body: {
          response: authenticator.register((await optionsRes.json()) as RegistrationOptionsJSON, {
            origin: ORIGIN,
          }),
        },
      }),
    );

    expect(verifyRes.status).toBe(200);
    expect(setsSessionCookie(verifyRes)).toBe(false);
    expect(await verifyRes.json()).not.toHaveProperty("passkeyWallet");
  });
});
