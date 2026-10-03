import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { syncEnvFile } from "../../src/env/project-env";

function makeEnvDir(content: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "bos-env-sync-"));
  if (content !== null) {
    writeFileSync(join(dir, ".env"), content);
  }
  return dir;
}

const runSync = (
  dir: string,
  generated: Record<string, string>,
  shellEnv: Record<string, string> = {},
) => Effect.runPromise(syncEnvFile(dir, generated, shellEnv));

describe("syncEnvFile", () => {
  it("updates drifted bos-owned lines and preserves everything else", async () => {
    const dir = makeEnvDir(
      [
        "# Generated from configured bos secrets",
        "CORS_ORIGIN=http://localhost:3000",
        "# user comment",
        "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5432/api_db",
        "MY_CUSTOM_FLAG=keep-me",
        "",
      ].join("\n"),
    );

    const drift = await runSync(dir, {
      CORS_ORIGIN: "http://localhost:3008",
      API_DATABASE_URL: "postgres://everythingdev:everythingdev@localhost:5432/api_db",
    });

    expect(drift).toEqual([
      { key: "CORS_ORIGIN", from: "http://localhost:3000", to: "http://localhost:3008" },
    ]);

    const content = readFileSync(join(dir, ".env"), "utf-8");
    expect(content).toContain("CORS_ORIGIN=http://localhost:3008");
    expect(content).toContain("# user comment");
    expect(content).toContain("MY_CUSTOM_FLAG=keep-me");
  });

  it("appends generated keys missing from the file", async () => {
    const dir = makeEnvDir("MY_CUSTOM_FLAG=keep-me\n");

    const drift = await runSync(dir, { CORS_ORIGIN: "http://localhost:3000" });

    expect(drift).toEqual([{ key: "CORS_ORIGIN", from: undefined, to: "http://localhost:3000" }]);
    const content = readFileSync(join(dir, ".env"), "utf-8");
    expect(content).toContain("MY_CUSTOM_FLAG=keep-me");
    expect(content).toContain("CORS_ORIGIN=http://localhost:3000");
  });

  it("skips shell-exported keys — a deliberate override is not reverted on disk", async () => {
    const dir = makeEnvDir(
      "CORS_ORIGIN=http://localhost:3000\nAPI_DATABASE_URL=postgres://u:p@127.0.0.1:5434/api_test_db\n",
    );

    const drift = await runSync(
      dir,
      {
        CORS_ORIGIN: "http://localhost:3008",
        API_DATABASE_URL: "postgres://u:p@127.0.0.1:5432/api_db",
      },
      { API_DATABASE_URL: "postgres://u:p@127.0.0.1:5434/api_test_db" },
    );

    expect(drift).toEqual([
      { key: "CORS_ORIGIN", from: "http://localhost:3000", to: "http://localhost:3008" },
    ]);
    const content = readFileSync(join(dir, ".env"), "utf-8");
    expect(content).toContain("CORS_ORIGIN=http://localhost:3008");
    expect(content).toContain("API_DATABASE_URL=postgres://u:p@127.0.0.1:5434/api_test_db");
  });

  it("is idempotent once aligned", async () => {
    const dir = makeEnvDir("CORS_ORIGIN=http://localhost:3008\n");

    expect(await runSync(dir, { CORS_ORIGIN: "http://localhost:3008" })).toEqual([]);
    expect(await runSync(dir, { CORS_ORIGIN: "http://localhost:3008" })).toEqual([]);

    const content = readFileSync(join(dir, ".env"), "utf-8");
    expect(content).toBe("CORS_ORIGIN=http://localhost:3008\n");
  });

  it("returns no drift and does not create the file when .env is absent", async () => {
    const dir = makeEnvDir(null);

    expect(await runSync(dir, { CORS_ORIGIN: "http://localhost:3000" })).toEqual([]);
    expect(() => readFileSync(join(dir, ".env"), "utf-8")).toThrow();
  });

  it("ignores commented-out lines and does not treat them as present keys", async () => {
    const dir = makeEnvDir("# CORS_ORIGIN=http://localhost:3000\n");

    const drift = await runSync(dir, { CORS_ORIGIN: "http://localhost:3008" });

    expect(drift).toEqual([{ key: "CORS_ORIGIN", from: undefined, to: "http://localhost:3008" }]);
    const content = readFileSync(join(dir, ".env"), "utf-8");
    expect(content).toContain("# CORS_ORIGIN=http://localhost:3000");
    expect(content).toContain("CORS_ORIGIN=http://localhost:3008");
  });
});
