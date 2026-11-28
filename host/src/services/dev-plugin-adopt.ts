import path from "node:path";
import { Effect, type Scope } from "effect";
import {
  type AdoptState,
  advanceAdopt,
  type BackendDistFingerprint,
  createBackendFingerprintSampler,
  DEV_ADOPT_POLL_MS,
  DEV_ADOPT_SETTLE_MS,
  initialAdoptState,
} from "everything-dev/dev-adopt";
import type { RuntimeConfig } from "everything-dev/types";
import type { PluginRpcServing } from "../routes/api";
import { logger } from "../utils/logger";
import type { HostPluginEntry, PluginResult } from "./plugins";
import { describeCauseChain } from "./snapshot-watch";

/**
 * The dev serving plane's adopt set (issue #942): plugin children the host
 * federation-loads in-process. The `api` and `auth` app slots keep their
 * boot-frozen serving (their routers mount through the api handler, the MCP
 * route, and the session middleware — a live swap there re-architects the
 * routes layer, not the adopt), and call-only attachments never load.
 */
export const localPluginSlots = (
  config: RuntimeConfig,
  loaded: PluginResult["plugins"],
): string[] => {
  const slots: string[] = [];
  for (const [key, plugin] of Object.entries(config.plugins ?? {})) {
    if (plugin.source !== "local" || !plugin.localPath) continue;
    const record = loaded[key];
    if (!record || record.proxy) continue;
    slots.push(key);
  }
  return slots;
};

export interface DevAdoptSample {
  readonly key: string;
  readonly label: string;
  readonly fingerprint: BackendDistFingerprint | null;
}

export interface DevAdoptTickDeps {
  /** Sample every watched workspace's built dist (one sampler per slot). */
  readonly samples: () => Promise<readonly DevAdoptSample[]>;
  /** Commit the adopt: reload the plugin's in-process instance and swap the
   * serving cell. Failure keeps the old generation serving and the move
   * re-owed on the next tick. */
  readonly reload: (key: string) => Promise<void>;
  readonly logMove: (line: string) => void;
  readonly logFailure: (line: string) => void;
  /** The settle window and the clock — seams for the tick tests. */
  readonly settleMs?: number;
  readonly now?: () => number;
}

/**
 * One dev adopt tick (issue #942): sample → settle → reload each moved
 * plugin. The state machine (shared with the dev supervisor's child
 * replacement) commits a move only after the new dist content has been
 * stable for the settle window; a failed reload rolls the served entry back
 * so the next tick re-owes the move — the coherent old generation keeps
 * serving until the fresh one loads whole.
 */
export const runDevAdoptTick = (deps: DevAdoptTickDeps, state: AdoptState) =>
  Effect.gen(function* () {
    const samples = yield* Effect.tryPromise(deps.samples).pipe(
      Effect.catch((cause) => {
        deps.logFailure(
          `[DevPluginAdopt] dist sampling failed — keeping the serving generation: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
        return Effect.succeed(null);
      }),
    );
    if (!samples) return state;

    const advanced = advanceAdopt(state, {
      now: (deps.now ?? Date.now)(),
      settleMs: deps.settleMs ?? DEV_ADOPT_SETTLE_MS,
      observations: samples.map((sample) => ({
        key: sample.key,
        fingerprint: sample.fingerprint,
      })),
    });
    if (advanced.moves.length === 0) return advanced.state;

    let working = advanced.state;
    for (const move of advanced.moves) {
      const sample = samples.find((candidate) => candidate.key === move.key);
      const label = sample?.label ?? move.key;
      const previous = state.served.get(move.key);
      const committed = yield* Effect.tryPromise(() => deps.reload(move.key)).pipe(
        Effect.match({
          onSuccess: () => true,
          onFailure: (cause) => {
            deps.logFailure(
              `[DevPluginAdopt] ${label} reload failed — keeping the serving generation: ${describeCauseChain(cause)}`,
            );
            return false;
          },
        }),
      );
      if (!committed) {
        const served = new Map(working.served);
        if (previous) served.set(move.key, previous);
        else served.delete(move.key);
        working = { ...working, served };
        continue;
      }
      deps.logMove(`[DevPluginAdopt] ${label} moved to generation ${move.generation}`);
    }
    return working;
  });

const workspaceLabel = (localPath: string): string => {
  const relative = path.relative(process.cwd(), localPath);
  if (relative && !relative.startsWith("..")) return relative;
  return path.basename(localPath);
};

/**
 * The dev host's adopt loop (issue #942): the host federation-loads plugin
 * children in-process, so a plugin rebuild reaches serving only through a
 * reload HERE — the dev supervisor's child replacement refreshes the child
 * processes, not the host's containers. Dev only (config.env), and never in
 * proxy mode (nothing is loaded to adopt). The loop owns the generation
 * state; each tick reloads moved plugins sequentially and swaps the serving
 * cell atomically — a request either opens on the old generation's handler
 * or the new one, never a mix. This is the dev plane's analogue of the
 * production reconciler's instance replacement (issue #941) — the two never
 * arm together: the reconciler is production-only, this loop is dev-only.
 */
export const forkDevPluginAdopt = (input: {
  readonly config: RuntimeConfig;
  readonly plugins: PluginResult;
  readonly serving: PluginRpcServing;
  readonly intervalMs?: number;
}): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    if (input.config.env !== "development") return;
    if (!input.plugins.runtime) return;

    const slots = localPluginSlots(input.config, input.plugins.plugins);
    if (slots.length === 0) return;

    const samplers = new Map<string, () => Promise<BackendDistFingerprint | null>>();
    for (const key of slots) {
      const localPath = input.config.plugins?.[key]?.localPath;
      if (!localPath) continue;
      samplers.set(key, createBackendFingerprintSampler(localPath));
    }
    if (samplers.size === 0) return;

    const intervalMs = input.intervalMs ?? DEV_ADOPT_POLL_MS;
    const pluginRuntime = input.plugins.runtime;
    const reload = async (key: string): Promise<void> => {
      const record: HostPluginEntry | undefined = input.plugins.plugins[key];
      const loadArgs = record?.loadArgs;
      if (!record || !loadArgs) {
        throw new Error(`no captured load args for ${key} — cannot reload`);
      }
      const fresh = (await pluginRuntime.reloadPlugin(
        loadArgs.runtimeId,
        loadArgs.config as never,
        loadArgs.plugins,
      )) as unknown as {
        createClient: (context?: unknown) => unknown;
        router: unknown;
        metadata: { remoteUrl: string; version?: string };
        initialized?: { effectContext?: unknown; warnings?: unknown };
      };
      const updated: HostPluginEntry = {
        ...record,
        createClient: fresh.createClient,
        router: fresh.router,
        metadata: fresh.metadata,
        initialized: fresh.initialized as HostPluginEntry["initialized"],
        loadArgs,
      };
      input.plugins.plugins[key] = updated;
      input.serving.swap(key, updated.router, fresh.initialized?.effectContext);
    };

    logger.info(
      `[DevPluginAdopt] armed — watching ${[...samplers.keys()].join(", ")} for rebuilt plugin generations (poll ${intervalMs}ms)`,
    );

    let state = initialAdoptState;
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        while (true) {
          const tick = runDevAdoptTick(
            {
              samples: async () =>
                Promise.all(
                  [...samplers.entries()].map(async ([key, sample]) => ({
                    key,
                    label: workspaceLabel(input.config.plugins?.[key]?.localPath ?? key),
                    fingerprint: await sample(),
                  })),
                ),
              reload,
              logMove: (line) => logger.info(line),
              logFailure: (line) => logger.warn(line),
            },
            state,
          );
          const outcome = yield* tick.pipe(
            Effect.catchDefect((defect) =>
              Effect.logError(
                "[DevPluginAdopt] tick defect — the loop continues with the served generation:",
                defect,
              ).pipe(Effect.as(state)),
            ),
          );
          state = outcome;
          yield* Effect.sleep(`${intervalMs} millis`);
        }
      }),
    );
  });
