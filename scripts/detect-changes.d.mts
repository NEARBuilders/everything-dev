export interface DetectInputs {
  event: "pull_request" | "workflow_dispatch" | "push";
  /** The PR head branch — the changeset-release fast path keys on it. */
  prHeadRef?: string;
  /** Changed paths; CLI callers compute these via git before calling. */
  files?: string[];
}

export type DetectOutputs = Record<string, string>;

export declare function detect(inputs: DetectInputs): DetectOutputs;

export declare const PATH_GROUPS: Record<string, string[]>;
