import path from "node:path";
import { createUiSharedDeps } from "every-plugin/shared-deps-spec";
import { describe, expect, it } from "vitest";
import { CORE_UI_DEPLOY_FIELDS } from "../../src/build/ui";

const expectedSharedKeys = [
  "@lingui/core",
  "@lingui/react",
  "@orpc/client",
  "@orpc/contract",
  "@tanstack/react-query",
  "@tanstack/react-router",
  "everything-dev/ui/auth",
  "everything-dev/ui/i18n",
  "react",
  "react-dom",
];

describe("createUiSharedDeps", () => {
  it("resolves requiredVersion from the installed package version", () => {
    const deps = createUiSharedDeps();
    expect(Object.keys(deps).sort()).toEqual(expectedSharedKeys);
    expect(deps.react?.singleton).toBe(true);
    expect(deps.react?.eager).toBe(false);
    expect(deps.react?.requiredVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(deps.react?.strictVersion).toBe(true);
  });

  it("shares the session read path module as a strict singleton", () => {
    const provider = createUiSharedDeps({ role: "provider" });
    const consumer = createUiSharedDeps({ role: "consumer" });

    expect(provider["everything-dev/ui/auth"]).toMatchObject({
      singleton: true,
      strictVersion: true,
      requiredVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
    expect(consumer["everything-dev/ui/auth"]?.import).toBe(false);
    expect(provider["everything-dev/ui/i18n"]).toMatchObject({
      singleton: true,
      strictVersion: true,
      requiredVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
    expect(consumer["everything-dev/ui/i18n"]?.import).toBe(false);
  });

  it("resolves the session module version from the building workspace root", () => {
    const deps = createUiSharedDeps({ workspaceRoot: path.resolve(process.cwd(), "../..") });
    expect(deps["everything-dev/ui/auth"]?.requiredVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("can relax strictVersion (core-shell parity mode)", () => {
    const deps = createUiSharedDeps({ strictVersion: false });
    expect(deps.react?.requiredVersion).toBe(false);
    expect(deps.react?.strictVersion).toBe(false);
  });

  it("resolves the installed version, never a declared range or wildcard", () => {
    const deps = createUiSharedDeps();
    expect(deps.react?.requiredVersion).toMatch(/^\d+\.\d+\.\d+/);
    for (const entry of Object.values(deps)) {
      expect(entry.version).not.toBe("*");
      expect(entry.version).not.toBe("latest");
    }
  });

  it("consumer role sets import: false — no bundled fallback copy", () => {
    const provider = createUiSharedDeps({ role: "provider" });
    const consumer = createUiSharedDeps({ role: "consumer" });
    expect(provider.react?.import).toBeUndefined();
    expect(consumer.react?.import).toBe(false);
    expect(consumer.react).toMatchObject({ singleton: true, eager: false, strictVersion: true });
  });
});

describe("CORE_UI_DEPLOY_FIELDS", () => {
  it("names the app.ui.* fields", () => {
    expect(CORE_UI_DEPLOY_FIELDS.urlField).toBe("app.ui.production");
    expect(CORE_UI_DEPLOY_FIELDS.ssrUrlField).toBe("app.ui.ssr");
  });
});
