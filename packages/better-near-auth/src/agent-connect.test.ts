import { createHash } from "node:crypto";
import { hex } from "@scure/base";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { createGrantCredential, grantCommitment } from "./agent-api.js";
import { agentConnect } from "./agent-connect.js";
import { siwn } from "./index.js";

const MOCK_ACCOUNT_ID = "test.near";
const MOCK_RECIPIENT = "example.near";
const MOCK_PUBLIC_KEY = "ed25519:abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const AGENT_API_BASE = "http://localhost:9999";

vi.mock("near-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("near-kit")>();
  return {
    ...actual,
    Near: vi.fn(function NearMock() {
      return {};
    }),
    verifyNep413Signature: vi.fn(() => Promise.resolve(true)),
  };
});

function makeUniqueNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  return nonce;
}

const mockSignedMessage = {
  accountId: MOCK_ACCOUNT_ID,
  publicKey: MOCK_PUBLIC_KEY,
  signature: "mock-signature-base64",
};

function makeVerifyBody() {
  const nonceBytes = makeUniqueNonce();
  const nonceHex = hex.encode(nonceBytes);
  return {
    signedMessage: mockSignedMessage,
    message: `Sign in to ${MOCK_RECIPIENT}`,
    recipient: MOCK_RECIPIENT,
    nonce: nonceHex,
    accountId: MOCK_ACCOUNT_ID,
  };
}

const TEST_POLICY = {
  frozen: false,
  actions: ["swap", "transfer", "withdraw"],
  confidential: false,
  owner_approval: false,
  assets: "any",
  limits: {},
  max_actions_per_hour: null,
  destinations: { mode: "only", list: [] },
  budget: { daily_usd: "10", weekly_usd: null, monthly_usd: null },
  timelock_ms: 0,
};

function makeAgentApiFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const handler = async (
    url: string | URL,
    init?: RequestInit & { body?: string },
  ): Promise<Response> => {
    calls.push({ url: String(url), init });
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/v1/generate-intent")) {
      const body = JSON.parse(init?.body ?? "{}") as {
        type: string;
        agent_id?: string;
      };
      const agentId = body.agent_id ?? "ag_test1";
      return Response.json({
        correlation_id: `intent_${calls.length}`,
        type: body.type,
        agent_id: agentId,
        status: "PENDING_SIGNATURE",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        signer: { type: "near", account_id: MOCK_ACCOUNT_ID, public_key: MOCK_PUBLIC_KEY },
        intent: {
          standard: "nep413",
          payload: {
            message: "create agent",
            recipient: "api.agentsonintents.com",
            nonce: "dGVzdA==",
          },
        },
        preview: { summary: "Create your agent account" },
      });
    }
    if (path.endsWith("/v1/submit-intent")) {
      const body = JSON.parse(init?.body ?? "{}") as { type: string };
      const details =
        body.type === "grant_issue"
          ? {
              grant: {
                grant_id: "64hexgrantid",
                agent_id: "ag_test1",
                wallet_id: "w",
                label: "l",
                issued_at: "",
                expires_at: "",
                revoked_at: null,
                revoked_reason: null,
                owner_epoch: 0,
                owner_message: {},
              },
            }
          : {};
      return Response.json({
        correlation_id: "intent_1",
        agent_id: "ag_test1",
        status: "SUCCESS",
        failure_code: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dispatch_committed_at: null,
        grant: null,
        type: body.type,
        details,
      });
    }
    if (path.endsWith("/v1/status")) {
      return Response.json({
        correlation_id: "intent_1",
        agent_id: "ag_test1",
        status: "SUCCESS",
        failure_code: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dispatch_committed_at: null,
        grant: null,
        type: "agent_create",
        details: { agent_id: "ag_test1", revision: 1, policy_hash: "hash", transaction_hash: null },
      });
    }
    return Response.json(
      { errors: [{ status: "404", code: "not_found", title: "Not found" }] },
      { status: 404 },
    );
  };
  const fetchFn = vi.fn(handler) as unknown as typeof fetch;
  return { fetchFn, calls };
}

async function setup() {
  const { fetchFn } = makeAgentApiFetch();
  return getTestInstance(
    {
      plugins: [
        siwn({
          recipient: MOCK_RECIPIENT,
          validateLimitedAccessKey: async () => true,
        }),
        agentConnect({
          apiKey: `naa_${"a".repeat(43)}`,
          baseUrl: AGENT_API_BASE,
          fetch: fetchFn,
        }),
      ],
    },
    {
      clientOptions: { plugins: [] },
      disableTestUser: true,
    },
  );
}

async function verifyWithCookie(customFetchImpl: (r: string, o?: unknown) => Promise<Response>) {
  const res = await customFetchImpl("http://localhost/api/auth/near/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(makeVerifyBody()),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie") || "";
  expect(cookie).not.toBe("");
  return cookie;
}

describe("agent connect grant credentials", () => {
  it("issues ngt_ tokens whose commitment is the sha256 of the token", () => {
    const { token, commitment } = createGrantCredential();
    expect(token).toMatch(/^ngt_[A-Za-z0-9_-]{43}$/);
    expect(commitment).toBe(createHash("sha256").update(token).digest("hex"));
    expect(commitment).toBe(grantCommitment(token));
  });
});

describe("agent connect routes", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("requires a session", async () => {
    const { customFetchImpl } = await setup();
    const res = await customFetchImpl("http://localhost/api/auth/agent/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "my agent", policy: TEST_POLICY }),
    });
    expect(res.status).toBe(401);
  });

  it("returns the generated intent without leaking the api key", async () => {
    const { customFetchImpl } = await setup();
    const cookie = await verifyWithCookie(customFetchImpl);

    const res = await customFetchImpl("http://localhost/api/auth/agent/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "my agent", policy: TEST_POLICY }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.correlation_id).toMatch(/^intent_/);
    expect(body.intent.standard).toBe("nep413");
    expect(JSON.stringify(body)).not.toContain("naa_");
  });

  it("refuses submits for correlation ids not issued to the user", async () => {
    const { customFetchImpl } = await setup();
    const cookie = await verifyWithCookie(customFetchImpl);

    const res = await customFetchImpl("http://localhost/api/auth/agent/intents/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        type: "agent_create",
        correlationId: "intent_not_issued",
        signedData: {
          standard: "nep413",
          payload: { message: "m", recipient: "r", nonce: "dGVzdA==" },
          public_key: MOCK_PUBLIC_KEY,
          signature: "sig",
        },
      }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a submit whose type does not match the issued intent", async () => {
    const { customFetchImpl } = await setup();
    const cookie = await verifyWithCookie(customFetchImpl);

    const createRes = await customFetchImpl("http://localhost/api/auth/agent/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "my agent", policy: TEST_POLICY }),
    });
    const created = (await createRes.json()) as { correlation_id: string };

    const res = await customFetchImpl("http://localhost/api/auth/agent/intents/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        type: "grant_revoke",
        correlationId: created.correlation_id,
        signedData: {
          standard: "nep413",
          payload: { message: "m", recipient: "r", nonce: "dGVzdA==" },
          public_key: MOCK_PUBLIC_KEY,
          signature: "sig",
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("keeps grant tokens server-side when issuing a grant", async () => {
    const { customFetchImpl } = await setup();
    const cookie = await verifyWithCookie(customFetchImpl);

    const createRes = await customFetchImpl("http://localhost/api/auth/agent/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "my agent", policy: TEST_POLICY }),
    });
    expect(createRes.status).toBe(200);

    const res = await customFetchImpl("http://localhost/api/auth/agent/grants/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ agentId: "ag_test1", label: "assistant-session-42" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("grant_issue");
    expect(JSON.stringify(body)).not.toContain("ngt_");
  });
});
