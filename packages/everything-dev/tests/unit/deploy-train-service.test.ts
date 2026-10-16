import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { PublishTrainError } from "../../src/services/deploy/errors";
import { DeployTrainService } from "../../src/services/deploy/train";
import type { BosConfig } from "../../src/types";

const configWithoutDomain = { account: "v1.acct.near" } as BosConfig;
const configReady = { account: "v1.acct.near", domain: "app.test" } as BosConfig;

const baseInput = {
  runtimeConfig: null,
  configDir: "/tmp/does-not-exist",
  env: "production" as const,
  build: false,
  dryRun: false,
  verbose: false,
  packages: "all",
};

describe("DeployTrainService", () => {
  it("fails the typed channel — a preflight guard surfaces as PublishTrainError with its leg kind", async () => {
    const program = Effect.gen(function* () {
      const train = yield* DeployTrainService;
      return yield* train.publish({ ...baseInput, bosConfig: configWithoutDomain });
    });
    const failure = await Effect.runPromise(Effect.provide(program, DeployTrainService.Live)).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(PublishTrainError);
    expect(failure).toMatchObject({
      kind: "preflight",
      error: "authored config must define domain to publish",
    });
  });

  it("handlers map the typed error to the wire shape mechanically via catchTag", async () => {
    const program = Effect.gen(function* () {
      const train = yield* DeployTrainService;
      return yield* train
        .publish({ ...baseInput, bosConfig: configWithoutDomain })
        .pipe(Effect.catchTag("PublishTrainError", (e) => Effect.succeed(e.toResult())));
    });
    const result = await Effect.runPromise(Effect.provide(program, DeployTrainService.Live));

    expect(result).toMatchObject({
      status: "error",
      registryUrl: "",
      error: "authored config must define domain to publish",
    });
  });

  it("the dry-run short-circuit returns through the success channel", async () => {
    const program = Effect.gen(function* () {
      const train = yield* DeployTrainService;
      return yield* train.publish({
        ...baseInput,
        bosConfig: configReady,
        dryRun: true,
      });
    });
    const result = await Effect.runPromise(Effect.provide(program, DeployTrainService.Live));

    expect(result.status).toBe("dry-run");
    expect(result.registryUrl).toContain("v1.acct.near");
  });
});
