import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchBosConfigFromFastKvMock } = vi.hoisted(() => ({
  fetchBosConfigFromFastKvMock: vi.fn(),
}));

vi.mock("../../src/services/registry/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/registry/fastkv")>();
  return {
    ...actual,
    fetchBosConfigFromFastKv: fetchBosConfigFromFastKvMock,
  };
});

import { isConfigAlreadyPublished } from "../../src/services/deploy/train";
import {
  type ConfirmLeg,
  confirmPublish,
  describeConfirmTimeout,
  TX_UNKNOWN_GRACE_MS,
  type TxStatus,
} from "../../src/services/registry/confirm";
import type { RegistryKey } from "../../src/services/registry/keys";
import type { BosConfig } from "../../src/types";

const CONFIG_KEY: RegistryKey = {
  kind: "runtimeConfig",
  ref: "bos://dev.everything.near/everything.dev",
};
const MANIFEST_KEY: RegistryKey = {
  kind: "manifest",
  ref: "bos://dev.everything.near/everything.dev",
};
const VERSION_KEY: RegistryKey = {
  kind: "version",
  ref: "bos://dev.everything.near/everything.dev",
  version: "2.0.0-rc.31",
};

/** A fake clock: `now()` walks the tick count so the machine's deadline
 * arithmetic runs deterministically without real timers. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    },
  };
}

function harness(
  legs: ConfirmLeg[],
  opts?: { txHash?: string; txStatus?: (txHash: string) => Promise<TxStatus> },
) {
  const clock = fakeClock();
  const reads: Array<{ key: RegistryKey; value: unknown }> = [];
  const history: Array<{ txHash?: string }> = [];
  let historyError: Error | undefined;
  const outcome = confirmPublish({
    legs,
    ...(opts?.txHash ? { txHash: opts.txHash } : {}),
    ...(opts?.txStatus ? { txStatus: opts.txStatus } : {}),
    timeoutMs: 10_000,
    intervalMs: 10,
    read: async (key) => {
      const hit = [...reads].reverse().find((r) => JSON.stringify(r.key) === JSON.stringify(key));
      if (!hit) throw new Error(`no served value for ${key.kind}`);
      return hit.value;
    },
    history: async () => {
      if (historyError) throw historyError;
      return history;
    },
    now: clock.now,
    sleep: async (ms) => {
      clock.tick(ms);
    },
  });
  return {
    outcome,
    clock,
    serve: (key: RegistryKey, value: unknown) => reads.push({ key, value }),
    serveHistory: (txHash?: string) => history.push({ ...(txHash ? { txHash } : {}) }),
    failHistory: (error: Error) => {
      historyError = error;
    },
  };
}

describe("confirmPublish — the publish-confirmation state machine", () => {
  beforeEach(() => {
    delete process.env.BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS;
    delete process.env.BOS_PUBLISH_CONFIRMATION_INTERVAL_MS;
  });

  afterEach(() => {
    delete process.env.BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS;
    delete process.env.BOS_PUBLISH_CONFIRMATION_INTERVAL_MS;
  });

  const configLeg = (value: unknown): ConfirmLeg => ({
    kind: "runtimeConfig",
    key: CONFIG_KEY,
    expected: value,
  });

  it("verifies immediately when every leg serves the published payload", async () => {
    const h = harness([configLeg({ domain: "everything.dev" })]);
    h.serve(CONFIG_KEY, { domain: "everything.dev" });
    await expect(h.outcome).resolves.toEqual({ ok: true, verified: ["runtimeConfig"] });
  });

  it("verifies all legs only when every leg reads back equal", async () => {
    const legs: ConfirmLeg[] = [
      configLeg({ domain: "everything.dev" }),
      { kind: "manifest", key: MANIFEST_KEY, expected: { version: "2.0.0-rc.31" } },
      { kind: "version", key: VERSION_KEY, expected: { frameworkVersion: "2.0.0-rc.31" } },
    ];
    const h = harness(legs, { txHash: "tx1" });
    h.serveHistory("tx1");
    h.serve(CONFIG_KEY, { domain: "everything.dev" });
    h.serve(MANIFEST_KEY, { version: "2.0.0-rc.31" });
    h.serve(VERSION_KEY, { frameworkVersion: "2.0.0-rc.31" });
    await expect(h.outcome).resolves.toEqual({
      ok: true,
      verified: ["runtimeConfig", "manifest", "version"],
    });
  });

  it("a lagging leg retries until it serves — then verifies", async () => {
    const clock = fakeClock();
    let served = 0;
    const verdict = await confirmPublish({
      legs: [configLeg({ v: 1 })],
      timeoutMs: 10_000,
      intervalMs: 10,
      read: async () => {
        served += 1;
        return served < 3 ? { v: 0 } : { v: 1 };
      },
      now: clock.now,
      sleep: async (ms) => {
        clock.tick(ms);
      },
    });
    expect(verdict).toEqual({ ok: true, verified: ["runtimeConfig"] });
    expect(served).toBe(3);
  });

  it("times out naming the unverified legs when they never serve", async () => {
    const legs: ConfirmLeg[] = [
      configLeg({ v: 1 }),
      { kind: "manifest", key: MANIFEST_KEY, expected: { version: "1" } },
    ];
    const h = harness(legs, { txHash: "tx1" });
    h.serveHistory("tx1");
    h.serve(CONFIG_KEY, { v: 1 }); // config verifies; manifest never serves
    const verdict = await h.outcome;
    expect(verdict).toMatchObject({ ok: false, unverified: ["manifest"] });
    expect(
      describeConfirmTimeout(legs, verdict as Extract<typeof verdict, { ok: false }>),
    ).toContain("apps/dev.everything.near/everything.dev/manifest.json");
  });

  it("the tx probe is informative only — after two absent probes it falls back to content polling", async () => {
    const h = harness([configLeg({ v: 1 })], { txHash: "tx1" });
    h.serve(CONFIG_KEY, { v: 1 }); // content serves; history never shows the tx
    h.serveHistory(undefined);
    h.serveHistory(undefined);
    h.serveHistory(undefined);
    await expect(h.outcome).resolves.toEqual({ ok: true, verified: ["runtimeConfig"] });
  });

  it("a history probe failure falls back permanently to content polling", async () => {
    const h = harness([configLeg({ v: 1 })], { txHash: "tx1" });
    h.serve(CONFIG_KEY, { v: 1 });
    h.failHistory(new Error("history endpoint down"));
    await expect(h.outcome).resolves.toEqual({ ok: true, verified: ["runtimeConfig"] });
  });

  it("without a txHash it tracks content alone", async () => {
    const h = harness([configLeg({ v: 1 })]);
    h.serve(CONFIG_KEY, { v: 1 });
    await expect(h.outcome).resolves.toEqual({ ok: true, verified: ["runtimeConfig"] });
  });

  it("an invalid transaction ends the wait immediately with a terminal verdict", async () => {
    const txStatus = vi.fn<() => Promise<TxStatus>>().mockResolvedValue("invalid");
    const h = harness([configLeg({ v: 1 })], { txHash: "tx1", txStatus });
    const verdict = await h.outcome;
    expect(verdict).toMatchObject({
      ok: false,
      terminalTx: true,
      unverified: ["runtimeConfig"],
    });
    expect((verdict as Extract<typeof verdict, { ok: false }>).lastError).toContain(
      "transaction tx1 will never apply",
    );
    expect((verdict as Extract<typeof verdict, { ok: false }>).lastError).toContain(
      "rejected on-chain",
    );
    expect(txStatus).toHaveBeenCalledTimes(1);
  });

  it("a transaction unknown past the grace window is terminal — dropped at broadcast", async () => {
    const clock = fakeClock();
    const verdict = await confirmPublish({
      legs: [configLeg({ v: 1 })],
      txHash: "tx1",
      txStatus: async () => "unknown",
      timeoutMs: 60_000,
      intervalMs: 10,
      read: async () => {
        throw new Error("registry unreachable");
      },
      history: async () => [],
      now: clock.now,
      sleep: async (ms) => {
        clock.tick(ms);
      },
    });
    expect(verdict).toMatchObject({ ok: false, terminalTx: true });
    expect((verdict as Extract<typeof verdict, { ok: false }>).lastError).toContain(
      `unknown to the chain past ${TX_UNKNOWN_GRACE_MS / 1000}s`,
    );
  });

  it("a transient unknown never becomes terminal before the grace window", async () => {
    let calls = 0;
    const txStatus = vi.fn(async () =>
      calls++ < 5 ? ("unknown" as TxStatus) : ("included" as TxStatus),
    );
    const h = harness([configLeg({ v: 1 })], { txHash: "tx1", txStatus });
    const verdict = await h.outcome;
    expect(verdict).toMatchObject({ ok: false, unverified: ["runtimeConfig"] });
    expect("terminalTx" in verdict).toBe(false);
    expect(calls).toBeGreaterThanOrEqual(5);
  });

  it("a status probe failure is informative only — content polling still verifies", async () => {
    const txStatus = vi.fn<() => Promise<TxStatus>>().mockRejectedValue(new Error("rpc down"));
    const h = harness([configLeg({ v: 1 })], { txHash: "tx1", txStatus });
    h.serve(CONFIG_KEY, { v: 1 });
    await expect(h.outcome).resolves.toEqual({ ok: true, verified: ["runtimeConfig"] });
  });

  it("without a txStatus seam the machine behaves exactly as before", async () => {
    const h = harness([configLeg({ v: 1 })], { txHash: "tx1" });
    h.serve(CONFIG_KEY, { v: 1 });
    const verdict = await h.outcome;
    expect(verdict).toEqual({ ok: true, verified: ["runtimeConfig"] });
    expect("terminalTx" in verdict).toBe(false);
  });

  it("a leg read failure (unreachable) retries, then times out naming the leg", async () => {
    const legs: ConfirmLeg[] = [configLeg({ v: 1 })];
    const clock = fakeClock();
    const verdict = await confirmPublish({
      legs,
      timeoutMs: 100,
      intervalMs: 10,
      read: async () => {
        throw new Error("registry unreachable");
      },
      now: clock.now,
      sleep: async (ms) => {
        clock.tick(ms);
      },
    });
    expect(verdict).toMatchObject({
      ok: false,
      unverified: ["runtimeConfig"],
      lastError: "registry unreachable",
    });
  });
});

describe("isConfigAlreadyPublished", () => {
  const publishConfig: BosConfig = {
    account: "dev.everything.near",
    domain: "dev.everything.dev",
    app: {
      host: { development: "local:host", production: "https://host.example" },
      ui: { development: "local:ui", production: "https://ui.example" },
      api: { development: "local:api", production: "https://api.example" },
    },
  };

  afterEach(() => {
    fetchBosConfigFromFastKvMock.mockReset();
  });

  it("returns true when FastKV already matches the publish payload", async () => {
    fetchBosConfigFromFastKvMock.mockResolvedValueOnce({ ...publishConfig });

    const result = await isConfigAlreadyPublished({
      account: "dev.everything.near",
      gateway: "everything.dev",
      publishConfig,
    });

    expect(result).toBe(true);
    expect(fetchBosConfigFromFastKvMock).toHaveBeenCalledWith(
      "bos://dev.everything.near/everything.dev",
      undefined,
    );
  });

  it("returns false when FastKV differs from the publish payload", async () => {
    fetchBosConfigFromFastKvMock.mockResolvedValueOnce({
      ...publishConfig,
      domain: "stale.example",
    });

    const result = await isConfigAlreadyPublished({
      account: "dev.everything.near",
      gateway: "everything.dev",
      publishConfig,
    });

    expect(result).toBe(false);
  });

  it("returns false when the FastKV fetch fails so publish still proceeds", async () => {
    fetchBosConfigFromFastKvMock.mockRejectedValueOnce(new Error("rpc unavailable"));

    const result = await isConfigAlreadyPublished({
      account: "dev.everything.near",
      gateway: "everything.dev",
      publishConfig,
    });

    expect(result).toBe(false);
  });
});

describe("confirmPublish — the manifest-tag leg (the release thin-tag flip)", () => {
  beforeEach(() => {
    delete process.env.BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS;
    delete process.env.BOS_PUBLISH_CONFIRMATION_INTERVAL_MS;
  });

  afterEach(() => {
    delete process.env.BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS;
    delete process.env.BOS_PUBLISH_CONFIRMATION_INTERVAL_MS;
  });

  const MANIFEST_KEY = {
    kind: "manifest" as const,
    ref: "bos://dev.everything.near/everything.dev",
  };
  const tag = { schemaVersion: 1, version: "2.0.0-rc.36", digest: "aaa" };

  const legs = (): ConfirmLeg[] => [
    { kind: "runtimeConfig", key: CONFIG_KEY, expected: { domain: "everything.dev" } },
    {
      kind: "manifest",
      key: MANIFEST_KEY,
      expected: tag,
      read: async () => null,
    },
  ];

  it("verifies the manifest leg through its injected pointer read", async () => {
    const clock = fakeClock();
    const verdict = await confirmPublish({
      legs: [
        { kind: "runtimeConfig", key: CONFIG_KEY, expected: { domain: "everything.dev" } },
        {
          kind: "manifest",
          key: MANIFEST_KEY,
          expected: tag,
          read: async () => tag,
        },
      ],
      timeoutMs: 10_000,
      intervalMs: 10,
      read: async (key) => {
        if (key.kind === "runtimeConfig") return { domain: "everything.dev" };
        throw new Error(`no served value for ${key.kind}`);
      },
      now: clock.now,
      sleep: async (ms) => {
        clock.tick(ms);
      },
    });
    expect(verdict).toEqual({ ok: true, verified: ["runtimeConfig", "manifest"] });
  });

  it("a lagging tag flip retries until the index serves it — then verifies", async () => {
    const clock = fakeClock();
    let tagReads = 0;
    const verdict = await confirmPublish({
      legs: [
        { kind: "runtimeConfig", key: CONFIG_KEY, expected: { domain: "everything.dev" } },
        {
          kind: "manifest",
          key: MANIFEST_KEY,
          expected: tag,
          // the index lags the write: two absent probes, then the flip
          read: async () => {
            tagReads += 1;
            return tagReads < 3 ? null : tag;
          },
        },
      ],
      timeoutMs: 10_000,
      intervalMs: 10,
      read: async (key) => {
        if (key.kind === "runtimeConfig") return { domain: "everything.dev" };
        throw new Error(`no served value for ${key.kind}`);
      },
      now: clock.now,
      sleep: async (ms) => {
        clock.tick(ms);
      },
    });
    expect(verdict).toEqual({ ok: true, verified: ["runtimeConfig", "manifest"] });
    expect(tagReads).toBe(3);
  });

  it("a manifest-leg timeout names the key-model path", async () => {
    const clock = fakeClock();
    const verdict = await confirmPublish({
      legs: [
        { kind: "runtimeConfig", key: CONFIG_KEY, expected: { domain: "everything.dev" } },
        {
          kind: "manifest",
          key: MANIFEST_KEY,
          expected: tag,
          read: async () => null,
        },
      ],
      timeoutMs: 100,
      intervalMs: 10,
      read: async (key) => {
        if (key.kind === "runtimeConfig") return { domain: "everything.dev" };
        throw new Error(`no served value for ${key.kind}`);
      },
      now: clock.now,
      sleep: async (ms) => {
        clock.tick(ms);
      },
    });
    expect(verdict.ok).toBe(false);
    const message = describeConfirmTimeout(legs(), verdict);
    expect(message).toContain("apps/dev.everything.near/everything.dev/manifest.json");
    expect(message).not.toContain("bos.config.json");
  });
});
