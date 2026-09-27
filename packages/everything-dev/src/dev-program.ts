import process from "node:process";
import { Data, Effect, Layer } from "effect";
import { buildRuntimeConfig, detectLocalPackages, PortAllocatorLive } from "./app";
import {
  buildBetterNearAuthQuietly,
  buildEveryPluginQuietly,
  buildEverythingDevQuietly,
} from "./build";
import { generateCodeArtifacts } from "./code-artifacts";
import {
  buildRuntimePluginsForConfig,
  drainConfigWarnings,
  findConfigPath,
  getHostDevelopmentPort,
  loadResolvedConfig,
  resumeWarnings,
  suppressWarnings,
} from "./config";
import type { DevOptions, PhaseTiming, StartOptions } from "./contract";
import {
  captureShellEnv,
  type EnvEnsureError,
  type EnvLoadError,
  ProjectEnv,
  ProjectEnvLive,
  type ProjectEnvService,
} from "./env/project-env";
import { buildRegistryConfigUrl } from "./fastkv";
import { materializeViaLayer } from "./infra/materializer";
import { planInfra } from "./infra/planner";
import { preflightLocalInfra } from "./infra/preflight";
import type { InfraPlan } from "./infra/types";
import { isRegistryStart, resolveStartConfigSource } from "./local-prod-config";
import { mergeGeneratedOverFileEnv } from "./orchestrator";
import { type ProgressEvent, pluginEvents, timePhase } from "./progress";
import {
  type AppOrchestrator,
  buildDescription,
  buildServiceDescriptorMap,
  buildServiceDescriptorMapFromPlan,
  type ServiceDescriptor,
} from "./service-descriptor";
import { syncResolvedSharedDeps } from "./shared-deps";
import type { BosConfig, RuntimeConfig, SourceMode } from "./types";
import { run } from "./utils/run";

export interface DevSessionData {
  orchestrator: AppOrchestrator;
  services: Map<string, ServiceDescriptor>;
  runtimeConfig: RuntimeConfig;
  /** The generated infra env tier — required so a start session can never silently run with an empty tier. */
  envGenerated: Record<string, string>;
  shellEnv: Record<string, string>;
}

export interface StartSummary {
  configSource: string;
  configSourceHttp?: string;
  account: string;
  domain?: string;
  modules: { host?: string; ui?: string; api?: string; auth?: string };
  warnings: string[];
}

export interface BootstrapDeps {
  configDir: string;
  bosConfig: BosConfig | null;
  runtimeConfig: RuntimeConfig | null;
}

export interface BootstrapHelpers {
  resolveProxyUrl: (bosConfig: BosConfig | null) => string | null;
  fetchPublishedConfig: (
    account: string,
    domain: string,
    registry?: string,
  ) => Promise<BosConfig | null>;
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
    const startedAt = Date.now();
    const result = yield* effect;
    timings.push({ name, durationMs: Date.now() - startedAt });
    yield* emitProgress({ phase: name, status: "done", durationMs: Date.now() - startedAt });
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

    yield* ensureEnvStep(projectEnv, deps.configDir);
    yield* loadEnvStep(projectEnv, deps.configDir);

    const localPackages = detectLocalPackages(
      deps.bosConfig ?? undefined,
      deps.runtimeConfig ?? undefined,
    );

    const hostSource: SourceMode = localPackages.includes("host")
      ? parseSourceMode(input.host, "local")
      : "remote";
    const uiSource: SourceMode = localPackages.includes("ui")
      ? parseSourceMode(input.ui, "local")
      : "remote";
    const apiSource: SourceMode = localPackages.includes("api")
      ? parseSourceMode(input.api, "local")
      : "remote";
    const authSource: SourceMode = localPackages.includes("auth")
      ? parseSourceMode(input.auth, "local")
      : "remote";
    const ssr = input.ssr ?? false;
    const proxy = input.proxy ?? false;

    if (input.logLevel) {
      yield* Effect.sync(() => {
        process.env.BOS_LOG_LEVEL = input.logLevel;
      });
    }

    if (ssr) {
      yield* Effect.sync(() => {
        process.env.BOS_SSR = "1";
      });
    }

    const sharedSync = yield* step(timings, "shared deps", () =>
      syncResolvedSharedDeps({
        configDir: deps.configDir,
        hostMode: hostSource,
        bosConfig: deps.bosConfig ?? undefined,
        extendsChain: [],
      }),
    );
    let configMayHaveChanged = false;
    if (sharedSync.catalogChanged) {
      yield* step(timings, "install", () => run("bun", ["install"], { cwd: deps.configDir }));
      configMayHaveChanged = true;
    }
    const shouldBuildPlugin =
      (apiSource === "local" && !proxy) || localPackages.some((pkg) => pkg.startsWith("plugin:"));

    yield* step(timings, "build", async () => {
      const [everythingDevRebuilt] = await Promise.all([
        buildEverythingDevQuietly(deps.configDir),
        buildBetterNearAuthQuietly(deps.configDir),
      ]);
      if (shouldBuildPlugin) {
        await buildEveryPluginQuietly(deps.configDir);
      }
      if (everythingDevRebuilt === true) {
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
      const refreshed = yield* step(timings, "resolve config", () =>
        loadResolvedConfig({
          cwd: deps.configDir,
          remotePlugins: input.remotePlugins,
        }),
      );
      deps.bosConfig = refreshed?.config ?? deps.bosConfig;
      deps.runtimeConfig = refreshed?.runtime ?? deps.runtimeConfig;
      devExtendsChain = refreshed?.source.extended;
    }

    if (!deps.bosConfig) {
      return yield* new DevConfigMissing({});
    }

    if (proxy && !helpers.resolveProxyUrl(deps.bosConfig)) {
      return yield* new DevProxyMissing({});
    }
    const bosConfig: BosConfig = deps.bosConfig;

    // Failure-safe warning suppression: the release runs even when the build
    // fails, so warnings can never stay suppressed process-wide.
    const developmentRuntime = yield* Effect.acquireUseRelease(
      Effect.sync(() => suppressWarnings()),
      () =>
        Effect.tryPromise({
          try: () =>
            buildRuntimeConfig(bosConfig, {
              uiSource,
              apiSource,
              authSource,
              hostSource,
              env: "development",
              plugins: deps.runtimeConfig?.plugins,
            }),
          catch: (cause) => new DevStepError({ phase: "build runtime config", cause }),
        }),
      () =>
        Effect.sync(() => {
          drainConfigWarnings();
          resumeWarnings();
        }),
    );

    const plan: InfraPlan = yield* timedEffect(
      timings,
      "ports",
      planInfra({
        configDir: deps.configDir,
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
      try: () => materializeViaLayer(deps.configDir, plan.runtimeConfig),
      catch: (cause) => new DevStepError({ phase: "materialize infra", cause }),
    });
    yield* ensureEnvStep(projectEnv, deps.configDir);
    yield* loadEnvStep(projectEnv, deps.configDir);

    yield* projectEnv
      .sync(deps.configDir, plan.envGenerated, shell)
      .pipe(
        Effect.catchTag("EnvSyncError", (error) =>
          Effect.logWarning(`[env] failed to refresh .env from resolved ports: ${error.cause}`),
        ),
      );

    const mergedEnv = yield* Effect.sync(() =>
      mergeGeneratedOverFileEnv(plan.envGenerated, process.env as Record<string, string>, shell),
    );
    yield* Effect.sync(() => {
      for (const [key, value] of Object.entries(mergedEnv)) {
        if (key === "BASE_URL" || key === "CORS_ORIGIN") process.env[key] = value;
      }
    });
    const preflightFailures = yield* preflightLocalInfra(plan.envGenerated, mergedEnv);
    if (preflightFailures.length > 0) {
      return yield* new DevPreflightFailed({ messages: preflightFailures.map((f) => f.error) });
    }

    const services = buildServiceDescriptorMapFromPlan(plan, { ssr, proxy });

    const packages = [...plan.serviceDescriptors.keys()];
    if (process.env.DEBUG === "true" || process.env.DEBUG === "1") {
      yield* Effect.sync(() => console.error("[DEBUG dev] services keys:", packages.join(", ")));
    }
    const apiSvc = services.get("api");
    if (apiSvc?.proxy) {
      const proxyUrl = helpers.resolveProxyUrl(bosConfig);
      if (proxyUrl) plan.orchestrator.env.API_PROXY = proxyUrl;
    }

    yield* step(timings, "generate artifacts", () =>
      generateCodeArtifacts(deps.configDir, bosConfig, {
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
  helpers: BootstrapHelpers,
) =>
  Effect.gen(function* () {
    const shell = yield* captureShellEnv;
    const projectEnv = yield* ProjectEnv;

    yield* ensureEnvStep(projectEnv, deps.configDir);
    yield* loadEnvStep(projectEnv, deps.configDir);

    yield* emitProgress({ phase: "config", status: "running" });

    const bosEnv = input.env ?? (process.env.BOS_ENV === "staging" ? "staging" : "production");
    const explicitConfig = resolveStartConfigSource(input, {
      BOS_ACCOUNT: process.env.BOS_ACCOUNT,
      BOS_GATEWAY: process.env.BOS_GATEWAY,
    });

    let config: BosConfig | null = null;
    let remoteConfig: BosConfig | null = null;

    if (explicitConfig.configPath) {
      config = deps.bosConfig;
    } else if (explicitConfig.registry) {
      const { account, domain } = explicitConfig.registry;
      const expectedUrl = buildRegistryConfigUrl(account, domain, input.registry);
      remoteConfig = yield* Effect.tryPromise({
        try: () => helpers.fetchPublishedConfig(account, domain, input.registry),
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
      config = deps.bosConfig;
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
      try: () => buildRuntimePluginsForConfig(baseConfig, deps.configDir, "production"),
      catch: (cause) => new DevStepError({ phase: "resolve runtime plugins", cause }),
    });
    // Failure-safe warning suppression (same finalizer discipline as the
    // development path above).
    const runtimeConfig = yield* Effect.acquireUseRelease(
      Effect.sync(() => suppressWarnings()),
      () =>
        Effect.tryPromise({
          try: () =>
            buildRuntimeConfig(baseConfig, {
              uiSource: "remote",
              apiSource: "remote",
              authSource: "remote",
              hostSource: "remote",
              env: "production",
              plugins: runtimePlugins,
            }),
          catch: (cause) => new DevStepError({ phase: "build runtime config", cause }),
        }),
      () =>
        Effect.sync(() => {
          drainConfigWarnings();
          resumeWarnings();
        }),
    );

    if (isStaging && baseConfig.staging?.domain) {
      runtimeConfig.domain = baseConfig.staging.domain;
    }

    if (isStaging) {
      runtimeConfig.env = "staging";
    }

    yield* Effect.tryPromise({
      try: () => materializeViaLayer(deps.configDir, runtimeConfig),
      catch: (cause) => new DevStepError({ phase: "materialize infra", cause }),
    });
    yield* ensureEnvStep(projectEnv, deps.configDir);
    yield* loadEnvStep(projectEnv, deps.configDir);

    yield* emitProgress({ phase: "generate artifacts", status: "running" });
    yield* Effect.tryPromise({
      try: () =>
        generateCodeArtifacts(deps.configDir, baseConfig, {
          env: "production",
          runtimeConfig,
        }),
      catch: (cause) => new DevStepError({ phase: "generate artifacts", cause }),
    });
    yield* emitProgress({ phase: "generate artifacts", status: "done" });

    const productionEnv: Record<string, string> = {};
    const warnings: string[] = [];

    const localhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
    const corsOrigin = process.env.CORS_ORIGIN;
    const isLocalhostProductionOrigin =
      corsOrigin !== undefined && localhostOrigin.test(corsOrigin);
    if (isLocalhostProductionOrigin && isRegistryStart(explicitConfig)) {
      warnings.push(
        `CORS_ORIGIN is a localhost origin (${corsOrigin}) in a registry production start — overriding with the configured domain`,
      );
      delete process.env.CORS_ORIGIN;
      delete process.env.BASE_URL;
    }

    if (!process.env.CORS_ORIGIN && baseConfig.domain) {
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
      const value = process.env[secret];
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
      configDir: deps.configDir,
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
