import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// #959: fast-check property tests that run in CI must pin a recorded seed —
// a random seed per run flakes clean main whenever the seed draws a failure
// case (#948 presented as a full debug cycle on a law that only some seeds
// reach). This drift guard scans the test roots CI runs (packages/*/tests,
// plugins/*/src/__tests__) and fails any `fc.assert` call whose region has no
// `seed` option, unless the call site carries the explicit `fc-random: allow`
// escape for an intentional random run. The convention paragraph lives in
// docs/agents/testing.md ("Test value rules"); pin counterexamples as
// deterministic regression tests in the same file, never bump the seed.

const ESCAPE_MARKER = "fc-random: allow";

const GUARD_FILENAME = "property-seed-pin.test.ts";

const ASSERT_WINDOW = 60;

const SEED_OPTION_RE = /\bseed\s*:/;

const TEST_FILE_RE = /\.(?:test|spec)\.[jt]sx?$/;

function walkTestFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTestFiles(full));
    else if (TEST_FILE_RE.test(entry.name)) out.push(full);
  }
  return out;
}

function assertRegionEnd(lines: string[], start: number): number {
  let depth = 0;
  let opened = false;
  const ceiling = Math.min(start + ASSERT_WINDOW, lines.length);
  for (let i = start; i < ceiling; i++) {
    for (const ch of lines[i]) {
      if (ch === "(") {
        depth += 1;
        opened = true;
      } else if (ch === ")") {
        depth -= 1;
      }
    }
    if (opened && depth <= 0) return i;
  }
  return ceiling - 1;
}

function unseededAssertLines(content: string): number[] {
  const lines = content.split("\n");
  const flagged: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("fc.assert(")) continue;
    const region = lines.slice(i, assertRegionEnd(lines, i) + 1).join("\n");
    const escaped = [lines[i - 1] ?? "", lines[i]].some((line) => line.includes(ESCAPE_MARKER));
    if (!escaped && !SEED_OPTION_RE.test(region)) flagged.push(i + 1);
  }
  return flagged;
}

function propertyTestFiles(): string[] {
  const root = join(import.meta.dirname, "../../../..");
  const candidates = [
    ...walkTestFiles(join(root, "packages")).filter((file) =>
      relative(root, file).split("/").includes("tests"),
    ),
    ...walkTestFiles(join(root, "plugins")).filter((file) =>
      relative(root, file).split("/").includes("__tests__"),
    ),
  ];
  return candidates.filter(
    (file) => !file.endsWith(GUARD_FILENAME) && readFileSync(file, "utf8").includes("fast-check"),
  );
}

describe("property-test seed pins (#959)", () => {
  it("pins every CI-run fc.assert to a recorded seed", () => {
    const files = propertyTestFiles();
    expect(files.length, "expected at least one fast-check test file to scan").toBeGreaterThan(0);
    const violations = files.flatMap((file) =>
      unseededAssertLines(readFileSync(file, "utf8")).map(
        (line) => `  ${relative(join(import.meta.dirname, "../../../.."), file)}:${line}`,
      ),
    );
    expect(
      violations,
      [
        "Every CI-run fc.assert must pass a recorded seed — property tests with",
        "a random seed per run flake clean main when the seed draws a failure",
        "case (#948, #959). Pin a seed constant, and pin any counterexample as",
        "a deterministic regression test in the same file; the convention is",
        "docs/agents/testing.md (Test value rules). An intentional random run",
        `carries a \`${ESCAPE_MARKER}\` comment on the call site. Unseeded calls:`,
        violations.join("\n"),
      ].join("\n"),
    ).toEqual([]);
  });

  it("flags a synthetic unseeded assert and honors the escape marker", () => {
    const unseeded = "expect(fc.assert(prop, { numRuns: 100 })).toBeUndefined();";
    expect(unseededAssertLines(unseeded)).toEqual([1]);
    expect(unseededAssertLines(`// ${ESCAPE_MARKER}\n${unseeded}`)).toEqual([]);
    expect(unseededAssertLines(`${unseeded} // ${ESCAPE_MARKER}`)).toEqual([]);
    expect(
      unseededAssertLines("expect(fc.assert(prop, { numRuns: 100, seed: PROPERTY_SEED }));"),
    ).toEqual([]);
    expect(
      unseededAssertLines(
        [
          "expect(",
          "  fc.assert(prop, {",
          "    numRuns: 300,",
          "    seed: PROPERTY_SEED,",
          "  }),",
          ").toBeUndefined();",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
