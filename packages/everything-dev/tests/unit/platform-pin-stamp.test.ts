import { describe, expect, it } from "vitest";
import { stampPlatformPin } from "../../src/cli/upgrade";

const childSource = `import { App } from "everything-dev/descriptor";

export default App({
  name: "child.app",
  extends: "bos://dev.everything.near/everything.dev",
  account: "child.near",
  domain: "child.app",
  platform: "2.0.0-rc.19",
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

describe("stampPlatformPin (surgical authored-config edit)", () => {
  it("replaces the pin line and leaves every other byte untouched", () => {
    const next = stampPlatformPin(childSource, "2.0.0-rc.20");
    expect(next.replace(`platform: "2.0.0-rc.20"`, `platform: "2.0.0-rc.19"`)).toBe(childSource);
  });

  it("preserves indentation and a comma-less last property", () => {
    const source = `App({\n  name: "x",\n  extends: "bos://base.near/base",\n  platform: "1.0.0"\n});\n`;
    const next = stampPlatformPin(source, "2.0.0");
    expect(next).toBe(
      `App({\n  name: "x",\n  extends: "bos://base.near/base",\n  platform: "2.0.0"\n});\n`,
    );
  });

  it("reads the quoted-key variant", () => {
    const next = stampPlatformPin(`App({\n  "platform": "1.0.0",\n});`, "2.0.0");
    expect(next).toBe(`App({\n  platform: "2.0.0",\n});`);
  });

  it("inserts the pin after extends when the field is absent", () => {
    const source = childSource.replace(`  platform: "2.0.0-rc.19",\n`, "");
    const next = stampPlatformPin(source, "2.0.0-rc.20");
    expect(next).toBe(
      source.replace(
        `  extends: "bos://dev.everything.near/everything.dev",\n`,
        `  extends: "bos://dev.everything.near/everything.dev",\n  platform: "2.0.0-rc.20",\n`,
      ),
    );
  });

  it("insertion gains the missing comma on a comma-less extends line", () => {
    const source = `App({\n  extends: "bos://base.near/base"\n  name: "x",\n});\n`;
    const next = stampPlatformPin(source, "2.0.0");
    expect(next).toBe(
      `App({\n  extends: "bos://base.near/base",\n  platform: "2.0.0",\n  name: "x",\n});\n`,
    );
  });

  it("throws with the version to set by hand when no anchor exists", () => {
    expect(() => stampPlatformPin(`App({\n  name: "x",\n});`, "2.0.0")).toThrow(
      /platform: "2.0.0"/,
    );
  });

  it("replaces the first occurrence — a stale nested pin never blocks the top-level one", () => {
    const source = `App({\n  platform: "1.0.0",\n  api: { variables: { platform: "9.9.9" } },\n});`;
    const next = stampPlatformPin(source, "2.0.0");
    expect(next).toBe(
      `App({\n  platform: "2.0.0",\n  api: { variables: { platform: "9.9.9" } },\n});`,
    );
  });
});
