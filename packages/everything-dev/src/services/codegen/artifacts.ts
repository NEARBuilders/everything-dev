import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { emitCoreUiStubs } from "every-plugin/build/ui";
import { CORE_UI_PLUGIN_KEY } from "every-plugin/ui/manifest";
import { generateUiManifest } from "every-plugin/ui/manifest-generator";
import { writeResolvedConfig } from "../../config";
import type { BosConfig, RuntimeConfig } from "../../types";
import type { BosEnv } from "../resolution/merge";
import { openResolution } from "../resolution/session";
import { type ContractBridgeStatus, syncApiContractBridge } from "./api-contract";
import { generateRuntimeMapEffect } from "./runtime-map";

export class ArtifactGenError extends Schema.TaggedError<ArtifactGenError>()("ArtifactGenError", {
  phase: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {
  // TaggedError carries no message field, so `error.message` serializes as ""
  // down every `error instanceof Error ? error.message` wire (CI output
  // included). Render the phase + cause instead — a generation failure must
  // always name what failed.
  override get message(): string {
    let detail: string;
    try {
      detail =
        this.cause instanceof Error
          ? this.cause.message
          : this.cause === undefined
            ? ""
            : String(this.cause);
    } catch {
      // some Error subclasses (Effect's YieldableError) delete toString —
      // a non-serializable cause must not break rendering the message
      detail = "non-serializable cause";
    }
    return `artifact generation failed (${this.phase})${detail ? `: ${detail}` : ""}`;
  }
}

interface GeneratedArtifacts {
  resolvedConfigPath?: string;
  contractBridgePath: string;
}

interface UiManifestTarget {
  workspaceRoot: string;
  pluginName: string;
  emitRouteTree: boolean;
}

export function uiManifestTargets(
  runtimeConfig: RuntimeConfig,
  forceRouteTree?: boolean,
): UiManifestTarget[] {
  const targets: UiManifestTarget[] = [];
  const ui = runtimeConfig.ui;
  // The core ui is always a manifest target when local — with no authored
  // rsbuild.config.ts the every-plugin build synthesizes one, so the
  // config's existence no longer gates manifest generation.
  if (ui?.source === "local" && ui.localPath) {
    targets.push({
      workspaceRoot: ui.localPath,
      pluginName: CORE_UI_PLUGIN_KEY,
      emitRouteTree: forceRouteTree
        ? true
        : !existsSync(join(ui.localPath, "src/routeTree.gen.ts")),
    });
  }
  // A local auth attachment's ui (`auth.ui`) is its own manifest target:
  // the plugins bucket only covers `plugins.<id>` entries, so an
  // `auth.ui` override against a published auth server would otherwise
  // never get a manifest (it is composed under the "auth" key).
  const authUi = runtimeConfig.auth?.ui;
  if (
    authUi?.source === "local" &&
    authUi.localPath &&
    !targets.some((t) => t.workspaceRoot === authUi.localPath)
  ) {
    targets.push({
      workspaceRoot: authUi.localPath,
      pluginName: "auth",
      emitRouteTree: forceRouteTree
        ? true
        : !existsSync(join(authUi.localPath, "src/routeTree.gen.ts")),
    });
  }
  for (const [key, plugin] of Object.entries(runtimeConfig.plugins ?? {})) {
    const uiPath = plugin.ui?.localPath;
    // Folder-form plugin uis (no committed rsbuild.config.ts) are still
    // manifest targets: generateUiManifest needs only src/routes, and on a
    // fresh checkout no manifest.gen.json exists until something generates
    // it — gating on the rsbuild config left those uis ungenerated, so a
    // strict types gen failed the run on a source typegen itself should
    // have produced (the #558 class; same reason auth-ui is unconditional).
    if (plugin.ui?.source === "local" && uiPath && existsSync(join(uiPath, "src/routes"))) {
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
    forceRouteTree?: boolean;
    /** Strict runtime-map degradation (#594): an unresolvable remote manifest
     * fails the run instead of shrinking the map. `bos types gen` sets this —
     * dev/build/train paths degrade to a warning (a flaky remote must not
     * block a boot). */
    runtimeMapStrict?: boolean;
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

  for (const target of uiManifestTargets(runtimeConfig, opts?.forceRouteTree)) {
    if (target.pluginName === CORE_UI_PLUGIN_KEY) {
      yield* Effect.try({
        try: () => emitCoreUiStubs(target.workspaceRoot),
        catch: (cause) =>
          new ArtifactGenError({ phase: `emit ui stubs (${target.pluginName})`, cause }),
      });
    }
    yield* Effect.tryPromise({
      try: () => generateUiManifest(target),
      catch: (cause) =>
        new ArtifactGenError({ phase: `generate ui manifest (${target.pluginName})`, cause }),
    });
  }

  // The composition inspector (#591/#594): the generated effective route
  // tree — local manifests were just refreshed above; remote ones fetch from
  // the published `<ui>/manifest.gen.json`. Strict mode (`bos types gen`)
  // fails the run on an unresolvable map so typecheck catches an upstream
  // rename; dev/build/train paths warn and continue (a flaky remote must
  // not block a boot — the runtime load fails loudly on its own).
  yield* generateRuntimeMapEffect(configDir, runtimeConfig, {
    strict: opts?.runtimeMapStrict === true,
    env,
    platform: config.platform ?? null,
    ...(opts?.extendsChain ? { extendsChain: opts.extendsChain } : {}),
  }).pipe(
    Effect.catch((error) => {
      if (opts?.runtimeMapStrict === true) {
        return Effect.fail(new ArtifactGenError({ phase: "generate runtime map", cause: error }));
      }
      console.warn(
        `[runtime-map] generation failed — continuing: ${error instanceof Error ? error.message : String(error)}`,
      );
      return Effect.succeed(null);
    }),
  );

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
    forceRouteTree?: boolean;
  },
): Promise<(GeneratedArtifacts & { contractStatus: ContractBridgeStatus[] }) | null> {
  return Effect.runPromise(generateCodeArtifactsEffect(configDir, config, opts));
}
