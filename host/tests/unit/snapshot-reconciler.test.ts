import { Effect } from "effect";
import type { BosConfig } from "everything-dev/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ReconcileTickDeps,
  reconcileHeldGenerations,
  runReconcileTick,
} from "../../src/services/snapshot-reconciler";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../src/utils/logger", () => ({ logger: loggerMock }));

const pointer = {
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    ui: {
      development: "local:ui",
      production: "https://cdn.example.test/ui/",
      digest: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
    },
    api: {
      development: "local:api",
      production: "https://cdn.example.test/api/",
      digest: { manifest: "versions/api-two.json", integrity: "sha384-api-pin" },
    },
  },
} as unknown as BosConfig;

const makeDeps = (overrides?: Partial<ReconcileTickDeps>) => {
  const order: string[] = [];
  const deps = {
    order,
    ledger: vi.fn(async () => ["app.api"]),
    clearLedger: vi.fn(async () => {
      order.push("clear");
    }),
    fetchPointer: vi.fn(async () => pointer),
    verifyGeneration: vi.fn(async () => {
      order.push("verify");
      return { resolved: pointer, digest: "digest-next" };
    }),
    persistApprovedSnapshot: vi.fn(async () => {
      order.push("persist");
    }),
    replaceInstance: vi.fn(async () => {
      order.push("replace");
    }),
    ...overrides,
  } as ReconcileTickDeps & {
    order: string[];
    ledger: ReturnType<typeof vi.fn>;
    clearLedger: ReturnType<typeof vi.fn>;
    fetchPointer: ReturnType<typeof vi.fn>;
    verifyGeneration: ReturnType<typeof vi.fn>;
    persistApprovedSnapshot: ReturnType<typeof vi.fn>;
    replaceInstance: ReturnType<typeof vi.fn>;
  };
  return deps;
};

const runTick = (deps: ReconcileTickDeps) => Effect.runPromise(runReconcileTick(deps));

describe("runReconcileTick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("an empty ledger idles — the published pointer is never fetched", async () => {
    const deps = makeDeps({ ledger: vi.fn(async () => []) });
    const outcome = await runTick(deps);
    expect(outcome).toEqual({ status: "idle" });
    expect(deps.fetchPointer).not.toHaveBeenCalled();
    expect(deps.replaceInstance).not.toHaveBeenCalled();
  });

  it("a held generation commits: verify → persist → replace → the ledger clears", async () => {
    const deps = makeDeps();
    const outcome = await runTick(deps);
    expect(outcome).toEqual({ status: "committed", held: ["app.api"], digest: "digest-next" });
    expect(deps.order).toEqual(["verify", "persist", "replace", "clear"]);
    expect(deps.persistApprovedSnapshot).toHaveBeenCalledWith(pointer);
  });

  it("an unreachable pointer defers — nothing replaces, the ledger stays armed", async () => {
    const deps = makeDeps({ fetchPointer: vi.fn(async () => null) });
    const outcome = await runTick(deps);
    expect(outcome).toEqual({
      status: "deferred",
      held: ["app.api"],
      reason: "the published pointer is unreachable",
    });
    expect(deps.verifyGeneration).not.toHaveBeenCalled();
    expect(deps.replaceInstance).not.toHaveBeenCalled();
    expect(deps.clearLedger).not.toHaveBeenCalled();
  });

  it("a failed verification defers — the coherent serving generation stays", async () => {
    const deps = makeDeps({
      verifyGeneration: vi.fn(async () => {
        throw new Error("the candidate composition failed chain verification");
      }),
    });
    const outcome = await runTick(deps);
    expect(outcome).toEqual({
      status: "deferred",
      held: ["app.api"],
      reason: "the published generation failed verification",
    });
    expect(deps.persistApprovedSnapshot).not.toHaveBeenCalled();
    expect(deps.replaceInstance).not.toHaveBeenCalled();
    expect(deps.clearLedger).not.toHaveBeenCalled();
  });

  it("a failed persist is non-fatal — the replacement still commits", async () => {
    const deps = makeDeps({
      persistApprovedSnapshot: vi.fn(async () => {
        throw new Error("EACCES: snapshot dir unwritable");
      }),
    });
    const outcome = await runTick(deps);
    expect(outcome).toEqual({ status: "committed", held: ["app.api"], digest: "digest-next" });
    expect(deps.replaceInstance).toHaveBeenCalledTimes(1);
    expect(deps.clearLedger).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it("a failed replacement defers — the ledger stays armed for the next tick", async () => {
    const deps = makeDeps({
      replaceInstance: vi.fn(async () => {
        throw new Error("SIGTERM refused");
      }),
    });
    const outcome = await runTick(deps);
    expect(outcome).toEqual({
      status: "deferred",
      held: ["app.api"],
      reason: "the replacement could not be committed",
    });
    expect(deps.clearLedger).not.toHaveBeenCalled();
  });

  it("a ledger read failure never fails the tick", async () => {
    const deps = makeDeps({
      ledger: vi.fn(async () => {
        throw new Error("ledger unavailable");
      }),
    });
    const outcome = await runTick(deps);
    expect(outcome).toEqual({ status: "idle" });
    expect(deps.fetchPointer).not.toHaveBeenCalled();
  });

  it("BOS_RECONCILE_HELD_GENERATIONS gates the service on", () => {
    expect(reconcileHeldGenerations()).toBe(false);
    vi.stubEnv("BOS_RECONCILE_HELD_GENERATIONS", "1");
    expect(reconcileHeldGenerations()).toBe(true);
    vi.stubEnv("BOS_RECONCILE_HELD_GENERATIONS", "0");
    expect(reconcileHeldGenerations()).toBe(false);
    vi.unstubAllEnvs();
  });
});
