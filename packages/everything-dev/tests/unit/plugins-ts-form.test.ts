import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPlugins } from "../../src/commands/plugins";
import type { BosBuilder, BosDeps } from "../../src/commands/shared";
import { BosDepsTag } from "../../src/commands/shared";
import { ResolutionSession } from "../../src/resolution/session";
import type { BosConfig, BosConfigInput, RuntimeConfig } from "../../src/types";

vi.mock("../../src/code-artifacts", () => ({
  generateCodeArtifacts: vi.fn(),
}));

const authoredInput = {
  account: "child.near",
  domain: "child.dev",
  extends: "bos://base.near/base",
  title: "Child",
  app: {
    ui: { development: "local:ui" },
    api: { development: "local:api" },
  },
  plugins: {
    registry: {
      development: "local:plugins/registry",
      variables: { registryNamespace: "base.near" },
    },
  },
} as unknown as BosConfigInput;

const resolvedConfig = {
  ...authoredInput,
  title: "Child",
  plugins: {
    ...authoredInput.plugins,
    apps: { development: "local:plugins/apps" },
  },
} as unknown as BosConfig;

let configDir: string;

function tsSession(): ResolutionSession {
  return new ResolutionSession({
    config: resolvedConfig,
    runtime: {} as RuntimeConfig,
    root: configDir,
    path: join(configDir, "bos.app.ts"),
    chain: [],
    rawConfig: authoredInput,
    catalog: null,
    repository: undefined,
    env: "development",
    warnings: [],
  });
}

function getHandler(name: string): (args: unknown) => Promise<any> {
  const records = new Map<string, unknown>();
  const builder = new Proxy(
    {},
    {
      get: (_target, prop) => ({
        handler: (handler: unknown) => {
          records.set(prop as string, handler);
          return { route: prop, handler };
        },
      }),
    },
  ) as BosBuilder;
  registerPlugins(builder);
  return records.get(name) as (args: unknown) => Promise<any>;
}

function makeContext(session: ResolutionSession) {
  const deps: BosDeps = {
    session,
    databaseBindings: undefined as never,
    drizzleKit: undefined as never,
  };
  return { context: { "effect/context": Context.make(BosDepsTag, deps) } };
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "bos-plugins-ts-"));
  writeFileSync(join(configDir, "bos.app.ts"), "export default {};");
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

describe("pluginAdd on a TS-form project", () => {
  it("edits the authored bos.app.ts and never creates a bos.config.json shadow", async () => {
    const handler = getHandler("pluginAdd");
    const result = await handler({
      input: { source: "local:plugins/newplugin" },
      ...makeContext(tsSession()),
    });

    expect(result.status).toBe("added");
    expect(existsSync(join(configDir, "bos.config.json"))).toBe(false);
    const source = readFileSync(join(configDir, "bos.app.ts"), "utf-8");
    expect(source).toContain("newplugin");
    expect(source).toContain("plugins/newplugin");
    expect(source).toContain("bos://base.near/base");
    expect(source).toContain("registry");
  });

  it("keeps the pre-existing authored plugin entries", async () => {
    const handler = getHandler("pluginAdd");
    await handler({
      input: { source: "local:plugins/newplugin" },
      ...makeContext(tsSession()),
    });
    const source = readFileSync(join(configDir, "bos.app.ts"), "utf-8");
    expect(source).toContain("plugins/registry");
    expect(source).toContain("base.near");
  });
});

describe("pluginRemove on a TS-form project", () => {
  it("removes an authored plugin from bos.app.ts", async () => {
    const handler = getHandler("pluginRemove");
    const result = await handler({
      input: { key: "registry" },
      ...makeContext(tsSession()),
    });

    expect(result.status).toBe("removed");
    const source = readFileSync(join(configDir, "bos.app.ts"), "utf-8");
    expect(source).not.toContain("plugins/registry");
    expect(existsSync(join(configDir, "bos.config.json"))).toBe(false);
  });

  it("refuses to remove a plugin inherited from the parent runtime", async () => {
    const handler = getHandler("pluginRemove");
    const result = await handler({
      input: { key: "apps" },
      ...makeContext(tsSession()),
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("inherited from the parent runtime");
    expect(readFileSync(join(configDir, "bos.app.ts"), "utf-8")).toBe("export default {};");
  });
});

describe("pluginRemove on a JSON-form child", () => {
  beforeEach(() => {
    rmSync(join(configDir, "bos.app.ts"));
    writeFileSync(
      join(configDir, "bos.config.json"),
      `${JSON.stringify(
        {
          extends: "bos://base.near/base",
          account: "child.near",
          domain: "child.dev",
          plugins: {
            registry: {
              development: "local:plugins/registry",
              variables: { registryNamespace: "base.near" },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("removes an inherited plugin with a null sentinel in bos.config.json", async () => {
    const handler = getHandler("pluginRemove");
    const result = await handler({
      input: { key: "apps" },
      ...makeContext(tsSession()),
    });

    expect(result.status).toBe("removed");
    const written = JSON.parse(readFileSync(join(configDir, "bos.config.json"), "utf-8")) as {
      plugins: Record<string, unknown>;
    };
    expect(written.plugins.apps).toBeNull();
    expect(written.plugins.registry).toBeDefined();
    expect(existsSync(join(configDir, "bos.app.ts"))).toBe(false);
  });
});
