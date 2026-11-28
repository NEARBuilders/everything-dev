import { Effect } from "effect";
import type { AdoptState } from "everything-dev/dev-adopt";
import type { RuntimeConfig } from "everything-dev/types";
import { describe, expect, it, vi } from "vitest";
import { PluginRpcServing } from "../../src/routes/api";
import {
  type DevAdoptSample,
  type DevAdoptTickDeps,
  localPluginSlots,
  runDevAdoptTick,
} from "../../src/services/dev-plugin-adopt";

const fingerprint = (digest: string) => ({
  digest,
  newestMtimeMs: 100,
  files: new Map(),
});

const sample = (key: string, container: string | null, label = key): DevAdoptSample => ({
  key,
  label,
  fingerprint: container === null ? null : fingerprint(container),
});

const makeDeps = () => {
  const order: string[] = [];
  const deps = {
    order,
    samples: vi.fn(async () => [sample("plugin:votes", "gen-a", "plugins/votes")]),
    reload: vi.fn(async (key: string) => {
      order.push(`reload:${key}`);
    }),
    logMove: vi.fn((line: string) => order.push(`move:${line}`)),
    logFailure: vi.fn((line: string) => order.push(`fail:${line}`)),
    now: vi.fn(() => 0),
  } as DevAdoptTickDeps & {
    order: string[];
    reload: ReturnType<typeof vi.fn>;
    logMove: ReturnType<typeof vi.fn>;
    logFailure: ReturnType<typeof vi.fn>;
    now: () => number;
  };
  return deps;
};

const runTick = (deps: DevAdoptTickDeps, state: AdoptState) =>
  Effect.runPromise(runDevAdoptTick(deps, state) as Effect.Effect<AdoptState>);

describe("runDevAdoptTick", () => {
  it("a stable rebuild settles into one reload and one move log", async () => {
    const deps = makeDeps();
    deps.now = () => 0;
    let state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-a", "plugins/votes")] },
      { served: new Map(), pending: new Map() },
    );
    expect(deps.reload).not.toHaveBeenCalled();

    deps.now = () => 100;
    state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-b", "plugins/votes")] },
      state,
    );
    expect(deps.reload).not.toHaveBeenCalled();

    deps.now = () => 2_000;
    state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-b", "plugins/votes")] },
      state,
    );
    expect(deps.order).toEqual([
      "reload:plugin:votes",
      "move:[DevPluginAdopt] plugins/votes moved to generation 1",
    ]);
    expect(state.served.get("plugin:votes")?.generation).toBe(1);
  });

  it("a reload failure keeps the serving generation and logs the failure", async () => {
    const deps = makeDeps();
    deps.reload.mockRejectedValue(new Error("the rebuilt container never loaded"));
    deps.now = () => 0;
    let state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-a", "plugins/votes")] },
      { served: new Map(), pending: new Map() },
    );
    deps.now = () => 100;
    state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-b", "plugins/votes")] },
      state,
    );
    deps.now = () => 2_000;
    state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-b", "plugins/votes")] },
      state,
    );
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.logFailure).toHaveBeenCalledWith(
      expect.stringContaining("plugins/votes reload failed — keeping the serving generation"),
    );

    // The served entry rolled back: the settle window re-arms before the
    // move re-owes.
    deps.reload.mockResolvedValue(undefined);
    deps.now = () => 4_000;
    state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-b", "plugins/votes")] },
      state,
    );
    expect(deps.reload).toHaveBeenCalledTimes(1);
    deps.now = () => 6_000;
    state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-b", "plugins/votes")] },
      state,
    );
    expect(deps.reload).toHaveBeenCalledTimes(2);
    expect(state.served.get("plugin:votes")?.generation).toBe(1);
  });

  it("a sampling failure never reloads and never advances the state", async () => {
    const deps = makeDeps();
    (deps.samples as unknown as ReturnType<typeof vi.fn>) = vi.fn(async () => {
      throw new Error("dist walk failed");
    });
    const state = await runTick(deps, { served: new Map(), pending: new Map() });
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.logFailure).toHaveBeenCalledWith(expect.stringContaining("dist sampling failed"));
    expect(state.served.size).toBe(0);
  });

  it("an unchanged generation is idempotent — no reload, no log", async () => {
    const deps = makeDeps();
    let state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-a", "plugins/votes")] },
      { served: new Map(), pending: new Map() },
    );
    state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-a", "plugins/votes")] },
      state,
    );
    state = await runTick(
      { ...deps, samples: async () => [sample("plugin:votes", "gen-a", "plugins/votes")] },
      state,
    );
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.logMove).not.toHaveBeenCalled();
  });
});

describe("localPluginSlots", () => {
  const plugin = (overrides: Record<string, unknown> = {}) => ({
    source: "local",
    localPath: "/repo/plugins/votes",
    ...overrides,
  });

  it("adopts only local, in-process loaded plugin children", () => {
    const config = {
      plugins: {
        votes: plugin(),
        registry: plugin({ source: "remote", localPath: undefined }),
        "call-only": plugin({ proxy: "https://prod.example.test" }),
      },
    } as unknown as RuntimeConfig;
    const loaded = {
      votes: { key: "votes" },
      "call-only": { key: "call-only", proxy: { target: "https://prod.example.test" } },
    } as unknown as Record<string, { key: string }>;
    expect(localPluginSlots(config, loaded as never)).toEqual(["votes"]);
  });
});

describe("PluginRpcServing (the dev adopt's swap seam)", () => {
  it("a swapped cell serves the new generation without re-mounting", () => {
    const serving = new PluginRpcServing((router) => ({ router }) as never);
    const cell = { handler: { router: "router-gen-1" }, effectContext: "ctx-1" };
    serving.cells.set("votes", cell as never);

    expect(serving.swap("votes", "router-gen-2", "ctx-2")).toBe(true);
    expect(cell.handler).toEqual({ router: "router-gen-2" });
    expect(cell.effectContext).toBe("ctx-2");

    expect(serving.swap("unknown-plugin", "router-x", "ctx-x")).toBe(false);
  });
});
