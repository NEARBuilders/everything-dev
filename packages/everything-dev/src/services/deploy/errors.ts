import { Data } from "effect";
import type { WorkspaceDeployResult } from "../../contract";
import type { BosConfigInput } from "../../types";
import type { PublishedDiff } from "./changed-slots";

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
  | "composition"
  | "pin-verification"
  | "platform-manifest"
  | "platform-truth"
  | "compat-window"
  | "sign"
  | "submit"
  | "confirm";

export interface PublishTrainOk {
  status: "published" | "dry-run";
  registryUrl: string;
  txHash?: string;
  /** The txHash as a nearblocks explorer link, resolved against the train's
   * network — the summary prints the link, never the bare hash. */
  txUrl?: string;
  built?: string[];
  skipped?: string[];
  publishConfig?: BosConfigInput;
  deployResults?: WorkspaceDeployResult[];
  pointerDigest?: string;
  remoteDigests?: Record<string, string>;
  /** The release classifier's decision (#571/#573) — threads to the image
   * leg so version tags move on the release deploy only. */
  releaseLeg?: boolean;
  /** The framework version the release leg published (release trains only)
   * — the post-publish smoke's manifest leg verifies the pointer serves it. */
  frameworkVersion?: string;
  /** The published-config diff vs the previously live config (#826 follow-up)
   * — the Railway leg's ui-only skip decision. Undefined when the live
   * config was unreadable (first publish, registry offline): the legs then
   * read cold and redeploy. */
  diff?: PublishedDiff;
}

/** The wire shape the train's caller sees on terminal failure. */
export interface PublishTrainFailureResult {
  status: "error";
  registryUrl: string;
  error: string;
  /** The failed leg's identity — the CLI's failure block keys its
   * why-it-matters / what-to-do guidance off this. */
  kind?: TrainErrorKind;
  txHash?: string;
  built?: string[];
  skipped?: string[];
  deployResults?: WorkspaceDeployResult[];
}

export class PublishTrainError extends Data.TaggedError("PublishTrainError")<{
  readonly kind: TrainErrorKind;
  readonly registryUrl: string;
  readonly error: string;
  /** The broadcast hash, when the train died after submitting (confirm) —
   * the failure block links it on nearblocks. */
  readonly txHash?: string;
  readonly built?: string[];
  readonly skipped?: string[];
  readonly deployResults?: WorkspaceDeployResult[];
}> {
  toResult(): PublishTrainFailureResult {
    return {
      status: "error",
      registryUrl: this.registryUrl,
      error: this.error,
      kind: this.kind,
      ...(this.txHash !== undefined ? { txHash: this.txHash } : {}),
      ...(this.built !== undefined ? { built: this.built } : {}),
      ...(this.skipped !== undefined ? { skipped: this.skipped } : {}),
      ...(this.deployResults !== undefined ? { deployResults: this.deployResults } : {}),
    };
  }
}
