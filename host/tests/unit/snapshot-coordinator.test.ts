import { createHash } from "node:crypto";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cause, Effect, Exit, Layer } from "effect";
import { buildRuntimeConfigEffect, type ConfigVersionManifestError } from "everything-dev/config";
import { pointerFingerprint } from "everything-dev/fingerprint";
import { parseBootSnapshot, snapshotFingerprintMatches } from "everything-dev/snapshot";
import type { BosConfig, RuntimeConfig } from "everything-dev/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// the entry bytes the fake CDN serves for the hashed entry — the adopt
// transaction walks the pinned composition at entries depth before swapping,
// so the CDN fixture serves schema-valid manifests whose pins derive from
// the served bytes
const entryBytes = "console.log('hashed entry');";
const entrySri = `sha384-${createHash("sha384").update(entryBytes).digest("base64")}`;

const manifestFor = (input: {
  version: string;
  entry: string;
  entryIntegrity?: string;
}): string =>
  JSON.stringify({
    version: input.version,
    entry: input.entry,
    entryIntegrity: input.entryIntegrity ?? entrySri,
  });

const sriOf = (content: string): string =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;

const uiManifest = manifestFor({ version: "8f3ac1d2feedbeef", entry: "remoteEntry.cf71.js" });
const uiPin = sriOf(uiManifest);
const secondUiManifest = manifestFor({ version: "1111111111111111", entry: "remoteEntry.dd01.js" });
const secondUiPin = sriOf(secondUiManifest);
const authManifest = manifestFor({ version: "2222222222222222", entry: "remoteEntry.auth.js" });
const authPin = sriOf(authManifest);

const cdnRoutes: Record<string, string> = {
  "https://cdn.example.test/ui/versions/8f3ac1d2feedbeef.json": uiManifest,
  "https://cdn.example.test/ui/versions/1111111111111111.json": secondUiManifest,
  "https://cdn.example.test/auth/versions/2222222222222222.json": authManifest,
  "https://cdn.example.test/ui/remoteEntry.cf71.js": entryBytes,
  "https://cdn.example.test/ui/remoteEntry.dd01.js": entryBytes,
  "https://cdn.example.test/auth/remoteEntry.auth.js": entryBytes,
};

const fakeCdnFetch = async (input: string | URL | Request): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = cdnRoutes[url];
  return body === undefined
    ? new Response("not found", { status: 404 })
    : new Response(body, { status: 200 });
};
const publishedPointer = {
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    ui: {
      development: "local:ui",
      production: "https://cdn.example.test/ui/",
      digest: {
        manifest: "versions/8f3ac1d2feedbeef.json",
        integrity: uiPin,
      },
    },
    api: { development: "local:api", production: "https://cdn.example.test/api/" },
  },
} as unknown as BosConfig;

// what resolveMergedConfigInput returns for a child pointer: the extends
// chain walked, so remotes the child inherits — notably app.host — are present
const mergedPointer = {
  ...publishedPointer,
  app: {
    ...publishedPointer.app,
    host: { development: "local:host", production: "https://cdn.example.test/host/" },
  },
} as unknown as BosConfig;


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
const resolveMergedConfigInputMock = vi.hoisted(() => vi.fn());

vi.mock("everything-dev/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("everything-dev/config")>();
  return { ...actual, buildRuntimeConfigEffect: vi.fn() };
});

vi.mock("everything-dev/resolution", () => ({
  resolveMergedConfigInput: resolveMergedConfigInputMock,
}));

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
  vi.stubGlobal("fetch", vi.fn(fakeCdnFetch) as unknown as typeof fetch);
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("adoptPublishedPointer", () => {
  beforeEach(() => {
    resolveMergedConfigInputMock.mockReset();
    resolveMergedConfigInputMock.mockResolvedValue(mergedPointer);
  });

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
    expect(buildRuntimeConfigMock).toHaveBeenCalledTimes(1);
    const [builtFrom, builtBaseDir, builtEnv] = buildRuntimeConfigMock.mock.calls[0]!;
    expect(builtEnv).toBe("production");
    expect(builtBaseDir).toEqual(expect.any(String));
    expect(builtFrom.app.host).toEqual(mergedPointer.app.host);
    expect(builtFrom.app.ui).toMatchObject({ production: "https://cdn.example.test/ui/" });
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

  it("flags boot-frozen slots whose pins the adopted pointer moved (#826 follow-up)", async () => {
    const secondPointer = {
      ...publishedPointer,
      app: {
        ...publishedPointer.app,
        ui: {
          ...publishedPointer.app.ui,
          digest: { manifest: "versions/1111111111111111.json", integrity: secondUiPin },
        },
        auth: {
          development: "local:auth",
          production: "https://cdn.example.test/auth/",
          digest: { manifest: "versions/2222222222222222.json", integrity: authPin },
        },
      },
    } as unknown as BosConfig;
    const secondMerged = {
      ...secondPointer,
      app: {
        ...secondPointer.app,
        host: { development: "local:host", production: "https://cdn.example.test/host/" },
      },
    } as unknown as BosConfig;
    const secondDerived = {
      ...derivedConfig,
      ui: { ...derivedConfig.ui, entryUrl: "https://cdn.example.test/ui/remoteEntry.dd01.js" },
    } as unknown as RuntimeConfig;
    resolveMergedConfigInputMock
      .mockResolvedValueOnce(mergedPointer)
      .mockResolvedValueOnce(secondMerged);
    buildRuntimeConfigMock
      .mockReturnValueOnce(Effect.succeed(derivedConfig))
      .mockReturnValueOnce(Effect.succeed(secondDerived));
    composeUiMock
      .mockReturnValueOnce(Effect.succeed({ digest: "digest-prewarm" }))
      .mockReturnValueOnce(Effect.succeed({ digest: "digest-prewarm-2" }));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        yield* adoptPublishedPointer({ snapshot, publishedConfig: publishedPointer });
        const outcome = yield* adoptPublishedPointer({ snapshot, publishedConfig: secondPointer });
        const after = yield* snapshot.get;
        return { outcome, after };
      }).pipe(Effect.provide(snapshotLayer)),
    );
    expect(result.outcome.status).toBe("swapped");
    // the ui pin move is adopted; the auth pin move is boot-frozen and flagged
    expect(result.after.restartRequired).toEqual(["app.auth"]);
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
    expect((squashed as SnapshotAdoptError).message).toContain("chain verification");
    expect((squashed as SnapshotAdoptError).message).toContain("manifest SRI mismatch");
    expect(result.after).toBe(result.before);
    // restore the good CDN for the tests that follow
    vi.stubGlobal("fetch", vi.fn(fakeCdnFetch) as unknown as typeof fetch);
  });

  it("derives from the extends-merged pointer — inherited remotes (app.host) reach the runtime build", async () => {
    // a child pointer carries no app.host (inherited via extends); building
    // straight from the raw pointer crashed the adopt with
    // `Cannot read properties of undefined (reading 'production')`
    buildRuntimeConfigMock.mockReturnValue(Effect.succeed(derivedConfig));
    composeUiMock.mockReturnValue(Effect.succeed({ digest: "digest-prewarm" }));

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        return yield* adoptPublishedPointer({ snapshot, publishedConfig: publishedPointer });
      }).pipe(Effect.provide(snapshotLayer)),
    );

    expect(outcome.status).toBe("swapped");
    expect(resolveMergedConfigInputMock).toHaveBeenCalledWith(
      "bos://v1.citynode.near/citynode.app",
      { env: "production", seedConfig: publishedPointer },
    );
    const builtFrom = buildRuntimeConfigMock.mock.calls[0]![0] as BosConfig;
    expect(builtFrom.app.host).toEqual({
      development: "local:host",
      production: "https://cdn.example.test/host/",
    });
  });

  it("an unresolvable extends chain fails the adopt and leaves the live snapshot untouched", async () => {
    resolveMergedConfigInputMock.mockRejectedValue(
      new Error("No config found for bos://dev.everything.near/everything.dev"),
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
    expect((squashed as SnapshotAdoptError).message).toContain(
      "deriving the published pointer failed",
    );
    expect((squashed as SnapshotAdoptError).message).toContain("No config found");
    expect(result.after).toBe(result.before);
  });

  it("a pointer without a domain fails the adopt — no fallback to another runtime's ref", async () => {
    const domainLess = { ...publishedPointer, domain: undefined } as unknown as BosConfig;
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const before = yield* snapshot.get;
        const exit = yield* Effect.exit(
          adoptPublishedPointer({ snapshot, publishedConfig: domainLess }),
        );
        const after = yield* snapshot.get;
        return { before, exit, after };
      }).pipe(Effect.provide(snapshotLayer)),
    );
    if (!Exit.isFailure(result.exit)) throw new Error("expected adopt failure");
    const squashed = Cause.squash(result.exit.cause);
    expect((squashed as SnapshotAdoptError).message).toContain(
      "deriving the published pointer failed",
    );
    expect((squashed as SnapshotAdoptError).message).toContain("has no domain");
    expect(resolveMergedConfigInputMock).not.toHaveBeenCalled();
    expect(result.after).toBe(result.before);
  });

  it("persists the approved snapshot on a swapped adopt — verified bytes for a restart", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-"));
    vi.stubEnv("BOS_SNAPSHOT_DIR", dir);
    buildRuntimeConfigMock.mockReturnValue(Effect.succeed(derivedConfig));
    composeUiMock.mockReturnValue(Effect.succeed({ digest: "digest-prewarm" }));
    await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        return yield* adoptPublishedPointer({ snapshot, publishedConfig: publishedPointer });
      }).pipe(Effect.provide(snapshotLayer)),
    );
    const stored = parseBootSnapshot(
      await readFile(path.join(dir, "v1.citynode.near", "citynode.app.json"), "utf8"),
    );
    expect(stored.runtimeRef).toBe("bos://v1.citynode.near/citynode.app");
    expect(stored.fingerprint).toBe(pointerFingerprint(stored.config));
    expect(snapshotFingerprintMatches(stored)).toBe(true);
    expect(stored.config.app.ui).toMatchObject({
      production: "https://cdn.example.test/ui/",
      digest: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: uiPin },
    });
    expect(stored.remotes["app.ui"]).toEqual({
      base: "https://cdn.example.test/ui/",
      digest: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: uiPin },
    });
  });

  it("re-persists on an unchanged adopt — a deleted snapshot heals on the next tick", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-"));
    vi.stubEnv("BOS_SNAPSHOT_DIR", dir);
    buildRuntimeConfigMock.mockReturnValue(Effect.succeed(derivedConfig));
    composeUiMock.mockReturnValue(Effect.succeed({ digest: "digest-prewarm" }));
    const target = path.join(dir, "v1.citynode.near", "citynode.app.json");
    const outcomes = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const first = yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: publishedPointer,
        });
        yield* Effect.tryPromise(() => unlink(target));
        const second = yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: publishedPointer,
        });
        return { first, second };
      }).pipe(Effect.provide(snapshotLayer)),
    );
    expect(outcomes.first.status).toBe("swapped");
    expect(outcomes.second.status).toBe("unchanged");
    await expect(readFile(target, "utf8")).resolves.toContain("everything-dev/boot-snapshot");
  });

  it("a persist failure never fails the adopt — the snapshot is an addition, not a dependency", async () => {
    // Deterministic persist failure on every OS: the snapshot root's parent
    // is a regular file, so the recursive mkdir refuses instantly (ENOTDIR /
    // EEXIST-on-file). A /proc path was tried first and HANGS on Linux —
    // procfs exists there and the recursive walk never settles.
    const blocker = path.join(
      await mkdtemp(path.join(tmpdir(), "boot-snapshot-blocker-")),
      "blocker",
    );
    await writeFile(blocker, "not a directory");
    vi.stubEnv("BOS_SNAPSHOT_DIR", blocker);
    buildRuntimeConfigMock.mockReturnValue(Effect.succeed(derivedConfig));
    composeUiMock.mockReturnValue(Effect.succeed({ digest: "digest-prewarm" }));
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        return yield* adoptPublishedPointer({ snapshot, publishedConfig: publishedPointer });
      }).pipe(Effect.provide(snapshotLayer)),
    );
    expect(outcome.status).toBe("swapped");
  });
});
