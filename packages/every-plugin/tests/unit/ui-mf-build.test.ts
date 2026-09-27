import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_UI_DEPLOY_FIELDS, createUiSharedDeps } from "../../src/build/ui";

const pkg = {
  dependencies: {
    react: "catalog:",
    "react-dom": "catalog:",
    "@orpc/client": "catalog:",
    "@orpc/contract": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@tanstack/react-router": "catalog:",
    "everything-dev": "catalog:",
  },
};

const expectedSharedKeys = [
  "@orpc/client",
  "@orpc/contract",
  "@tanstack/react-query",
  "@tanstack/react-router",
  "everything-dev/ui/auth",
  "react",
  "react-dom",
];

describe("createUiSharedDeps", () => {
  it("resolves requiredVersion from the installed package version", () => {
    const deps = createUiSharedDeps(pkg);
    expect(Object.keys(deps).sort()).toEqual(expectedSharedKeys);
    expect(deps.react.singleton).toBe(true);
    expect(deps.react.eager).toBe(false);
    expect(deps.react.requiredVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(deps.react.strictVersion).toBe(true);
  });

  it("shares the session read path module as a strict singleton", () => {
    const provider = createUiSharedDeps(pkg, { role: "provider" });
    const consumer = createUiSharedDeps(pkg, { role: "consumer" });

    expect(provider["everything-dev/ui/auth"]).toMatchObject({
      singleton: true,
      strictVersion: true,
      requiredVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
    expect(consumer["everything-dev/ui/auth"]?.import).toBe(false);
  });

  it("resolves the session module version from the building workspace root", () => {
    const deps = createUiSharedDeps(pkg, { workspaceRoot: path.resolve(process.cwd(), "../..") });
    expect(deps["everything-dev/ui/auth"]?.requiredVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("can relax strictVersion (core-shell parity mode)", () => {
    const deps = createUiSharedDeps(pkg, { strictVersion: false });
    expect(deps.react.requiredVersion).toBe(false);
    expect(deps.react.strictVersion).toBe(false);
  });

  it("prefers the installed version over the declared range", () => {
    const deps = createUiSharedDeps({ dependencies: { react: "19.1.0" } });
    expect(deps.react.requiredVersion).toBe("19.2.4");
  });

  it("consumer role sets import: false — no bundled fallback copy", () => {
    const provider = createUiSharedDeps(pkg, { role: "provider" });
    const consumer = createUiSharedDeps(pkg, { role: "consumer" });
    expect(provider.react.import).toBeUndefined();
    expect(consumer.react.import).toBe(false);
    expect(consumer.react).toMatchObject({ singleton: true, eager: false, strictVersion: true });
  });
});

describe("CORE_UI_DEPLOY_FIELDS", () => {
  it("names the app.ui.* fields", () => {
    expect(CORE_UI_DEPLOY_FIELDS.urlField).toBe("app.ui.production");
    expect(CORE_UI_DEPLOY_FIELDS.ssrUrlField).toBe("app.ui.ssr");
  });
});
