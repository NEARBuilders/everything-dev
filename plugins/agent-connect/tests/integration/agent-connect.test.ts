import type { ContractRouterClient } from "@orpc/contract";
import { Context, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { contract } from "@/contract";
import { AgentStore } from "@/services/store";

const MOCK_ACCOUNT_ID = "test.near";
const MOCK_PUBLIC_KEY = "ed25519:abcdefghijklmnopqrstuvwxyz0123456789ABCD";

const state = vi.hoisted(() => ({
  /** Status returned by the mocked submitIntent call. */
  submitStatus: "SUCCESS",
  /** Status returned by the mocked getStatus call (polling). */
  pollStatus: "SUCCESS",
  /** How many times the mock's generateIntent was invoked. */
  generateCalls: 0,
}));

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

const SIGNED_DATA = {
  standard: "nep413",
  payload: { message: "m", recipient: "r", nonce: "dGVzdA==" },
  public_key: MOCK_PUBLIC_KEY,
  signature: "sig",
};

/**
 * In-memory stand-in for the hosted Agent API — the SDK module is mocked so
 * the plugin's control-plane invariants are tested against the same
 * generate/submit/status surface without network. `state` drives the
 * non-terminal/later-success paths.
 */
function makeAgentApiStub() {
  const intents: Array<{ type: string; agent_id?: string }> = [];
  const intentTypeByCorrelationId = new Map<string, string>();
  return class AgentApiMock {
    constructor(options?: { apiKey?: string }) {
      if (!options?.apiKey) throw new Error("apiKey required");
    }
    generateIntent(
      request: { type: string; agent_id?: string },
      options?: { idempotencyKey?: string },
    ) {
      state.generateCalls += 1;
      intents.push(request);
      const correlationId = `intent_${intents.length}`;
      intentTypeByCorrelationId.set(correlationId, request.type);
      const agentId = "agent_id" in request && request.agent_id ? request.agent_id : "ag_test1";
      return Promise.resolve({
        correlation_id: correlationId,
        type: request.type,
        agent_id: agentId,
        status: "PENDING_SIGNATURE",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        signer: { type: "near", account_id: MOCK_ACCOUNT_ID, public_key: MOCK_PUBLIC_KEY },
        idempotencyKey: options?.idempotencyKey,
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
      const settled = state.submitStatus === "SUCCESS";
      const details =
        request.type === "grant_issue" && settled ? { grant: { grant_id: "64hexgrantid" } } : {};
      return Promise.resolve({
        correlation_id: "intent_1",
        agent_id: "ag_test1",
        status: state.submitStatus,
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
      const settled = state.pollStatus === "SUCCESS";
      const intentType = intentTypeByCorrelationId.get(correlationId) ?? "agent_create";
      const details = !settled
        ? {}
        : intentType === "grant_issue"
          ? { grant: { grant_id: "64hexgrantid" } }
          : { agent_id: "ag_test1", revision: 1, policy_hash: "hash", transaction_hash: null };
      return Promise.resolve({
        correlation_id: correlationId,
        agent_id: "ag_test1",
        status: state.pollStatus,
        failure_code: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dispatch_committed_at: null,
        grant: null,
        type: intentType,
        details,
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

const { getPluginClient, getPluginEffectContext, runtime } = await import("../setup");
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
        signedData: SIGNED_DATA,
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
        signedData: SIGNED_DATA,
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
      signedData: SIGNED_DATA,
    });
    expect(status.status).toBe("SUCCESS");

    const view = await client.agentGet({ agentId: "ag_test1" });
    expect(view.id).toBe("ag_test1");
  });

  it("reuses the prepared intent for the same idempotency key", async () => {
    const client = await getPluginClient({ userId: "user1" });
    const first = await client.agentCreate({
      name: "my agent",
      policy: TEST_POLICY,
      idempotencyKey: "retry-key-1234",
    });
    const callsAfterFirst = state.generateCalls;

    const second = await client.agentCreate({
      name: "my agent",
      policy: TEST_POLICY,
      idempotencyKey: "retry-key-1234",
    });

    expect(second.correlation_id).toBe(first.correlation_id);
    expect(state.generateCalls).toBe(callsAfterFirst);
  });

  it("conflicts when the same idempotency key is reused for a different request type", async () => {
    const client = await getPluginClient({ userId: "user1" });
    await client.agentCreate({
      name: "my agent",
      policy: TEST_POLICY,
      idempotencyKey: "retry-key-1234",
    });

    await expect(
      client.prepareIntent({
        type: "grant_issue",
        agentId: "ag_test1",
        label: "l",
        idempotencyKey: "retry-key-1234",
      }),
    ).rejects.toThrow(/different request/);
  });

  it("reconciles local state when polling reveals a later success", async () => {
    state.submitStatus = "PROCESSING";
    state.pollStatus = "SUCCESS";
    try {
      const client = await getPluginClient({ userId: "user1" });
      await client.agentCreate({ name: "my agent", policy: TEST_POLICY });

      const grantIntent = await client.prepareIntent({
        type: "grant_issue",
        agentId: "ag_test1",
        label: "assistant-session-42",
      });
      await client.intentSubmit({
        type: "grant_issue",
        correlationId: grantIntent.correlation_id,
        signedData: SIGNED_DATA,
      });

      const store = Context.get(getPluginEffectContext(), AgentStore);
      const intentRow = await Effect.runPromise(
        store.findIntentByUser("user1", grantIntent.correlation_id),
      );
      const grantRowBefore = await Effect.runPromise(
        intentRow?.grantRowId ? store.findGrantById(intentRow.grantRowId) : Effect.succeed(null),
      );
      expect(grantRowBefore?.grantId).toBeNull();

      await client.intentStatus({ correlationId: grantIntent.correlation_id });

      const grantRowAfter = await Effect.runPromise(
        intentRow?.grantRowId ? store.findGrantById(intentRow.grantRowId) : Effect.succeed(null),
      );
      expect(grantRowAfter?.grantId).toBe("64hexgrantid");
    } finally {
      state.submitStatus = "SUCCESS";
      state.pollStatus = "SUCCESS";
    }
  });

  it("activates the agent row when polling reveals a later success", async () => {
    state.submitStatus = "PROCESSING";
    state.pollStatus = "SUCCESS";
    try {
      const client = await getPluginClient({ userId: "user1" });
      const created = await client.agentCreate({ name: "my agent", policy: TEST_POLICY });

      await client.intentSubmit({
        type: "agent_create",
        correlationId: created.correlation_id,
        signedData: SIGNED_DATA,
      });

      const store = Context.get(getPluginEffectContext(), AgentStore);
      const agentRow = await Effect.runPromise(store.findAgentByUser("user1", "ag_test1"));
      expect(agentRow?.status).toBe("ACTIVE");
    } finally {
      state.submitStatus = "SUCCESS";
      state.pollStatus = "SUCCESS";
    }
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
