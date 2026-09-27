import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertChildConfigToAppForm } from "../../src/cli/init";
import { clearConfigCache, loadAppDescriptorConfig, loadResolvedConfig } from "../../src/config";
import { App } from "../../src/descriptor/constructors";
import { configInputToDescriptor, toConfigInput } from "../../src/descriptor/resolve";

const fixtures = join(import.meta.dirname, "..", "fixtures", "bos-app-loader");

afterEach(() => {
  clearConfigCache();
  rmSync(join(fixtures, "convert-scratch"), { recursive: true, force: true });
});

describe("bos.app.ts materialization (loadAppDescriptorConfig)", () => {
  it("materializes an import-extends descriptor: child wins over the inlined parent", async () => {
    const input = await loadAppDescriptorConfig(join(fixtures, "materialize-child", "bos.app.ts"));
    expect(input.account).toBe("child.near");
    expect(input.domain).toBe("child.near");
    // inherited from the inlined parent, untouched by the child
    expect(input.app?.api).toMatchObject({
      development: "local:api",
      variables: { platformAccount: "base.near" },
    });
    expect(input.app?.auth).toMatchObject({
      development: "local:plugins/auth",
      name: "@everything-dev/auth-plugin",
    });
    // the consumed extends key is dropped from the authoring output
    expect(input.extends).toBeUndefined();
  });

  it("rejects a file without a default export and ignores non-descriptor named exports", async () => {
    const dir = join(tmpdir(), "bos-app-harden");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    // no default export
    writeFileSync(join(dir, "no-default.app.ts"), 'export const app = { name: "x" };\n');
    await expect(loadAppDescriptorConfig(join(dir, "no-default.app.ts"))).rejects.toThrow(
      "must default-export an App() descriptor",
    );
    // a named export that is not a descriptor must not enter the registry
    writeFileSync(
      join(dir, "mixed.app.ts"),
      'export const helper = { name: "not-an-app", note: "just a helper object" };\n' +
        'export default { name: "child.test", account: "child.near", domain: "child.near" };\n',
    );
    const input = await loadAppDescriptorConfig(join(dir, "mixed.app.ts"));
    expect(input.account).toBe("child.near");
  });

  it("passes a registry-less bos://-style extends ref through for the JSON chain", async () => {
    const input = await loadAppDescriptorConfig(
      join(fixtures, "extends-passthrough", "bos.app.ts"),
    );
    expect(input.extends).toBe("bos://base.near/base");
    expect(input.account).toBe("child.near");
  });
});

describe("bos.app.ts resolution parity with bos.config.json", () => {
  it("a TS-authored child resolves identically to the equivalent JSON child", async () => {
    const ts = await loadResolvedConfig({
      cwd: join(fixtures, "ts-child"),
      env: "development",
    });
    const json = await loadResolvedConfig({
      cwd: join(fixtures, "json-child"),
      env: "development",
    });
    expect(ts).not.toBeNull();
    expect(json).not.toBeNull();
    // same resolved config…
    expect(ts!.config).toEqual(json!.config);
    // …same runtime projection (minus the load-source path)
    expect(ts!.source.path).toBe(join(fixtures, "ts-child", "bos.app.ts"));
    expect(json!.source.path).toBe(join(fixtures, "json-child", "bos.config.json"));
  });

  it("prefers bos.config.json when both forms coexist", async () => {
    const dir = join(tmpdir(), "bos-app-both-forms");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "bos.app.ts"),
      `export default { name: "ts.near", account: "ts.near", domain: "ts.near" };
`,
    );
    writeFileSync(join(dir, "base.json"), readFileSync(join(fixtures, "base.json"), "utf-8"));
    writeFileSync(
      join(dir, "bos.config.json"),
      JSON.stringify({
        extends: "./base.json",
        account: "json.near",
        domain: "json.near",
      }),
    );
    const result = await loadResolvedConfig({ cwd: dir, env: "development" });
    expect(result!.config.account).toBe("json.near");
    expect(result!.source.path).toBe(join(dir, "bos.config.json"));
  });
});

describe("descriptor constructors sanity", () => {
  it("App() is pure data (the golden fixture covers the full shape)", () => {
    const app = App({ name: "sanity.near", account: "sanity.near" });
    expect(app.name).toBe("sanity.near");
  });
});

describe("TS config form scaffold (convertChildConfigToAppForm)", () => {
  it("converts the personalized JSON into an authored bos.app.ts and removes the copy", async () => {
    // inside the repo so the generated file's `everything-dev/descriptor`
    // import resolves when the loader materializes it back
    const dir = join(fixtures, "convert-scratch");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "base.json"), readFileSync(join(fixtures, "base.json"), "utf-8"));
    writeFileSync(
      join(dir, "bos.config.json"),
      JSON.stringify({
        extends: "bos://base.near/base",
        account: "child.near",
        domain: "child.near",
        title: "Child",
        app: {
          ui: { development: "local:ui" },
          auth: {
            development: "local:plugins/auth",
            name: "@everything-dev/auth-plugin",
            secrets: ["BETTER_AUTH_SECRET"],
          },
        },
        plugins: { apps: { development: "local:plugins/apps" } },
      }),
    );

    await convertChildConfigToAppForm(dir);

    expect(existsSync(join(dir, "bos.app.ts"))).toBe(true);
    expect(existsSync(join(dir, "bos.config.json"))).toBe(false);

    // the authored form materializes back with the personalized values
    const input = await loadAppDescriptorConfig(join(dir, "bos.app.ts"));
    expect(input.account).toBe("child.near");
    expect(input.domain).toBe("child.near");
    expect(input.title).toBe("Child");
    expect(input.extends).toBe("bos://base.near/base");
    expect(input.app?.auth).toMatchObject({
      development: "local:plugins/auth",
      name: "@everything-dev/auth-plugin",
    });
    expect(input.plugins?.apps).toMatchObject({ development: "local:plugins/apps" });
  });
});

describe("authored form round-trip", () => {
  it("descriptor → config input → descriptor is identity (scaffold serializer is lossless)", () => {
    const descriptor = App({
      name: "child.test",
      extends: "bos://base.near/base",
      account: "child.near",
      domain: "child.near",
      title: "Child",
      host: { path: "host", secrets: ["CORS_ORIGIN"] },
      ui: { path: "ui" },
      api: {
        path: "api",
        variables: { platformAccount: "child.near" },
        secrets: ["API_DATABASE_URL"],
      },
      auth: {
        name: "auth",
        path: "plugins/auth",
        ui: { name: "auth-ui", path: "plugins/auth/ui" },
      },
      plugins: {
        apps: {
          name: "apps",
          path: "plugins/apps",
          variables: { registryNamespace: "child.near" },
        },
        proposals: { name: "proposals", extends: "bos://builds.near/proposals" },
      },
    });
    const input = configInputToDescriptor(toConfigInput(descriptor));
    // toConfigInput consumes `extends` into the merge (the loader re-derives
    // it from the personalized input) and drops the authoring `name` (the
    // inverse derives it from the domain) — every other field round-trips.
    const { extends: _extends, name: _name, ...inputRest } = input;
    const { extends: _dropped, name: _renamed, ...expectedRest } = descriptor;
    expect(inputRest).toEqual(expectedRest);
  });
});
