import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retireZephyr } from "../../../src/services/scaffold/upgrade-audit/steps/retire-zephyr";

let projectDir: string;

const run = async (dryRun: boolean) => Effect.runPromise(retireZephyr(projectDir, dryRun));

const write = async (relPath: string, content: string) => {
  const full = join(projectDir, relPath);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
};

const read = (relPath: string) => readFile(join(projectDir, relPath), "utf-8");

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "v2-upgrade-retire-zephyr-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("retireZephyr", () => {
  describe("ui/rsbuild.config.ts", () => {
    beforeEach(async () => {
      await write(
        "ui/rsbuild.config.ts",
        [
          'import { defineConfig } from "@rsbuild/core";',
          'import { computeSriHashForUrl, reportDeployResult } from "everything-dev/integrity";',
          'import { withZephyr } from "zephyr-rsbuild-plugin";',
          "",
          'const uiBosConfigPath = "../bos.config.json";',
          'const shouldDeploy = process.env.DEPLOY === "true";',
          "",
          "export default defineConfig({",
          "  devtool: shouldDeploy ? false : 'source-map',",
          "  plugins: [],",
          "});",
          "",
          "if (shouldDeploy) {",
          "  plugins.push(",
          "    withZephyr({",
          "      hooks: {",
          "        onDeployComplete: async (info) => {",
          '          console.log("deployed", info.url);',
          "          const integrity = await computeSriHashForUrl(info.url);",
          "          reportDeployResult({",
          "            url: info.url,",
          "            integrity,",
          "            bosConfigPath: uiBosConfigPath,",
          '            urlField: "app.ui.production",',
          "          });",
          "        },",
          "      },",
          "    }),",
          "  );",
          "}",
          "",
        ].join("\n"),
      );
    });

    it("removes the withZephyr push block, imports, and unused helpers", async () => {
      const result = await run(false);
      expect(result.writes).toContain("ui/rsbuild.config.ts");
      const source = await read("ui/rsbuild.config.ts");
      expect(source).not.toContain("withZephyr");
      expect(source).not.toContain("everything-dev/integrity");
      expect(source).not.toContain("uiBosConfigPath");
      expect(source).not.toContain("if (shouldDeploy)");
      // shouldDeploy stays — it still gates devtool
      expect(source).toContain("shouldDeploy ? false");
    });

    it("keeps the config intact on dry-run", async () => {
      const before = await read("ui/rsbuild.config.ts");
      await run(true);
      expect(await read("ui/rsbuild.config.ts")).toBe(before);
    });
  });

  describe("rspack conditional default export", () => {
    beforeEach(async () => {
      await write(
        "api/rspack.config.js",
        [
          'import { computeSriHashForUrl, reportDeployResult } from "everything-dev/integrity";',
          'import { withZephyr } from "zephyr-rspack-plugin";',
          'import { defineConfig } from "./base";',
          "",
          'const shouldDeploy = process.env.DEPLOY === "true";',
          "",
          "const baseConfig = defineConfig({ devtool: 'source-map' });",
          "",
          "export default shouldDeploy",
          "  ? withZephyr({",
          "      hooks: {",
          "        onDeployComplete: async (info) => {",
          "          const integrity = await computeSriHashForUrl(info.url);",
          "          reportDeployResult({ url: info.url, integrity });",
          "        },",
          "      },",
          "    })",
          "  : baseConfig;",
          "",
        ].join("\n"),
      );
    });

    it("unwraps the ternary to the base config and drops unused imports", async () => {
      const result = await run(false);
      expect(result.writes).toContain("api/rspack.config.js");
      const source = await read("api/rspack.config.js");
      expect(source).toContain("export default baseConfig;");
      expect(source).not.toContain("withZephyr");
      expect(source).not.toContain("everything-dev/integrity");
    });
  });

  it("leaves configs without Zephyr wiring untouched", async () => {
    await write("api/rspack.config.js", 'export default { devtool: "source-map" };\n');
    const result = await run(false);
    expect(result.writes).not.toContain("api/rspack.config.js");
    expect(result.notes.join("\n")).toMatch(/no Zephyr wiring/);
  });

  it("strips zephyr deps from workspace packages and the root catalog", async () => {
    await write(
      "package.json",
      JSON.stringify(
        {
          name: "monorepo",
          workspaces: {
            packages: ["ui", "api"],
            catalog: {
              "zephyr-rsbuild-plugin": "^1.1.2",
              "zephyr-rspack-plugin": "^1.1.2",
              react: "19.2.4",
            },
          },
        },
        null,
        2,
      ),
    );
    await write(
      "ui/package.json",
      JSON.stringify(
        { name: "ui", dependencies: { "zephyr-rsbuild-plugin": "catalog:", react: "catalog:" } },
        null,
        2,
      ),
    );
    await write(
      "plugins/crosspost/package.json",
      JSON.stringify(
        { name: "crosspost", dependencies: { "zephyr-rspack-plugin": "catalog:" } },
        null,
        2,
      ),
    );

    const result = await run(false);
    const root = JSON.parse(await read("package.json"));
    const ui = JSON.parse(await read("ui/package.json"));
    const crosspost = JSON.parse(await read("plugins/crosspost/package.json"));
    expect(root.workspaces.catalog["zephyr-rsbuild-plugin"]).toBeUndefined();
    expect(root.workspaces.catalog["zephyr-rspack-plugin"]).toBeUndefined();
    expect(root.workspaces.catalog.react).toBe("19.2.4");
    expect(ui.dependencies["zephyr-rsbuild-plugin"]).toBeUndefined();
    expect(ui.dependencies.react).toBe("catalog:");
    expect(crosspost.dependencies["zephyr-rspack-plugin"]).toBeUndefined();
    expect(result.writes).toContain("package.json");
    expect(result.writes).toContain("ui/package.json");
    expect(result.writes).toContain("plugins/crosspost/package.json");
  });

  it("no-ops on a tree without any Zephyr wiring", async () => {
    const result = await run(false);
    expect(result.writes).toEqual([]);
    expect(result.notes.join("\n")).toMatch(/no Zephyr wiring found/);
  });
});
