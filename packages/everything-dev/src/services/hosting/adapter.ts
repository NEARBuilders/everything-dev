import { Context, type Effect, Schema } from "effect";

/**
 * The deploy console's single substrate coupling (ADR 0035): operating a
 * runtime instance — boot an image with identity env, observe it, restart it,
 * stop it — expressed in platform vocabulary only. No substrate resource
 * types, ports, networks, or machine ids cross this seam; implementations
 * return a URL and keep the derivation private.
 */

export interface RuntimeDescriptor {
  /** Stable logical instance name, unique per hosting namespace. */
  readonly instance: string;
  /** OCI image reference, digest-pinned in production. */
  readonly image: string;
  /**
   * Identity env forwarded verbatim (BOS_ACCOUNT / BOS_GATEWAY today). The
   * adapter never interprets these values.
   */
  readonly identityEnv: Readonly<Record<string, string>>;
}

export interface DeployedInstance {
  readonly instance: string;
  /** Where the instance serves traffic after a health-gated boot. */
  readonly url: string;
}

export interface InstanceSnapshot {
  readonly instance: string;
  readonly running: boolean;
  /** Present only while the instance is running and health-known. */
  readonly url: string | undefined;
  readonly image: string | undefined;
}

export class DeployFailed extends Schema.TaggedError<DeployFailed>()("DeployFailed", {
  instance: Schema.String,
  reason: Schema.String,
}) {}

export class HealthTimeout extends Schema.TaggedError<HealthTimeout>()("HealthTimeout", {
  instance: Schema.String,
  url: Schema.String,
  attempts: Schema.Finite,
}) {}

export class InstanceNotFound extends Schema.TaggedError<InstanceNotFound>()("InstanceNotFound", {
  instance: Schema.String,
}) {}

export class HostingOperationFailed extends Schema.TaggedError<HostingOperationFailed>()(
  "HostingOperationFailed",
  {
    instance: Schema.String,
    operation: Schema.String,
    reason: Schema.String,
  },
) {}

export class HostingAdapter extends Context.Service<
  HostingAdapter,
  {
    /**
     * Converge the instance to the descriptor (idempotent for an unchanged
     * descriptor), then health-gate before returning its URL.
     */
    deploy(
      descriptor: RuntimeDescriptor,
    ): Effect.Effect<DeployedInstance, DeployFailed | HealthTimeout>;
    /** Observe the instance without mutating it. Unknown instances report `running: false`. */
    current(instance: string): Effect.Effect<InstanceSnapshot, HostingOperationFailed>;
    /**
     * Restart the instance (starting it when stopped) and health-gate again.
     * Fails for an instance that has never been deployed.
     */
    restart(
      instance: string,
    ): Effect.Effect<DeployedInstance, InstanceNotFound | HealthTimeout | HostingOperationFailed>;
    /** Stop the instance. Fails for an instance that has never been deployed. */
    stop(instance: string): Effect.Effect<void, InstanceNotFound | HostingOperationFailed>;
  }
>()("hosting/HostingAdapter") {}

export type HostingAdapterService = HostingAdapter["Service"];
