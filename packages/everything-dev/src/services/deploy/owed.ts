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

import { fetchRegistryKeyOrNull } from "../registry/fastkv";
import { readFrameworkVersion } from "./image";
import { findUnpublishedFrameworkPackages } from "./preflight";

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

export interface OwedWorkDeps {
  npmPublished?: typeof findUnpublishedFrameworkPackages;
  fetchPointer?: (
    account: string,
    gateway: string,
  ) => Promise<{ frameworkVersion?: string } | null>;
}

export async function detectOwedWork(
  input: { configDir: string; account?: string; gateway?: string },
  deps: OwedWorkDeps = {},
): Promise<OwedWork> {
  const npmPublished = deps.npmPublished ?? findUnpublishedFrameworkPackages;
  const fetchPointer =
    deps.fetchPointer ?? ((a: string, g: string) => fetchRegistryKeyOrNull(a, g, "platform.json"));

  let unpublished: Array<{ name: string; version: string }> = [];
  try {
    unpublished = await npmPublished(input.configDir);
  } catch {
    // npm unreachable — unverifiable is not owed; never block the train
  }
  const localFrameworkVersion = readFrameworkVersion(input.configDir);

  let pointerFrameworkVersion: string | undefined;
  let pointerState: "absent" | "present" | "unknown" = "unknown";
  if (input.account && input.gateway) {
    try {
      const pointer = await fetchPointer(input.account, input.gateway);
      pointerState = pointer ? "present" : "absent";
      if (pointer) pointerFrameworkVersion = pointer.frameworkVersion;
    } catch {
      // registry unreachable — unverifiable is not owed; never block the train
    }
  }

  const npmOwed = unpublished.length > 0;
  const manifestOwed =
    pointerState === "unknown"
      ? false
      : pointerState === "absent"
        ? Boolean(localFrameworkVersion)
        : Boolean(
            localFrameworkVersion &&
              pointerFrameworkVersion !== undefined &&
              compareVersions(pointerFrameworkVersion, localFrameworkVersion) < 0,
          );

  return {
    npmOwed,
    manifestOwed,
    release: npmOwed || manifestOwed,
    detail: {
      unpublished,
      ...(localFrameworkVersion ? { localFrameworkVersion } : {}),
      ...(pointerFrameworkVersion ? { pointerFrameworkVersion } : {}),
      pointerExists: pointerState === "present",
    },
  };
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

/** Prerelease-aware semver ordering ("2.0.0-rc.9" < "2.0.0-rc.10" < "2.0.0").
 * Unparseable versions order as equal (no owed-work decision from noise). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { core: number[]; pre: string[] } | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim());
    if (!match) return null;
    return {
      core: [Number(match[1]), Number(match[2]), Number(match[3])],
      pre: match[4] ? match[4].split(".") : [],
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i]! < pb.core[i]! ? -1 : 1;
  }
  // a release outranks its prereleases; prerelease identifiers compare
  // numeric-when-numeric
  if (pa.pre.length === 0 && pb.pre.length > 0) return 1;
  if (pa.pre.length > 0 && pb.pre.length === 0) return -1;
  for (let i = 0; i < Math.min(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i]!;
    const y = pb.pre[i]!;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return pa.pre.length - pb.pre.length;
}
