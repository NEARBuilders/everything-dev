import { Data, Effect } from "effect";
import type { DevOptions, PhaseTiming } from "../../contract";
import { getProcessEnv, processEnvRecord, setProcessEnv } from "../../env/process-env";
import {
  captureShellEnv,
  type EnvEnsureError,
  type EnvLoadError,
  ProjectEnv,
  type ProjectEnvService,
} from "../../env/project-env";
import {
  detectAutoStartContext,
  isDockerAvailable,
  runDockerComposeUp,
  shouldAutoStartDocker,
} from "../../infra/docker";
import { materializeViaLayer } from "../../infra/materializer";
import { planInfra } from "../../infra/planner";
import { preflightLocalInfra } from "../../infra/preflight";
import type { InfraPlan } from "../../infra/types";
import type { BosConfig, SourceMode } from "../../types";
import { run } from "../../utils/run";
import { generateCodeArtifacts } from "../codegen/artifacts";
import { openResolution, type ResolutionSession } from "../resolution/session";
import { detectLocalPackages } from "../workspace/linked-packages";
import { syncResolvedSharedDeps } from "../workspace/shared-deps";
import { ensureFreshDeps, findWorkspaceRoot } from "../workspace/workspace";
import { isDebug } from "./logs";
import { mergeGeneratedOverFileEnv } from "./orchestrator";
import { timedPhase } from "./progress";
import { buildDescription, buildServiceDescriptorMapFromPlan } from "./service-descriptor";
import type { DevSessionData } from "./session";
export interface BootstrapDeps {
  readonly session: ResolutionSession | null;
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

const step = <A>(timings: PhaseTiming[], name: string, fn: () => Promise<A>) =>
  timedPhase(
    timings,
    name,
    Effect.tryPromise({
      try: fn,
      catch: (cause) => new DevStepError({ phase: name, cause }),
    }),
  );

const ensureEnvStep = (projectEnv: ProjectEnvService, configDir: string) =>
  projectEnv
    .ensureFile(configDir)
    .pipe(
      Effect.mapError((cause: EnvEnsureError) => new DevStepError({ phase: "ensure env", cause })),
    );

export const loadEnvStep = (projectEnv: ProjectEnvService, configDir: string) =>
  projectEnv
    .load(configDir)
    .pipe(Effect.mapError((cause: EnvLoadError) => new DevStepError({ phase: "load env", cause })));

export const devBootstrap = (deps: BootstrapDeps, input: DevOptions, timings: PhaseTiming[]) =>
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
        // run (node --import tsx src/cli.ts) never imported dist, so nothing
        // is stale for it — warn only where the previously imported build
        // matters.
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

    if (proxy && !resolveProxyUrl(bosConfig)) {
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

    const plan: InfraPlan = yield* timedPhase(
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
          Effect.logWarning(
            `[env] failed to refresh .env from resolved ports: ${String(error.cause)}`,
          ),
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
    if (isDebug(getProcessEnv("DEBUG"))) {
      yield* Effect.logError(`[DEBUG dev] services keys: ${packages.join(", ")}`);
    }
    const apiSvc = services.get("api");
    if (apiSvc?.proxy) {
      const proxyUrl = resolveProxyUrl(bosConfig);
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
