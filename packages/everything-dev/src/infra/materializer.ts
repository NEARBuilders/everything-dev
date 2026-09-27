import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { getSecretGroups, renderEnvFile, renderEnvTestFile } from "../cli/infra";
import type { RuntimeConfig } from "../types";
import { InfraError, type InfraPhase } from "./types";

export interface InfraMaterializerShape {
  readonly materializeTemplate: (
    configDir: string,
    runtimeConfig: RuntimeConfig,
  ) => Effect.Effect<void, InfraError>;
  readonly materializeTestInfra: (
    configDir: string,
    runtimeConfig: RuntimeConfig,
  ) => Effect.Effect<void, InfraError>;
}

export class InfraMaterializer extends Context.Service<InfraMaterializer, InfraMaterializerShape>()(
  "InfraMaterializer",
) {}

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function writeIfChanged(filePath: string, content: string): void {
  if (existsSync(filePath) && readFileSync(filePath, "utf-8") === content) return;
  ensureDir(filePath);
  writeFileSync(filePath, content);
}

function writeContentEffect(
  filePath: string,
  content: string,
  phase: InfraPhase,
): Effect.Effect<void, InfraError> {
  return Effect.try({
    try: () => writeIfChanged(filePath, content),
    catch: (cause) =>
      new InfraError({
        phase,
        message: `failed to write ${filePath}`,
        cause,
      }),
  });
}

const makeMaterializer = (): InfraMaterializerShape => ({
  materializeTemplate: (configDir, runtimeConfig) =>
    Effect.gen(function* () {
      const groups = getSecretGroups(runtimeConfig);
      const filePath = join(configDir, ".env.example");
      const content = renderEnvFile(groups, { forExample: true });
      yield* writeContentEffect(filePath, content, "materialize-env");
    }),

  materializeTestInfra: (configDir, runtimeConfig) =>
    Effect.gen(function* () {
      const groups = getSecretGroups(runtimeConfig);
      const filePath = join(configDir, ".env.test");
      const content = renderEnvTestFile(groups);
      yield* writeContentEffect(filePath, content, "materialize-env");
    }),
});

export const InfraMaterializerLive: Layer.Layer<InfraMaterializer> = Layer.succeed(
  InfraMaterializer,
  makeMaterializer(),
);

/**
 * Single source of truth for "should we persist port state?".
 * Lives next to the only thing that still persists dev ports (the planner).
 */
export function shouldPersistPortState(): boolean {
  return (
    process.env.BOS_NO_PERSIST_PORTS !== "1" &&
    process.env.BOS_TEST !== "1" &&
    process.env.NODE_ENV !== "test"
  );
}

/**
 * True when the run is ephemeral (regression, CI, local test).
 * In ephemeral mode we must not rewrite `.env.example` because it's a
 * committed reference template — every regression run was previously
 * baking the resolved regression port into it, polluting the file.
 */
export function isEphemeralRun(): boolean {
  return (
    process.env.BOS_NO_PERSIST_PORTS === "1" ||
    process.env.BOS_TEST === "1" ||
    process.env.NODE_ENV === "test"
  );
}

export interface MaterializeOptions {
  /**
   * Override the ephemeral detection. Defaults to the env-var check.
   * Pass `ephemeral: false` to force-template-write, e.g. for opt-in
   * smoke runs that explicitly want a deterministic template.
   */
  readonly ephemeral?: boolean;
}

/**
 * Orchestration helper: materializes the env templates in the canonical
 * order. docker-compose.yml is a static committed file — nothing here
 * generates or rewrites it.
 */
export async function materializeViaLayer(
  configDir: string,
  runtimeConfig: RuntimeConfig,
  options: MaterializeOptions = {},
): Promise<void> {
  const ephemeral = options.ephemeral ?? isEphemeralRun();
  await Effect.runPromise(
    Effect.gen(function* () {
      const m = yield* InfraMaterializer;
      if (!ephemeral) {
        yield* m.materializeTemplate(configDir, runtimeConfig);
      }
      yield* m.materializeTestInfra(configDir, runtimeConfig);
    }).pipe(Effect.provide(InfraMaterializerLive)),
  );
}
