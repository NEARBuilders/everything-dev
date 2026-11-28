import { rmSync } from "node:fs";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BOOT_PORTS,
  type BootEvidence,
  bootChild,
  buildChild,
  findKnownDefect,
  type GateReport,
  installChild,
  linkLocalFramework,
  runLane,
  type Scaffolded,
  scaffoldChild,
  typegenChild,
  upgradeCheckChild,
} from "../helpers/child-fixture";

const pendingCleanup: string[] = [];
afterAll(() => {
  if (process.env.BOS_KEEP_INIT_CHILD === "1") return;
  while (pendingCleanup.length > 0) {
    rmSync(pendingCleanup.pop()!, { recursive: true, force: true });
  }
}, 120_000);

const BOOT_GATES = [
  "scaffold",
  "framework-links",
  "install",
  "types",
  "build",
  "upgrade-check",
  "boot",
];

/**
 * The consumer boot gate: the scaffold a real `bos init` produces, with the
 * framework packages linked to this tree, must `bos build` clean (gate 5)
 * and boot under `bos dev` (gate 6) against the live published chain —
 * local host/api/ui, remote auth and inherited plugins. The full
 * composition (host override) is the shape the dev harness is known to
 * boot; the levels prove the starter split survives a real runtime.
 *
 * Evidence-first: `beforeAll` runs the lane once; assertions read the
 * collected reports and boot evidence, never runner ordering.
 */
describe.each(["simple", "advanced"] as const)("init %s — born healthy (boot lane)", (level) => {
  let reports: GateReport[] = [];
  let evidence: BootEvidence | undefined;

  beforeAll(async () => {
    let child!: Scaffolded;
    let booted!: BootEvidence;
    reports = await Effect.runPromise(
      Effect.scoped(
        runLane([
          {
            gate: "scaffold",
            effect: Effect.gen(function* () {
              child = yield* scaffoldChild({ level, composition: "full" });
              pendingCleanup.push(child.dir);
            }),
          },
          {
            gate: "framework-links",
            effect: Effect.gen(function* () {
              yield* linkLocalFramework(child);
            }),
          },
          {
            gate: "install",
            effect: Effect.gen(function* () {
              child = yield* installChild(child);
            }),
          },
          {
            gate: "types",
            effect: Effect.gen(function* () {
              yield* typegenChild(child);
            }),
          },
          // Token-consuming steps read lazily (the steps array is built
          // before the lane runs).
          {
            gate: "build",
            effect: Effect.gen(function* () {
              yield* buildChild(child);
            }),
          },
          {
            gate: "upgrade-check",
            effect: Effect.gen(function* () {
              yield* upgradeCheckChild(child);
            }),
          },
          {
            gate: "boot",
            effect: Effect.gen(function* () {
              booted = yield* bootChild(child, BOOT_PORTS);
            }),
          },
        ]),
      ),
    );
    evidence = booted;
  }, 1_800_000);

  it.each(BOOT_GATES)("gate %s", (gate: string) => {
    const report = reports.find((entry) => entry.gate === gate);
    expect(report, `gate ${gate} never reported — the lane stalled`).toBeDefined();
    const defect = findKnownDefect(level, gate);
    if (defect) {
      expect(
        report?.ok,
        `${gate} unexpectedly passed — the defect is fixed, delete the KNOWN_DEFECTS row: ${defect.reason}`,
      ).toBe(false);
      if (defect.detailMatches && report?.detail && !report.detail.startsWith("blocked by")) {
        expect(report.detail).toMatch(defect.detailMatches);
      }
      return;
    }
    expect(report?.ok, report?.detail ?? `gate ${gate} failed`).toBe(true);
  });

  // When the boot gate itself is a documented defect, the lane never reaches
  // the server — the evidence is undefined and these rows are vacuous.
  it.skipIf(findKnownDefect(level, "boot") !== undefined)(
    "the ui and api answer before their budgets",
    () => {
      expect(evidence?.uiStatus).toBe(200);
      expect(evidence?.apiStatus).toBeGreaterThan(0);
    },
  );

  it.skipIf(findKnownDefect(level, "boot") !== undefined)(
    "the boot log carries no known failure classes",
    () => {
      const log = evidence?.log ?? "";
      expect(log).not.toContain("release-composition divergence");
      expect(log).not.toContain("pool.end() called from");
    },
  );

  it.skipIf(findKnownDefect(level, "boot") !== undefined)(
    "SIGTERM was enough — graceful quit",
    () => {
      expect(evidence?.quitCleanly).toBe(true);
    },
  );
});
