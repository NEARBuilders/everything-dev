import { Clock, Data, Effect, Layer } from "effect";
import { detectLocalPackages, PortAllocatorLive } from "./app";
import { generateCodeArtifacts } from "./code-artifacts";
import {
  buildRuntimeConfig,
  buildRuntimePluginsForConfig,
  findConfigPath,
  getHostDevelopmentPort,
  resolveConfigComposableEntries,
} from "./config";
import type { DevOptions, PhaseTiming, StartOptions } from "./contract";
import type { DevSessionData, StartSummary } from "./dev-session-data";
import {
  deleteProcessEnv,
  getProcessEnv,
  processEnvRecord,
  setProcessEnv,
} from "./env/process-env";
import {
  captureShellEnv,
  type EnvEnsureError,
  type EnvLoadError,
  ProjectEnv,
  ProjectEnvLive,
  type ProjectEnvService,
} from "./env/project-env";
import { buildRegistryConfigUrl } from "./fastkv";
import {
  detectAutoStartContext,
  isDockerAvailable,
  runDockerComposeUp,
  shouldAutoStartDocker,
} from "./infra/docker";
import { materializeViaLayer } from "./infra/materializer";
import { planInfra } from "./infra/planner";
import { preflightLocalInfra } from "./infra/preflight";
import type { InfraPlan } from "./infra/types";
import { mergeGeneratedOverFileEnv } from "./orchestrator";
import { type ProgressEvent, pluginEvents, timePhase } from "./progress";
import { openResolution, type ResolutionSession, walkExtendsChain } from "./resolution/session";
import {
  type AppOrchestrator,
  buildDescription,
  buildServiceDescriptorMap,
  buildServiceDescriptorMapFromPlan,
} from "./service-descriptor";
import { syncResolvedSharedDeps } from "./shared-deps";
import { isRegistryStart, resolveStartConfigSource } from "./start-config-source";
import type { BosConfig, SourceMode } from "./types";
import { BosConfigSchema } from "./types";
import { run } from "./utils/run";
import { ensureFreshDeps, findWorkspaceRoot } from "./workspace";

export type { DevSessionData, StartSummary } from "./dev-session-data";

export interface BootstrapDeps {
  readonly session: ResolutionSession | null;
}

export interface BootstrapHelpers {
  resolveProxyUrl: (bosConfig: BosConfig | null) => string | null;
}

export class DevStepError extends Data.TaggedError("DevStepError")<{
  phase: string;
  cause: unknown;
}> {}

export class DevConfigMissing extends Data.TaggedError("DevConfigMissing")<Record<string, never>> {}

export class DevProxyMissing extends Data.TaggedError("DevProxyMissing")<Record<string, never>> {}

export class DevPreflightFailed extends Data.TaggedError("DevPreflightFailed")<{
  messages: string[];
}> {}

export class StartFetchFailed extends Data.TaggedError("StartFetchFailed")<{ message: string }> {}

export class StartRemoteConfigMissing extends Data.TaggedError("StartRemoteConfigMissing")<{
  message: string;
}> {}

export class StartConfigMissing extends Data.TaggedError("StartConfigMissing")<
  Record<string, never>
> {}

function parseSourceMode(value: string | undefined, defaultValue: SourceMode): SourceMode {
  if (value === "local" || value === "remote") return value;
  return defaultValue;
}

async function resolvePublishedConfig(
  account: string,
  gateway: string,
  registry?: string,
): Promise<BosConfig | null> {
  try {
    const { config: merged } = await walkExtendsChain(`bos://${account}/${gateway}`, {
      env: "production",
      registry,
      visit: async () => {},
    });
    return resolveConfigComposableEntries(
      BosConfigSchema.parse(merged),
      process.cwd(),
      "production",
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No config found")) {
      return null;
    }
    throw error;
  }
}

function isValidProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveProxyUrl(bosConfig: BosConfig | null): string | null {
  if (!bosConfig) return null;
  const apiConfig = bosConfig.app.api;
  if (!apiConfig) return null;
  if (apiConfig.proxy && isValidProxyUrl(apiConfig.proxy)) return apiConfig.proxy;
  if (apiConfig.production && isValidProxyUrl(apiConfig.production)) return apiConfig.production;
  return null;
}

const emitProgress = (event: ProgressEvent) =>
  Effect.sync(() => pluginEvents.emit("progress", event));

const step = <A>(timings: PhaseTiming[], name: string, fn: () => Promise<A>) =>
  Effect.tryPromise({
    try: () => timePhase(timings, name, fn),
    catch: (cause) => new DevStepError({ phase: name, cause }),
  });

const timedEffect = <A, E, R>(
  timings: PhaseTiming[],
  name: string,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    yield* emitProgress({ phase: name, status: "running" });
    const startedAt = yield* Clock.currentTimeMillis;
    const result = yield* effect;
    const endedAt = yield* Clock.currentTimeMillis;
    timings.push({ name, durationMs: endedAt - startedAt });
    yield* emitProgress({ phase: name, status: "done", durationMs: endedAt - startedAt });
    return result;
  }).pipe(Effect.onError(() => emitProgress({ phase: name, status: "error" })));

const ensureEnvStep = (projectEnv: ProjectEnvService, configDir: string) =>
  projectEnv
    .ensureFile(configDir)
    .pipe(
      Effect.mapError((cause: EnvEnsureError) => new DevStepError({ phase: "ensure env", cause })),
    );

const loadEnvStep = (projectEnv: ProjectEnvService, configDir: string) =>
  projectEnv
    .load(configDir)
    .pipe(Effect.mapError((cause: EnvLoadError) => new DevStepError({ phase: "load env", cause })));

export const devBootstrap = (
  deps: BootstrapDeps,
  input: DevOptions,
  timings: PhaseTiming[],
  helpers: Pick<BootstrapHelpers, "resolveProxyUrl">,
) =>
  Effect.gen(function* () {
    const shell = yield* captureShellEnv;
    const projectEnv = yield* ProjectEnv;

    if (!deps.session) {
      return yield* new DevConfigMissing({});
    }
    let session: ResolutionSession = deps.session;

    yield* ensureEnvStep(projectEnv, session.root);
    yield* loadEnvStep(projectEnv, session.root);

    const localPackages = detectLocalPackages(
      session.config ?? undefined,
      session.runtime ?? undefined,
      session.root,
    );
    const localPackageNames = new Set(localPackages.map((entry) => entry.name));
    const localDirs = localPackages.map((entry) => entry.dir);

    const hostSource: SourceMode = localPackageNames.has("host")
      ? parseSourceMode(input.host, "local")
      : "remote";
    const uiSource: SourceMode = localPackageNames.has("ui")
      ? parseSourceMode(input.ui, "local")
      : "remote";
    const apiSource: SourceMode = localPackageNames.has("api")
      ? parseSourceMode(input.api, "local")
      : "remote";
    const authSource: SourceMode = localPackageNames.has("auth")
      ? parseSourceMode(input.auth, "local")
      : "remote";
    const ssr = input.ssr ?? false;
    const proxy = input.proxy ?? false;

    if (input.logLevel) {
      yield* Effect.sync(() => {
        setProcessEnv("BOS_LOG_LEVEL", input.logLevel!);
      });
    }

    if (ssr) {
      yield* Effect.sync(() => {
        setProcessEnv("BOS_SSR", "1");
      });
    }

    const sharedSync = yield* step(timings, "shared deps", () =>
      syncResolvedSharedDeps({
        configDir: session.root,
        hostMode: hostSource,
        bosConfig: session.config ?? undefined,
        extendsChain: [],
      }),
    );
    let configMayHaveChanged = false;
    if (sharedSync.catalogChanged) {
      yield* step(timings, "install", () =>
        run("pnpm", ["install"], { cwd: findWorkspaceRoot(session.root)?.dir ?? session.root }),
      );
      configMayHaveChanged = true;
    }

    yield* step(timings, "build", async () => {
      const report = await ensureFreshDeps(session.root, localDirs);
      if (report.rebuilt.some((member) => member.name === "everything-dev")) {
        // Only the bos process itself runs the everything-dev dist (plugin
        // children spawn after this step and load the fresh build). A source
        // run (bun src/cli.ts) never imported dist, so nothing is stale for
        // it — warn only where the previously imported build matters.
        const runningFromDist = import.meta.url.includes("/dist/");
        if (runningFromDist) {
          console.log(
            "[dev] everything-dev was rebuilt — this session still runs the previous " +
              "orchestrator build. Restart `bos dev` once to pick it up.",
          );
        }
      }
    });

    let devExtendsChain: string[] | undefined;
    if (configMayHaveChanged || input.remotePlugins !== undefined) {
      yield* step(timings, "resolve config", async () => {
        const opened = await openResolution({
          cwd: session.root,
          remotePlugins: input.remotePlugins,
        });
        if (opened) {
          session = opened;
          devExtendsChain = [...opened.chain];
        }
      });
    }

    if (!session.config) {
      return yield* new DevConfigMissing({});
    }
    const bosConfig: BosConfig = session.config;

    if (proxy && !helpers.resolveProxyUrl(bosConfig)) {
      return yield* new DevProxyMissing({});
    }

    const developmentRuntime = yield* Effect.tryPromise({
      try: async () => {
        return session.buildRuntime({
          uiSource,
          apiSource,
          authSource,
          hostSource,
          env: "development",
          plugins: session.runtime?.plugins,
        });
      },
      catch: (cause) => new DevStepError({ phase: "build runtime config", cause }),
    });
    for (const message of session.warnings) {
      yield* Effect.logWarning(message);
    }

    const plan: InfraPlan = yield* timedEffect(
      timings,
      "ports",
      planInfra({
        configDir: session.root,
        bosConfig: developmentRuntime,
        cli: {
          port: input.port,
          apiPort: input.apiPort,
          authPort: input.authPort,
          uiPort: input.uiPort,
          pluginPortStart: input.pluginPortStart,
          ssr,
          proxy,
          hostSource,
          uiSource,
          apiSource,
          authSource,
          interactive: input.interactive,
        },
      }),
    );

    yield* Effect.tryPromise({
      try: () => materializeViaLayer(session.root, plan.runtimeConfig),
      catch: (cause) => new DevStepError({ phase: "materialize infra", cause }),
    });
    yield* ensureEnvStep(projectEnv, session.root);
    yield* loadEnvStep(projectEnv, session.root);

    yield* projectEnv
      .sync(session.root, plan.envGenerated, shell)
      .pipe(
        Effect.catchTag("EnvSyncError", (error) =>
          Effect.logWarning(`[env] failed to refresh .env from resolved ports: ${error.cause}`),
        ),
      );

    const mergedEnv = yield* Effect.sync(() =>
      mergeGeneratedOverFileEnv(
        plan.envGenerated,
        processEnvRecord() as Record<string, string>,
        shell,
      ),
    );
    yield* Effect.sync(() => {
      for (const [key, value] of Object.entries(mergedEnv)) {
        if (key === "BASE_URL" || key === "CORS_ORIGIN") setProcessEnv(key, value);
      }
    });
    let preflightFailures = yield* preflightLocalInfra(plan.envGenerated, mergedEnv);
    if (
      preflightFailures.length > 0 &&
      shouldAutoStartDocker(preflightFailures, {
        ...detectAutoStartContext(session.root),
        dockerAvailable: yield* Effect.promise(isDockerAvailable),
      })
    ) {
      const compose = yield* step(timings, "docker compose up", () =>
        runDockerComposeUp(session.root),
      );
      if (compose.ok) {
        preflightFailures = yield* preflightLocalInfra(plan.envGenerated, mergedEnv);
      } else {
        preflightFailures = [
          ...preflightFailures,
          {
            secret: "docker-compose",
            host: "localhost",
            port: 0,
            error: `docker compose up -d --wait failed${compose.tail ? `:\n${compose.tail}` : ""}`,
            tcpReachable: false,
          },
        ];
      }
    }
    if (preflightFailures.length > 0) {
      return yield* new DevPreflightFailed({ messages: preflightFailures.map((f) => f.error) });
    }

    const services = buildServiceDescriptorMapFromPlan(plan, { ssr, proxy });

    const packages = [...plan.serviceDescriptors.keys()];
    if (getProcessEnv("DEBUG") === "true" || getProcessEnv("DEBUG") === "1") {
      yield* Effect.logError(`[DEBUG dev] services keys: ${packages.join(", ")}`);
    }
    const apiSvc = services.get("api");
    if (apiSvc?.proxy) {
      const proxyUrl = helpers.resolveProxyUrl(bosConfig);
      if (proxyUrl) plan.orchestrator.env.API_PROXY = proxyUrl;
    }

    yield* step(timings, "generate artifacts", () =>
      generateCodeArtifacts(session.root, bosConfig, {
        env: "development",
        extendsChain: devExtendsChain,
        runtimeConfig: plan.runtimeConfig,
      }),
    );

    return {
      session: {
        orchestrator: plan.orchestrator,
        services,
        runtimeConfig: plan.runtimeConfig,
        envGenerated: plan.envGenerated,
        shellEnv: shell,
      } satisfies DevSessionData,
      description: buildDescription(services) || plan.description,
      processes: packages,
    };
  });

export const startBootstrap = (
  deps: BootstrapDeps,
  input: StartOptions,
  _helpers: BootstrapHelpers,
) =>
  Effect.gen(function* () {
    const shell = yield* captureShellEnv;
    const projectEnv = yield* ProjectEnv;

    const sessionRoot = deps.session?.root ?? process.cwd();

    yield* ensureEnvStep(projectEnv, sessionRoot);
    yield* loadEnvStep(projectEnv, sessionRoot);

    yield* emitProgress({ phase: "config", status: "running" });

    const bosEnv = input.env ?? (getProcessEnv("BOS_ENV") === "staging" ? "staging" : "production");
    const explicitConfig = resolveStartConfigSource(input, {
      BOS_ACCOUNT: getProcessEnv("BOS_ACCOUNT"),
      BOS_GATEWAY: getProcessEnv("BOS_GATEWAY"),
    });

    let config: BosConfig | null = null;
    let remoteConfig: BosConfig | null = null;

    if (explicitConfig.configPath) {
      config = deps.session?.config ?? null;
    } else if (explicitConfig.registry) {
      const { account, domain } = explicitConfig.registry;
      const expectedUrl = buildRegistryConfigUrl(account, domain, input.registry);
      remoteConfig = yield* Effect.tryPromise({
        try: () => resolvePublishedConfig(account, domain, input.registry),
        catch: (error) =>
          new StartFetchFailed({
            message: `Failed to fetch config for bos://${account}/${domain}: ${
              error instanceof Error ? error.message : "Unknown error"
            }\nExpected URL: ${expectedUrl}`,
          }),
      });
      if (remoteConfig) {
        config = remoteConfig;
      } else {
        return yield* new StartRemoteConfigMissing({
          message: `No config found at bos://${account}/${domain}. Verify the account and gateway are correct and the config has been published.\nExpected URL: ${expectedUrl}`,
        });
      }
    } else {
      config = deps.session?.config ?? null;
    }

    if (!config) {
      return yield* new StartConfigMissing({});
    }

    if (!explicitConfig.configPath) {
      if (explicitConfig.registry?.account) {
        config = { ...config, account: explicitConfig.registry.account };
      }
      if (explicitConfig.registry?.domain) {
        config = { ...config, domain: explicitConfig.registry.domain };
      }
    }
    const baseConfig: BosConfig = config;

    const port = input.port ?? getHostDevelopmentPort(baseConfig.app.host.development);
    const isStaging = bosEnv === "staging";
    const runtimePlugins = yield* Effect.tryPromise({
      try: () => buildRuntimePluginsForConfig(baseConfig, sessionRoot, "production"),
      catch: (cause) => new DevStepError({ phase: "resolve runtime plugins", cause }),
    });
    const runtimeConfig = yield* Effect.tryPromise({
      try: () =>
        buildRuntimeConfig(baseConfig, sessionRoot, "production", {
          uiSource: "remote",
          apiSource: "remote",
          authSource: "remote",
          hostSource: "remote",
          plugins: runtimePlugins,
        }),
      catch: (cause) => new DevStepError({ phase: "build runtime config", cause }),
    });

    if (isStaging && baseConfig.staging?.domain) {
      runtimeConfig.domain = baseConfig.staging.domain;
    }

    if (isStaging) {
      runtimeConfig.env = "staging";
    }

    yield* Effect.tryPromise({
      try: () => materializeViaLayer(sessionRoot, runtimeConfig),
      catch: (cause) => new DevStepError({ phase: "materialize infra", cause }),
    });
    yield* ensureEnvStep(projectEnv, sessionRoot);
    yield* loadEnvStep(projectEnv, sessionRoot);

    yield* emitProgress({ phase: "generate artifacts", status: "running" });
    yield* Effect.tryPromise({
      try: () =>
        generateCodeArtifacts(sessionRoot, baseConfig, {
          env: "production",
          runtimeConfig,
        }),
      catch: (cause) => new DevStepError({ phase: "generate artifacts", cause }),
    });
    yield* emitProgress({ phase: "generate artifacts", status: "done" });

    const productionEnv: Record<string, string> = {};
    const warnings: string[] = [];

    const localhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
    const corsOrigin = getProcessEnv("CORS_ORIGIN");
    const isLocalhostProductionOrigin =
      corsOrigin !== undefined && localhostOrigin.test(corsOrigin);
    if (isLocalhostProductionOrigin && isRegistryStart(explicitConfig)) {
      warnings.push(
        `CORS_ORIGIN is a localhost origin (${corsOrigin}) in a registry production start — overriding with the configured domain`,
      );
      deleteProcessEnv("CORS_ORIGIN");
      deleteProcessEnv("BASE_URL");
    }

    if (!getProcessEnv("CORS_ORIGIN") && baseConfig.domain) {
      const effectiveDomain = isStaging
        ? (baseConfig.staging?.domain ?? baseConfig.domain)
        : baseConfig.domain;
      const defaultOrigin = `https://${effectiveDomain}`;
      productionEnv.CORS_ORIGIN = defaultOrigin;
      productionEnv.BASE_URL = defaultOrigin;
      warnings.push(`CORS_ORIGIN defaulting to ${defaultOrigin}`);
    }

    const requiredSecrets = new Set<string>();
    const missingSecrets: string[] = [];

    if (runtimeConfig.host.secrets) {
      for (const s of runtimeConfig.host.secrets) requiredSecrets.add(s);
    }
    if (runtimeConfig.auth?.secrets) {
      for (const s of runtimeConfig.auth.secrets) requiredSecrets.add(s);
    }
    if (runtimeConfig.api?.secrets) {
      for (const s of runtimeConfig.api.secrets) requiredSecrets.add(s);
    }
    for (const plugin of Object.values(runtimeConfig.plugins ?? {})) {
      if (plugin.secrets) {
        for (const s of plugin.secrets) requiredSecrets.add(s);
      }
    }

    for (const secret of requiredSecrets) {
      const value = getProcessEnv(secret);
      if (!value || value.length === 0) {
        missingSecrets.push(secret);
      }
    }

    if (missingSecrets.length > 0) {
      warnings.push(`Missing ${missingSecrets.length} secret(s): ${missingSecrets.join(", ")}`);
    }

    const stagingEnvVars: Record<string, string> = isStaging
      ? { BOS_GATEWAY: baseConfig.staging?.domain ?? baseConfig.domain ?? "" }
      : {};

    const plan: InfraPlan = yield* planInfra({
      configDir: sessionRoot,
      bosConfig: runtimeConfig,
      cli: {
        port: input.port,
        ssr: false,
        proxy: false,
        hostSource: "remote",
        uiSource: "remote",
        apiSource: "remote",
        authSource: "remote",
        interactive: input.interactive,
      },
    });

    const services = buildServiceDescriptorMap(plan.runtimeConfig);

    const configSource = explicitConfig.configPath
      ? explicitConfig.configPath
      : remoteConfig
        ? `bos://${explicitConfig.registry?.account}/${explicitConfig.registry?.domain}`
        : (findConfigPath() ?? "bos.config.json");

    const configSourceHttp =
      remoteConfig && explicitConfig.registry
        ? buildRegistryConfigUrl(
            explicitConfig.registry.account,
            explicitConfig.registry.domain,
            input.registry,
          )
        : undefined;

    const summary: StartSummary = {
      configSource,
      configSourceHttp,
      account: baseConfig.account,
      domain: baseConfig.domain ?? undefined,
      modules: {
        host: plan.runtimeConfig.host.remoteUrl ?? plan.runtimeConfig.host.url ?? "local",
        ui: plan.runtimeConfig.ui.url ?? "local",
        api: plan.runtimeConfig.api.url ?? "local",
        auth: plan.runtimeConfig.auth?.url ?? undefined,
      },
      warnings,
    };

    const orchestrator: AppOrchestrator = {
      packages: ["host"],
      env: {
        NODE_ENV: "production",
        ...productionEnv,
        ...stagingEnvVars,
        ...plan.launch.env,
      },
      description: `${isStaging ? "Staging" : "Production"} Mode (${baseConfig.account})`,
      port: plan.resolvedPorts.host ?? port,
      interactive: input.interactive,
      noLogs: true,
    };

    yield* emitProgress({ phase: "config", status: "done" });

    return {
      session: {
        orchestrator,
        services,
        runtimeConfig: plan.runtimeConfig,
        envGenerated: plan.envGenerated,
        shellEnv: shell,
      } satisfies DevSessionData,
      summary,
      url: plan.launch.hostUrl ?? `http://localhost:${plan.resolvedPorts.host ?? port}`,
    };
  });

export const bootstrapLayers = Layer.mergeAll(ProjectEnvLive, PortAllocatorLive);
