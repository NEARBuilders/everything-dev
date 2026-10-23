import { Effect } from "effect";
import { audit } from "./audit";
import { scanImports } from "./checks/imports";
import { GateBlocked } from "./domain";
import { applyManifest } from "./steps/apply-manifest";
import { authorConfig, type StepResult } from "./steps/author-config";
import { migratePnpm } from "./steps/migrate-pnpm";
import { migrateRouteMounts } from "./steps/migrate-route-mounts";
import { migrateUiSeam } from "./steps/migrate-ui-seam";
import { retireV1Shell } from "./steps/retire-v1-shell";
import { retireZephyr } from "./steps/retire-zephyr";

export interface ApplyStepLog {
  readonly name: string;
  readonly result: StepResult;
}

export const apply = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<ApplyStepLog[], GateBlocked | Error> =>
  Effect.gen(function* () {
    // Route mount restructure clears blocker-class findings (unknown mounts),
    // so it runs before the audit gate. Re-run the audit after it so the gate
    // sees the corrected tree.
    const mountResult = yield* migrateRouteMounts(projectDir, dryRun);

    const report = yield* audit(projectDir);
    if (report.manifest.blockerCount > 0) {
      return yield* Effect.fail(
        new GateBlocked({
          findings: report.findings.filter((f) => f.severity === "blocker"),
        }),
      );
    }

    const rewrites = yield* scanImports(projectDir);

    const configResult = yield* authorConfig(projectDir, report.manifest.plugins, dryRun);
    const pnpmResult = yield* migratePnpm(projectDir, dryRun);
    const seamResult = yield* migrateUiSeam(projectDir, dryRun);
    const shellResult = yield* retireV1Shell(projectDir, dryRun);
    const zephyrResult = yield* retireZephyr(projectDir, dryRun);
    const manifestResult = yield* applyManifest(projectDir, rewrites, dryRun);

    return [
      { name: "migrate-route-mounts", result: mountResult },
      { name: "author-config", result: configResult },
      { name: "migrate-pnpm", result: pnpmResult },
      { name: "migrate-ui-seam", result: seamResult },
      { name: "retire-v1-shell", result: shellResult },
      { name: "retire-zephyr", result: zephyrResult },
      { name: "apply-manifest", result: manifestResult },
    ];
  });
