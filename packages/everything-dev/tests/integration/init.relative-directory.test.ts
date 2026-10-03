import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildInitPatterns, copyFilteredFiles, personalizeConfig } from "../../src/cli/init";
import { makeProjectEnv } from "../../src/env/project-env";
import { InfraMaterializer, InfraMaterializerLive } from "../../src/infra/materializer";
import { openResolution } from "../../src/resolution/session";
import type { RuntimeConfig } from "../../src/types";
import { loadParentConfigFixture, writeChildConfigFixture } from "../helpers/parent-config";

vi.mock("../../src/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/fastkv")>();
  return {
    ...actual,
    fetchBosConfigFromFastKv: async <T>() => {
      return (await loadParentConfigFixture()) as T;
    },
  };
});
vi.mock("../../src/http-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/http-client")>();
  return {
    ...actual,
    fetchResponse: async () => {
      throw new Error("network disabled in test");
    },
    fetchJsonOrNull: async () => null,
  };
});

async function materialize(targetDir: string, runtime: RuntimeConfig): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      const m = yield* InfraMaterializer;
      yield* m.materializeTemplate(targetDir, runtime);
      yield* m.materializeTestInfra(targetDir, runtime);
    }).pipe(Effect.provide(InfraMaterializerLive)),
  );
}

const REPO_ROOT = join(import.meta.dirname, "../../../../");

describe("bos init - relative directory", () => {
  let workingDir: string;
  let previousCwd: string;

  beforeAll(() => {
    workingDir = mkdtempSync(join(tmpdir(), "bos-init-relative-"));
    previousCwd = process.cwd();
    process.chdir(workingDir);
  });

  afterAll(() => {
    process.chdir(previousCwd);
    rmSync(workingDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("generates infra files when the target directory starts as relative", async () => {
    const relativeDir = "testing.com";
    const targetDir = resolve(relativeDir);
    const patterns = buildInitPatterns(["ui", "api"]);

    await copyFilteredFiles(REPO_ROOT, targetDir, patterns, {
      overrides: ["ui", "api"],
      plugins: [],
    });
    writeChildConfigFixture(targetDir, ["ui", "api"], {});
    await personalizeConfig(targetDir, {
      extendsAccount: "dev.everything.near",
      extendsGateway: "everything.dev",
      account: "testing.near",
      domain: "testing.com",
      plugins: [],
      overrides: ["ui", "api", "plugins"],
      workspaceOpts: { sourceDir: REPO_ROOT },
    });

    const session = await openResolution({ cwd: targetDir });
    expect(session?.config.account).toBe("testing.near");
    expect(session?.config.domain).toBe("testing.com");

    if (!session?.runtime) {
      throw new Error("Expected runtime config to be available");
    }

    await materialize(targetDir, session.runtime);
    await Effect.runPromise(makeProjectEnv().ensureFile(targetDir));

    expect(existsSync(join(targetDir, "bos.config.json"))).toBe(true);
    expect(existsSync(join(targetDir, ".env.example"))).toBe(true);
    expect(existsSync(join(targetDir, "docker-compose.yml"))).toBe(true);

    const envExample = readFileSync(join(targetDir, ".env.example"), "utf-8");
    const dockerCompose = readFileSync(join(targetDir, "docker-compose.yml"), "utf-8");

    // Auth env materializes when the auth workspace is present in the child
    // (composed inits); the ui/api-only scaffold carries the api + host vars.
    expect(envExample).toContain(
      "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5432/api_db",
    );
    expect(envExample).toContain("CORS_ORIGIN=http://localhost:3000");
    expect(envExample).not.toContain("PROJECTS_DATABASE_URL=");

    expect(dockerCompose).toContain("postgres-api:");
    expect(dockerCompose).toContain("postgres-api-test:");
    expect(dockerCompose).not.toContain("postgres-auth:");
    expect(dockerCompose).not.toContain("postgres-example:");
  }, 60_000);
});
