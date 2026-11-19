import { createHash } from "node:crypto";
import { mkdtemp, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Layer, Ref } from "effect";
import { buildRuntimeConfigEffect } from "everything-dev/config";
import type { BosConfig, RuntimeConfig } from "everything-dev/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/services/config";
import { deploymentDigest, RuntimeSnapshot } from "../../src/services/runtime-snapshot";
import {
  adoptPublishedPointer,
  holdOnBackendChange,
} from "../../src/services/snapshot-coordinator";

/**
 * The hosted coherence guard (fly-hosting 14): under
 * `BOS_HOLD_ON_BACKEND_CHANGE=1` an adopt whose pointer moved a boot-frozen
 * pin (app.api / app.auth / app.host / plugins.<id> backends) refuses to
 * swap — a new UI must not pair with the old API — records the held remotes
 * in `pendingRestart`, and keeps the serving generation coherent until a
 * restart adopts the published pointer whole. Flag off (default) keeps the
 * old adopt-and-flag behavior for single-box hosts. Every scenario adopts a
 * baseline pointer first: a first adopt after boot has no baseline and
 * detects no boot-frozen moves.
 */

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

const entryBytes = "console.log('hashed entry');";
const entrySri = `sha384-${createHash("sha384").update(entryBytes).digest("base64")}`;

const manifestFor = (input: { version: string; entry: string }): string =>
  JSON.stringify({ version: input.version, entry: input.entry, entryIntegrity: entrySri });

const sriOf = (content: string): string =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;

const uiVersions = [
  { id: "8f3ac1d2feedbeef", entry: "remoteEntry.cf71.js" },
  { id: "1111111111111111", entry: "remoteEntry.dd01.js" },
  { id: "2222222222222222", entry: "remoteEntry.ee02.js" },
];
const apiVersions = [
  { id: "aaaaaaaaaaaaaaaa", entry: "remoteEntry.api-one.js" },
  { id: "bbbbbbbbbbbbbbbb", entry: "remoteEntry.api-two.js" },
];

const cdnRoutes: Record<string, string> = {
  "https://cdn.example.test/ui/remoteEntry.cf71.js": entryBytes,
  "https://cdn.example.test/ui/remoteEntry.dd01.js": entryBytes,
  "https://cdn.example.test/ui/remoteEntry.ee02.js": entryBytes,
  "https://cdn.example.test/api/remoteEntry.api-one.js": entryBytes,
  "https://cdn.example.test/api/remoteEntry.api-two.js": entryBytes,
};
for (const version of uiVersions) {
  cdnRoutes[`https://cdn.example.test/ui/versions/${version.id}.json`] = manifestFor({
    version: version.id,
    entry: version.entry,
  });
}
for (const version of apiVersions) {
  cdnRoutes[`https://cdn.example.test/api/versions/${version.id}.json`] = manifestFor({
    version: version.id,
    entry: version.entry,
  });
}

const fakeCdnFetch = async (input: string | URL | Request): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = cdnRoutes[url];
  return body === undefined
    ? new Response("not found", { status: 404 })
    : new Response(body, { status: 200 });
};

const uiPin = (index: number): string =>
  sriOf(cdnRoutes[`https://cdn.example.test/ui/versions/${uiVersions[index].id}.json`]);
const apiPin = (index: number): string =>
  sriOf(cdnRoutes[`https://cdn.example.test/api/versions/${apiVersions[index].id}.json`]);

const pointerFor = (input: { uiIndex: number; apiIndex?: number }) =>
  ({
    account: "v1.citynode.near",
    domain: "citynode.app",
    app: {
      ui: {
        development: "local:ui",
        production: "https://cdn.example.test/ui/",
        digest: {
          manifest: `versions/${uiVersions[input.uiIndex].id}.json`,
          integrity: uiPin(input.uiIndex),
        },
      },
      ...(input.apiIndex === undefined
        ? {}
        : {
            api: {
              development: "local:api",
              production: "https://cdn.example.test/api/",
              digest: {
                manifest: `versions/${apiVersions[input.apiIndex].id}.json`,
                integrity: apiPin(input.apiIndex),
              },
            },
          }),
    },
  }) as unknown as BosConfig;

const mergedFor = (pointer: BosConfig) =>
  ({
    ...pointer,
    app: {
      ...pointer.app,
      host: { development: "local:host", production: "https://cdn.example.test/host/" },
    },
  }) as unknown as BosConfig;

const derivedFor = (uiIndex: number) =>
  ({
    ...bootConfig,
    ui: {
      ...bootConfig.ui,
      integrity: entrySri,
      entryUrl: `https://cdn.example.test/ui/${uiVersions[uiIndex].entry}`,
    },
  }) as unknown as RuntimeConfig;

const snapshotLayer = RuntimeSnapshot.layer().pipe(
  Layer.provide(Layer.succeed(ConfigService, bootConfig)),
);

const buildRuntimeConfigMock = vi.mocked(buildRuntimeConfigEffect);
const composeUiMock = vi.hoisted(() => vi.fn());
const resolveMergedConfigInputMock = vi.hoisted(() => vi.fn());

vi.mock("everything-dev/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("everything-dev/config")>();
  return { ...actual, buildRuntimeConfigEffect: vi.fn() };
});

vi.mock("everything-dev/resolution", () => ({
  resolveMergedConfigInput: resolveMergedConfigInputMock,
}));

vi.mock("../../src/services/ui-compose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/ui-compose")>();
  return {
    ...actual,
    composeUi: composeUiMock,
  };
});

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(fakeCdnFetch) as unknown as typeof fetch);
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  resolveMergedConfigInputMock.mockReset();
  buildRuntimeConfigMock.mockReset();
  composeUiMock.mockReset();
  vi.unstubAllEnvs();
});

/** Queue the merged-pointer and derived-config mocks for a whole adopt
 * sequence (baseline first — a first adopt after boot has no baseline). */
const planAdopts = (steps: Array<{ uiIndex: number; apiIndex?: number }>) => {
  for (const step of steps) {
    resolveMergedConfigInputMock.mockResolvedValueOnce(mergedFor(pointerFor(step)));
    buildRuntimeConfigMock.mockReturnValueOnce(Effect.succeed(derivedFor(step.uiIndex)));
  }
  composeUiMock.mockReturnValue(Effect.succeed({ digest: "digest-prewarm" }));
};

describe("BOS_HOLD_ON_BACKEND_CHANGE coherence guard", () => {
  it("a publish moving app.ui AND app.api is held — the serving digest does not change", async () => {
    vi.stubEnv("BOS_HOLD_ON_BACKEND_CHANGE", "1");
    expect(holdOnBackendChange()).toBe(true);
    planAdopts([
      { uiIndex: 0, apiIndex: 0 },
      { uiIndex: 1, apiIndex: 1 },
    ]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const pendingRestart = yield* Ref.make<readonly string[]>([]);
        const baseline = yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: pointerFor({ uiIndex: 0, apiIndex: 0 }),
          pendingRestart,
        });
        const serving = yield* snapshot.get;
        const outcome = yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: pointerFor({ uiIndex: 1, apiIndex: 1 }),
          pendingRestart,
        });
        const after = yield* snapshot.get;
        const held = yield* Ref.get(pendingRestart);
        return { baseline, serving, outcome, after, held };
      }).pipe(Effect.provide(snapshotLayer)),
    );

    expect(result.baseline.status).toBe("swapped");
    expect(result.outcome.status).toBe("held");
    expect(result.outcome).toMatchObject({ pendingRestart: ["app.api"] });
    expect(result.held).toEqual(["app.api"]);
    expect(result.after).toBe(result.serving);
    expect(result.after.deploymentDigest).toBe(deploymentDigest(derivedFor(0)));
    expect(composeUiMock).toHaveBeenCalledTimes(1);
  });

  it("a held generation does not persist an approved boot snapshot", async () => {
    vi.stubEnv("BOS_HOLD_ON_BACKEND_CHANGE", "1");
    const dir = await mkdtemp(path.join(tmpdir(), "hold-no-snapshot-"));
    vi.stubEnv("BOS_SNAPSHOT_DIR", dir);
    planAdopts([
      { uiIndex: 0, apiIndex: 0 },
      { uiIndex: 1, apiIndex: 1 },
    ]);
    const target = path.join(dir, "v1.citynode.near", "citynode.app.json");

    await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: pointerFor({ uiIndex: 0, apiIndex: 0 }),
        });
        yield* Effect.tryPromise(() => unlink(target));
        return yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: pointerFor({ uiIndex: 1, apiIndex: 1 }),
        });
      }).pipe(Effect.provide(snapshotLayer)),
    );

    await expect(readFile(target, "utf8")).rejects.toThrow();
  });

  it("a UI-only publish still swaps under the flag and clears the hold ledger", async () => {
    vi.stubEnv("BOS_HOLD_ON_BACKEND_CHANGE", "1");
    planAdopts([
      { uiIndex: 0, apiIndex: 0 },
      { uiIndex: 1, apiIndex: 1 },
      { uiIndex: 2, apiIndex: 0 },
    ]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const pendingRestart = yield* Ref.make<readonly string[]>([]);
        yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: pointerFor({ uiIndex: 0, apiIndex: 0 }),
          pendingRestart,
        });
        const heldOutcome = yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: pointerFor({ uiIndex: 1, apiIndex: 1 }),
          pendingRestart,
        });
        const heldRemotes = yield* Ref.get(pendingRestart);
        const swappedOutcome = yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: pointerFor({ uiIndex: 2, apiIndex: 0 }),
          pendingRestart,
        });
        const after = yield* snapshot.get;
        const clearedRemotes = yield* Ref.get(pendingRestart);
        return { heldOutcome, heldRemotes, swappedOutcome, after, clearedRemotes };
      }).pipe(Effect.provide(snapshotLayer)),
    );

    expect(result.heldOutcome.status).toBe("held");
    expect(result.heldRemotes).toEqual(["app.api"]);
    expect(result.swappedOutcome.status).toBe("swapped");
    expect(result.after.deploymentDigest).toBe(deploymentDigest(derivedFor(2)));
    expect(result.after.restartRequired).toBeUndefined();
    expect(result.clearedRemotes).toEqual([]);
  });

  it("with the flag off (default) the same publish swaps and only flags restartRequired", async () => {
    expect(holdOnBackendChange()).toBe(false);
    planAdopts([
      { uiIndex: 0, apiIndex: 0 },
      { uiIndex: 1, apiIndex: 1 },
    ]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const pendingRestart = yield* Ref.make<readonly string[]>([]);
        yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: pointerFor({ uiIndex: 0, apiIndex: 0 }),
          pendingRestart,
        });
        const outcome = yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: pointerFor({ uiIndex: 1, apiIndex: 1 }),
          pendingRestart,
        });
        const after = yield* snapshot.get;
        const held = yield* Ref.get(pendingRestart);
        return { outcome, after, held };
      }).pipe(Effect.provide(snapshotLayer)),
    );

    expect(result.outcome.status).toBe("swapped");
    expect(result.after.restartRequired).toEqual(["app.api"]);
    expect(result.after.deploymentDigest).toBe(deploymentDigest(derivedFor(1)));
    expect(result.held).toEqual([]);
  });
});
