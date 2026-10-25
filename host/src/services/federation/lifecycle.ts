import { Context, Effect, Layer } from "effect";
import { UiComposer } from "../ui-composer";
import { FederationContainers } from "./containers";
import { FederationLoader } from "./loader";

/**
 * The federation seam's umbrella: one layer for the host's server wiring and
 * one tag the server effect yields to tie the services to its scope. The
 * per-service finalizers (composition instance teardown, scoped container
 * servers) run when the owning scope closes — there is no global disposal.
 */
export class FederationLifecycle extends Context.Service<FederationLifecycle, undefined>()(
  "host/FederationLifecycle",
) {
  static readonly layer = Layer.mergeAll(
    FederationLoader.layer,
    FederationContainers.layer,
    UiComposer.layer,
    Layer.effect(FederationLifecycle, Effect.succeed(FederationLifecycle.of(undefined))),
  );
}
