import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { DeploySummary } from "@/lib/deploy-history";
import {
  buildReconciler,
  decideReconcile,
  type ReconcilerDeps,
  type ReconcilerStatusSnapshot,
  type ReconcilerWatchEntry,
} from "@/lib/reconciler";
import { runtimeDatabaseNames, runtimeDbUrl } from "@/lib/runtime-databases";

const NS = { account: "app1.near", gateway: "app1.dev" };
const ENTRY: ReconcilerWatchEntry = { ...NS };

const deployRow = (overrides: Partial<DeploySummary> = {}): DeploySummary => ({
  key: "apps/app1.near/app1.dev/manifests/2026-10-22T00-00-00.json",
  publishedAt: "2026-10-22T00:00:00.000Z",
  fingerprint: "fp-1",
  imageRef: "ghcr.io/nearbuilders/everything-dev@v1",
  blockHeight: 100,
  ...overrides,
});

interface Harness {
  deps: ReconcilerDeps;
  reconciler: {
    tick: () => Effect.Effect<ReconcilerStatusSnapshot>;
    status: () => Effect.Effect<ReconcilerStatusSnapshot>;
  };
  setDeploys: (rows: DeploySummary[]) => void;
  setSecrets: (values: Record<string, string>) => void;
  setCurrent: (snapshot: { running: boolean; image?: string }) => void;
  failDeploy: (reason: string) => void;
  descriptorOf: (
    call: number,
  ) => { instance: string; image: string; identityEnv: Record<string, string> } | undefined;
  failHistory: (message: string) => void;
}

const runTick = (h: Harness): Promise<ReconcilerStatusSnapshot> =>
  Effect.runPromise(h.reconciler.tick());

const statusOf = (h: Harness): Promise<ReconcilerStatusSnapshot> =>
  Effect.runPromise(h.reconciler.status());

function makeHarness(
  options: Partial<ReconcilerWatchEntry> & { pollIntervalMs?: number } = {},
): Harness {
  let deploys: DeploySummary[] = [];
  let secrets: Record<string, string> = {};
  let current: { running: boolean; image?: string } = { running: true };
  let deployError: string | undefined;
  let historyError: string | undefined;
  let deployCalls = 0;

  const descriptors: Array<{
    instance: string;
    image: string;
    identityEnv: Record<string, string>;
  }> = [];

  const deps: ReconcilerDeps = {
    history: {
      listDeploys: vi.fn((input: { account: string; gateway: string; limit: number }) => {
        if (historyError)
          return Effect.fail({ _tag: "DeployHistoryReadError", message: historyError });
        expect(input.account).toBe(NS.account);
        expect(input.gateway).toBe(NS.gateway);
        return Effect.succeed(deploys.slice(0, input.limit));
      }),
    },
    secrets: {
      resolve: vi.fn((input: { account: string; gateway: string }) => {
        expect(input.account).toBe(NS.account);
        expect(input.gateway).toBe(NS.gateway);
        return Effect.succeed(secrets);
      }),
    },
    adapter: {
      deploy: vi.fn((descriptor) => {
        if (deployError) {
          return Effect.fail({
            _tag: "DeployFailed",
            instance: descriptor.instance,
            reason: deployError,
          });
        }
        deployCalls += 1;
        descriptors.push({
          instance: descriptor.instance,
          image: descriptor.image,
          identityEnv: { ...descriptor.identityEnv },
        });
        return Effect.succeed({
          instance: descriptor.instance,
          url: `http://127.0.0.1:${4000 + deployCalls}`,
        });
      }),
      current: vi.fn((instance: string) =>
        Effect.succeed({
          instance,
          running: current.running,
          url: current.running ? "http://127.0.0.1:3000" : undefined,
          image: current.image,
        }),
      ),
      restart: vi.fn(() => Effect.fail({ _tag: "InstanceNotFound", instance: "unused" })),
      stop: vi.fn(() => Effect.fail({ _tag: "InstanceNotFound", instance: "unused" })),
    },
    provisionDatabases: vi.fn((input: { account: string; gateway: string }) => {
      expect(input.account).toBe(NS.account);
      expect(input.gateway).toBe(NS.gateway);
      return Effect.succeed({
        API_DATABASE_URL: "postgres://platform@db:5432/runtime_x_api",
        AUTH_DATABASE_URL: "postgres://platform@db:5432/runtime_x_auth",
      });
    }),
  } as unknown as ReconcilerDeps;

  const reconciler = buildReconciler(deps, {
    watch: [{ ...ENTRY, ...options }],
    pollIntervalMs: options.pollIntervalMs ?? 15000,
  });

  return {
    deps,
    reconciler,
    setDeploys: (rows) => {
      deploys = rows;
      historyError = undefined;
    },
    setSecrets: (values) => {
      secrets = values;
    },
    setCurrent: (snapshot) => {
      current = snapshot;
    },
    failDeploy: (reason) => {
      deployError = reason;
    },
    failHistory: (message) => {
      historyError = message;
    },
    descriptorOf: (call) => descriptors[call - 1],
  };
}

describe("decideReconcile (pure)", () => {
  it("no-ops when the namespace has never published", () => {
    expect(decideReconcile({ running: true, converged: undefined }, undefined)).toEqual({
      action: "noop",
    });
  });

  it("assumes the baseline when the instance is running at first observation", () => {
    expect(decideReconcile({ running: true, converged: undefined }, "fp-1")).toEqual({
      action: "baseline",
      fingerprint: "fp-1",
    });
  });

  it("converges at boot when the instance is not running", () => {
    expect(decideReconcile({ running: false, converged: undefined }, "fp-1")).toEqual({
      action: "converge",
      fingerprint: "fp-1",
    });
  });

  it("no-ops on an unchanged fingerprint", () => {
    expect(decideReconcile({ running: true, converged: "fp-1" }, "fp-1")).toEqual({
      action: "noop",
    });
  });

  it("converges on a changed fingerprint", () => {
    expect(decideReconcile({ running: true, converged: "fp-1" }, "fp-2")).toEqual({
      action: "converge",
      fingerprint: "fp-2",
    });
  });
});

describe("runtime database naming (pure)", () => {
  it("derives deterministic per-runtime database names", () => {
    const names = runtimeDatabaseNames("App1.near", "app1.dev");
    expect(names.apiDatabase).toMatch(/^runtime_[a-z0-9_]+_api$/);
    expect(names.authDatabase).toMatch(/^runtime_[a-z0-9_]+_auth$/);
    expect(names.apiDatabase.slice(0, -4)).toBe(names.authDatabase.slice(0, -5));
  });

  it("sanitizes hostile identities and stays within the 63-byte identifier limit", () => {
    const names = runtimeDatabaseNames(
      "Very.Long.Account.Id.With-Suffix.near",
      "gateway-name.with.dots",
    );
    for (const name of [names.apiDatabase, names.authDatabase]) {
      expect(name.length).toBeLessThanOrEqual(63);
      expect(name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("derives the child URL from the platform URL, keeping credentials and host", () => {
    const url = runtimeDbUrl(
      "postgres://user:secret@db.example.com:5432/api_db?sslmode=require",
      "runtime_x_api",
    );
    expect(url).toBe("postgres://user:secret@db.example.com:5432/runtime_x_api?sslmode=require");
  });
});

describe("reconciler tick", () => {
  it("records the baseline without deploying when the instance is running at boot", async () => {
    const h = makeHarness();
    h.setDeploys([deployRow()]);
    const status = await runTick(h);
    expect(status.namespaces[0]).toMatchObject({
      account: NS.account,
      gateway: NS.gateway,
      convergedFingerprint: "fp-1",
      bootAssumed: true,
      drift: undefined,
    });
    expect(h.descriptorOf(1)).toBeUndefined();
  });

  it("converges at boot when the instance is not running", async () => {
    const h = makeHarness();
    h.setDeploys([deployRow()]);
    h.setCurrent({ running: false });
    const status = await runTick(h);
    expect(status.namespaces[0]).toMatchObject({
      convergedFingerprint: "fp-1",
      bootAssumed: false,
      instanceUrl: "http://127.0.0.1:4001",
    });
    const descriptor = h.descriptorOf(1);
    expect(descriptor).toMatchObject({
      instance: "hosted-app1.near-app1.dev",
      image: "ghcr.io/nearbuilders/everything-dev@v1",
      identityEnv: { BOS_ACCOUNT: "app1.near", BOS_GATEWAY: "app1.dev" },
    });
  });

  it("no-ops on an unchanged fingerprint", async () => {
    const h = makeHarness();
    h.setDeploys([deployRow()]);
    h.setCurrent({ running: false });
    await runTick(h);
    const second = await runTick(h);
    expect(second.namespaces[0]).toMatchObject({ convergedFingerprint: "fp-1" });
    expect(h.descriptorOf(1)).toBeDefined();
    expect(h.descriptorOf(2)).toBeUndefined();
  });

  it("converges on a new publish and reports the new pin", async () => {
    const h = makeHarness();
    h.setDeploys([deployRow()]);
    h.setCurrent({ running: false });
    await runTick(h);
    h.setDeploys([
      deployRow({
        key: "apps/app1.near/app1.dev/manifests/2026-10-22T01-00-00.json",
        publishedAt: "2026-10-22T01:00:00.000Z",
        fingerprint: "fp-2",
        imageRef: "ghcr.io/nearbuilders/everything-dev@v2",
        blockHeight: 110,
      }),
    ]);
    const status = await runTick(h);
    expect(status.namespaces[0]).toMatchObject({ convergedFingerprint: "fp-2" });
    expect(h.descriptorOf(2)?.image).toBe("ghcr.io/nearbuilders/everything-dev@v2");
  });

  it("surfaces a convergence failure as drift and clears it on the next success", async () => {
    const h = makeHarness();
    h.setDeploys([deployRow()]);
    h.setCurrent({ running: false });
    await runTick(h);
    h.setDeploys([deployRow({ fingerprint: "fp-2" })]);
    h.failDeploy("daemon unreachable");
    const failed = await runTick(h);
    expect(failed.namespaces[0]?.drift?.reason).toContain("daemon unreachable");
    expect(failed.namespaces[0]?.convergedFingerprint).toBe("fp-1");
    h.failDeploy("");
    const recovered = await runTick(h);
    expect(recovered.namespaces[0]).toMatchObject({
      convergedFingerprint: "fp-2",
      drift: undefined,
    });
  });

  it("delivers stored secrets under the platform-composed identity keys", async () => {
    const h = makeHarness();
    h.setSecrets({ AI_API_KEY: "sk-vault", BOS_GATEWAY: "spoof.dev" });
    h.setDeploys([deployRow()]);
    h.setCurrent({ running: false });
    await runTick(h);
    const env = h.descriptorOf(1)?.identityEnv ?? {};
    expect(env.AI_API_KEY).toBe("sk-vault");
    expect(env.BOS_GATEWAY).toBe("app1.dev");
    expect(env.BOS_ACCOUNT).toBe("app1.near");
  });

  it("rides provisioned database urls into identityEnv", async () => {
    const h = makeHarness();
    h.setDeploys([deployRow()]);
    h.setCurrent({ running: false });
    await runTick(h);
    const env = h.descriptorOf(1)?.identityEnv ?? {};
    expect(env.API_DATABASE_URL).toBe("postgres://platform@db:5432/runtime_x_api");
    expect(env.AUTH_DATABASE_URL).toBe("postgres://platform@db:5432/runtime_x_auth");
  });

  it("fails loudly as drift when no image pin is resolvable", async () => {
    const h = makeHarness();
    h.setDeploys([deployRow({ imageRef: undefined })]);
    h.setCurrent({ running: false });
    const status = await runTick(h);
    expect(status.namespaces[0]?.drift?.reason).toContain("image pin");
    expect(h.descriptorOf(1)).toBeUndefined();
  });

  it("prefers the watch entry's explicit image over the platform pin", async () => {
    const h = makeHarness({ image: "nginx:alpine" });
    h.setDeploys([deployRow()]);
    h.setCurrent({ running: false });
    await runTick(h);
    expect(h.descriptorOf(1)?.image).toBe("nginx:alpine");
  });

  it("records drift on a history read failure and recovers on the next tick", async () => {
    const h = makeHarness();
    h.failHistory("HTTP 503 fetching kv");
    const failed = await runTick(h);
    expect(failed.namespaces[0]?.drift?.reason).toContain("HTTP 503");
    h.setDeploys([deployRow()]);
    const recovered = await runTick(h);
    expect(recovered.namespaces[0]?.drift).toBeUndefined();
  });

  it("no-ops a namespace that has never published", async () => {
    const h = makeHarness();
    h.setDeploys([]);
    const status = await runTick(h);
    expect(status.namespaces[0]).toMatchObject({
      convergedFingerprint: undefined,
      drift: undefined,
    });
    expect(h.descriptorOf(1)).toBeUndefined();
  });

  it("clamps the poll interval to a bounded floor", async () => {
    const h = makeHarness({ pollIntervalMs: 5 });
    const status = await statusOf(h);
    expect(status.enabled).toBe(true);
    expect(status.pollIntervalMs).toBeGreaterThanOrEqual(1000);
  });
});
