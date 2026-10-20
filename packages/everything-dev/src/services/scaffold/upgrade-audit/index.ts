/**
 * v1 → v2 upgrade train (NEARBuilders/everything-dev#455).
 *
 * Audits an everything-dev v1 child app for upgrade readiness (hardline
 * mount-conformance gate, config surface, legacy imports) and applies the
 * deterministic v2 transforms (authored descriptor, bun→pnpm catalog
 * migration, consumerized refs, import rewrites, obsolete-file deletion,
 * plugin dep declarations). State-aware: a tree with an authored
 * `bos.app.ts` is already on the v2 train — the audit reads
 * `bos.config.json` and is for pre-upgrade trees only.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { apply } from "./apply";
import { audit } from "./audit";
import {
  AUTH_FIXTURE_PATH,
  type ComposeProbe,
  composeFindings,
  probeComposeSeam,
  readEveryPluginVersion,
} from "./checks/compose-seam";
import type { Manifest, RouterSeam, Finding as RuntimeFinding } from "./domain";
import { GateBlocked } from "./domain";
import type { StepResult } from "./steps/author-config";
import { migrateI18nSeam } from "./steps/migrate-i18n-seam";
import { migrateRouteMounts } from "./steps/migrate-route-mounts";
import { patchDbTopology } from "./steps/patch-db-topology";
import { portRouteGuards } from "./steps/port-route-guards";
export type UpgradeAuditStep =
  | "port-route-guards"
  | "db-topology"
  | "i18n-seam"
  | "compose-seam"
  | "route-mounts";

export type PlainFinding = {
  readonly check: string;
  readonly path: string;
  readonly severity: "blocker" | "warn";
  readonly message: string;
};

export type AuditManifest = Manifest;

export type AuditOutcome = {
  readonly tier: "A" | "B";
  readonly gateBlocked: boolean;
  readonly findings: readonly PlainFinding[];
  readonly manifest: AuditManifest;
};

export type ApplyOutcome = {
  readonly migrated: string[];
  readonly notes: string[];
};

const toPlainFinding = (finding: RuntimeFinding): PlainFinding => ({
  check: finding.check,
  path: finding.path,
  severity: finding.severity,
  message: finding.message,
});

export const isV2Tree = (projectDir: string): boolean => existsSync(join(projectDir, "bos.app.ts"));

const writeManifestFile = async (projectDir: string, manifest: Manifest): Promise<void> => {
  await mkdir(join(projectDir, ".bos"), { recursive: true });
  await writeFile(
    join(projectDir, ".bos/v2-upgrade-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
};

/** Run the v1 audit: gate findings, manifest emit, no tree writes. */
export const auditV1Tree = async (projectDir: string): Promise<AuditOutcome> => {
  const report = await Effect.runPromise(audit(projectDir));
  const findings = report.findings.map(toPlainFinding);
  await writeManifestFile(projectDir, report.manifest);
  return {
    tier: report.tier,
    gateBlocked: report.manifest.blockerCount > 0,
    findings,
    manifest: report.manifest,
  };
};

/** Apply the v2 transforms; the hardline gate must pass first. */
export const applyV1Tree = async (
  projectDir: string,
  dryRun: boolean,
): Promise<
  { ok: true; outcome: ApplyOutcome } | { ok: false; blockers: readonly PlainFinding[] }
> => {
  try {
    const logs = await Effect.runPromise(apply(projectDir, dryRun));
    const migrated: string[] = [];
    const notes: string[] = [];
    for (const log of logs) {
      for (const path of log.result.writes) migrated.push(`${log.name}: ${path}`);
      for (const path of log.result.deletes) migrated.push(`${log.name}: deleted ${path}`);
      for (const note of log.result.notes) notes.push(`${log.name}: ${note}`);
    }
    return { ok: true, outcome: { migrated, notes } };
  } catch (error) {
    if (error instanceof GateBlocked) {
      return { ok: false, blockers: error.findings.map(toPlainFinding) };
    }
    throw error;
  }
};

/** Re-run a post-upgrade maintenance step (regression guard after `bos sync`). */
export const maintainV1Tree = async (
  projectDir: string,
  step: UpgradeAuditStep,
  dryRun: boolean,
): Promise<StepResult> => {
  switch (step) {
    case "route-mounts": {
      return await Effect.runPromise(migrateRouteMounts(projectDir, dryRun));
    }
    case "port-route-guards":
      return await Effect.runPromise(portRouteGuards(projectDir, dryRun));
    case "db-topology":
      return await Effect.runPromise(patchDbTopology(projectDir, dryRun));
    case "i18n-seam":
      return await Effect.runPromise(migrateI18nSeam(projectDir, dryRun));
    case "compose-seam": {
      const probe = await Effect.runPromise(probeComposeSeam(projectDir, { live: false }));
      const version = await Effect.runPromise(readEveryPluginVersion(projectDir));
      const findings = composeFindings(probe, version);
      return {
        writes: [],
        deletes: [],
        notes: [
          `every-plugin ${version}, auth manifest: ${AUTH_FIXTURE_PATH}`,
          `seam: ${describeComposeProbe(probe)}`,
          ...probe.composeLog,
          ...(probe.error ? [`error: ${probe.error}`] : []),
          ...findings.map((finding) => `[${finding.severity}] ${finding.message}`),
        ],
      };
    }
  }
};

export const describeComposeProbe = (probe: ComposeProbe): string => {
  switch (probe.seam) {
    case "ok":
      return probe.composeLog.some((line) => line.includes("core ui wins"))
        ? "compose ok — core ui wins; shadowed auth routes skipped cleanly"
        : "compose ok — note: no /login shadow exercised (core ui no longer claims /login)";
    case "absent-ui-manifest":
      return "ui/src/manifest.gen.json absent — run `bos types gen` first";
    case "cascade-bug":
      return 'KNOWN BUG — false "unresolvable parentage" for the /login shadow cascade';
    case "path-collision":
      return "REGRESSION — the /login shadow is treated as a hard path collision";
    case "compose-failed":
      return "compose failed";
  }
};

export type { Manifest, RouterSeam, StepResult };
