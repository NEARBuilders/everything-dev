import type { ContractRouterClient } from "@orpc/contract";
import { describe, expect, it, vi } from "vitest";
import type { contract } from "@/contract";

const MOCK_ACCOUNT_ID = "test.near";
const MOCK_PUBLIC_KEY = "ed25519:abcdefghijklmnopqrstuvwxyz0123456789ABCD";

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

/**
 * In-memory stand-in for the hosted Agent API — the SDK module is mocked so
 * the plugin's control-plane invariants are tested against the same
 * generate/submit/status surface without network.
 */
function makeAgentApiStub() {
  const intents: Array<{ type: string; agent_id?: string }> = [];
  return class AgentApiMock {
    constructor(options?: { apiKey?: string }) {
      if (!options?.apiKey) throw new Error("apiKey required");
    }
    generateIntent(
      request: { type: string; agent_id?: string },
      options?: { idempotencyKey?: string },
    ) {
      intents.push(request);
      const agentId = "agent_id" in request && request.agent_id ? request.agent_id : "ag_test1";
      return Promise.resolve({
        correlation_id: `intent_${intents.length}`,
        type: request.type,
        agent_id: agentId,
        status: "PENDING_SIGNATURE",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        signer: { type: "near", account_id: MOCK_ACCOUNT_ID, public_key: MOCK_PUBLIC_KEY },
        intent: {
          standard: "nep413",
          payload: {
            message: "owner intent",
            recipient: "api.agentsonintents.com",
            nonce: "dGVzdA==",
          },
        },
        preview: { summary: "Sign to continue" },
      });
    }
    submitIntent(request: { type: string }) {
      const details = request.type === "grant_issue" ? { grant: { grant_id: "64hexgrantid" } } : {};
      return Promise.resolve({
        correlation_id: "intent_1",
        agent_id: "ag_test1",
        status: "SUCCESS",
        failure_code: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dispatch_committed_at: null,
        grant: null,
        type: request.type,
        details,
      });
    }
    getStatus(correlationId: string) {
      return Promise.resolve({
        correlation_id: correlationId,
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
    listAgents() {
      return Promise.resolve({ data: [{ id: "ag_test1" }], next_cursor: null });
    }
    getAgent(agentId: string) {
      return Promise.resolve({ id: agentId });
    }
    listGrants() {
      return Promise.resolve([]);
    }
  };
}

vi.mock("@near-intents-agent-api/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@near-intents-agent-api/sdk")>();
  return {
    ...actual,
    AgentApi: makeAgentApiStub(),
  };
});

const { getPluginClient, runtime } = await import("../setup");
const { createPluginRuntime } = await import("every-plugin");
const Plugin = (await import("@/index")).default;

describe("agent connect routes", () => {
  it("requires a session", async () => {
    const client = await getPluginClient();
    await expect(client.agentCreate({ name: "my agent", policy: TEST_POLICY })).rejects.toThrow(
      /Authentication required/,
    );
  });

  it("returns the generated intent without leaking the api key", async () => {
    const client = await getPluginClient({ userId: "user1" });
    const generated = await client.agentCreate({ name: "my agent", policy: TEST_POLICY });

    expect(generated.correlation_id).toMatch(/^intent_/);
    expect(generated.intent.standard).toBe("nep413");
    expect(JSON.stringify(generated)).not.toContain("naa_");
  });

  it("derives the owner from the primary linked NEAR account or refuses", async () => {
    const client = await getPluginClient({
      userId: "user1",
      near: { primaryAccountId: null, linkedAccounts: [], hasNearAccount: false },
    });
    await expect(client.agentCreate({ name: "no wallet", policy: TEST_POLICY })).rejects.toThrow(
      /No owner wallet available/,
    );
  });

  it("refuses submits for correlation ids not issued to the user", async () => {
    const client = await getPluginClient({ userId: "user1" });
    await expect(
      client.intentSubmit({
        type: "agent_create",
        correlationId: "intent_not_issued",
        signedData: {
          standard: "nep413",
          payload: { message: "m", recipient: "r", nonce: "dGVzdA==" },
          public_key: MOCK_PUBLIC_KEY,
          signature: "sig",
        },
      }),
    ).rejects.toThrow(/Unknown correlation id/);
  });

  it("rejects a submit whose type does not match the issued intent", async () => {
    const client = await getPluginClient({ userId: "user1" });
    const created = await client.agentCreate({ name: "my agent", policy: TEST_POLICY });

    await expect(
      client.intentSubmit({
        type: "grant_revoke",
        correlationId: created.correlation_id,
        signedData: {
          standard: "nep413",
          payload: { message: "m", recipient: "r", nonce: "dGVzdA==" },
          public_key: MOCK_PUBLIC_KEY,
          signature: "sig",
        },
      }),
    ).rejects.toThrow(/does not match the issued correlation id/);
  });

  it("keeps grant tokens server-side when issuing a grant", async () => {
    const client = await getPluginClient({ userId: "user1" });
    await client.agentCreate({ name: "my agent", policy: TEST_POLICY });

    const generated = await client.prepareIntent({
      type: "grant_issue",
      agentId: "ag_test1",
      label: "assistant-session-42",
    });
    expect(generated.type).toBe("grant_issue");
    expect(JSON.stringify(generated)).not.toContain("ngt_");
  });

  it("refuses grant operations on agents the user does not own", async () => {
    const client = await getPluginClient({ userId: "someone-else" });
    await expect(
      client.prepareIntent({ type: "grant_issue", agentId: "ag_test1", label: "hijack" }),
    ).rejects.toThrow(/Agent not found for this user/);
    await expect(client.grantList({ agentId: "ag_test1" })).rejects.toThrow(
      /Agent not found for this user/,
    );
  });

  it("completes the create → submit → owned-agent flow", async () => {
    const client = await getPluginClient({ userId: "user1" });
    const created = await client.agentCreate({ name: "my agent", policy: TEST_POLICY });

    const status = await client.intentSubmit({
      type: "agent_create",
      correlationId: created.correlation_id,
      signedData: {
        standard: "nep413",
        payload: { message: "m", recipient: "r", nonce: "dGVzdA==" },
        public_key: MOCK_PUBLIC_KEY,
        signature: "sig",
      },
    });
    expect(status.status).toBe("SUCCESS");

    const view = await client.agentGet({ agentId: "ag_test1" });
    expect(view.id).toBe("ag_test1");
  });
});

describe("dormant plugin", () => {
  it("fails with a not-configured error when no api key is set", async () => {
    const { createServer } = await import("node:http");
    const dormantRuntime = createPluginRuntime({
      registry: {
        "@everything-dev/agent-connect-plugin": { module: Plugin, description: "dormant" },
      },
      secrets: {},
    });
    const { router, initialized } = await dormantRuntime.usePlugin(
      "@everything-dev/agent-connect-plugin",
      {
        variables: {},
        secrets: { AGENT_CONNECT_DATABASE_URL: "pglite:.bos/agent-connect-test/:memory:" },
      } as never,
    );

    const { RPCHandler } = await import("@orpc/server/node");
    const { createORPCClient } = await import("@orpc/client");
    const { RPCLink } = await import("@orpc/client/fetch");

    const rpcHandler = new RPCHandler(router);
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, "http://localhost:0");
      if (url.pathname.startsWith("/rpc")) {
        const result = await rpcHandler.handle(req, res, {
          prefix: "/rpc",
          context: { userId: "user1", "effect/context": initialized.effectContext },
        });
        if (result.matched) return;
      }
      res.statusCode = 404;
      res.end("Route not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const link = new RPCLink({
      origin: `http://127.0.0.1:${port}`,
      url: "/rpc",
      fetch: globalThis.fetch,
    });
    const client: ContractRouterClient<typeof contract> = createORPCClient(link);

    await expect(client.agentList()).rejects.toThrow(/not configured/);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await dormantRuntime.shutdown();
    await runtime.shutdown();
  });
});
