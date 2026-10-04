import { createHash } from "node:crypto";
import { Cause, Effect, Exit, Layer } from "effect";
import { buildRuntimeConfigEffect, type ConfigVersionManifestError } from "everything-dev/config";
import type { BosConfig, RuntimeConfig } from "everything-dev/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/services/config";
import { deploymentFingerprint, RuntimeSnapshot } from "../../src/services/runtime-snapshot";
import { adoptPublishedPointer, SnapshotAdoptError } from "../../src/services/snapshot-coordinator";

const bootConfig = {
  env: "production",
  account: "v1.citynode.near",
  domain: "citynode.app",
  networkId: "mainnet",
  ui: {
    name: "ui",
    url: "https://cdn.example.test/ui/",
    entry: "https://cdn.example.test/ui/mf-manifest.json",
    source: "remote",
    integrity: "sha384-ui-entry",
  },
  api: {
    name: "api",
    url: "https://cdn.example.test/api/",
    entry: "https://cdn.example.test/api/mf-manifest.json",
    source: "remote",
  },
} as unknown as RuntimeConfig;

const publishedPointer = {
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    ui: {
      development: "local:ui",
      production: "https://cdn.example.test/ui/",
      pin: {
        manifest: "versions/8f3ac1d2feedbeef.json",
        integrity: "sha384-slot-pin",
      },
    },
    api: { development: "local:api", production: "https://cdn.example.test/api/" },
  },
} as unknown as BosConfig;

// the entry bytes the fake CDN serves for the hashed entry — the adopt
// transaction verifies the pinned entry (SRI) before swapping
const entryBytes = "console.log('hashed entry');";
const entrySri = `sha384-${createHash("sha384").update(entryBytes).digest("base64")}`;

const derivedConfig = {
  ...bootConfig,
  ui: {
    ...bootConfig.ui,
    integrity: entrySri,
    entryUrl: "https://cdn.example.test/ui/remoteEntry.cf71.js",
  },
} as unknown as RuntimeConfig;

const snapshotLayer = RuntimeSnapshot.layer().pipe(
  Layer.provide(Layer.succeed(ConfigService, bootConfig)),
);

const buildRuntimeConfigMock = vi.mocked(buildRuntimeConfigEffect);
const composeUiMock = vi.hoisted(() => vi.fn());

vi.mock("everything-dev/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("everything-dev/config")>();
  return { ...actual, buildRuntimeConfigEffect: vi.fn() };
});

// the pre-warm compose is the seam: its internals (SSR container loads, digest
// parity) are covered by ui-compose's own suite
vi.mock("../../src/services/ui-compose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/ui-compose")>();
  return {
    ...actual,
    composeUi: composeUiMock,
  };
});

beforeAll(() => {
  const fakeCdnFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/remoteEntry.cf71.js")) return new Response(entryBytes, { status: 200 });
    return new Response("not found", { status: 404 });
  };
  vi.stubGlobal("fetch", vi.fn(fakeCdnFetch) as unknown as typeof fetch);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe("adoptPublishedPointer", () => {
  it("derives the new config, pre-warms a fresh compose state, and swaps", async () => {
    buildRuntimeConfigMock.mockReturnValue(Effect.succeed(derivedConfig));
    composeUiMock.mockReturnValue(Effect.succeed({ digest: "digest-prewarm" }));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const before = yield* snapshot.get;
        const outcome = yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: publishedPointer,
        });
        const after = yield* snapshot.get;
        return { before, outcome, after };
      }).pipe(Effect.provide(snapshotLayer)),
    );

    expect(result.outcome.status).toBe("swapped");
    expect(buildRuntimeConfigMock).toHaveBeenCalledWith(
      publishedPointer,
      expect.any(String),
      "production",
    );
    expect(composeUiMock).toHaveBeenCalledTimes(1);
    // the pre-warm composes into the FRESH serving caches, which the swap
    // adopts as a whole — the warm state IS the serving state (C7)
    const composeStateArg = composeUiMock.mock.calls[0]![1];
    expect(result.after.composeState).toBe(composeStateArg);
    expect(result.after.composeState).not.toBe(result.before.composeState);
    expect(result.after.clientConfigState).not.toBe(result.before.clientConfigState);
    expect(result.after.config.ui.integrity).toBe(entrySri);
    expect(result.after.config.ui.entryUrl).toBe("https://cdn.example.test/ui/remoteEntry.cf71.js");
    expect(result.after.fingerprint).toBe(deploymentFingerprint(derivedConfig));
  });

  it("is a no-op when the derived fingerprint is unchanged", async () => {
    buildRuntimeConfigMock.mockReturnValue(Effect.succeed(derivedConfig));
    composeUiMock.mockReturnValue(Effect.succeed({ digest: "digest-prewarm" }));
    const outcomes = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const first = yield* adoptPublishedPointer({ snapshot, publishedConfig: publishedPointer });
        const second = yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: publishedPointer,
        });
        return { first, second };
      }).pipe(Effect.provide(snapshotLayer)),
    );
    expect(outcomes.first.status).toBe("swapped");
    expect(outcomes.second.status).toBe("unchanged");
  });

  it("a failed derivation leaves the live snapshot untouched", async () => {
    buildRuntimeConfigMock.mockReturnValueOnce(
      Effect.fail(
        new Error("version manifest fetch failed") as unknown as ConfigVersionManifestError,
      ),
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const before = yield* snapshot.get;
        const exit = yield* Effect.exit(
          adoptPublishedPointer({ snapshot, publishedConfig: publishedPointer }),
        );
        const after = yield* snapshot.get;
        return { before, exit, after };
      }).pipe(Effect.provide(snapshotLayer)),
    );
    if (!Exit.isFailure(result.exit)) throw new Error("expected adopt failure");
    const squashed = Cause.squash(result.exit.cause);
    expect(squashed).toBeInstanceOf(SnapshotAdoptError);
    expect((squashed as SnapshotAdoptError).message).toContain("version manifest fetch failed");
    expect(result.after).toBe(result.before);
  });

  it("a failed pre-warm compose aborts the adopt before the swap", async () => {
    buildRuntimeConfigMock.mockReturnValue(Effect.succeed(derivedConfig));
    composeUiMock.mockReturnValue(
      Effect.fail(new SnapshotAdoptError({ message: "compose digest mismatch" })),
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const before = yield* snapshot.get;
        const exit = yield* Effect.exit(
          adoptPublishedPointer({ snapshot, publishedConfig: publishedPointer }),
        );
        const after = yield* snapshot.get;
        return { before, exit, after };
      }).pipe(Effect.provide(snapshotLayer)),
    );
    if (!Exit.isFailure(result.exit)) throw new Error("expected adopt failure");
    const squashed = Cause.squash(result.exit.cause);
    expect((squashed as SnapshotAdoptError).message).toContain("pre-warm compose failed");
    expect(result.after).toBe(result.before);
  });

  it("a pinned entry failing SRI verification aborts the adopt", async () => {
    buildRuntimeConfigMock.mockReturnValue(Effect.succeed(derivedConfig));
    composeUiMock.mockReturnValue(Effect.succeed({ digest: "digest-prewarm" }));
    // the fake CDN serves bytes whose SRI does not match the derived pin
    const tampered = vi.fn(async () => new Response("tampered bytes", { status: 200 }));
    vi.stubGlobal("fetch", tampered as unknown as typeof fetch);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const before = yield* snapshot.get;
        const exit = yield* Effect.exit(
          adoptPublishedPointer({ snapshot, publishedConfig: publishedPointer }),
        );
        const after = yield* snapshot.get;
        return { before, exit, after };
      }).pipe(Effect.provide(snapshotLayer)),
    );
    if (!Exit.isFailure(result.exit)) throw new Error("expected adopt failure");
    const squashed = Cause.squash(result.exit.cause);
    expect((squashed as SnapshotAdoptError).message).toContain("failed verification");
    expect(result.after).toBe(result.before);
  });
});
