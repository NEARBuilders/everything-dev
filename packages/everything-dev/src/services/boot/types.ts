import { Data } from "effect";
import type { DevSessionData } from "../dev/session";

export type BootMode = "dev" | "start";

/** Everything the bootstrap (control plane) produced; the boot only
 * supervises (ADR 0043 — the runtime plane's only input). */
export interface BootSpec {
  readonly mode: BootMode;
  readonly dir: string;
  readonly data: DevSessionData;
}

/** A production-like boot failed: the named units did not start or never
 * became ready. `runApp` maps a failed session to exit 1, so in the runtime
 * image the container's death is the boot verdict the deploy smoke consumes.
 * Development sessions never fail with this — they tolerate a partial start
 * (DevStartFailure's tolerance split, now under this name). */
export class BootFailure extends Data.TaggedError("BootFailure")<{
  readonly failed: readonly string[];
}> {
  override get message() {
    return `boot failed — services did not start: ${this.failed.join(", ")}`;
  }
}
