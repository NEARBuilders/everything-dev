import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  type DatabaseBinding,
  DatabaseBindings,
  type DatabaseBindingsService,
  DrizzleKit,
  type DrizzleKitService,
  makeDatabaseBindings,
  makeDrizzleKitLive,
  workspaceIdentityFromWorkspaceDir,
} from "../../src/db";
import type { RuntimeConfig } from "../../src/types";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function tempWorkspace(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "everything-dev-svc-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name })}\n`);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixtureRuntimeConfig(localWidgetsDir: string): RuntimeConfig {
  return {
    env: "development",
    account: "test.near",
    networkId: "testnet",
    host: { name: "host", url: "http://localhost:3000", entry: "./index", source: "local" },
    ui: { name: "ui", url: "http://localhost:3003", entry: "./index", source: "local" },
    api: {
      name: "api",
      url: "http://localhost:3001",
      entry: "./index",
      source: "local",
      secrets: ["API_DATABASE_URL"],
    },
    auth: {
      name: "auth",
      url: "http://localhost:3002",
      entry: "./index",
      source: "remote",
      secrets: ["AUTH_DATABASE_URL"],
    },
    plugins: {
      widgets: {
        name: "widgets",
        url: "http://localhost:3110",
        entry: "./index",
        source: "local",
        localPath: localWidgetsDir,
        secrets: ["WIDGETS_DATABASE_URL"],
      },
      proposals: {
        name: "proposals",
        url: "http://localhost:3111",
        entry: "./index",
        source: "remote",
        secrets: ["PROPOSALS_DATABASE_URL"],
      },
    },
  } as unknown as RuntimeConfig;
}

function makeBindings(
  runtimeConfig: RuntimeConfig,
  env: Record<string, string | undefined>,
): DatabaseBindingsService {
  return Effect.runSync(
    DatabaseBindings.pipe(
      Effect.provide(
        makeDatabaseBindings({
          projectDir: "/virtual/project",
          loadRuntimeConfig: async () => runtimeConfig,
          env,
        }),
      ),
    ),
  );
}

function buildDrizzleKit(projectDir: string): DrizzleKitService {
  return Effect.runSync(DrizzleKit.pipe(Effect.provide(makeDrizzleKitLive({ projectDir }))));
}

async function expectFailure<A, E extends Error>(effect: Effect.Effect<A, E>): Promise<unknown> {
  try {
    await Effect.runPromise(effect);
  } catch (error) {
    return error;
  }
  throw new Error("expected effect to fail");
}

describe("DatabaseBindings.forPluginKey", () => {
  it("resolves a local plugin's binding from its workspace identity", async () => {
    const widgetsDir = tempWorkspace("@everything-dev/widgets-plugin");
    const bindings = makeBindings(fixtureRuntimeConfig(widgetsDir), {
      WIDGETS_DATABASE_URL: "postgres://u:p@localhost:5432/widgets_db",
    });

    const binding = await Effect.runPromise(bindings.forPluginKey("widgets"));

    expect(binding.key).toBe("widgets");
    expect(binding.source).toBe("local");
    expect(binding.section).toBe("plugins");
    expect(binding.identity.slug).toBe("widgets");
    expect(binding.identity.secretName).toBe("WIDGETS_DATABASE_URL");
    expect(binding.identity.workspaceDir).toBe(widgetsDir);
    expect(binding.url).toBe("postgres://u:p@localhost:5432/widgets_db");
  });

  it("resolves api and auth sections", async () => {
    const bindings = makeBindings(fixtureRuntimeConfig("/unused"), {
      API_DATABASE_URL: "postgres://api",
      AUTH_DATABASE_URL: "postgres://auth",
    });

    const api = await Effect.runPromise(bindings.forPluginKey("api"));
    const auth = await Effect.runPromise(bindings.forPluginKey("auth"));

    expect(api.section).toBe("app.api");
    expect(api.identity.secretName).toBe("API_DATABASE_URL");
    expect(api.identity.workspaceDir).toBeUndefined();
    expect(auth.section).toBe("app.auth");
    expect(auth.source).toBe("remote");
  });

  it("resolves remote-only plugins by config key", async () => {
    const bindings = makeBindings(fixtureRuntimeConfig("/unused"), {
      PROPOSALS_DATABASE_URL: "postgres://proposals",
    });

    const binding = await Effect.runPromise(bindings.forPluginKey("proposals"));

    expect(binding.identity.slug).toBe("proposals");
    expect(binding.identity.secretName).toBe("PROPOSALS_DATABASE_URL");
    expect(binding.identity.workspaceDir).toBeUndefined();
  });

  it("fails for unknown plugins", async () => {
    const bindings = makeBindings(fixtureRuntimeConfig("/unused"), {});
    const error = await expectFailure(bindings.forPluginKey("nope"));
    expect(String(error)).toContain('Plugin "nope" not found');
  });

  it("fails loudly naming the missing secret", async () => {
    const widgetsDir = tempWorkspace("@everything-dev/widgets-plugin");
    const bindings = makeBindings(fixtureRuntimeConfig(widgetsDir), {});
    const error = await expectFailure(bindings.forPluginKey("widgets"));
    expect(String(error)).toContain("WIDGETS_DATABASE_URL");
  });
});

describe("DrizzleKit.migrate env materialization", () => {
  it("spawns drizzle-kit with the binding's canonical secret in the environment", async () => {
    const workspaceDir = tempWorkspace("@everything-dev/widgets-plugin");
    writeFileSync(join(workspaceDir, "drizzle.config.ts"), "export default {};\n");

    const shimDir = mkdtempSync(join(tmpdir(), "everything-dev-shim-"));
    const outFile = join(shimDir, "captured-env.txt");
    writeFileSync(
      join(shimDir, "npx"),
      `#!/bin/sh\nprintf '%s' "$WIDGETS_DATABASE_URL" > "${outFile}"\n`,
    );
    chmodSync(join(shimDir, "npx"), 0o755);
    cleanups.push(() => rmSync(shimDir, { recursive: true, force: true }));

    const previousPath = process.env.PATH;
    process.env.PATH = `${shimDir}:${previousPath ?? ""}`;

    try {
      const identity = workspaceIdentityFromWorkspaceDir(workspaceDir);
      const binding: DatabaseBinding = {
        key: "widgets",
        source: "local",
        section: "plugins",
        identity,
        url: "postgres://u:p@localhost:5432/widgets_db",
      };

      const service = buildDrizzleKit("/virtual/project");
      await Effect.runPromise(service.migrate(binding));

      expect(existsSync(outFile)).toBe(true);
      expect(readFileSync(outFile, "utf-8")).toBe("postgres://u:p@localhost:5432/widgets_db");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
});

describe("DrizzleKit error paths", () => {
  it("fails when a local workspace has no drizzle.config.ts", async () => {
    const workspaceDir = tempWorkspace("@everything-dev/widgets-plugin");
    const identity = workspaceIdentityFromWorkspaceDir(workspaceDir);
    const binding: DatabaseBinding = {
      key: "widgets",
      source: "local",
      section: "plugins",
      identity,
      url: "postgres://u:p@localhost:5432/widgets_db",
    };

    const service = buildDrizzleKit("/virtual/project");
    const error = await expectFailure(service.migrate(binding));
    expect(String(error)).toContain("No drizzle.config.ts found");
  });
});

describe("npx shim mechanism", () => {
  it("resolves a fake npx from PATH under shell spawn", () => {
    const shimDir = mkdtempSync(join(tmpdir(), "everything-dev-shim2-"));
    const outFile = join(shimDir, "out.txt");
    writeFileSync(join(shimDir, "npx"), `#!/bin/sh\nprintf 'x' > "${outFile}"\n`);
    chmodSync(join(shimDir, "npx"), 0o755);
    cleanups.push(() => rmSync(shimDir, { recursive: true, force: true }));

    spawnSync("npx", ["anything"], {
      cwd: shimDir,
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ""}` },
      shell: true,
    });

    expect(readFileSync(outFile, "utf-8")).toBe("x");
  });
});
