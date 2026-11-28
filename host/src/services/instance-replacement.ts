import { Context, Effect, Layer } from "effect";
import { logger } from "../utils/logger";

/**
 * The replacement actuator the reconciler drives when a published generation
 * is held (issue #941, on the ADR 0049 plane split): boot-frozen backends
 * cannot reload in-process, so the generation moves by replacing the
 * instance — the replacement boots the published pointer whole (UI and
 * backends together), with the ADR 0041 approved-snapshot rung serving it
 * if the registry is unreachable mid-window. The default adapter terminates
 * THIS instance gracefully (SIGTERM to self — the same path a container
 * stop takes) and leaves the replacement to the supervisor's restart policy;
 * a hosting adapter provides its own blue/green layer at this seam instead.
 */
export class InstanceReplacement extends Context.Service<
  InstanceReplacement,
  {
    /** Commit the replacement of this instance for the held generation. */
    readonly replace: (held: readonly string[]) => Effect.Effect<void>;
  }
>()("host/InstanceReplacement") {
  static readonly layer = Layer.succeed(
    InstanceReplacement,
    InstanceReplacement.of({
      replace: (held) =>
        Effect.sync(() => {
          logger.warn(
            `[InstanceReplacement] replacing the instance — the published generation moved ${held.join(", ")} and backends cannot reload in-process; terminating so the supervisor's replacement boots it whole`,
          );
          process.kill(process.pid, "SIGTERM");
        }),
    }),
  );
}
