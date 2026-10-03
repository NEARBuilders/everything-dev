import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bindingEnv, resolveDatabaseUrl, workspaceIdentityFromWorkspaceDir } from "../../src/db";

const DRIZZLE_KIT_STUDIO_ARGV = ["node", "/repo/node_modules/drizzle-kit/bin.cjs", "studio"];
const DRIZZLE_KIT_GENERATE_ARGV = ["node", "/repo/node_modules/drizzle-kit/bin.cjs", "generate"];
const NON_DRIZZLE_KIT_ARGV = ["node", "/repo/scripts/build.ts"];

function makeWorkspace(): { workspaceDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "everything-dev-binding-"));
  const workspaceDir = join(root, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(
    join(workspaceDir, "package.json"),
    `${JSON.stringify({ name: "@everything-dev/widgets-plugin" })}\n`,
  );
  return { workspaceDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("resolveDatabaseUrl", () => {
  it("prefers the canonical secret from the environment", () => {
    const { workspaceDir, cleanup } = makeWorkspace();
    try {
      const identity = workspaceIdentity(workspaceDir);
      const url = resolveDatabaseUrl(identity, {
        env: { WIDGETS_DATABASE_URL: "postgres://direct:value@localhost:5432/x" },
        argv: DRIZZLE_KIT_STUDIO_ARGV,
      });
      expect(url).toBe("postgres://direct:value@localhost:5432/x");
    } finally {
      cleanup();
    }
  });

  it("falls back to the nearest .env walked up from the workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "everything-dev-binding-env-"));
    const workspaceDir = join(root, "nested", "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(workspaceDir, "package.json"),
      `${JSON.stringify({ name: "@everything-dev/widgets-plugin" })}\n`,
    );
    writeFileSync(
      join(root, ".env"),
      "WIDGETS_DATABASE_URL=postgres://envfile:value@localhost:5432/widgets_db\n",
    );
    try {
      const identity = workspaceIdentity(workspaceDir);
      const url = resolveDatabaseUrl(identity, {
        env: {},
        argv: DRIZZLE_KIT_STUDIO_ARGV,
      });
      expect(url).toBe("postgres://envfile:value@localhost:5432/widgets_db");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws a loud error naming the secret when a DB-requiring command has no URL", () => {
    const { workspaceDir, cleanup } = makeWorkspace();
    try {
      const identity = workspaceIdentity(workspaceDir);
      expect(() =>
        resolveDatabaseUrl(identity, { env: {}, argv: DRIZZLE_KIT_STUDIO_ARGV }),
      ).toThrow(/WIDGETS_DATABASE_URL/);
      expect(() =>
        resolveDatabaseUrl(identity, { env: {}, argv: DRIZZLE_KIT_STUDIO_ARGV }),
      ).toThrow(/drizzle-kit studio/);
    } finally {
      cleanup();
    }
  });

  it("returns a pglite placeholder for generate (never connects)", () => {
    const { workspaceDir, cleanup } = makeWorkspace();
    try {
      const identity = workspaceIdentity(workspaceDir);
      expect(resolveDatabaseUrl(identity, { env: {}, argv: DRIZZLE_KIT_GENERATE_ARGV })).toBe(
        "pglite:.bos/widgets/:memory:",
      );
    } finally {
      cleanup();
    }
  });

  it("returns a pglite placeholder outside drizzle-kit invocations", () => {
    const { workspaceDir, cleanup } = makeWorkspace();
    try {
      const identity = workspaceIdentity(workspaceDir);
      expect(resolveDatabaseUrl(identity, { env: {}, argv: NON_DRIZZLE_KIT_ARGV })).toBe(
        "pglite:.bos/widgets/:memory:",
      );
    } finally {
      cleanup();
    }
  });
});

function workspaceIdentity(workspaceDir: string) {
  return workspaceIdentityFromWorkspaceDir(workspaceDir);
}

describe("bindingEnv", () => {
  it("materializes the canonical secret name to the resolved URL", () => {
    expect(
      bindingEnv({ secretName: "WIDGETS_DATABASE_URL", url: "postgres://u:p@h:5432/db" }),
    ).toEqual({ WIDGETS_DATABASE_URL: "postgres://u:p@h:5432/db" });
  });
});
