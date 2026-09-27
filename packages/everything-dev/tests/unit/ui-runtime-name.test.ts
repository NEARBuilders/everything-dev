import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeContainerName } from "every-plugin/ui/manifest/contract";
import { describe, expect, it } from "vitest";
import { resolveUiRuntimeName } from "../../src/config";

const fixtures: Array<{ name: string; build: (root: string) => string }> = [
  {
    // folder-form: the ui directory has no package.json — the plugin
    // workspace owns the build and its package name is the container identity
    name: "folder-form",
    build: (root) => {
      mkdirSync(path.join(root, "plugins/auth/ui/src/routes"), { recursive: true });
      writeFileSync(
        path.join(root, "plugins/auth/package.json"),
        JSON.stringify({ name: "@everything-dev/auth-plugin" }),
      );
      return path.join(root, "plugins/auth/ui");
    },
  },
  {
    // workspace-form: the ui has its own package.json
    name: "workspace-form",
    build: (root) => {
      mkdirSync(path.join(root, "ui-plugin/src"), { recursive: true });
      writeFileSync(
        path.join(root, "ui-plugin/package.json"),
        JSON.stringify({ name: "@everything-dev/auth-ui" }),
      );
      return path.join(root, "ui-plugin");
    },
  },
  {
    // no package.json anywhere — falls back to the authored name
    name: "bare",
    build: (root) => {
      mkdirSync(path.join(root, "ui-alone"), { recursive: true });
      return path.join(root, "ui-alone");
    },
  },
];

describe("resolveUiRuntimeName", () => {
  for (const fixture of fixtures) {
    it(`derives the built container name for a ${fixture.name} ui source`, () => {
      const root = path.join(tmpdir(), `ui-runtime-name-${fixture.name}-${process.pid}`);
      mkdirSync(root, { recursive: true });
      try {
        const localPath = fixture.build(root);
        const name = resolveUiRuntimeName({ name: "auth-ui" }, localPath, "auth-plugin");
        const expected = sanitizeContainerName(
          fixture.name === "workspace-form"
            ? "@everything-dev/auth-ui"
            : fixture.name === "folder-form"
              ? "@everything-dev/auth-plugin"
              : "auth-ui",
        );
        if (fixture.name === "bare") {
          expect(name).toBe("auth-ui");
        } else {
          expect(name).toBe(expected);
          expect(name).not.toBe("auth-ui");
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("prefers the authored name when no local path exists (remote source)", () => {
    expect(resolveUiRuntimeName({ name: "auth-ui" }, undefined, "auth-plugin")).toBe("auth-ui");
  });
});

describe("sanitizeContainerName", () => {
  it("matches the build's container naming rule", () => {
    expect(sanitizeContainerName("@everything-dev/auth-plugin")).toBe(
      "_everything_dev_auth_plugin",
    );
    expect(sanitizeContainerName("ui")).toBe("ui");
  });
});
