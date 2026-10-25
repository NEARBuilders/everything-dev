/**
 * Docker dev-substrate `HostingAdapter` (ADR 0035).
 *
 * Alchemy is the control plane, embedded programmatically: each instance is
 * one Alchemy stack holding a `Docker.Container` resource, evaluated
 * in-process through `alchemy/Deploy`'s `deploy()` — the same plan/apply and
 * state-ledger semantics as `alchemy deploy` without a CLI subprocess. The
 * choice was deliberate: `Deploy.deploy` is a public programmatic API and
 * alchemy's own test harness (`lib/Test/Core.js`) drives stacks exactly this
 * way, so idempotency comes from Alchemy's plan diffing (an unchanged
 * descriptor yields a no-op apply and never recreates the container) and the
 * ledger is Alchemy's local file state store under `stateDir`.
 * Stop/start/inspect go through the same provider's `Docker` service, so
 * every mutation flows through the one control plane — the adapter never
 * shells `docker` itself. Docker is the development/CI substrate only;
 * Railway and Fly adapters implement the same seam.
 *
 * The host port is deliberately ephemeral (`external: 0`): Docker binds a
 * free host port at container creation, the provider reports the resolved
 * mapping in the resource output, and the instance URL derives from it. The
 * binding is stable for the container's lifetime (stop/start preserves it);
 * only a re-create — i.e. a descriptor change — rebinds it.
 */

import * as Alchemy from "alchemy";
import { AlchemyContext, AlchemyContextLive, AuthProviders, Stack, Stage } from "alchemy";
import { AdoptPolicy } from "alchemy/AdoptPolicy";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import * as Deploy from "alchemy/Deploy";
import * as Docker from "alchemy/Docker";
import * as Interaction from "alchemy/Interaction";
import * as State from "alchemy/State";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import { Clock, Context, Duration, Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import {
  type DeployedInstance,
  DeployFailed,
  HealthTimeout,
  HostingAdapter,
  HostingOperationFailed,
  InstanceNotFound,
  type InstanceSnapshot,
  type RuntimeDescriptor,
} from "./adapter";

export interface DockerHostingOptions {
  /** Container port the runtime serves HTTP on. */
  readonly containerPort?: number | undefined;
  /** Path polled for readiness after deploy/restart. */
  readonly healthPath?: string | undefined;
  /** Bounded window for the readiness poll. */
  readonly healthTimeout?: Duration.Input | undefined;
  /** Interval between readiness polls. */
  readonly healthInterval?: Duration.Input | undefined;
  /** Alchemy state ledger directory (defaults to `<cwd>/.alchemy`). */
  readonly stateDir?: string | undefined;
  /** Adopt pre-existing containers instead of failing on conflicts. */
  readonly adopt?: boolean | undefined;
  /** Alchemy stage scoping the state ledger. */
  readonly stage?: string | undefined;
}

const DEFAULT_CONTAINER_PORT = 3000;
const DEFAULT_HEALTH_PATH = "/health";
const DEFAULT_HEALTH_TIMEOUT: Duration.Input = "90 seconds";
const DEFAULT_HEALTH_INTERVAL: Duration.Input = "500 millis";
const DEFAULT_STAGE = "local";

interface ContainerInspect {
  readonly State: { readonly Status: string };
  readonly Config: { readonly Image: string };
  readonly NetworkSettings: {
    readonly Ports?:
      | Record<string, ReadonlyArray<{ readonly HostIp: string; readonly HostPort: string }> | null>
      | null
      | undefined;
  };
}

const containerName = (instance: string): string =>
  `bos-hosting-${instance.replaceAll(/[^a-zA-Z0-9_.-]/g, "-").toLowerCase()}`;

const stackName = (instance: string): string => `BosHosting-${containerName(instance)}`;

const describeHostError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isNotFound = (error: unknown): boolean =>
  error instanceof Error &&
  "reason" in error &&
  (error as { reason?: { _tag?: string } }).reason?._tag === "NotFound";

const alchemyContextLayer = (options: DockerHostingOptions) =>
  Layer.effect(
    AlchemyContext,
    Layer.build(AlchemyContextLive).pipe(
      Effect.map((context) => Context.get(context, AlchemyContext)),
      Effect.orDie,
      Effect.map((context) =>
        AlchemyContext.of({
          ...context,
          dev: false,
          adopt: options.adopt ?? false,
          dotAlchemy: options.stateDir ?? context.dotAlchemy ?? ".alchemy",
        }),
      ),
    ),
  );

const platformLayer = Layer.mergeAll(PlatformServices, FetchHttpClient.layer);

const runtimeLayer = (options: DockerHostingOptions) =>
  Layer.mergeAll(
    alchemyContextLayer(options),
    Interaction.layerNonInteractive(),
    Layer.succeed(ArtifactStore, createArtifactStore()),
    Layer.succeed(AdoptPolicy, options.adopt ?? false),
    Layer.succeed(AuthProviders, {}),
    State.localState(),
  ).pipe(Layer.provideMerge(platformLayer));

const dockerServiceLayer = (options: DockerHostingOptions) =>
  // eslint-disable-next-line effecttsgo/any-unknown-in-error-context -- alchemy's Docker.providers types its layer R as any
  Docker.providers().pipe(
    Layer.provide(
      Layer.succeed(Stack, {
        name: stackName("shared"),
        stage: options.stage ?? DEFAULT_STAGE,
        resources: {},
        bindings: {},
        actions: {},
      }),
    ),
    Layer.provide(Layer.succeed(Stage, options.stage ?? DEFAULT_STAGE)),
  );

export const dockerHostingAdapterLayer = (options: DockerHostingOptions = {}) =>
  // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- alchemy's Docker.providers() requirements resolve as any under tsgo; the seam's R is closed by the provides below
  Layer.effect(
    HostingAdapter,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const docker = yield* Docker.Docker;
      const containerPort = options.containerPort ?? DEFAULT_CONTAINER_PORT;
      const healthPath = options.healthPath ?? DEFAULT_HEALTH_PATH;
      const stage = options.stage ?? DEFAULT_STAGE;
      const runtime = runtimeLayer(options);

      const hostPortOf = (info: ContainerInspect): number | undefined => {
        const bindings = info.NetworkSettings.Ports?.[`${containerPort}/tcp`];
        const hostPort = bindings?.[0]?.HostPort;
        return hostPort === undefined || hostPort === "" ? undefined : Number(hostPort);
      };

      const hostUrl = (hostPort: number): string => `http://127.0.0.1:${hostPort}`;

      const inspectInstance = (instance: string) =>
        docker.container.inspect(containerName(instance));

      const waitForHealth = Effect.fn("DockerHostingAdapter.waitForHealth")(function* (
        instance: string,
        url: string,
      ) {
        const timeoutMs = Duration.toMillis(
          Duration.fromInputUnsafe(options.healthTimeout ?? DEFAULT_HEALTH_TIMEOUT),
        );
        const interval = Duration.fromInputUnsafe(
          options.healthInterval ?? DEFAULT_HEALTH_INTERVAL,
        );
        const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
        let attempts = 0;
        while (true) {
          attempts += 1;
          const healthy = yield* http.execute(HttpClientRequest.get(`${url}${healthPath}`)).pipe(
            Effect.map((response) => response.status >= 200 && response.status < 300),
            Effect.orElseSucceed(() => false),
          );
          if (healthy) return url;
          if ((yield* Clock.currentTimeMillis) >= deadline) {
            return yield* new HealthTimeout({ instance, url, attempts });
          }
          yield* Effect.sleep(interval);
        }
      });

      const snapshotOf = (instance: string, info: ContainerInspect): InstanceSnapshot => {
        const running = info.State.Status === "running";
        const port = running ? hostPortOf(info) : undefined;
        return {
          instance,
          running,
          url: port === undefined ? undefined : hostUrl(port),
          image: info.Config.Image,
        };
      };

      const deployDescriptor = (descriptor: RuntimeDescriptor) =>
        Effect.gen(function* () {
          const name = containerName(descriptor.instance);
          const stack = Alchemy.Stack(
            stackName(descriptor.instance),
            {
              // eslint-disable-next-line effecttsgo/any-unknown-in-error-context -- alchemy's Docker.providers types its layer R as any
              providers: Docker.providers(),
              state: State.localState(),
            },
            Effect.gen(function* () {
              const container = yield* Docker.Container("runtime", {
                image: descriptor.image,
                name,
                environment: { ...descriptor.identityEnv },
                labels: { "bos.hosting/instance": descriptor.instance },
                ports: [{ external: 0, internal: containerPort }],
                start: true,
                restart: "no",
              });
              return { container };
            }),
          );
          yield* Deploy.deploy({ stack, stage, dev: false }).pipe(
            Effect.provide(runtime),
            Effect.mapError(
              (error) =>
                new DeployFailed({
                  instance: descriptor.instance,
                  reason: describeHostError(error),
                }),
            ),
          );
          const info = yield* inspectInstance(descriptor.instance).pipe(
            Effect.mapError(
              (error) =>
                new DeployFailed({
                  instance: descriptor.instance,
                  reason: describeHostError(error),
                }),
            ),
          );
          const port = hostPortOf(info);
          if (port === undefined) {
            return yield* new DeployFailed({
              instance: descriptor.instance,
              reason: `container published no host port for ${containerPort}/tcp`,
            });
          }
          const url = hostUrl(port);
          yield* waitForHealth(descriptor.instance, url);
          return { instance: descriptor.instance, url };
        });

      const current = (instance: string) =>
        inspectInstance(instance).pipe(
          Effect.map((info) => snapshotOf(instance, info)),
          Effect.catchTag(
            "PlatformError",
            (error): Effect.Effect<InstanceSnapshot, HostingOperationFailed> =>
              isNotFound(error)
                ? Effect.succeed({ instance, running: false, url: undefined, image: undefined })
                : Effect.fail(
                    new HostingOperationFailed({
                      instance,
                      operation: "current",
                      reason: describeHostError(error),
                    }),
                  ),
          ),
        );

      const restart = (
        instance: string,
      ): Effect.Effect<
        DeployedInstance,
        InstanceNotFound | HealthTimeout | HostingOperationFailed
      > =>
        Effect.gen(function* () {
          const info = yield* inspectInstance(instance);
          if (info.State.Status === "running") {
            yield* docker.container.stop(containerName(instance));
          }
          yield* docker.container.start(containerName(instance));
          const after = yield* inspectInstance(instance);
          const port = hostPortOf(after);
          if (port === undefined) {
            return yield* new HostingOperationFailed({
              instance,
              operation: "restart",
              reason: `container published no host port for ${containerPort}/tcp`,
            });
          }
          const url = hostUrl(port);
          yield* waitForHealth(instance, url);
          return { instance, url };
        }).pipe(
          Effect.catchTag(
            "PlatformError",
            (error): Effect.Effect<DeployedInstance, InstanceNotFound | HostingOperationFailed> =>
              isNotFound(error)
                ? Effect.fail(new InstanceNotFound({ instance }))
                : Effect.fail(
                    new HostingOperationFailed({
                      instance,
                      operation: "restart",
                      reason: describeHostError(error),
                    }),
                  ),
          ),
        );

      const stop = (instance: string) =>
        docker.container.stop(containerName(instance)).pipe(
          Effect.asVoid,
          Effect.catchTag(
            "PlatformError",
            (error): Effect.Effect<void, InstanceNotFound | HostingOperationFailed> =>
              isNotFound(error)
                ? Effect.fail(new InstanceNotFound({ instance }))
                : Effect.fail(
                    new HostingOperationFailed({
                      instance,
                      operation: "stop",
                      reason: describeHostError(error),
                    }),
                  ),
          ),
        );

      return HostingAdapter.of({ deploy: deployDescriptor, current, restart, stop });
    }),
  ).pipe(
    // eslint-disable-next-line effecttsgo/any-unknown-in-error-context -- alchemy's Docker.providers types its layer R as any
    Layer.provide(dockerServiceLayer(options)),
    Layer.provide(runtimeLayer(options)),
  ) as Layer.Layer<HostingAdapter>;
