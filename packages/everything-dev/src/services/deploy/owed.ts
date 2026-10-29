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
import { fetchRegistryKeyOrNull } from "../registry/fastkv";
import { readFrameworkVersion } from "./image";
import { findUnpublishedFrameworkPackages } from "./preflight";

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

export interface OwedWorkDeps {
  npmPublished?: typeof findUnpublishedFrameworkPackages;
  fetchPointer?: (
    account: string,
    gateway: string,
  ) => Promise<{ frameworkVersion?: string } | null>;
}

/** The full I/O detection (npm + FastKV) — the workflow-level owed-work step.
 * The deploy train uses `computeOwedWork` directly on its own single pointer
 * read instead (one read, no duplicates). */
export async function detectOwedWork(
  input: { configDir: string; account?: string; gateway?: string },
  deps: OwedWorkDeps = {},
): Promise<OwedWork> {
  const npmPublished = deps.npmPublished ?? findUnpublishedFrameworkPackages;
  const fetchPointer =
    deps.fetchPointer ?? ((a: string, g: string) => fetchRegistryKeyOrNull(a, g, "platform.json"));

  let unpublished: UnpublishedPackage[] = [];
  try {
    unpublished = await npmPublished(input.configDir);
  } catch {
    // npm unreachable — unverifiable is not owed; never block the train
  }
  const localFrameworkVersion = readFrameworkVersion(input.configDir);

  let pointer: PointerRead = { state: "unknown" };
  if (input.account && input.gateway) {
    try {
      const value = await fetchPointer(input.account, input.gateway);
      pointer = value
        ? { state: "present", frameworkVersion: value.frameworkVersion }
        : { state: "absent" };
    } catch {
      // registry unreachable — unverifiable is not owed; never block the train
    }
  }

  return computeOwedWork({ pointer, localFrameworkVersion, unpublished });
}

/**
 * The root's in-train drift alarm: owed on exactly one side with a completed
 * release cycle on record means the last release half-landed — the #568
 * window (config + npm published, manifest pointer skipped, or the reverse).
 * Returns the human-readable drift, or undefined when consistent.
 */
export function owedWorkDrift(owed: OwedWork): string | undefined {
  if (!owed.detail.pointerExists) return undefined;
  if (owed.npmOwed === owed.manifestOwed) return undefined;
  const npmSide = owed.npmOwed
    ? `npm owes ${owed.detail.unpublished.map((p) => `${p.name}@${p.version}`).join(", ")}`
    : "npm serves every publishable version";
  const manifestSide = owed.manifestOwed
    ? `the platform-manifest pointer (${owed.detail.pointerFrameworkVersion ?? "unset"}) trails the repo (${owed.detail.localFrameworkVersion ?? "unknown"})`
    : `the platform-manifest pointer is current (${owed.detail.pointerFrameworkVersion})`;
  return `release-state drift: ${npmSide}, but ${manifestSide} — the last release half-landed; reconcile before deploying`;
}
