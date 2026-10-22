import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BosBuilder } from "../../src/handlers/shared";
import {
  PlatformReleaseManifestSchema,
  type ResolvedPlatformManifest,
} from "../../src/services/platform/manifest";

const platformMocks = vi.hoisted(() => ({ resolvePlatformManifest: vi.fn() }));

vi.mock("../../src/services/platform/manifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/platform/manifest")>();
  return {
    ...actual,
    readInImagePlatformManifest: () => null,
    resolvePlatformManifest: (opts: unknown) => platformMocks.resolvePlatformManifest(opts),
  };
});

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
      platform: "2.0.0-rc.16",
    })}\n`,
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
  platformMocks.resolvePlatformManifest.mockReset();
});

const PUBLISHED = PlatformReleaseManifestSchema.parse({
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

function platformManifestEffect(): Promise<unknown> {
  const effectHandler =
    (fn: (opts: unknown, input: unknown) => Generator) => (opts: unknown, input: unknown) =>
      Effect.runPromise(Effect.gen(() => fn(opts, input)));
  const builder = {
    upgrade: { effect: effectHandler },
    typesGen: { effect: effectHandler },
    typecheck: { effect: effectHandler },
    mfCheck: { effect: effectHandler },
    platformManifest: { effect: effectHandler },
  } as unknown as BosBuilder;
  const router = registerUpgrade(builder) as unknown as {
    platformManifest: (input: unknown, opts: unknown) => Promise<unknown>;
  };
  return router.platformManifest({ check: false }, { context: {} });
}

describe("platformManifest handler — pin drift (issue #546)", () => {
  it("reports the published parent platform against the stale pin instead of a cryptic pin-not-found error", async () => {
    platformMocks.resolvePlatformManifest.mockImplementation(
      (opts: { localConfig: Record<string, unknown> }) => {
        if (typeof opts.localConfig.platform === "string") {
          return Promise.reject(
            new Error(
              "platform pin 2.0.0-rc.16 not found in the extends chain (bos://dev.everything.near/everything.dev) — publish the release or clear the pin",
            ),
          );
        }
        return Promise.resolve(resolved({ account: "dev.everything.near", gateway: "everything.dev" }));
      },
    );

    const result = (await platformManifestEffect()) as {
      status: string;
      version: string | null;
      drift?: { pinned: string; published: string };
      error?: string;
    };

    expect(platformMocks.resolvePlatformManifest).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("fail");
    expect(result.version).toBe("2.0.0-rc.18");
    expect(result.drift).toEqual({ pinned: "2.0.0-rc.16", published: "2.0.0-rc.18" });
    expect(result.error).toContain("parent platform is 2.0.0-rc.18");
    expect(result.error).toContain("you pinned 2.0.0-rc.16");
    expect(result.error).toContain("bos upgrade");
  });

  it("resolves normally when the pin still matches the chain", async () => {
    platformMocks.resolvePlatformManifest.mockImplementation(() =>
      Promise.resolve(resolved({ account: "dev.everything.near", gateway: "everything.dev" })),
    );

    const result = (await platformManifestEffect()) as {
      status: string;
      version: string | null;
      drift?: unknown;
    };

    expect(platformMocks.resolvePlatformManifest).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    expect(result.version).toBe("2.0.0-rc.18");
    expect(result.drift).toBeUndefined();
  });
});
