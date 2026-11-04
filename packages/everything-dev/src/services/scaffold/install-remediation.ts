import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  FRAMEWORK_EXCLUDE_PACKAGES,
  reconcileWorkspaceYamlFile,
} from "../workspace/catalog-overrides";

export interface ReleaseAgeOffender {
  name: string;
  version: string;
}

const FRAMEWORK_OFFENDER_NAMES: readonly string[] = FRAMEWORK_EXCLUDE_PACKAGES;

/**
 * Parse pnpm's `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` output for the
 * offending `name@version` entries — the lockfile entries the active
 * supply-chain holdback rejected.
 */
export function classifyReleaseAgeViolation(output: string): ReleaseAgeOffender[] {
  const offenders: ReleaseAgeOffender[] = [];
  for (const match of output.matchAll(/^\s*([@a-zA-Z0-9/._-]+)@(\d\S*?)\s+was published at/gm)) {
    offenders.push({ name: match[1]!, version: match[2]! });
  }
  return offenders;
}

function errorOutput(error: unknown): string {
  if (error && typeof error === "object") {
    const parts = error as {
      all?: unknown;
      stdout?: unknown;
      stderr?: unknown;
      message?: unknown;
      output?: unknown;
    };
    const collected = [parts.all, parts.stdout, parts.stderr, parts.message, parts.output].filter(
      (part): part is string => typeof part === "string",
    );
    if (collected.length > 0) return collected.join("\n");
  }
  return String(error);
}

function releaseAgeError(offenders: ReleaseAgeOffender[], output: string): Error {
  const listed = offenders.map((o) => `${o.name}@${o.version}`).join(", ");
  const frameworkListed = offenders.some((o) => FRAMEWORK_OFFENDER_NAMES.includes(o.name));
  const detail = offenders.length > 0 ? ` (${listed})` : "";
  const guidance = frameworkListed
    ? "the framework rows are reconciled automatically — a persistent failure means the holdback window is still open; wait for the release to age past the cutoff, or override the policy locally if you trust the packages"
    : "wait for those releases to age past the cutoff, or override the policy locally if you trust them";
  return new Error(
    `pnpm's supply-chain holdback (minimumReleaseAge) rejected the install${detail} — ${guidance}.` +
      `${output.trim() ? `\n${output.trim().split("\n").at(-1)}` : ""}`,
  );
}

export interface InstallRemediationOptions {
  /** The workspace root (pnpm-workspace.yaml / pnpm-lock.yaml live here). */
  workspaceDir: string;
  /** The install invocation — re-invoked for the post-repair retry. */
  run: (workspaceDir: string) => Promise<void>;
  log?: (message: string) => void;
}

/**
 * The upgrade install with the release-age remediation (the Nov-03 stranded
 * rc): pnpm's `minimumReleaseAge` holdback rejects a brand-new framework
 * release whose lockfile entry an earlier attempt already wrote — every
 * retry fails on the stale entry even though the workspace excludes allow
 * the resolution. On that error class: repair the exclude posture, discard
 * the polluted lockfile, retry once. Anything else (non-framework offenders,
 * a persistent violation) fails with the targeted remediation instead of the
 * raw pnpm dump — the install's own output already streamed live.
 */
export async function installWithReleaseAgeRemediation(
  opts: InstallRemediationOptions,
): Promise<void> {
  let firstError: unknown;
  try {
    await opts.run(opts.workspaceDir);
    return;
  } catch (error) {
    firstError = error;
  }

  const output = errorOutput(firstError);
  if (!output.includes("ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION")) throw firstError;

  const offenders = classifyReleaseAgeViolation(output);
  const frameworkOffenders = offenders.filter((o) => FRAMEWORK_OFFENDER_NAMES.includes(o.name));
  if (frameworkOffenders.length === 0) throw releaseAgeError(offenders, output);

  reconcileWorkspaceYamlFile(opts.workspaceDir);
  rmSync(join(opts.workspaceDir, "pnpm-lock.yaml"), { force: true });
  opts.log?.(
    "a stale lockfile entry carries a release younger than the supply-chain holdback — regenerating the lockfile and retrying",
  );
  try {
    await opts.run(opts.workspaceDir);
  } catch (retryError) {
    const retryOutput = errorOutput(retryError);
    throw releaseAgeError(classifyReleaseAgeViolation(retryOutput), retryOutput);
  }
}
