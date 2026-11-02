/**
 * Owed-work detection (#571): the train derives release work from live
 * state — npm registry reads and the FastKV platform-manifest pointer —
 * never git history. Two facts decide the release leg:
 *
 * - `npmOwed` — a publishable workspace's version is not on npm yet
 * - `manifestOwed` — the published pointer's frameworkVersion trails the
 *   repo's (or no pointer exists at all)
 *
 * Unknown states (npm unreachable, FastKV read failure) never block: they
 * read as not-owed, matching the preflight npm gate's tolerance. The
 * cross-check — owed on one side only, with a completed release cycle on
 * record — is drift and fails the train loudly (#568's silent-skip class).
 */

import { compareSemver as compareVersions } from "../../utils/semver";

/** Tri-state pointer read: `present` (a completed release cycle exists),
 * `absent` (read succeeded, no slot — a first release), or `unknown` (the
 * read itself failed). */
export interface PointerRead {
  state: "absent" | "present" | "unknown";
  frameworkVersion?: string;
}

export interface OwedWorkDetail {
  /** Publishable workspaces whose version npm does not serve yet. */
  unpublished: Array<{ name: string; version: string }>;
  localFrameworkVersion?: string;
  /** The published pointer's frameworkVersion — absent when no pointer exists. */
  pointerFrameworkVersion?: string;
  /** The pointer read succeeded and found a slot — a completed release cycle. */
  pointerExists: boolean;
}

export interface OwedWork {
  npmOwed: boolean;
  manifestOwed: boolean;
  /** The release leg — any owed work. Drives release-conditional image tags. */
  release: boolean;
  detail: OwedWorkDetail;
}

export type UnpublishedPackage = { name: string; version: string };

/**
 * The pure decision core — no I/O. `pointer` is tri-state; `unpublished` is
 * optional (the npm leg is not consulted everywhere: the deploy train's
 * preflight npm gate already hard-fails unpublished versions before the
 * build, so in-train the release classifier is the pointer alone).
 */
export function computeOwedWork(input: {
  pointer: PointerRead;
  localFrameworkVersion?: string;
  unpublished?: UnpublishedPackage[];
}): OwedWork {
  const unpublished = input.unpublished ?? [];
  const npmOwed = unpublished.length > 0;
  const { pointer, localFrameworkVersion } = input;
  const manifestOwed =
    pointer.state === "unknown"
      ? false
      : pointer.state === "absent"
        ? Boolean(localFrameworkVersion)
        : Boolean(
            localFrameworkVersion &&
              pointer.frameworkVersion !== undefined &&
              compareVersions(pointer.frameworkVersion, localFrameworkVersion) < 0,
          );
  return {
    npmOwed,
    manifestOwed,
    release: npmOwed || manifestOwed,
    detail: {
      unpublished,
      ...(localFrameworkVersion ? { localFrameworkVersion } : {}),
      ...(pointer.frameworkVersion ? { pointerFrameworkVersion: pointer.frameworkVersion } : {}),
      pointerExists: pointer.state === "present",
    },
  };
}
