import { describe, expect, it } from "vitest";
import { stampRelease } from "../../src/services/scaffold/upgrade";

const childSource = `import { App } from "everything-dev/descriptor";

export default App({
  name: "child.app",
  extends: "bos://dev.everything.near/everything.dev",
  account: "child.near",
  domain: "child.app",
  release: "2.0.0-rc.19",
  auth: {
    name: "@everything-dev/auth-plugin",
    variables: {
      siwn: { recipients: { mainnet: "child.near" } },
    },
    ui: { name: "auth-ui", path: "plugins/auth-ui" },
  },
  plugins: {
    api: { path: "api" },
  },
});
`;

describe("stampRelease (surgical authored-config edit)", () => {
  it("replaces the release line and leaves every other byte untouched", () => {
    const next = stampRelease(childSource, "2.0.0-rc.20");
    expect(next.replace(`release: "2.0.0-rc.20"`, `release: "2.0.0-rc.19"`)).toBe(childSource);
  });

  it("preserves indentation and a comma-less last property", () => {
    const source = `App({\n  name: "x",\n  extends: "bos://base.near/base",\n  release: "1.0.0"\n});\n`;
    const next = stampRelease(source, "2.0.0");
    expect(next).toBe(
      `App({\n  name: "x",\n  extends: "bos://base.near/base",\n  release: "2.0.0"\n});\n`,
    );
  });

  it("reads the quoted-key variant", () => {
    const next = stampRelease(`App({\n  "release": "1.0.0",\n});`, "2.0.0");
    expect(next).toBe(`App({\n  release: "2.0.0",\n});`);
  });

  it("codemod: a legacy platform line rewrites to the release field", () => {
    const legacy = childSource.replace(
      `  release: "2.0.0-rc.19",\n`,
      `  platform: "2.0.0-rc.19",\n`,
    );
    const next = stampRelease(legacy, "2.0.0-rc.20");
    expect(next).toBe(childSource.replace(`release: "2.0.0-rc.19"`, `release: "2.0.0-rc.20"`));
  });

  it("codemod: a quoted legacy platform line rewrites to the bare release key", () => {
    const next = stampRelease(`App({\n  "platform": "1.0.0",\n});`, "2.0.0");
    expect(next).toBe(`App({\n  release: "2.0.0",\n});`);
  });

  it("inserts the release after extends when the field is absent", () => {
    const source = childSource.replace(`  release: "2.0.0-rc.19",\n`, "");
    const next = stampRelease(source, "2.0.0-rc.20");
    expect(next).toBe(
      source.replace(
        `  extends: "bos://dev.everything.near/everything.dev",\n`,
        `  extends: "bos://dev.everything.near/everything.dev",\n  release: "2.0.0-rc.20",\n`,
      ),
    );
  });

  it("insertion gains the missing comma on a comma-less extends line", () => {
    const source = `App({\n  extends: "bos://base.near/base"\n  name: "x",\n});\n`;
    const next = stampRelease(source, "2.0.0");
    expect(next).toBe(
      `App({\n  extends: "bos://base.near/base",\n  release: "2.0.0",\n  name: "x",\n});\n`,
    );
  });

  it("throws with the version to set by hand when no anchor exists", () => {
    expect(() => stampRelease(`App({\n  name: "x",\n});`, "2.0.0")).toThrow(/release: "2\.0\.0"/);
  });

  it("replaces the first occurrence — a stale nested release never blocks the top-level one", () => {
    const source = `App({\n  release: "1.0.0",\n  api: { variables: { release: "9.9.9" } },\n});`;
    const next = stampRelease(source, "2.0.0");
    expect(next).toBe(
      `App({\n  release: "2.0.0",\n  api: { variables: { release: "9.9.9" } },\n});`,
    );
  });
});
