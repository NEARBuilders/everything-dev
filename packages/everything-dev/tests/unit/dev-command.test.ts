import { Context, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { registerDev } from "../../src/commands/dev";
import type { BosBuilder, BosDeps } from "../../src/commands/shared";
import { BosDepsTag } from "../../src/commands/shared";
import type { DevSessionData, StartSummary } from "../../src/dev-program";
import { ResolutionSession } from "../../src/resolution/session";
import type { BosConfig, RuntimeConfig } from "../../src/types";

const mocks = vi.hoisted(() => ({
  devBootstrap: vi.fn(),
  startBootstrap: vi.fn(),
}));

vi.mock("../../src/dev-program", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/dev-program")>();
  return {
    ...actual,
    devBootstrap: mocks.devBootstrap,
    startBootstrap: mocks.startBootstrap,
  };
});

const session = ResolutionSession.fromParts({
  config: { account: "fixture.near" } as BosConfig,
  runtime: {} as RuntimeConfig,
  root: "/fixture-root",
});

const deps: BosDeps = {
  session,
  databaseBindings: undefined as never,
  drizzleKit: undefined as never,
};

const sessionData = {
  orchestrator: { packages: [], env: {}, description: "fixture" },
  services: new Map(),
  runtimeConfig: {},
  envGenerated: {},
  shellEnv: {},
} as unknown as DevSessionData;

const summary: StartSummary = {
  configSource: "bos.config.json",
  account: "fixture.near",
  modules: {},
  warnings: [],
};

function getHandlers(): Map<string, unknown> {
  const records = new Map<string, unknown>();
  const builder = new Proxy(
    {},
    {
      get: (_target, prop) => ({
        handler: (handler: unknown) => {
          records.set(prop as string, handler);
          return { route: prop, handler };
        },
      }),
    },
  ) as BosBuilder;
  registerDev(builder);
  return records;
}

function makeContext() {
  return { "effect/context": Context.make(BosDepsTag, deps) };
}

describe("dev/start handlers carry the session on the oRPC result", () => {
  it("dev returns the started session on the result", async () => {
    mocks.devBootstrap.mockReturnValue(
      Effect.succeed({ session: sessionData, description: "ok", processes: ["host"] }),
    );
    const dev = getHandlers().get("dev") as (args: unknown) => Promise<any>;

    const result = await dev({ input: {}, context: makeContext() });

    expect(result.status).toBe("started");
    expect(result.session).toBe(sessionData);
  });

  it("dev returns no session on the error path", async () => {
    mocks.devBootstrap.mockReturnValue(Effect.succeed({ failed: "No bos.config.json found" }));
    const dev = getHandlers().get("dev") as (args: unknown) => Promise<any>;

    const result = await dev({ input: {}, context: makeContext() });

    expect(result.status).toBe("error");
    expect(result.session).toBeUndefined();
  });

  it("start returns the running session and summary on the result", async () => {
    mocks.startBootstrap.mockReturnValue(
      Effect.succeed({ session: sessionData, summary, url: "http://localhost:3000" }),
    );
    const start = getHandlers().get("start") as (args: unknown) => Promise<any>;

    const result = await start({ input: {}, context: makeContext() });

    expect(result.status).toBe("running");
    expect(result.session).toBe(sessionData);
    expect(result.summary).toBe(summary);
  });

  it("start returns no session on the error path", async () => {
    mocks.startBootstrap.mockReturnValue(Effect.succeed({ failed: "boom" }));
    const start = getHandlers().get("start") as (args: unknown) => Promise<any>;

    const result = await start({ input: {}, context: makeContext() });

    expect(result.status).toBe("error");
    expect(result.session).toBeUndefined();
    expect(result.summary).toBeUndefined();
  });
});
