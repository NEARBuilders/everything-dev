import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { captureShellEnv, makeProjectEnv } from "../../src/env/project-env";
import { mergeGeneratedOverFileEnv } from "../../src/orchestrator";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const tempDirs: string[] = [];
const trackedEnvKeys = new Set<string>();

function makeEnvDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "bos-project-env-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function trackEnvKey(key: string): void {
  trackedEnvKeys.add(key);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  for (const key of trackedEnvKeys) {
    delete process.env[key];
  }
  trackedEnvKeys.clear();
});

describe("ProjectEnv service", () => {
  it("ensureFile creates .env from .env.example with a generated auth secret, once", async () => {
    const dir = makeEnvDir({
      ".env.example": "BETTER_AUTH_SECRET=replace-me\nCORS_ORIGIN=http://localhost:3000\n",
    });
    const env = makeProjectEnv();

    expect(await run(env.ensureFile(dir))).toBe(true);

    const content = readEnv(dir);
    expect(content).toMatch(/BETTER_AUTH_SECRET=[A-Za-z0-9_-]{30,}/);
    expect(content).toContain("CORS_ORIGIN=http://localhost:3000");

    expect(await run(env.ensureFile(dir))).toBe(false);
  });

  it("ensureFile is a no-op when .env.example is absent", async () => {
    const dir = makeEnvDir();
    const env = makeProjectEnv();

    expect(await run(env.ensureFile(dir))).toBe(false);
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });

  it("load dedupes per directory and force reloads after .env changes", async () => {
    const dir = makeEnvDir({ ".env": "FIRST_KEY=one\n" });
    const env = makeProjectEnv();
    trackEnvKey("FIRST_KEY");
    trackEnvKey("SECOND_KEY");

    delete process.env.FIRST_KEY;
    delete process.env.SECOND_KEY;

    await run(env.load(dir));
    expect(process.env.FIRST_KEY).toBe("one");

    await run(env.load(dir));
    expect(process.env.FIRST_KEY).toBe("one");

    writeFileSync(join(dir, ".env"), "FIRST_KEY=one\nSECOND_KEY=two\n");
    await run(env.load(dir));
    expect(process.env.SECOND_KEY).toBeUndefined();

    await run(env.load(dir, { force: true }));
    expect(process.env.SECOND_KEY).toBe("two");
    expect(process.env.FIRST_KEY).toBe("one");
  });
});

describe("three-tier env precedence at the merge point", () => {
  it("shell tier survives .env loading; generated env outranks .env-sourced values", async () => {
    const dir = makeEnvDir({
      ".env": "DRIFTED_PORT=3000\nSHELL_EXPORTED=from-shell\nFILE_ONLY=from-file\n",
    });
    const env = makeProjectEnv();

    trackEnvKey("DRIFTED_PORT");
    trackEnvKey("SHELL_EXPORTED");
    trackEnvKey("FILE_ONLY");
    trackEnvKey("GENERATED_ONLY");

    process.env.SHELL_EXPORTED = "from-shell";
    const shell = await run(captureShellEnv);

    delete process.env.DRIFTED_PORT;
    delete process.env.FILE_ONLY;
    await run(env.load(dir));
    expect(process.env.DRIFTED_PORT).toBe("3000");

    const generated = { DRIFTED_PORT: "3008", GENERATED_ONLY: "gen" };
    const merged = mergeGeneratedOverFileEnv(
      generated,
      process.env as Record<string, string>,
      shell,
    );

    expect(merged.DRIFTED_PORT).toBe("3008");
    expect(merged.SHELL_EXPORTED).toBe("from-shell");
    expect(merged.FILE_ONLY).toBe("from-file");
    expect(merged.GENERATED_ONLY).toBe("gen");
  });
});

function readEnv(dir: string): string {
  return readFileSync(join(dir, ".env"), "utf-8");
}
