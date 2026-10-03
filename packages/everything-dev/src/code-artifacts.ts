import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { CORE_UI_PLUGIN_KEY } from "every-plugin/ui/manifest";
import { generateUiManifest } from "every-plugin/ui/manifest-generator";
import { type ContractBridgeStatus, syncApiContractBridge } from "./api-contract";
import { writeResolvedConfig } from "./config";
import type { BosEnv } from "./merge";
import { openResolution } from "./resolution/session";
import type { BosConfig, RuntimeConfig } from "./types";

export class ArtifactGenError extends Schema.TaggedError<ArtifactGenError>()("ArtifactGenError", {
  phase: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

interface GeneratedArtifacts {
  resolvedConfigPath?: string;
  contractBridgePath: string;
}

interface UiManifestTarget {
  workspaceRoot: string;
  pluginName: string;
  emitRouteTree: boolean;
}

function uiManifestTargets(runtimeConfig: RuntimeConfig): UiManifestTarget[] {
  const targets: UiManifestTarget[] = [];
  const ui = runtimeConfig.ui;
  // The core ui is always a manifest target when local — with no authored
  // rsbuild.config.ts the every-plugin build synthesizes one, so the
  // config's existence no longer gates manifest generation.
  if (ui?.source === "local" && ui.localPath) {
    targets.push({
      workspaceRoot: ui.localPath,
      pluginName: CORE_UI_PLUGIN_KEY,
      emitRouteTree: !existsSync(join(ui.localPath, "src/routeTree.gen.ts")),
    });
  }
  for (const [key, plugin] of Object.entries(runtimeConfig.plugins ?? {})) {
    const uiPath = plugin.ui?.localPath;
    if (plugin.ui?.source === "local" && uiPath && existsSync(join(uiPath, "rsbuild.config.ts"))) {
      targets.push({ workspaceRoot: uiPath, pluginName: key, emitRouteTree: false });
    }
  }
  return targets;
}

export const generateCodeArtifactsEffect = Effect.fn("generateCodeArtifacts")(function* (
  configDir: string,
  config: BosConfig,
  opts?: {
    env?: BosEnv;
    extendsChain?: string[];
    runtimeConfig?: RuntimeConfig;
  },
): Effect.fn.Return<
  (GeneratedArtifacts & { contractStatus: ContractBridgeStatus[] }) | null,
  ArtifactGenError
> {
  const env = opts?.env;
  if (env) {
    yield* Effect.try({
      try: () => writeResolvedConfig(configDir, config, env, opts?.extendsChain),
      catch: (cause) => new ArtifactGenError({ phase: "write resolved config", cause }),
    });
  }

  const runtimeConfig =
    opts?.runtimeConfig ??
    (yield* Effect.tryPromise({
      try: () => openResolution({ cwd: configDir }),
      catch: (cause) => new ArtifactGenError({ phase: "load resolved config", cause }),
    }))?.runtime;
  if (!runtimeConfig) return null;

  const bridge = yield* Effect.tryPromise({
    try: () =>
      syncApiContractBridge({
        configDir,
        runtimeConfig,
        apiBaseUrl: runtimeConfig.api.url,
      }),
    catch: (cause) => new ArtifactGenError({ phase: "sync api contract bridge", cause }),
  });

  for (const target of uiManifestTargets(runtimeConfig)) {
    yield* Effect.tryPromise({
      try: () => generateUiManifest(target),
      catch: (cause) =>
        new ArtifactGenError({ phase: `generate ui manifest (${target.pluginName})`, cause }),
    });
  }

  return {
    resolvedConfigPath: env ? join(configDir, ".bos/bos.resolved-config.json") : undefined,
    contractBridgePath: bridge.bridgePath,
    contractStatus: bridge.status,
  };
});

export async function generateCodeArtifacts(
  configDir: string,
  config: BosConfig,
  opts?: {
    env?: BosEnv;
    extendsChain?: string[];
    runtimeConfig?: RuntimeConfig;
  },
): Promise<(GeneratedArtifacts & { contractStatus: ContractBridgeStatus[] }) | null> {
  return Effect.runPromise(generateCodeArtifactsEffect(configDir, config, opts));
}
