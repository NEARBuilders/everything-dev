import process from "node:process";
import * as p from "@clack/prompts";
import { Context, Effect, Layer } from "effect";
import { buildScoped, buildScopedContext } from "every-plugin";
import { registerBuild } from "./commands/build";
import { registerConfig } from "./commands/config";
import { registerDb } from "./commands/db";
import { registerDeploy } from "./commands/deploy";
import { registerDev } from "./commands/dev";
import { registerInit } from "./commands/init";
import { registerKeys } from "./commands/keys";
import { registerOps } from "./commands/ops";
import { registerPlugins } from "./commands/plugins";
import { type BosDeps, BosDepsTag } from "./commands/shared";
import { registerUpgrade } from "./commands/upgrade";
import { bosContract } from "./contract";
import { DatabaseBindings, DrizzleKit, makeDatabaseBindings, makeDrizzleKitLive } from "./db";
import { ProjectEnv, ProjectEnvLive } from "./env/project-env";
import { openResolution } from "./resolution/session";
import { createPlugin, z } from "./sdk";

export { resolveRemoteConfigChain } from "./commands/config";
export type { DevSessionData, StartSummary } from "./dev-program";
export { type ProgressEvent, pluginEvents } from "./progress";

export default createPlugin({
  variables: z.object({
    configPath: z.string().optional(),
    // The artifact root (cwd-derived) — decoupled from configPath so an
    // explicit boot config (--config-path fixture) validates and loads
    // without redirecting where the CLI writes generated artifacts.
    configDir: z.string().optional(),
  }),
  secrets: z.object({}),
  contract: bosContract,
  initialize: (config, _plugins) =>
    Effect.gen(function* () {
      const session = yield* Effect.promise(() =>
        openResolution({ path: config.variables.configPath }),
      );

      const projectEnv = yield* buildScoped(ProjectEnv, ProjectEnvLive);

      const configDir = config.variables.configDir ?? session?.root ?? process.cwd();

      const services = yield* buildScopedContext(
        Layer.mergeAll(
          makeDatabaseBindings({
            projectDir: configDir,
            loadRuntimeConfig: async () => (await session?.buildRuntime()) ?? null,
            loadEnv: () =>
              projectEnv.load(configDir).pipe(
                Effect.catchTag("EnvLoadError", (error) =>
                  Effect.fail(
                    new Error(
                      `failed to load .env: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`,
                    ),
                  ),
                ),
                Effect.runPromise,
              ),
          }),
          makeDrizzleKitLive({
            projectDir: configDir,
            onLog: (message) => p.log.info(message),
          }),
        ),
      );

      return Layer.succeed(BosDepsTag, {
        session,
        databaseBindings: Context.get(services, DatabaseBindings),
        drizzleKit: Context.get(services, DrizzleKit),
      } satisfies BosDeps);
    }),
  createRouter: (builder) => ({
    ...registerConfig(builder),
    ...registerPlugins(builder),
    ...registerDev(builder),
    ...registerBuild(builder),
    ...registerDeploy(builder),
    ...registerKeys(builder),
    ...registerInit(builder),
    ...registerUpgrade(builder),
    ...registerDb(builder),
    ...registerOps(builder),
  }),
});
