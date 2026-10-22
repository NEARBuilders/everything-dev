import { Context, Data, Effect, Layer } from "effect";
import { HostingAdapter, type RuntimeDescriptor } from "everything-dev/hosting";
import { withSecrets } from "everything-dev/hosting/secrets";
import {
  type DeployHistoryReadError,
  DeployHistoryService,
  type DeploySummary,
} from "./deploy-history";
import { ReconcilerStatusSchema } from "./reconciler-schema";
import { provisionRuntimeDatabases, type RuntimeProvisionError } from "./runtime-databases";
import { SecretsStore, type SecretsStoreError } from "./secrets-store";

export { ReconcilerStatusSchema };

export const DEFAULT_POLL_INTERVAL_MS = 15000;
const MIN_POLL_INTERVAL_MS = 1000;

export interface ReconcilerWatchEntry {
  readonly account: string;
  readonly gateway: string;
  readonly instance?: string | undefined;
  readonly image?: string | undefined;
}

export interface ReconcilerConfig {
  readonly watch: readonly ReconcilerWatchEntry[];
  readonly pollIntervalMs: number;
}

export interface NamespaceReconcileState {
  readonly account: string;
  readonly gateway: string;
  readonly instance: string;
  lastSeenFingerprint: string | undefined;
  convergedFingerprint: string | undefined;
  bootAssumed: boolean;
  drift: { reason: string; at: string } | undefined;
  instanceUrl: string | undefined;
  lastCheckedAt: string | undefined;
  lastConvergedAt: string | undefined;
}

export interface ReconcilerStatusSnapshot {
  readonly enabled: boolean;
  readonly pollIntervalMs: number;
  readonly namespaces: NamespaceReconcileState[];
}

export type ReconcileDecision =
  | { readonly action: "noop" }
  | { readonly action: "baseline"; readonly fingerprint: string }
  | { readonly action: "converge"; readonly fingerprint: string };

export function decideReconcile(
  state: { running: boolean | undefined; converged: string | undefined },
  latest: string | undefined,
): ReconcileDecision {
  if (latest === undefined) return { action: "noop" };
  if (state.converged === undefined) {
    if (state.running === true) return { action: "baseline", fingerprint: latest };
    return { action: "converge", fingerprint: latest };
  }
  return latest === state.converged
    ? { action: "noop" }
    : { action: "converge", fingerprint: latest };
}

export const instanceNameFor = (entry: ReconcilerWatchEntry): string =>
  entry.instance ?? `hosted-${entry.account}-${entry.gateway}`;

const describeError = (error: unknown): string => {
  const record = error as { message?: unknown; reason?: unknown; _tag?: unknown } | null;
  if (typeof record?.message === "string" && record.message) return record.message;
  if (typeof record?.reason === "string" && record.reason) return record.reason;
  if (typeof record?._tag === "string" && record._tag) return record._tag;
  return String(error);
};

export class ReconcileConvergenceError extends Data.TaggedError("ReconcileConvergenceError")<{
  message: string;
  cause?: unknown;
}> {}

export interface ReconcilerDeps {
  readonly history: {
    readonly listDeploys: (input: {
      account: string;
      gateway: string;
      limit: number;
    }) => Effect.Effect<DeploySummary[], DeployHistoryReadError>;
  };
  readonly secrets: {
    readonly resolve: (input: {
      account: string;
      gateway: string;
      names?: string[] | undefined;
    }) => Effect.Effect<Record<string, string>, SecretsStoreError>;
  };
  readonly adapter: HostingAdapter["Service"];
  readonly provisionDatabases?:
    | ((input: {
        account: string;
        gateway: string;
        platformUrl: string;
      }) => Effect.Effect<Record<string, string>, RuntimeProvisionError>)
    | undefined;
  readonly platformDatabaseUrl?: string | undefined;
}

const namespaceKey = (entry: ReconcilerWatchEntry): string => `${entry.account}/${entry.gateway}`;

export function buildReconciler(
  deps: ReconcilerDeps,
  config: ReconcilerConfig,
): {
  status: () => Effect.Effect<ReconcilerStatusSnapshot>;
  tick: () => Effect.Effect<ReconcilerStatusSnapshot>;
} {
  const pollIntervalMs = Math.max(MIN_POLL_INTERVAL_MS, config.pollIntervalMs);
  const now = (): string => new Date().toISOString();

  const states = new Map<string, NamespaceReconcileState>();
  for (const entry of config.watch) {
    states.set(namespaceKey(entry), {
      account: entry.account,
      gateway: entry.gateway,
      instance: instanceNameFor(entry),
      lastSeenFingerprint: undefined,
      convergedFingerprint: undefined,
      bootAssumed: false,
      drift: undefined,
      instanceUrl: undefined,
      lastCheckedAt: undefined,
      lastConvergedAt: undefined,
    });
  }

  const snapshot = (): ReconcilerStatusSnapshot => ({
    enabled: true,
    pollIntervalMs,
    namespaces: [...states.values()]
      .sort((a, b) => namespaceKey(a).localeCompare(namespaceKey(b)))
      .map((state) => ({ ...state, drift: state.drift ? { ...state.drift } : undefined })),
  });

  const latestDeploy = (entry: ReconcilerWatchEntry) =>
    deps.history
      .listDeploys({ account: entry.account, gateway: entry.gateway, limit: 1 })
      .pipe(Effect.map((rows) => rows[0]));

  const observeInstance = (entry: ReconcilerWatchEntry) =>
    deps.adapter.current(instanceNameFor(entry));

  const markDrift = (entry: ReconcilerWatchEntry, reason: string): void => {
    const state = states.get(namespaceKey(entry));
    if (state) state.drift = { reason, at: now() };
  };

  const reconcileNamespace = (entry: ReconcilerWatchEntry) =>
    Effect.gen(function* () {
      const key = namespaceKey(entry);
      const state = states.get(key);
      if (!state) return;

      const row = yield* latestDeploy(entry);
      state.lastCheckedAt = now();
      if (row?.fingerprint !== undefined) state.lastSeenFingerprint = row.fingerprint;

      let running: boolean | undefined;
      if (state.convergedFingerprint === undefined && row) {
        const observed = yield* observeInstance(entry);
        running = observed.running;
      }

      const decision = decideReconcile(
        { running, converged: state.convergedFingerprint },
        row?.fingerprint,
      );

      if (decision.action === "baseline") {
        state.convergedFingerprint = decision.fingerprint;
        state.bootAssumed = true;
        state.drift = undefined;
        return;
      }

      if (decision.action === "converge") {
        if (!row) return;
        const fingerprint = decision.fingerprint;
        const image = entry.image ?? row.imageRef;
        if (!image) {
          return yield* new ReconcileConvergenceError({
            message: `no image pin in force for ${entry.account}/${entry.gateway} — publish a platform manifest or set the watch entry's image`,
          });
        }
        const provisioned = deps.provisionDatabases
          ? yield* deps
              .provisionDatabases({
                account: entry.account,
                gateway: entry.gateway,
                platformUrl: deps.platformDatabaseUrl ?? "",
              })
              .pipe(
                Effect.catch((error) =>
                  Effect.fail(
                    new ReconcileConvergenceError({
                      message: describeError(error),
                      cause: error,
                    }),
                  ),
                ),
              )
          : {};
        const baseDescriptor: RuntimeDescriptor = {
          instance: state.instance,
          image,
          identityEnv: {
            BOS_ACCOUNT: entry.account,
            BOS_GATEWAY: entry.gateway,
            ...provisioned,
          },
        };
        const stored = yield* deps.secrets.resolve({
          account: entry.account,
          gateway: entry.gateway,
        });
        const descriptor = withSecrets(baseDescriptor, stored);
        const deployed = yield* deps.adapter.deploy(descriptor);
        state.convergedFingerprint = fingerprint;
        state.bootAssumed = false;
        state.instanceUrl = deployed.url;
        state.lastConvergedAt = now();
        state.drift = undefined;
        return;
      }

      const observed = yield* observeInstance(entry);
      if (observed.running) {
        state.drift = undefined;
        return;
      }
      const healed = yield* deps.adapter.restart(state.instance);
      state.instanceUrl = healed.url;
      state.drift = undefined;
    }).pipe(Effect.catch((error) => Effect.sync(() => markDrift(entry, describeError(error)))));

  const tick = Effect.gen(function* () {
    for (const entry of config.watch) {
      yield* reconcileNamespace(entry);
    }
    return snapshot();
  });

  return { status: () => Effect.succeed(snapshot()), tick: () => tick };
}

export class ReconcilerService extends Context.Service<
  ReconcilerService,
  {
    status: () => Effect.Effect<ReconcilerStatusSnapshot>;
    tick: () => Effect.Effect<ReconcilerStatusSnapshot>;
  }
>()("api/ReconcilerService") {}

export const ReconcilerDisabled: Layer.Layer<ReconcilerService> = Layer.succeed(
  ReconcilerService,
  ReconcilerService.of({
    status: () =>
      Effect.succeed({
        enabled: false,
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
        namespaces: [],
      }),
    tick: () =>
      Effect.succeed({
        enabled: false,
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
        namespaces: [],
      }),
  }),
);

const loopEffect = (
  reconciler: {
    tick: () => Effect.Effect<ReconcilerStatusSnapshot>;
  },
  pollIntervalMs: number,
) =>
  Effect.gen(function* () {
    while (true) {
      yield* reconciler.tick();
      yield* Effect.sleep(pollIntervalMs);
    }
  });

export const ReconcilerLive = (config: ReconcilerConfig, platformDatabaseUrl?: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const history = yield* DeployHistoryService;
      const secrets = yield* SecretsStore;
      const adapter = yield* HostingAdapter;
      const reconciler = buildReconciler(
        {
          history,
          secrets,
          adapter,
          provisionDatabases: provisionRuntimeDatabases,
          platformDatabaseUrl,
        },
        config,
      );
      return Layer.mergeAll(
        Layer.succeed(ReconcilerService, ReconcilerService.of(reconciler)),
        Layer.effectDiscard(
          loopEffect(reconciler, Math.max(MIN_POLL_INTERVAL_MS, config.pollIntervalMs)).pipe(
            Effect.forkScoped,
          ),
        ),
      );
    }),
  );
