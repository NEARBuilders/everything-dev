import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { registerDev } from "../../src/handlers/dev";
import type { BosBuilder } from "../../src/handlers/shared";
import { DevFlowService } from "../../src/services/dev/flow";
import type { DevSessionData, StartSummary } from "../../src/services/dev/session";
import { ResolutionSession, ResolutionSessionService } from "../../src/services/resolution/session";
import type { BosConfig, RuntimeConfig } from "../../src/types";

const mocks = vi.hoisted(() => ({
  devBootstrap: vi.fn(),
  startBootstrap: vi.fn(),
}));

vi.mock("../../src/services/dev/boot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/dev/boot")>();
  return {
    ...actual,
    devBootstrap: mocks.devBootstrap,
  };
});

vi.mock("../../src/services/start/boot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/start/boot")>();
  return {
    ...actual,
    startBootstrap: mocks.startBootstrap,
  };
});

const session = ResolutionSession.fromParts({
  config: { account: "fixture.near" } as BosConfig,
  runtime: {} as RuntimeConfig,
  root: "/fixture-root",
});

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
        effect: (fn: (opts: unknown, input: unknown) => Generator) => {
          const callable = (opts: unknown, input: unknown) =>
            // eslint-disable-next-line effecttsgo/any-unknown-in-error-context -- test harness mirrors @orpc middlewareGen interop
            Effect.gen(() => fn(opts, input)).pipe(
              Effect.provideService(ResolutionSessionService, session),
              Effect.provide(DevFlowService.Live),
            );
          records.set(prop as string, callable);
          return { route: prop, handler: callable };
        },
      }),
    },
  ) as BosBuilder;
  registerDev(builder);
  return records;
}

function run(name: string, input: Record<string, unknown>): Promise<any> {
  const handler = getHandlers().get(name) as unknown as (
    opts: unknown,
    input: unknown,
  ) => Effect.Effect<unknown>;
  // eslint-disable-next-line effecttsgo/any-unknown-in-error-context -- test harness mirrors @orpc middlewareGen interop
  return Effect.runPromise(handler({}, input) as Effect.Effect<unknown, unknown, never>);
}

describe("dev/start handlers carry the session on the oRPC result", () => {
  it("dev returns the started session on the result", async () => {
    mocks.devBootstrap.mockReturnValue(
      Effect.succeed({ session: sessionData, description: "ok", processes: ["host"] }),
    );

    const result = await run("dev", {});

    expect(result.status).toBe("started");
    expect(result.session).toBe(sessionData);
  });

  it("dev returns no session on the error path", async () => {
    mocks.devBootstrap.mockReturnValue(Effect.succeed({ failed: "No bos.config.json found" }));

    const result = await run("dev", {});

    expect(result.status).toBe("error");
    expect(result.session).toBeUndefined();
  });

  it("start returns the running session and summary on the result", async () => {
    mocks.startBootstrap.mockReturnValue(
      Effect.succeed({ session: sessionData, summary, url: "http://localhost:3000" }),
    );

    const result = await run("start", {});

    expect(result.status).toBe("running");
    expect(result.session).toBe(sessionData);
    expect(result.summary).toBe(summary);
  });

  it("start returns no session on the error path", async () => {
    mocks.startBootstrap.mockReturnValue(Effect.succeed({ failed: "boom" }));

    const result = await run("start", {});

    expect(result.status).toBe("error");
    expect(result.session).toBeUndefined();
    expect(result.summary).toBeUndefined();
  });
});
