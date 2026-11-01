import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bindingEnv,
  drizzleCredentialsFor,
  resolveDatabaseUrl,
  workspaceIdentityFromWorkspaceDir,
} from "../../src/db";

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
      const url = resolveDatabaseUrl(identity, { env: {} });
      expect(url).toBe("postgres://envfile:value@localhost:5432/widgets_db");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("defaults to the persistent pglite data dir when no URL is configured", () => {
    const { workspaceDir, cleanup } = makeWorkspace();
    try {
      const identity = workspaceIdentity(workspaceDir);
      expect(resolveDatabaseUrl(identity, { env: {} })).toBe("pglite:.bos/db");
    } finally {
      cleanup();
    }
  });
});

describe("drizzleCredentialsFor", () => {
  it("selects the pglite dialect and data-dir driver tag for pglite URLs", () => {
    expect(drizzleCredentialsFor("pglite:.bos/db")).toEqual({
      dialect: "pglite",
      dbCredentials: { driver: "pglite", url: ".bos/db" },
    });
  });

  it("selects the postgresql dialect with a plain DSN otherwise", () => {
    expect(drizzleCredentialsFor("postgres://u:p@localhost:5432/db")).toEqual({
      dialect: "postgresql",
      dbCredentials: { url: "postgres://u:p@localhost:5432/db" },
    });
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
