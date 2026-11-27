import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { pruneUnusedUiFiles } from "../../src/cli/prune";
import { loadManifestNormalizationSpec } from "../../src/services/registry/manifest-normalizer";
import { loadInProcessDescriptor } from "../../src/services/resolution/load";
import { PNPM_PACKAGE_MANAGER } from "../../src/services/scaffold/init";
import { isFrameworkOwnedSyncFile } from "../../src/services/scaffold/ownership";
import {
  attempt,
  COMPOSITIONS,
  type Composition,
  ensureFrameworkDists,
  findKnownDefect,
  type GateReport,
  installChild,
  LEVELS,
  type Level,
  migrateChild,
  runLane,
  type Scaffolded,
  scaffoldChild,
  type Typed,
  typecheckChild,
  typegenChild,
} from "../helpers/child-fixture";
import { getFrameworkTarballs, rewriteFrameworkPackageSpecs } from "./framework-packages";

const REPO_ROOT = join(import.meta.dirname, "../../../../");
const MANIFEST_SPEC = loadManifestNormalizationSpec(REPO_ROOT);

const pendingCleanup: string[] = [];
afterAll(() => {
  if (process.env.BOS_KEEP_INIT_CHILD === "1") return;
  while (pendingCleanup.length > 0) {
    rmSync(pendingCleanup.pop()!, { recursive: true, force: true });
  }
}, 120_000);

const expectAll = (dir: string, relatives: string[], present: boolean) => {
  for (const relative of relatives) {
    expect(
      existsSync(join(dir, relative)),
      `${relative} expected ${present ? "present" : "absent"}`,
    ).toBe(present);
  }
};

describe.each(LEVELS)("init %s — structure matrix", (level: Level) => {
  describe.each(COMPOSITIONS)("%s", (composition: Composition) => {
    let child!: Scaffolded;

    beforeAll(async () => {
      child = await Effect.runPromise(scaffoldChild({ level, composition }));
      pendingCleanup.push(child.dir);
    }, 180_000);

    it("gate 1 — born-healthy scaffold", () => {
      expect(child.filesCopied).toBeGreaterThan(0);
      expectAll(
        child.dir,
        [
          "bos.app.ts",
          "bos.dev.ts",
          ".env",
          ".env.example",
          "package.json",
          "pnpm-workspace.yaml",
          ".gitignore",
          "biome.json",
          "AGENTS.md",
          join(".bos", "sync-snapshot.json"),
          join("docs", "agents", "testing.md"),
          join("docs", "agents", "change-placement.md"),
          join(".github", "workflows", "ci.yml"),
          join(".github", "workflows", "deploy.yml"),
          join(".github", "workflows", "staging.yml"),
        ],
        true,
      );
      expectAll(
        child.dir,
        [
          "bos.config.json",
          "docker-compose.yml",
          ".changeset",
          "bun.lock",
          "pnpm-lock.yaml",
          "packages",
          "plans",
          ".agent",
          ".opencode",
          join("plugins", "example"),
          join(".github", "renovate.json"),
          join(".github", "workflows", "release.yml"),
          join(".github", "workflows", "packages-release.yml"),
        ],
        false,
      );
    });

    it("routes match the starter level", () => {
      const routes = join(child.dir, "ui", "src", "routes");
      expectAll(
        routes,
        ["__root.tsx", "_public.tsx", join("_public", "index.tsx"), join("_public", "about.tsx")],
        true,
      );
      // Product surfaces are parent-only at every level (plan 003) — the
      // parent-coupled additions were caught by the born-healthy typecheck
      // gate (deploys → parent hosting api, things → parent votes/proposals).
      expectAll(
        routes,
        [
          join("_public", "$accountId.tsx"),
          join("_public", "$accountId"),
          join("_authenticated", "deploys.tsx"),
          join("_authenticated", "_dashboard", "things"),
        ],
        false,
      );
      if (level === "simple") {
        expectAll(routes, ["_authenticated.tsx", "_admin.tsx", "_authenticated", "_admin"], false);
      } else {
        expectAll(
          routes,
          [
            "_authenticated.tsx",
            "_admin.tsx",
            join("_authenticated", "_dashboard", "dashboard", "index.tsx"),
          ],
          true,
        );
      }
    });

    it("surface matches the composition", () => {
      const uiOnly = composition === "ui";
      expect(existsSync(join(child.dir, "api"))).toBe(!uiOnly);
      expect(existsSync(join(child.dir, "host"))).toBe(composition === "full");
      expect(existsSync(join(child.dir, "plugins"))).toBe(composition === "full");

      if (!uiOnly) {
        expectAll(
          child.dir,
          [
            join("api", "src", "contract.ts"),
            join("api", "src", "index.ts"),
            join("api", "src", "db", "schema.ts"),
            join("api", "src", "db", "layer.ts"),
            join("api", "src", "lib", "context.ts"),
            join("api", "src", "lib", "errors.ts"),
            join("api", "src", "global.d.ts"),
            join("api", "drizzle.config.ts"),
            join("api", "package.json"),
            join("api", "plugin.dev.ts"),
            join("api", "tests", "setup.ts"),
          ],
          true,
        );
        // ADR 0038: no compose-era infra ships for any child shape.
        expect(existsSync(join(child.dir, "api", "src", "services"))).toBe(false);
        const migrations = readdirSync(join(child.dir, "api", "src", "db", "migrations"));
        expect(migrations).toHaveLength(2);
        expect(migrations.some((entry) => /^0000_.*\.sql$/.test(entry))).toBe(true);
        expect(migrations).toContain("meta");
        expect(
          existsSync(join(child.dir, "api", "src", "db", "migrations", "meta", "_journal.json")),
        ).toBe(true);
        expectAll(
          child.dir,
          [
            join("api", "src", "discovery-contract.ts"),
            join("api", "src", "feature-areas.ts"),
            join("api", "src", "team-access-policy.ts"),
            join("api", "tests", "unit"),
            join("api", "tests", "integration"),
          ],
          false,
        );

        const contractSource = readFileSync(join(child.dir, "api", "src", "contract.ts"), "utf-8");
        expect(contractSource).toContain("ping");
        expect(contractSource).toContain("testError");
        expect(contractSource).not.toContain("listTenants");
        expect(contractSource).not.toContain("listNodes");
        const indexSource = readFileSync(join(child.dir, "api", "src", "index.ts"), "utf-8");
        expect(indexSource).not.toContain("./services/");
        expect(indexSource).not.toContain("./discovery-contract");

        // Shell plumbing stays framework-owned so sync can refresh it; the db
        // seam is app-owned (ADR 0033).
        for (const relative of ["api/src/global.d.ts", "api/drizzle.config.ts"]) {
          expect(isFrameworkOwnedSyncFile(relative)).toBe(true);
        }
        for (const relative of [
          "api/src/contract.ts",
          "api/src/index.ts",
          "api/src/db/schema.ts",
          "api/src/db/layer.ts",
          "api/src/lib/context.ts",
        ]) {
          expect(isFrameworkOwnedSyncFile(relative)).toBe(false);
        }
      }

      if (composition === "full") {
        expect(existsSync(join(child.dir, "host", "src", "program.ts"))).toBe(true);
        expectAll(
          child.dir,
          [
            join("plugins", "_template", "src", "index.ts"),
            join("plugins", "_template", "src", "contract.ts"),
            join("plugins", "_template", "plugin.dev.ts"),
          ],
          true,
        );
      }
    });

    it("authored config is personalized (no inherited deploy state)", async () => {
      const source = readFileSync(join(child.dir, "bos.app.ts"), "utf-8");
      const config = await loadInProcessDescriptor(source, "child");
      expect(config.account).toBe("test.near");
      expect(config.domain).toBe("test.dev");
      expect(config.extends).toBe("bos://dev.everything.near/everything.dev");
      expect(config.starter).toBe(level);

      const app = (config.app ?? {}) as Record<string, Record<string, unknown>>;
      expect(app.ui).toBeDefined();
      expect(!!app.api).toBe(composition !== "ui");
      expect(!!app.host).toBe(composition === "full");
      expect(app.auth).toBeUndefined();
      for (const section of ["ui", "api", "host"] as const) {
        expect(app[section]?.production).toBeUndefined();
        expect(app[section]?.integrity).toBeUndefined();
      }

      const plugins = (config.plugins ?? {}) as Record<string, unknown>;
      if (composition === "full") {
        expect(plugins.template).toMatchObject({ development: "local:plugins/_template" });
      } else {
        expect(Object.keys(plugins)).toEqual([]);
      }
    });

    it("root manifest and workspace yaml match the composition", () => {
      const pkg = JSON.parse(readFileSync(join(child.dir, "package.json"), "utf-8")) as {
        name?: string;
        private?: boolean;
        type?: string;
        packageManager?: string;
        module?: string;
        peerDependencies?: Record<string, string>;
        workspaces?: unknown;
        dependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      expect(pkg.name).toBe("monorepo");
      expect(pkg.private).toBe(true);
      expect(pkg.type).toBe("module");
      expect(pkg.packageManager).toBe(PNPM_PACKAGE_MANAGER);
      expect(pkg.module).toBeUndefined();
      expect(pkg.peerDependencies).toBeUndefined();
      expect(pkg.workspaces).toBeUndefined();
      expect(pkg.dependencies?.["everything-dev"]).toBe("catalog:");
      expect(pkg.dependencies?.["every-plugin"]).toBe("catalog:");
      expect(pkg.dependencies?.["@opentelemetry/api"]).toBe("catalog:");

      // #572: children have no changesets — no version/release scripts.
      for (const script of ["version", "release", "changeset", "sync-catalog", "init", "prepare"]) {
        expect(pkg.scripts?.[script]).toBeUndefined();
      }
      // pnpm 12 forwards everything after `run <script>` to the script itself,
      // so pnpm flags must precede `run` — a trailing --if-present reaches
      // vitest and dies with `CACError: Unknown option --ifPresent`.
      for (const script of [pkg.scripts?.["test:api"], pkg.scripts?.test]) {
        if (script !== undefined) {
          expect(script).toMatch(/--if-present run /);
          expect(script.includes("run test --if-present")).toBe(false);
        }
      }
      expect(pkg.scripts?.["dev:ui"]).toBeDefined();
      expect(!!pkg.scripts?.["dev:api"]).toBe(composition !== "ui");
      expect(!!pkg.scripts?.["db:push"]).toBe(composition !== "ui");
      expect(!!pkg.scripts?.["test:api"]).toBe(composition !== "ui");
      expect(!!pkg.scripts?.["test:e2e"]).toBe(composition === "full");

      const workspace = parseYaml(
        readFileSync(join(child.dir, "pnpm-workspace.yaml"), "utf-8"),
      ) as {
        packages?: string[];
        catalog?: Record<string, string>;
      };
      const expectedPackages: Record<Composition, string[]> = {
        ui: ["ui"],
        "ui+api": ["api", "ui"],
        full: ["api", "host", "plugins/*", "ui"],
      };
      expect(workspace.packages).toEqual(expectedPackages[composition]);
      expect(workspace.catalog?.["everything-dev"]).toBe(
        MANIFEST_SPEC.rootCatalog["everything-dev"],
      );
      expect(workspace.catalog?.["every-plugin"]).toBe(MANIFEST_SPEC.rootCatalog["every-plugin"]);
    });

    it("AGENTS.md teaches the current runtime, not the legacy one", () => {
      const agentsMd = readFileSync(join(child.dir, "AGENTS.md"), "utf-8");
      expect(agentsMd).toContain("Never use bun");
      expect(agentsMd).not.toMatch(/\bbun (install|run|x)\b/);
      expect(agentsMd).toContain("sputnik-dao");
      expect(agentsMd).not.toContain("NEAR_SUB_ACCOUNT_PARENT_KEY");
      expect(agentsMd).toContain(
        "[`docs/agents/coding-standards.md`](docs/agents/coding-standards.md)",
      );
      expect(agentsMd).toContain("[`docs/agents/testing.md`](docs/agents/testing.md)");
    });

    it("ui surface survives the prune idempotently", () => {
      const listFiles = (dir: string): string[] => {
        try {
          return readdirSync(dir, { recursive: true });
        } catch {
          return [];
        }
      };
      const appSurface = readFileSync(join(child.dir, "ui", "src", "app.ts"), "utf-8");
      expect(appSurface).toContain("export const appLocale");
      expect(appSurface).toContain("export const apiConnectionError");
      expect(existsSync(join(child.dir, "ui", "src", "router.tsx"))).toBe(true);
      expect(existsSync(join(child.dir, "ui", "src", "lib", "api.ts"))).toBe(true);
      expect(
        listFiles(join(child.dir, "ui", "src", "components", "ui")).length,
      ).toBeGreaterThanOrEqual(10);
      const barrel = readFileSync(join(child.dir, "ui", "src", "components", "index.ts"), "utf-8");
      expect(barrel).toContain('from "./ui/button"');

      const before = listFiles(join(child.dir, "ui", "src"));
      pruneUnusedUiFiles(child.dir);
      expect(listFiles(join(child.dir, "ui", "src"))).toEqual(before);
    });
  });
});

const INSTALL_CELLS: Array<{ level: Level; composition: Composition }> = [
  { level: "simple", composition: "ui" },
  { level: "simple", composition: "ui+api" },
  { level: "advanced", composition: "ui+api" },
  { level: "advanced", composition: "full" },
];

const INSTALL_GATES = [
  "scaffold",
  "framework-packs",
  "install",
  "types",
  "migrations",
  "typecheck",
];

describe.each(INSTALL_CELLS)("init $level@$composition — born healthy (install lane)", ({
  level,
  composition,
}) => {
  let reports: GateReport[] = [];

  beforeAll(async () => {
    let child!: Scaffolded;
    let typed!: Typed;
    reports = await Effect.runPromise(
      Effect.scoped(
        runLane([
          {
            gate: "scaffold",
            effect: Effect.gen(function* () {
              child = yield* scaffoldChild({ level, composition });
              pendingCleanup.push(child.dir);
            }),
          },
          {
            gate: "framework-packs",
            effect: Effect.gen(function* () {
              yield* ensureFrameworkDists();
              yield* attempt("framework-packs", "getFrameworkTarballs", async () => {
                const tarballs = await getFrameworkTarballs(REPO_ROOT);
                rewriteFrameworkPackageSpecs(child.dir, tarballs);
              });
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
              typed = yield* typegenChild(child);
            }),
          },
          // Token-consuming steps read lazily: the steps array is built
          // before the lane runs, so a bare `migrateChild(typed)` would
          // capture `undefined`.
          {
            gate: "migrations",
            effect: Effect.gen(function* () {
              yield* migrateChild(typed);
            }),
          },
          {
            gate: "typecheck",
            effect: Effect.gen(function* () {
              yield* typecheckChild(typed);
            }),
          },
        ]),
      ),
    );
  }, 1_200_000);

  it.each(INSTALL_GATES)("gate %s", (gate: string) => {
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
});
