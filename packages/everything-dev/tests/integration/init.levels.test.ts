import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildInitPatterns,
  buildPluginRouteExclusions,
  buildStarterRouteExclusions,
  convertChildConfigToAppForm,
  copyFilteredFiles,
  personalizeConfig,
  writeInitSnapshot,
} from "../../src/cli/init";
import { readSnapshot } from "../../src/cli/snapshot";

const REPO_ROOT = join(import.meta.dirname, "../../../../");
const ROOT_CONFIG = JSON.parse(readFileSync(join(REPO_ROOT, "bos.config.json"), "utf-8")) as {
  starter?: {
    exclude?: string[];
    levels?: Record<string, { include?: string[]; exclude?: string[] }>;
  };
  plugins?: Record<string, { routes?: string[] }>;
};

async function scaffoldProject(opts: {
  overrides: Array<"ui" | "api" | "host" | "plugins">;
  level: "simple" | "advanced";
  plugins?: string[];
}): Promise<string> {
  const projectDir = mkdtempSync(join(tmpdir(), "bos-init-levels-"));
  const patterns = buildInitPatterns(opts.overrides, opts.plugins);
  const starterExclusions = opts.overrides.includes("ui")
    ? buildStarterRouteExclusions(opts.level, ROOT_CONFIG)
    : [];
  const routeExclusions = opts.overrides.includes("ui")
    ? buildPluginRouteExclusions(ROOT_CONFIG, opts.plugins ?? [])
    : [];

  await copyFilteredFiles(REPO_ROOT, projectDir, patterns, {
    overrides: opts.overrides,
    plugins: opts.plugins,
    ignore: [...routeExclusions, ...starterExclusions],
  });

  await personalizeConfig(projectDir, {
    extendsAccount: "dev.everything.near",
    extendsGateway: "everything.dev",
    account: "test.near",
    domain: "test.dev",
    overrides: opts.overrides,
    plugins: opts.plugins,
    workspaceOpts: { sourceDir: REPO_ROOT },
    starter: opts.level,
  });

  await convertChildConfigToAppForm(projectDir);

  await writeInitSnapshot(
    projectDir,
    "dev.everything.near",
    "everything.dev",
    REPO_ROOT,
    patterns,
    {
      overrides: opts.overrides,
      plugins: opts.plugins,
      ignore: [...routeExclusions, ...starterExclusions],
      starter: opts.level,
    },
  );

  return projectDir;
}

describe("init starter levels", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("simple level prunes to the public shell", async () => {
    const projectDir = await scaffoldProject({ overrides: ["ui"], level: "simple" });
    tempDirs.push(projectDir);

    const routes = join(projectDir, "ui", "src", "routes");
    expect(existsSync(join(routes, "__root.tsx"))).toBe(true);
    expect(existsSync(join(routes, "_public.tsx"))).toBe(true);
    expect(existsSync(join(routes, "_public", "index.tsx"))).toBe(true);
    expect(existsSync(join(routes, "_public", "about.tsx"))).toBe(true);
    expect(existsSync(join(routes, "_public", "explore.tsx"))).toBe(false);
    expect(existsSync(join(routes, "_public", "stake.tsx"))).toBe(false);
    expect(existsSync(join(routes, "_authenticated.tsx"))).toBe(false);
    expect(existsSync(join(routes, "_admin.tsx"))).toBe(false);
    expect(existsSync(join(routes, "_authenticated", "_dashboard", "dashboard", "node"))).toBe(
      false,
    );
  });

  it("advanced level includes guards and orgs while excluding product routes", async () => {
    const projectDir = await scaffoldProject({ overrides: ["ui"], level: "advanced" });
    tempDirs.push(projectDir);

    const routes = join(projectDir, "ui", "src", "routes");
    expect(existsSync(join(routes, "_authenticated.tsx"))).toBe(true);
    expect(existsSync(join(routes, "_admin.tsx"))).toBe(true);
    expect(existsSync(join(routes, "_authenticated", "_dashboard", "orgs"))).toBe(true);
    expect(existsSync(join(routes, "_authenticated", "_dashboard", "things", "index.tsx"))).toBe(
      true,
    );
    expect(existsSync(join(routes, "_public", "stake.tsx"))).toBe(false);
    expect(
      existsSync(join(routes, "_authenticated", "_dashboard", "prototype-staking-poc.tsx")),
    ).toBe(false);
    expect(
      existsSync(join(routes, "_admin", "_dashboard", "_dashboard", "admin", "relayer.tsx")),
    ).toBe(false);
  });

  it("persists the level in bos.app.ts", async () => {
    const projectDir = await scaffoldProject({ overrides: ["ui"], level: "simple" });
    tempDirs.push(projectDir);

    expect(existsSync(join(projectDir, "bos.app.ts"))).toBe(true);
    const source = readFileSync(join(projectDir, "bos.app.ts"), "utf-8");
    expect(source).toContain(`"starter": "simple"`);
  });

  it("records the level in the sync snapshot", async () => {
    const projectDir = await scaffoldProject({ overrides: ["ui"], level: "simple" });
    tempDirs.push(projectDir);

    const snapshot = await readSnapshot(projectDir);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.starter).toBe("simple");
  });

  it("defaults to simple: excludes guarded routes when the level is simple", () => {
    const exclusions = buildStarterRouteExclusions("simple", null);
    expect(exclusions).toContain("ui/src/routes/_authenticated.tsx");
    expect(exclusions).toContain("ui/src/routes/_admin.tsx");
    expect(exclusions).toContain("ui/src/routes/_public/stake.tsx");
  });

  it("composes with plugin-route exclusions", () => {
    const syntheticParent = {
      plugins: {
        alpha: { routes: ["ui/src/routes/_authenticated/alpha.tsx"] },
        beta: { routes: ["ui/src/routes/_authenticated/beta.tsx"] },
      },
    };
    const routeExclusions = buildPluginRouteExclusions(syntheticParent, ["alpha"]);
    const starterExclusions = buildStarterRouteExclusions("advanced", null);
    const combined = [...routeExclusions, ...starterExclusions];

    expect(combined).toContain("ui/src/routes/_authenticated/beta.tsx");
    expect(combined).not.toContain("ui/src/routes/_authenticated/alpha.tsx");
    expect(combined).toContain("ui/src/routes/_public/stake.tsx");
  });
});
