import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkUiSeam,
  detectRouterSeam,
  readRouterSeam,
} from "../../../src/services/scaffold/upgrade-audit/checks/ui-seam";
import { migrateUiSeam } from "../../../src/services/scaffold/upgrade-audit/steps/migrate-ui-seam";
import { warnMessages } from "./test-helpers";

const conformant = join(
  import.meta.dirname,
  "../../../src/services/scaffold/upgrade-audit/fixtures/conformant",
);
const nonconformant = join(
  import.meta.dirname,
  "../../../src/services/scaffold/upgrade-audit/fixtures/nonconformant",
);

let projectDir: string;

const setup = async (fixture: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "v2-upgrade-ui-seam-"));
  await cp(fixture, dir, { recursive: true });
  return dir;
};

beforeEach(async () => {
  projectDir = await setup(nonconformant);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

const run = async <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect);

describe("detectRouterSeam", () => {
  it("classifies the authored seam, the monolithic factory, and unknown shapes", () => {
    expect(
      detectRouterSeam('import { createRouter } from "everything-dev/ui/router-client";'),
    ).toBe("authored-seam");
    expect(detectRouterSeam("createTanStackRouter({ routeTree })")).toBe("monolithic");
    expect(detectRouterSeam("export const totallyCustom = 1;")).toBe("unknown");
  });
});

describe("readRouterSeam", () => {
  it("classifies the conformant fixture as the authored seam", async () => {
    const seam = await run(readRouterSeam(conformant));
    expect(seam).toBe("authored-seam");
  });

  it("reports absent when router.tsx does not exist", async () => {
    await rm(join(projectDir, "ui/src/router.tsx"));
    const seam = await run(readRouterSeam(projectDir));
    expect(seam).toBe("absent");
  });
});

describe("checkUiSeam", () => {
  it("finds no issues in the conformant fixture", async () => {
    const findings = await run(checkUiSeam(conformant));
    expect(findings).toEqual([]);
  });

  it("warns on the monolithic factory", async () => {
    const findings = await run(checkUiSeam(projectDir));
    expect(warnMessages(findings).join("\n")).toMatch(/monolithic router factory/);
  });

  it("warns on app surfaces missing the bootstrap overrides", async () => {
    await rm(join(projectDir, "ui/src/app.ts"));
    await writeFile(join(projectDir, "ui/src/app.ts"), "export const somethingElse = 1;\n");
    const findings = await run(checkUiSeam(projectDir));
    expect(warnMessages(findings).join("\n")).toMatch(
      /missing bootstrap overrides.*appLocale, apiConnectionError/s,
    );
  });

  it("warns when router.tsx is absent", async () => {
    await rm(join(projectDir, "ui/src/router.tsx"));
    const findings = await run(checkUiSeam(projectDir));
    expect(warnMessages(findings).join("\n")).toMatch(/router\.tsx not found/);
  });
});

describe("migrateUiSeam", () => {
  it("rewrites the monolithic factory to the authored seam, preserving createQueryClient", async () => {
    const result = await run(migrateUiSeam(projectDir, false));
    expect(result.writes).toContain("ui/src/router.tsx");
    expect(result.writes).toContain("ui/src/router-client.ts");
    const source = await readFile(join(projectDir, "ui/src/router.tsx"), "utf-8");
    expect(source).toContain('from "everything-dev/ui/router-client"');
    expect(source).not.toContain("createTanStackRouter");
    expect(source).toContain("defaultRouteTree: routeTree");
    expect(source).toContain("staleTime: 5 * 60 * 1000");
    expect(source).toContain("interface Register");
    expect(await run(readRouterSeam(projectDir))).toBe("authored-seam");

    const shim = await readFile(join(projectDir, "ui/src/router-client.ts"), "utf-8");
    expect(shim).toContain("LOCAL SHIM");
    expect(shim).toContain("everything-dev/ui/router-client");
    expect(shim).toContain("Exit path");
  });

  it("drops the old template default components without notes", async () => {
    const result = await run(migrateUiSeam(projectDir, false));
    expect(result.notes.join("\n")).not.toMatch(/custom default/);
    const source = await readFile(join(projectDir, "ui/src/router.tsx"), "utf-8");
    expect(source).not.toContain("Oops!");
  });

  it("notes custom default components it cannot carry over", async () => {
    const source = await readFile(join(projectDir, "ui/src/router.tsx"), "utf-8");
    await writeFile(
      join(projectDir, "ui/src/router.tsx"),
      source.replace("Not Found", "Nothing here, friend"),
    );
    const result = await run(migrateUiSeam(projectDir, false));
    expect(result.notes.join("\n")).toMatch(/custom defaultNotFoundComponent detected/);
  });

  it("dry-run leaves the monolithic factory in place", async () => {
    await run(migrateUiSeam(projectDir, true));
    const source = await readFile(join(projectDir, "ui/src/router.tsx"), "utf-8");
    expect(source).toContain("createTanStackRouter");
  });

  it("no-ops when already on the authored seam", async () => {
    const dir = await setup(conformant);
    const result = await run(migrateUiSeam(dir, false));
    expect(result.writes).toEqual([]);
    expect(result.notes).toEqual(["router.tsx already on the authored seam"]);
    await rm(dir, { recursive: true, force: true });
  });

  it("leaves unrecognized router factories untouched", async () => {
    await writeFile(join(projectDir, "ui/src/router.tsx"), "export const custom = true;\n");
    const result = await run(migrateUiSeam(projectDir, false));
    expect(result.writes).toEqual([]);
    expect(result.notes.join("\n")).toMatch(/inspect manually/);
  });
});
