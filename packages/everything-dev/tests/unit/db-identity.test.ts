import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findWorkspaceDir,
  normalizeSlug,
  workspaceIdentityFromModuleUrl,
  workspaceIdentityFromWorkspaceDir,
} from "../../src/db";

function makeWorkspace(name: string, structure: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "everything-dev-identity-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name })}\n`);
  for (const nested of structure) {
    mkdirSync(join(dir, nested), { recursive: true });
  }
  return dir;
}

describe("normalizeSlug", () => {
  it.each([
    ["api", "api"],
    ["@everything-dev/auth-plugin", "auth"],
    ["@everything-dev/proposals-plugin", "proposals"],
    ["@every-plugin/template", "template"],
    ["my-cool-plugin", "my_cool"],
  ])("maps %s to %s", (name, expected) => {
    expect(normalizeSlug(name)).toBe(expected);
  });
});

describe("findWorkspaceDir", () => {
  it("returns the directory itself when it contains a package.json", () => {
    const dir = makeWorkspace("@everything-dev/foo-plugin");
    try {
      expect(findWorkspaceDir(dir)).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("walks up to the nearest ancestor with a package.json", () => {
    const dir = makeWorkspace("@everything-dev/foo-plugin", ["src/db/migrations"]);
    try {
      expect(findWorkspaceDir(join(dir, "src/db/migrations"))).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("workspaceIdentityFromWorkspaceDir", () => {
  it("derives slug, secret name, journal, and workspace dir from package.json", () => {
    const dir = makeWorkspace("@everything-dev/auth-plugin");
    try {
      const identity = workspaceIdentityFromWorkspaceDir(dir);
      expect(identity.slug).toBe("auth");
      expect(identity.secretName).toBe("AUTH_DATABASE_URL");
      expect(identity.journal).toEqual({
        schema: "drizzle",
        table: "__drizzle_migrations",
        slug: "auth",
      });
      expect(identity.workspaceDir).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("workspaceIdentityFromModuleUrl", () => {
  it("resolves through a file:// module URL pointing into the workspace", () => {
    const dir = makeWorkspace("@everything-dev/votes-plugin", ["src"]);
    try {
      const moduleUrl = `file://${join(dir, "src", "drizzle.config.ts")}`;
      const identity = workspaceIdentityFromModuleUrl(moduleUrl);
      expect(identity.slug).toBe("votes");
      expect(identity.secretName).toBe("VOTES_DATABASE_URL");
      expect(identity.workspaceDir).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches identity derived from the workspace directory itself", () => {
    const dir = makeWorkspace("@every-plugin/template");
    try {
      const fromUrl = workspaceIdentityFromModuleUrl(`file://${join(dir, "drizzle.config.ts")}`);
      const fromDir = workspaceIdentityFromWorkspaceDir(dir);
      expect(fromUrl).toEqual(fromDir);
      expect(fromUrl.secretName).toBe("TEMPLATE_DATABASE_URL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
