import { Data, Effect } from "effect";
import {
  buildRuntimeConfig,
  buildRuntimePluginsForConfig,
  findConfigPath,
  getHostDevelopmentPort,
} from "../../config";
import type { StartOptions } from "../../contract";
import { isRailwayPublicProxyUrl } from "../../db/driver";
import { deleteProcessEnv, getProcessEnv, processEnvRecord } from "../../env/process-env";
import { captureShellEnv, ProjectEnv } from "../../env/project-env";
import { planInfra } from "../../infra/planner";
import type { InfraPlan } from "../../infra/types";
import type { BosConfig } from "../../types";
import { generateCodeArtifacts } from "../codegen/artifacts";
import { type BootstrapDeps, DevStepError, loadEnvStep } from "../dev/boot";
import { emitProgress } from "../dev/progress";
import { type AppOrchestrator, buildServiceDescriptorMap } from "../dev/service-descriptor";
import type { DevSessionData, StartSummary } from "../dev/session";
import { buildRegistryConfigUrl } from "../registry/fastkv";
import { resolvePublishedConfig } from "../registry/published";
import { isRegistryStart, resolveStartConfigSource, type StartConfigSource } from "./source";

export class StartFetchFailed extends Data.TaggedError("StartFetchFailed")<{ message: string }> {}

export class StartRemoteConfigMissing extends Data.TaggedError("StartRemoteConfigMissing")<{
  message: string;
}> {}

export class StartConfigMissing extends Data.TaggedError("StartConfigMissing")<
  Record<string, never>
> {}

/**
 * A production start booting from an explicit config has declared that config
 * as its truth — the host's SnapshotWatch must not override it with the
 * registry pointer mid-run (a fixture-booted stack carrying a live identity
 * would otherwise adopt a foreign generation 30 seconds in, and a
 * config-path production boot is the operator's declared truth). The watch
 * stays on for identity-driven boots — adopting published config changes is
 * its feature. An operator-set interval always wins.
 */
export function setSnapshotWatchIntervalForBoot(
  source: StartConfigSource,
  env: "production" | "staging",
  processEnv: { BOS_SNAPSHOT_WATCH_INTERVAL_MS?: string } = process.env as {
    BOS_SNAPSHOT_WATCH_INTERVAL_MS?: string;
  },
): void {
  if (processEnv.BOS_SNAPSHOT_WATCH_INTERVAL_MS !== undefined) return;
  if (env !== "production" || !source.configPath) return;
  processEnv.BOS_SNAPSHOT_WATCH_INTERVAL_MS = "0";
}

export const startBootstrap = (deps: BootstrapDeps, input: StartOptions) =>
  Effect.gen(function* () {
    const shell = yield* captureShellEnv;
    const projectEnv = yield* ProjectEnv;

    const sessionRoot = deps.session?.root ?? process.cwd();

    yield* loadEnvStep(projectEnv, sessionRoot);

    yield* emitProgress({ phase: "config", status: "running" });

    const bosEnv = input.env ?? (getProcessEnv("BOS_ENV") === "staging" ? "staging" : "production");
    const explicitConfig = resolveStartConfigSource(input, {
      BOS_ACCOUNT: getProcessEnv("BOS_ACCOUNT"),
      BOS_GATEWAY: getProcessEnv("BOS_GATEWAY"),
    });
    const registry = input.registry ?? getProcessEnv("BOS_REGISTRY");
    setSnapshotWatchIntervalForBoot(explicitConfig, bosEnv);

    let config: BosConfig | null = null;
    let remoteConfig: BosConfig | null = null;

    if (explicitConfig.configPath) {
      config = deps.session?.config ?? null;
    } else if (explicitConfig.registry) {
      const { account, domain } = explicitConfig.registry;
      const expectedUrl = buildRegistryConfigUrl(account, domain, registry);
      remoteConfig = yield* Effect.tryPromise({
        try: () => resolvePublishedConfig(account, domain, registry),
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
        for (const s of plugin.secrets) {
          if (s.endsWith("_DATABASE_URL")) continue;
          requiredSecrets.add(s);
        }
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

    for (const [secret, value] of Object.entries(processEnvRecord())) {
      if (!value || !secret.endsWith("_DATABASE_URL")) continue;
      if (isRailwayPublicProxyUrl(value)) {
        const host = new URL(value).hostname;
        warnings.push(
          `${secret} points at Railway's public proxy (${host}) — its TLS certificate is self-signed, ` +
            `so connections use unverified TLS. Prefer the private *.railway.internal URL when the ` +
            `database runs in the same Railway project.`,
        );
      }
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
            registry,
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
      // Log persistence stays off for start stacks: the SSR host emits ~80
      // log events per page render (i18n uncompiled-catalog warnings), and
      // the file sink writes every event twice through a serialized
      // appendFile chain regardless of level or dedup — on a loaded machine
      // that chain starves the event loop and degrades SSR/hydration
      // mid-suite. Boot failures are diagnosed from stdout (the renderer
      // prints error-level lines; the smoke captures 400 lines of it).
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
