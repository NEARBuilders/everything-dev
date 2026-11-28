import { Effect, Layer, Queue, Stream } from "effect";
import type { RuntimeConfig } from "../../types";
import {
  encodeRuntimeConfig,
  type OrchestratorError,
  spawnDevProcess,
  spawnRemoteHost,
} from "../dev/orchestrator";
import {
  Supervisor,
  SupervisorError,
  type UnitEvent,
  type UnitHandle,
  type UnitSpec,
} from "./units";

/** A probe unit spawns nothing — the session's readiness poller is the whole
 * lifecycle. The handle is the trivial one. */
const probeEvents: Stream.Stream<UnitEvent> = Stream.empty;

export interface SupervisorInputs {
  readonly generatedEnv: Record<string, string>;
  readonly shellTier: Record<string, string>;
  readonly runtimeConfig: RuntimeConfig;
}

/** The live supervisor, parameterized by the bootstrap's env outputs (the
 * same data `DevRuntimeConfigLive`/`DevGeneratedEnvLive` consume). Env tiers
 * are captured once at layer build; child spawn input carries them forward. */
export const SupervisorLive = (inputs: SupervisorInputs): Layer.Layer<Supervisor> =>
  Layer.effect(
    Supervisor,
    Effect.gen(function* () {
      // A composition that can't serialize is a defect — the bootstrap
      // already serialized it once; the boot only re-encodes for child env.
      const runtimeConfigEnv = yield* encodeRuntimeConfig(inputs.runtimeConfig).pipe(Effect.orDie);
      const bridgeContext = yield* Effect.context<never>();
      const fail = (unit: UnitSpec, cause: unknown) =>
        new SupervisorError({
          unit: unit.name,
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        });

      return Supervisor.of({
        spawn: (unit) => {
          const payload = unit.payload;
          switch (payload._tag) {
            case "process":
              return spawnDevProcess({
                name: unit.name,
                command: payload.command,
                args: payload.args,
                cwd: payload.cwd,
                env: {},
                port: payload.port,
                generatedEnv: inputs.generatedEnv,
                shellTier: inputs.shellTier,
                runtimeConfigEnv,
              }).pipe(Effect.mapError((cause) => fail(unit, cause)));
            case "host-module":
              return Effect.gen(function* () {
                const logQueue = yield* Queue.unbounded<UnitEvent>();
                const handle = yield* spawnRemoteHost(
                  { key: unit.name, url: payload.remoteUrl, runtimeConfig: inputs.runtimeConfig },
                  {
                    onLog: (name, line, isError) => {
                      // fire-and-forget bridge out of a bare callback — the
                      // layer's runtime context carries the services.
                      void Effect.runPromiseWith(bridgeContext)(
                        Queue.offer(logQueue, { type: "log", line, stderr: Boolean(isError) }).pipe(
                          Effect.ignore,
                        ),
                      );
                    },
                    onStatus: () => {},
                  },
                ).pipe(Effect.mapError((cause) => fail(unit, cause as OrchestratorError)));
                return {
                  pid: handle.pid,
                  events: Stream.merge(handle.events, Stream.fromQueue(logQueue)),
                  terminate: handle.terminate,
                } satisfies UnitHandle;
              });
            case "probe":
              return Effect.succeed({
                pid: undefined,
                events: probeEvents,
                terminate: () => Effect.void,
              } satisfies UnitHandle);
          }
        },
      });
    }),
  );
