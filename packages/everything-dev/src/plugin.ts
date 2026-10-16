import process from "node:process";
import * as p from "@clack/prompts";
import { Context, Effect, Layer } from "effect";
import { buildScoped, buildScopedContext } from "every-plugin";
import { cliWorkspaceBuildRender } from "./cli/render/workspace-build";
import { bosContract } from "./contract";
import { DatabaseBindings, DrizzleKit, makeDatabaseBindings, makeDrizzleKitLive } from "./db";
import { ProjectEnv, ProjectEnvLive } from "./env/project-env";
import { registerBuild } from "./handlers/build";
import { registerConfig } from "./handlers/config";
import { registerDb } from "./handlers/db";
import { registerDeploy } from "./handlers/deploy";
import { registerDev } from "./handlers/dev";
import { registerImport } from "./handlers/import";
import { registerInit } from "./handlers/init";
import { registerKeys } from "./handlers/keys";
import { registerOps } from "./handlers/ops";
import { registerPlugins } from "./handlers/plugins";
import { registerProcesses } from "./handlers/processes";
import { registerSmoke } from "./handlers/smoke";
import { registerUpgrade } from "./handlers/upgrade";
import { createPlugin, z } from "./sdk";
import { DeviceLoginService } from "./services/auth/device-login";
import { SessionStore } from "./services/auth/session-store";
import { SignerService } from "./services/auth/signer";
import { SiteClient } from "./services/auth/site-client";
import { BundleStorage, RegistryStore } from "./services/deploy/deps";
import { DeployTrainService } from "./services/deploy/train";
import { ProcessesService } from "./services/processes";
import { openResolution, ResolutionSessionService } from "./services/resolution/session";
import { BuildTrainService, WorkspaceBuildRenderService } from "./services/workspace/build-train";

export type { DevSessionData, StartSummary } from "./dev-program";
export { resolveRemoteConfigChain } from "./handlers/config";
export { type ProgressEvent, pluginEvents } from "./progress";

const buildRenderLayer = Layer.succeed(
  WorkspaceBuildRenderService,
  WorkspaceBuildRenderService.of(cliWorkspaceBuildRender),
);

const buildTrainLayer = BuildTrainService.Live.pipe(Layer.provide(buildRenderLayer));

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
      const effectContext = yield* Effect.context();

      const configDir = config.variables.configDir ?? session?.root ?? process.cwd();

      const services = yield* buildScopedContext(
        Layer.mergeAll(
          makeDatabaseBindings({
            projectDir: configDir,
            loadRuntimeConfig: async () => (await session?.buildRuntime()) ?? null,
            loadEnv: () => Effect.runPromiseWith(effectContext)(projectEnv.load(configDir)),
          }),
          makeDrizzleKitLive({
            projectDir: configDir,
            onLog: (message) => p.log.info(message),
          }),
        ),
      );

      return Layer.mergeAll(
        Layer.succeed(ResolutionSessionService, session),
        Layer.succeed(DatabaseBindings, Context.get(services, DatabaseBindings)),
        Layer.succeed(DrizzleKit, Context.get(services, DrizzleKit)),
        ProcessesService.Live,
        SiteClient.Live,
        SessionStore.Live,
        DeviceLoginService.Live.pipe(Layer.provide(SiteClient.Live)),
        buildRenderLayer,
        buildTrainLayer,
        DeployTrainService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              BundleStorage.Live,
              RegistryStore.Live,
              SignerService.Live,
              buildTrainLayer,
            ),
          ),
        ),
      );
    }),
  createRouter: (builder) => ({
    ...registerConfig(builder),
    ...registerPlugins(builder),
    ...registerDev(builder),
    ...registerBuild(builder),
    ...registerDeploy(builder),
    ...registerSmoke(builder),
    ...registerKeys(builder),
    ...registerProcesses(builder),
    ...registerInit(builder),
    ...registerImport(builder),
    ...registerUpgrade(builder),
    ...registerDb(builder),
    ...registerOps(builder),
  }),
});
