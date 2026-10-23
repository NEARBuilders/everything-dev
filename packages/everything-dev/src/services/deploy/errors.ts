import { Data } from "effect";
import type { WorkspaceDeployResult } from "../../contract";
import type { BosConfigInput } from "../../types";

/**
 * The publish train's typed error channel (ticket #422): every terminal
 * failure is a tagged instance carrying its leg identity — handlers map it to
 * the wire result shape mechanically via `toResult()` instead of matching
 * string errors. `kind` discriminates the failed leg; `error` is the
 * human-facing message (unchanged wording from the string-error era).
 */

export type TrainErrorKind =
  | "preflight"
  | "build"
  | "reload"
  | "config-state"
  | "upload"
  | "missing-manifest"
  | "memory-backend"
  | "config-write"
  | "pin-verification"
  | "platform-truth"
  | "sign"
  | "submit"
  | "confirm";

export interface PublishTrainOk {
  status: "published" | "dry-run";
  registryUrl: string;
  txHash?: string;
  built?: string[];
  skipped?: string[];
  publishConfig?: BosConfigInput;
  deployResults?: WorkspaceDeployResult[];
  fingerprint?: string;
  slotPins?: Record<string, string>;
}

/** The wire shape the train's caller sees on terminal failure. */
export interface PublishTrainFailureResult {
  status: "error";
  registryUrl: string;
  error: string;
  built?: string[];
  skipped?: string[];
  deployResults?: WorkspaceDeployResult[];
}

export class PublishTrainError extends Data.TaggedError("PublishTrainError")<{
  readonly kind: TrainErrorKind;
  readonly registryUrl: string;
  readonly error: string;
  readonly built?: string[];
  readonly skipped?: string[];
  readonly deployResults?: WorkspaceDeployResult[];
}> {
  toResult(): PublishTrainFailureResult {
    return {
      status: "error",
      registryUrl: this.registryUrl,
      error: this.error,
      ...(this.built !== undefined ? { built: this.built } : {}),
      ...(this.skipped !== undefined ? { skipped: this.skipped } : {}),
      ...(this.deployResults !== undefined ? { deployResults: this.deployResults } : {}),
    };
  }
}
