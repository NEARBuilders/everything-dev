import { Effect } from "effect";
import { checkConfig } from "./checks/config";
import { scanImports } from "./checks/imports";
import { checkRouteGuards } from "./checks/route-guards";
import { checkRoutes } from "./checks/routes";
import { checkUiSeam, readRouterSeam } from "./checks/ui-seam";
import { type AuditReport, Finding } from "./domain";
import { buildManifest, readConfigKeys } from "./manifest";

export const audit = (projectDir: string): Effect.Effect<AuditReport, Error> =>
  Effect.gen(function* () {
    const [
      routeFindings,
      guardFindings,
      configFindings,
      importRewrites,
      configKeys,
      uiSeamFindings,
      routerSeam,
    ] = yield* Effect.all([
      checkRoutes(projectDir),
      checkRouteGuards(projectDir),
      checkConfig(projectDir),
      scanImports(projectDir),
      readConfigKeys(projectDir),
      checkUiSeam(projectDir),
      readRouterSeam(projectDir),
    ]);

    const findings: Finding[] = [
      ...routeFindings,
      ...guardFindings,
      ...configFindings,
      ...uiSeamFindings,
      ...importRewrites.flatMap((rewrite) =>
        rewrite.files.length === 0
          ? []
          : [
              new Finding({
                check: "imports",
                path: rewrite.files.join(", "),
                severity: "warn",
                message: `legacy import "${rewrite.from}" — rewrite to "${rewrite.to}"`,
              }),
            ],
      ),
    ];

    const blockers = findings.filter((f) => f.severity === "blocker");
    const warns = findings.filter((f) => f.severity === "warn");
    const tier = blockers.length === 0 ? "A" : "B";

    const manifest = yield* buildManifest(
      projectDir,
      tier,
      blockers.length,
      warns.length,
      importRewrites,
      configKeys,
      routerSeam,
    );

    return { tier, findings, manifest } satisfies AuditReport;
  });

const formatFinding = (finding: Finding): string =>
  `  [${finding.severity}] ${finding.check} ${finding.path}: ${finding.message}`;

export const printReport = (report: AuditReport): void => {
  const blockers = report.findings.filter((f) => f.severity === "blocker");
  const warns = report.findings.filter((f) => f.severity === "warn");
  console.log(`\nv2 upgrade audit — Tier ${report.tier}`);
  console.log(`  blockers: ${blockers.length}, warns: ${warns.length}`);
  for (const blocker of blockers) console.log(formatFinding(blocker));
  for (const warn of warns) console.log(formatFinding(warn));
  console.log("\nmanifest:");
  console.log(JSON.stringify(report.manifest, null, 2));
};
