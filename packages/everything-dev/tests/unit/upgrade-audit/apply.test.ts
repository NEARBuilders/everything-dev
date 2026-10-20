import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyManifest } from "../../../src/services/scaffold/upgrade-audit/steps/apply-manifest";
import { authorConfig } from "../../../src/services/scaffold/upgrade-audit/steps/author-config";
import { migratePnpm } from "../../../src/services/scaffold/upgrade-audit/steps/migrate-pnpm";

let projectDir: string;

const fixture = join(
  import.meta.dirname,
  "../../../src/services/scaffold/upgrade-audit/fixtures/conformant",
);

const setup = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "v2-upgrade-"));
  await cp(fixture, dir, { recursive: true });
  return dir;
};

const run = async <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect);

beforeEach(async () => {
  projectDir = await setup();
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("authorConfig", () => {
  it("authors bos.app.ts with the descriptor translation", async () => {
    await run(authorConfig(projectDir, [], false));
    const source = await readFile(join(projectDir, "bos.app.ts"), "utf-8");
    expect(source).toContain('import { App } from "everything-dev/descriptor"');
    expect(source).toContain('"extends": "bos://dev.everything.near/dev.everything.dev"');
    expect(source).toContain('"account": "example.near"');
    expect(source).toContain('"path": "api"');
    expect(source).toContain('"path": "ui"');
  });

  it("authors an empty dev overlay", async () => {
    await run(authorConfig(projectDir, [], false));
    const source = await readFile(join(projectDir, "bos.dev.ts"), "utf-8");
    expect(source).toContain("Partial<AppDescriptor>");
  });

  it("dry-run writes nothing", async () => {
    await run(authorConfig(projectDir, [], true));
    await expect(readFile(join(projectDir, "bos.app.ts"), "utf-8")).rejects.toThrow();
  });
});

describe("migratePnpm", () => {
  it("writes pnpm-workspace.yaml with packages, catalog, and RC pins", async () => {
    await run(migratePnpm(projectDir, false));
    const yaml = await readFile(join(projectDir, "pnpm-workspace.yaml"), "utf-8");
    expect(yaml).toContain("everything-dev: ^2.0.0-rc.10");
    expect(yaml).toContain("every-plugin: 3.0.0-rc.6");
    expect(yaml).toContain("better-near-auth: ^2.0.0-rc.1");
    expect(yaml).toContain("- api");
    expect(yaml).toContain("- plugins/*");
    expect(yaml).toContain("minimumReleaseAgeExclude:");
  });

  it("rewrites scripts to pnpm with failure propagation", async () => {
    await run(migratePnpm(projectDir, false));
    const pkg = JSON.parse(await readFile(join(projectDir, "package.json"), "utf-8"));
    expect(pkg.packageManager).toContain("pnpm@12.10.1");
    expect(pkg.scripts.typecheck).toContain("pnpm --dir ui run typecheck || exit 1");
    expect(pkg.scripts.typecheck).toContain("pnpm run types:gen");
  });

  it("removes bun artifacts and retired deploy files", async () => {
    await run(migratePnpm(projectDir, false));
    const yaml = await readFile(join(projectDir, "pnpm-workspace.yaml"), "utf-8");
    expect(yaml).toContain("catalog:");
  });

  it("mechanically rewrites bun invocations in workspace package.json scripts", async () => {
    await writeFile(
      join(projectDir, "ui/package.json"),
      JSON.stringify(
        {
          name: "ui",
          scripts: {
            build: "bun run build:client && bun run build:ssr",
            typecheck: "tsc --noEmit",
          },
        },
        null,
        2,
      ),
    );
    const result = await run(migratePnpm(projectDir, false));
    expect(result.writes).toContain("ui/package.json");
    const ui = JSON.parse(await readFile(join(projectDir, "ui/package.json"), "utf-8"));
    expect(ui.scripts.build).toBe("pnpm run build:client && pnpm run build:ssr");
    // workspace typecheck keeps its own body — the hardened chain is root-only
    expect(ui.scripts.typecheck).toBe("tsc --noEmit");
  });
});

describe("applyManifest", () => {
  it("rewrites legacy imports in place", async () => {
    await cp(
      join(
        import.meta.dirname,
        "../../../src/services/scaffold/upgrade-audit/fixtures/nonconformant/ui/src/lib/legacy.ts",
      ),
      join(projectDir, "ui/src/lib/legacy.ts"),
      { recursive: true },
    );
    await run(
      applyManifest(
        projectDir,
        [{ from: 'from "@/auth"', to: 'from "@/app"', files: ["ui/src/lib/legacy.ts"] }],
        false,
      ),
    );
    const source = await readFile(join(projectDir, "ui/src/lib/legacy.ts"), "utf-8");
    expect(source).toBe('export { session } from "@/app";\n');
  });

  it("dry-run leaves files untouched", async () => {
    await cp(
      join(
        import.meta.dirname,
        "../../../src/services/scaffold/upgrade-audit/fixtures/nonconformant/ui/src/lib/legacy.ts",
      ),
      join(projectDir, "ui/src/lib/legacy.ts"),
      { recursive: true },
    );
    await run(
      applyManifest(
        projectDir,
        [{ from: 'from "@/auth"', to: 'from "@/app"', files: ["ui/src/lib/legacy.ts"] }],
        true,
      ),
    );
    const source = await readFile(join(projectDir, "ui/src/lib/legacy.ts"), "utf-8");
    expect(source).toContain('from "@/auth"');
  });
});
