import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BosBuilder } from "../../src/handlers/shared";
import {
  ManifestSchema,
  ManifestService,
  type ResolvedPlatformManifest,
} from "../../src/services/platform/manifest";

const { registerUpgrade } = await import("../../src/handlers/upgrade");

let dir: string;
let originalCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "platform-drift-"));
  originalCwd = process.cwd();
  process.chdir(dir);
  writeFileSync(
    join(dir, "bos.config.json"),
    `${JSON.stringify({
      account: "child.near",
      extends: "bos://dev.everything.near/everything.dev",
      release: "2.0.0-rc.16",
    })}\n`,
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

const PUBLISHED = ManifestSchema.parse({
  schemaVersion: 1,
  kind: "everything-dev/platform-manifest",
  frameworkVersion: "2.0.0-rc.18",
  everyPluginVersion: "3.0.0-rc.10",
  image: { ref: "ghcr.io/nearbuilders/everything-dev", tags: ["v2.0.0-rc.18"] },
  catalog: {},
  sharedDeps: {},
  templateInventory: [],
  compat: { minChild: "2.0.0-rc.16" },
});

function resolved(source: { account: string; gateway: string }): ResolvedPlatformManifest {
  return { manifest: PUBLISHED, source, fromCache: false };
}

function serviceWith(
  resolve: (opts: {
    configDir: string;
    localConfig: Record<string, unknown>;
  }) => Promise<ResolvedPlatformManifest | null>,
): Layer.Layer<ManifestService> {
  return Layer.succeed(
    ManifestService,
    ManifestService.of({
      resolvePlatformManifest: resolve,
      composePlatformReleaseManifest: () => {
        throw new Error("not exercised by this test");
      },
      checkPlatformCompat: () => [],
      readInImagePlatformManifest: () => null,
    }),
  );
}

function manifestEffect(layer: Layer.Layer<ManifestService>): Promise<unknown> {
  const effectHandler =
    (fn: (opts: unknown, input: unknown) => Generator) => (opts: unknown, input: unknown) =>
      // eslint-disable-next-line effecttsgo/any-unknown-in-error-context -- test harness mirrors @orpc middlewareGen interop
      Effect.runPromise(Effect.gen(() => fn(opts, input)).pipe(Effect.provide(layer)));
  const builder = {
    upgrade: { effect: effectHandler },
    typesGen: { effect: effectHandler },
    typecheck: { effect: effectHandler },
    mfCheck: { effect: effectHandler },
    manifest: { effect: effectHandler },
  } as unknown as BosBuilder;
  const router = registerUpgrade(builder) as unknown as {
    manifest: (input: unknown, opts: unknown) => Promise<unknown>;
  };
  return router.manifest({ check: false }, { context: {} });
}

describe("manifest handler — release drift (issue #546)", () => {
  it("reports the published parent platform against the stale pin instead of a cryptic pin-not-found error", async () => {
    const resolve = vi.fn(async (opts: { localConfig: Record<string, unknown> }) => {
      if (typeof opts.localConfig.release === "string") {
        throw new Error(
          "platform pin 2.0.0-rc.16 not found in the extends chain (bos://dev.everything.near/everything.dev) — publish the release or clear the pin",
        );
      }
      return resolved({
        account: "dev.everything.near",
        gateway: "everything.dev",
      });
    });
    const result = (await manifestEffect(serviceWith(resolve))) as {
      status: string;
      version: string | null;
      drift?: { pinned: string; published: string };
      error?: string;
    };

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("fail");
    expect(result.version).toBe("2.0.0-rc.18");
    expect(result.drift).toEqual({ pinned: "2.0.0-rc.16", published: "2.0.0-rc.18" });
    expect(result.error).toContain("parent release is 2.0.0-rc.18");
    expect(result.error).toContain("you target 2.0.0-rc.16");
    expect(result.error).toContain("bos upgrade");
  });

  it("resolves normally when the pin still matches the chain", async () => {
    const resolve = vi.fn(async () =>
      resolved({ account: "dev.everything.near", gateway: "everything.dev" }),
    );
    const result = (await manifestEffect(serviceWith(resolve))) as {
      status: string;
      version: string | null;
      drift?: unknown;
    };

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    expect(result.version).toBe("2.0.0-rc.18");
    expect(result.drift).toBeUndefined();
  });
});
