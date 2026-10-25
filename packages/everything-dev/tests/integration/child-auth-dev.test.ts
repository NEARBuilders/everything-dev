import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { stripLocalDevelopmentTargets } from "../../src/services/resolution/merge";
import { buildRuntimeConfigEffect } from "../../src/services/resolution/runtime";
import { planInfra } from "../../src/infra/planner";
import { PortAllocatorLive } from "../../src/infra/ports";
import { detectLocalPackages } from "../../src/services/workspace/linked-packages";

let tempDir: string;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/** A child's resolved config shape (#584 evidence): the parent's authored
 * `local:` refs inherited through extends, plus consumable published URLs. */
const childResolvedConfig = {
  account: "child.near",
  domain: "child.dev",
  extends: "bos://dev.everything.near/everything.dev",
  app: {
    host: { development: "local:host", production: "https://cdn.example.test/child/host/" },
    ui: { development: "local:ui", production: "https://cdn.example.test/child/ui/" },
    api: { development: "local:api", production: "https://cdn.example.test/child/api/" },
    auth: {
      name: "@everything-dev/auth-plugin",
      development: "local:plugins/auth",
      production: "https://cdn.example.test/dev.everything.near/everything.dev/auth/",
      ui: {
        name: "auth-ui",
        development: "local:plugins/auth/ui",
        production: "https://cdn.example.test/dev.everything.near/everything.dev/auth-ui/",
      },
    },
  },
} as never as Parameters<typeof buildRuntimeConfigEffect>[0];

describe("inherited local: dev targets across an extends boundary (#584)", () => {
  it("a child with no local auth workspace runs the published bundle — no dev override, no auth spawn", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "child-auth-dev-"));
    // the child has ui/ and api/ workspaces but no plugins/auth, no host/
    mkdirSync(join(tempDir, "ui"), { recursive: true });
    mkdirSync(join(tempDir, "api"), { recursive: true });
    writeFileSync(join(tempDir, "ui", "package.json"), "{}\n");
    writeFileSync(join(tempDir, "api", "package.json"), "{}\n");

    const runtime = await Effect.runPromise(
      buildRuntimeConfigEffect(childResolvedConfig, tempDir, "development", {
        // the dev boot's derivation: auth is not among the local packages
        authSource: "remote",
        hostSource: "remote",
      }),
    );

    // the auth slot resolves to the published bundle, not the local path
    // (the runtime target strips the trailing slash)
    expect(runtime.auth?.source).toBe("remote");
    expect(runtime.auth?.url).toBe(
      "https://cdn.example.test/dev.everything.near/everything.dev/auth",
    );
    expect(runtime.auth?.localPath).toBeUndefined();
    // the auth ui surface likewise
    expect(runtime.auth?.ui?.source).toBe("remote");
    expect(runtime.auth?.ui?.url).toBe(
      "https://cdn.example.test/dev.everything.near/everything.dev/auth-ui",
    );

    // the dev harness derivation: auth is not a local package — no spawn
    const localPackages = detectLocalPackages(childResolvedConfig, runtime, tempDir);
    expect(localPackages.map((entry) => entry.name)).toEqual(["ui", "api"]);
  });

  it("the planner allocates no auth port when auth runs remote", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "child-auth-dev-"));
    const runtime = await Effect.runPromise(
      buildRuntimeConfigEffect(childResolvedConfig, tempDir, "development", {
        authSource: "remote",
        hostSource: "remote",
        uiSource: "remote",
        apiSource: "remote",
      }),
    );
    const plan = await Effect.runPromise(
      planInfra({
        configDir: tempDir,
        bosConfig: runtime,
        cli: { port: 25400, apiPort: 25401, authPort: 25402, uiPort: 25403 },
      }).pipe(Effect.provide(Layer.mergeAll(PortAllocatorLive))),
    );
    expect(plan.resolvedPorts.auth).toBeUndefined();
    // remote services get a compose descriptor (source: remote) but no
    // spawn unit
    expect(plan.serviceDescriptors.get("auth")?.source).toBe("remote");
    expect(plan.serviceDescriptors.get("auth")?.port).toBeUndefined();
  });
});

describe("stripLocalDevelopmentTargets — publish canonicalization", () => {
  it("strips local: development refs from app slots, auth.ui, and plugins — keeps production", () => {
    const stripped = stripLocalDevelopmentTargets({
      app: {
        ui: { development: "local:ui", production: "https://cdn/ui/" },
        auth: {
          development: "local:plugins/auth",
          production: "https://cdn/auth/",
          ui: { development: "local:plugins/auth/ui", production: "https://cdn/auth-ui/" },
        },
      },
      plugins: {
        votes: { development: "local:plugins/votes", production: "https://cdn/votes/" },
        remote: { extends: "bos://a.near/votes" },
      },
    });
    expect(stripped).toEqual({
      app: {
        ui: { production: "https://cdn/ui/" },
        auth: {
          production: "https://cdn/auth/",
          ui: { production: "https://cdn/auth-ui/" },
        },
      },
      plugins: {
        votes: { production: "https://cdn/votes/" },
        remote: { extends: "bos://a.near/votes" },
      },
    });
  });

  it("keeps explicit remote development overrides (they are consumable)", () => {
    const stripped = stripLocalDevelopmentTargets({
      app: { api: { development: "https://dev.example.test/api" } },
    });
    expect(stripped).toEqual({
      app: { api: { development: "https://dev.example.test/api" } },
    });
  });
});
