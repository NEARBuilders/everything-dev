import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevOptions, PhaseTiming } from "../../src/contract";
import {
  type BootstrapDeps,
  DevConfigMissing,
  DevStepError,
  devBootstrap,
  resolveProxyUrl,
} from "../../src/dev-program";
import { ProjectEnv } from "../../src/env/project-env";
import { ResolutionSession } from "../../src/resolution/session";
import type { BosConfig, RuntimeConfig } from "../../src/types";

const mocks = vi.hoisted(() => ({
  openResolution: vi.fn(),
  syncResolvedSharedDeps: vi.fn(),
}));

vi.mock("../../src/shared-deps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/shared-deps")>();
  return {
    ...actual,
    syncResolvedSharedDeps: mocks.syncResolvedSharedDeps,
  };
});

vi.mock("../../src/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/workspace")>();
  return {
    ...actual,
    ensureFreshDeps: vi.fn(async () => ({ rebuilt: [], fresh: [] })),
  };
});

vi.mock("../../src/resolution/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/resolution/session")>();
  return {
    ...actual,
    openResolution: mocks.openResolution,
  };
});

const projectEnvStub = Layer.succeed(ProjectEnv, {
  ensureFile: () => Effect.succeed(false),
  load: () => Effect.void,
  sync: () => Effect.succeed([]),
});

const fixtureConfig: BosConfig = {
  account: "fixture.near",
  app: {
    host: { development: "local:host", production: "" },
    ui: { development: "local:ui" },
    api: { development: "local:api" },
  },
};

const fixtureRuntime = {
  env: "development",
  account: "fixture.near",
  networkId: "mainnet",
  host: { name: "host", url: "", entry: "", source: "local" },
  ui: { name: "ui", url: "", entry: "", source: "local" },
  api: { name: "api", url: "", entry: "", source: "local" },
} as unknown as RuntimeConfig;

const makeSession = (root: string, account = "fixture.near"): ResolutionSession =>
  ResolutionSession.fromParts({
    config: { ...fixtureConfig, account },
    runtime: fixtureRuntime,
    root,
  });

const runBootstrap = (deps: BootstrapDeps) => {
  const timings: PhaseTiming[] = [];
  const outcome = Effect.runPromise(
    devBootstrap(deps, { remotePlugins: [] } as DevOptions, timings, { resolveProxyUrl }).pipe(
      Effect.provide(projectEnvStub),
    ),
  ).then(
    () => "resolved" as const,
    (error: unknown) => error,
  );
  return { timings, outcome };
};

describe("devBootstrap config guard", () => {
  beforeEach(() => {
    mocks.syncResolvedSharedDeps.mockResolvedValue({ catalogChanged: false });
  });

  it("fails with the tagged DevConfigMissing error before any install/build phase when the session is null", async () => {
    const deps: BootstrapDeps = { session: null };
    const { timings, outcome } = runBootstrap(deps);

    const exit = await outcome;

    expect(exit).toBeInstanceOf(DevConfigMissing);
    expect((exit as DevConfigMissing)._tag).toBe("DevConfigMissing");
    expect(timings).toEqual([]);
  });
});

describe("devBootstrap adopt-if-found re-load", () => {
  beforeEach(() => {
    mocks.syncResolvedSharedDeps.mockResolvedValue({ catalogChanged: false });
  });

  it("keeps the previous session when the fresh openResolution finds nothing", async () => {
    const previous = makeSession("/fixture-root/previous");
    vi.spyOn(previous, "buildRuntime").mockRejectedValue(new Error("previous-session-build"));
    mocks.openResolution.mockResolvedValue(null);

    const deps: BootstrapDeps = { session: previous };
    const { outcome } = runBootstrap(deps);

    const exit = await outcome;

    expect(exit).toBeInstanceOf(DevStepError);
    expect((exit as DevStepError).phase).toBe("build runtime config");
    expect((exit as DevStepError).cause).toBeInstanceOf(Error);
    expect(((exit as DevStepError).cause as Error).message).toBe("previous-session-build");
    expect(deps.session).toBe(previous);
  });

  it("adopts the fresh session for the bootstrap continuation without mutating deps", async () => {
    const previous = makeSession("/fixture-root/previous");
    const adopted = makeSession("/fixture-root/adopted", "adopted.near");
    vi.spyOn(adopted, "buildRuntime").mockRejectedValue(new Error("adopted-session-build"));
    mocks.openResolution.mockResolvedValue(adopted);

    const deps: BootstrapDeps = { session: previous };
    const { outcome } = runBootstrap(deps);

    const exit = await outcome;

    expect(exit).toBeInstanceOf(DevStepError);
    expect((exit as DevStepError).phase).toBe("build runtime config");
    expect((exit as DevStepError).cause).toBeInstanceOf(Error);
    expect(((exit as DevStepError).cause as Error).message).toBe("adopted-session-build");
    expect(deps.session).toBe(previous);
  });
});
