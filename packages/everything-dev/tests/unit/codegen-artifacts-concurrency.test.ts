import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncApiContractBridge } from "../../src/services/codegen/api-contract";
import { writeResolvedConfig } from "../../src/services/resolution/serialize";
import type { BosConfig, RuntimeConfig } from "../../src/types";

/**
 * Concurrent `bos dev` sessions in one config dir are a supported flow, and
 * their artifact generations raced: a torn `bos.resolved-config.json` read
 * resolved plugins without a localPath, flipping the sweep into deleting
 * another boot's freshly written gen files, and the sweep's unguarded
 * `rmSync` crashed with ENOENT. The resolved-config write is atomic (tmp +
 * rename) and the sweep is force-tolerant — this test exercises the real
 * bridge under concurrency so neither flavor can regress silently.
 */

const CONFIG = {
  account: "race.near",
  domain: "race.dev",
  app: {
    host: {
      name: "host",
      url: "http://localhost:3000",
      entry: "./src/program.ts",
      source: "local",
    },
    ui: { name: "ui", url: "http://localhost:3003", entry: "./src/entry.tsx", source: "local" },
    api: { name: "api", url: "http://localhost:3001", entry: "./src/index.ts", source: "local" },
  },
} as unknown as BosConfig;

const PLUGIN_KEYS = ["fakea", "fakeb"];

function writeContractSource(dir: string, name: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "contract.ts"),
    `import { oc } from "@orpc/contract";
import { z } from "zod";

export const ${name}Contract = {
  ping: oc.route({ method: "GET", path: "/ping" }).output(z.object({ ok: z.boolean() })),
};
`,
  );
}

function buildRuntimeConfig(projectDir: string): RuntimeConfig {
  return {
    env: "development",
    account: "race.near",
    networkId: "testnet",
    host: {
      name: "host",
      url: "http://localhost:3000",
      entry: "./src/program.ts",
      source: "local",
    },
    ui: {
      name: "ui",
      url: "http://localhost:3003",
      entry: "./src/entry.tsx",
      source: "local",
      localPath: join(projectDir, "ui"),
    },
    api: {
      name: "api",
      url: "http://localhost:3001",
      entry: "./src/index.ts",
      source: "local",
      localPath: join(projectDir, "api"),
    },
    plugins: Object.fromEntries(
      PLUGIN_KEYS.map((key) => [
        key,
        {
          name: `race-${key}`,
          url: `http://localhost:4110/${key}`,
          entry: "./src/index.ts",
          source: "local",
          localPath: join(projectDir, "plugins", key),
        },
      ]),
    ),
  } as unknown as RuntimeConfig;
}

describe("codegen artifact generation under concurrent boots", () => {
  let projectDir: string;

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), "bos-codegen-race-"));
    writeFileSync(join(projectDir, "bos.config.json"), JSON.stringify(CONFIG));
    const apiDir = join(projectDir, "api");
    writeContractSource(apiDir, "apiBase"); // api/src/contract.ts
    for (const key of PLUGIN_KEYS) {
      const pluginDir = join(projectDir, "plugins", key);
      cpSync(apiDir, pluginDir, { recursive: true });
    }
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("parallel bridge syncs and resolved-config writes never crash or tear", async () => {
    const runtimeConfig = buildRuntimeConfig(projectDir);

    const cycles = 8;
    for (let cycle = 0; cycle < cycles; cycle++) {
      await Promise.all([
        syncApiContractBridge({
          configDir: projectDir,
          runtimeConfig,
          apiBaseUrl: "http://localhost:3001",
        }),
        syncApiContractBridge({
          configDir: projectDir,
          runtimeConfig,
          apiBaseUrl: "http://localhost:3001",
        }),
        writeResolvedConfig(projectDir, CONFIG, "development", ["bos://parent.near/app"]),
      ]);

      const resolved = JSON.parse(
        readFileSync(join(projectDir, ".bos", "bos.resolved-config.json"), "utf-8"),
      ) as { _resolved?: { env: string; extendsChain: string[] } };
      expect(resolved._resolved).toMatchObject({ env: "development" });
    }

    for (const key of PLUGIN_KEYS) {
      const genPath = join(projectDir, "plugins", key, "src", "lib", "plugins-client.gen.ts");
      expect(existsSync(genPath), `${genPath} must survive concurrent generations`).toBe(true);
      expect(readFileSync(genPath, "utf-8")).toContain("export type PluginsClient");
    }

    expect(
      readFileSync(join(projectDir, "ui", "src", "lib", "api-types.gen.ts"), "utf-8"),
    ).toContain("export type ApiContract");
  });

  it("sweeps stale gen files of unconfigured plugins without crashing", async () => {
    const ghost = join(projectDir, "plugins", "ghost", "src", "lib");
    mkdirSync(ghost, { recursive: true });
    writeFileSync(join(ghost, "plugins-client.gen.ts"), "export type Stale = never;\n");

    await syncApiContractBridge({
      configDir: projectDir,
      runtimeConfig: buildRuntimeConfig(projectDir),
      apiBaseUrl: "http://localhost:3001",
    });

    expect(existsSync(join(ghost, "plugins-client.gen.ts"))).toBe(false);
  });
});
