import type { Layer } from "effect";
import type { DevRenderer } from "../dev/render";
import type { BootSpec } from "./types";

/** Stage-2 strangler (docs/plans/boot-seam.md): `bootRuntime` is the public
 * boot surface and delegates to the existing session runner. Stage 3 replaces
 * the delegation with the supervision core; from here on the surface — and
 * the container exit contract the deploy smoke consumes — is stable. */
export const bootRuntime = async (
  spec: BootSpec,
  renderer: Layer.Layer<DevRenderer>,
): Promise<void> => {
  const { devApp } = await import("../dev/session");
  return devApp(spec.dir, spec.data, renderer);
};
