import { describe, expect, it } from "vitest";
// @ts-expect-error root CI script — types via scripts/detect-changes.d.mts
import { detect } from "../../../../scripts/detect-changes.mjs";

const pr = (files: string[]) => detect({ event: "pull_request", prHeadRef: "feature/x", files });

describe("detect-changes path groups", () => {
  it("a release.yml-only diff runs no suites — the incident that forced this script", () => {
    const out = pr([".github/workflows/release.yml"]);
    expect(out).toEqual({
      version: "false",
      "everything-dev": "false",
      "every-plugin": "false",
      plugins: "false",
      "ui-api": "false",
      host: "false",
      "regression-http": "false",
      "regression-framework": "false",
      "regression-browser": "false",
      "regression-browser-smoke": "false",
      "regression-unit": "false",
      workflows: "true",
    });
  });

  it("touching ci.yml lights every suite arm on purpose — changing the CI wiring validates it", () => {
    const out = pr([".github/workflows/ci.yml"]);
    for (const name of Object.keys(out)) {
      expect(`${name}=${out[name]}`, name).toBe(
        name === "version" || name === "regression-browser-smoke"
          ? `${name}=false`
          : `${name}=true`,
      );
    }
  });

  it("an ui-only diff pays the app-load smoke, not the browser matrix", () => {
    const out = pr(["ui/src/app.tsx", "ui/src/lib/thing.ts"]);
    expect(out["regression-browser-smoke"]).toBe("true");
    expect(out["regression-browser"]).toBe("false");
    expect(out["regression-http"]).toBe("false");
    expect(out["ui-api"]).toBe("true");
    expect(out["host"]).toBe("true");
  });

  it("a mixed ui+api diff is not ui-only", () => {
    const out = pr(["ui/src/app.tsx", "api/src/contract.ts"]);
    expect(out["regression-browser-smoke"]).toBe("false");
    expect(out["regression-browser"]).toBe("true");
  });

  it("root-file matching is exact — nested configs do not trip root-file arms", () => {
    const out = pr(["ui/tsconfig.json"]);
    expect(out["everything-dev"]).toBe("false");
    expect(out["ui-api"]).toBe("true");
    expect(out["host"]).toBe("true");
  });

  it("the regression lib pins its unit plane", () => {
    const out = pr(["tests/regression/lib/start-stack.mjs"]);
    expect(out["regression-unit"]).toBe("true");
  });

  it("the version-PR fast path skips every suite", () => {
    const out = detect({
      event: "pull_request",
      prHeadRef: "changeset-release/main",
      files: ["package.json", ".github/workflows/ci.yml"],
    });
    expect(out.version).toBe("true");
    for (const [name, value] of Object.entries(out)) {
      if (name !== "version") expect(`${name}=${value}`).toBe(`${name}=false`);
    }
  });

  it("workflow_dispatch runs everything and emits every output key", () => {
    const out = detect({ event: "workflow_dispatch", files: [] });
    for (const [name, value] of Object.entries(out)) {
      const expected = name === "version" || name === "regression-browser-smoke" ? "false" : "true";
      expect(`${name}=${value}`, name).toBe(`${name}=${expected}`);
    }
    expect(Object.keys(out)).toContain("plugins");
    expect(Object.keys(out)).toContain("ui-api");
  });

  it("an empty diff runs nothing", () => {
    const out = pr([]);
    for (const value of Object.values(out)) expect(value).toBe("false");
  });
});
