import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { buildRuntimeConfigEffect } from "everything-dev/config";
import { pointerDigest } from "everything-dev/digest";
import { readBootSnapshot, snapshotDigestMatches } from "everything-dev/snapshot";
import type { BosConfig, RuntimeConfig } from "everything-dev/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runServer, type ServerHandle } from "../../src/program";
import { deploymentDigest } from "../../src/services/runtime-snapshot";
import { getAvailablePort } from "../helpers/ports";

/**
 * The reconciler end to end (issue #941): the coherence guard
 * (`BOS_HOLD_ON_BACKEND_CHANGE`) holds an adopt whose pointer moved the api
 * pin, /health reports `pendingRestart` (the consumer contract's shape), the
 * armed reconciler verifies the published generation, persists it as the
 * approved boot snapshot (ADR 0041), commits the replacement, and clears the
 * ledger — while the old instance's UI+API pair serves UNCHANGED through the
 * whole window (the hold refuses every partial swap). The replacement then
 * boots the moved pin from the persisted snapshot alone (registry outage),
 * UI and backends together.
 *
 * Real machinery: the HTTP server, the watch fiber, the coordinator's adopt
 * transaction (chain verification over fake CDN bytes), the reconciler loop,
 * the snapshot bytes on disk, and a second full server as the replacement.
 * Stubbed: the pure config derivation (`buildRuntimeConfigEffect`) and the
 * compose pre-warm, exactly like the coordinator hold unit tests; the
 * registry is a stubbed `latest` endpoint.
 */

const CDN = "https://cdn.example.test";
const ACCOUNT = "v1.citynode.near";
const GATEWAY = "citynode.app";

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
const hostVersion = { id: "cccccccccccccccc", entry: "remoteEntry.host.js" };

const cdnRoutes: Record<string, string> = {
  [`${CDN}/ui/remoteEntry.cf71.js`]: entryBytes,
  [`${CDN}/ui/remoteEntry.dd01.js`]: entryBytes,
  [`${CDN}/ui/remoteEntry.ee02.js`]: entryBytes,
  [`${CDN}/api/remoteEntry.api-one.js`]: entryBytes,
  [`${CDN}/api/remoteEntry.api-two.js`]: entryBytes,
  [`${CDN}/host/remoteEntry.host.js`]: entryBytes,
};
for (const version of uiVersions) {
  cdnRoutes[`${CDN}/ui/versions/${version.id}.json`] = manifestFor({
    version: version.id,
    entry: version.entry,
  });
}
for (const version of apiVersions) {
  cdnRoutes[`${CDN}/api/versions/${version.id}.json`] = manifestFor({
    version: version.id,
    entry: version.entry,
  });
}
cdnRoutes[`${CDN}/host/versions/${hostVersion.id}.json`] = manifestFor({
  version: hostVersion.id,
  entry: hostVersion.entry,
});

/** The published pointer — the test republishes by reassigning. */
const registryState: { pointer: BosConfig | null } = { pointer: null };

const realFetch = globalThis.fetch;
const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("127.0.0.1") || url.includes("localhost")) {
    return realFetch(input as never, init);
  }
  if (url.includes("/v0/latest/")) {
    return registryState.pointer
      ? new Response(JSON.stringify({ entries: [{ value: registryState.pointer }] }), {
          status: 200,
        })
      : new Response("not found", { status: 404 });
  }
  const body = cdnRoutes[url];
  return body === undefined
    ? new Response("not found", { status: 404 })
    : new Response(body, { status: 200 });
};

const pointerFor = (input: { uiIndex: number; apiIndex: number }): BosConfig =>
  ({
    account: ACCOUNT,
    domain: GATEWAY,
    app: {
      ui: {
        development: "local:ui",
        production: `${CDN}/ui/`,
        digest: {
          manifest: `versions/${uiVersions[input.uiIndex].id}.json`,
          integrity: sriOf(cdnRoutes[`${CDN}/ui/versions/${uiVersions[input.uiIndex].id}.json`]),
        },
      },
      api: {
        development: "local:api",
        production: `${CDN}/api/`,
        digest: {
          manifest: `versions/${apiVersions[input.apiIndex].id}.json`,
          integrity: sriOf(cdnRoutes[`${CDN}/api/versions/${apiVersions[input.apiIndex].id}.json`]),
        },
      },
      host: {
        development: "local:host",
        production: `${CDN}/host/`,
        digest: {
          manifest: `versions/${hostVersion.id}.json`,
          integrity: sriOf(cdnRoutes[`${CDN}/host/versions/${hostVersion.id}.json`]),
        },
      },
    },
  }) as unknown as BosConfig;

/** The derived generation the adopt pipeline produces for a pointer — the
 * api slot is proxy-shaped so the test servers boot without federation-
 * loading backend bundles (proxy mode skips plugin init); the pointer pins
 * still carry the boot-frozen coordinates the guard compares. */
const derivedFor = (uiIndex: number, apiIndex: number): RuntimeConfig =>
  ({
    env: "production",
    account: ACCOUNT,
    domain: GATEWAY,
    networkId: "mainnet",
    host: {
      name: "host",
      url: "http://127.0.0.1:3000",
      entry: "http://127.0.0.1:3000/mf-manifest.json",
      source: "local",
    },
    ui: {
      name: "ui",
      url: `${CDN}/ui/`,
      entry: `${CDN}/ui/mf-manifest.json`,
      source: "remote",
      integrity: entrySri,
      entryUrl: `${CDN}/ui/${uiVersions[uiIndex].entry}`,
    },
    api: {
      name: "api",
      url: `${CDN}/api/`,
      entry: `${CDN}/api/mf-manifest.json`,
      source: "remote",
      proxy: "http://127.0.0.1:1",
      integrity: entrySri,
      entryUrl: `${CDN}/api/${apiVersions[apiIndex].entry}`,
    },
  }) as unknown as RuntimeConfig;

const deriveFromPointer = vi.fn((config: unknown) => {
  const pointer = config as BosConfig;
  const app = pointer.app as {
    ui?: { digest?: { manifest?: string } };
    api?: { digest?: { manifest?: string } };
  };
  const uiIndex = Math.max(
    uiVersions.findIndex((v) => app?.ui?.digest?.manifest === `versions/${v.id}.json`),
    0,
  );
  const apiIndex = Math.max(
    apiVersions.findIndex((v) => app?.api?.digest?.manifest === `versions/${v.id}.json`),
    0,
  );
  return Effect.succeed(derivedFor(uiIndex, apiIndex));
});

const composeUiMock = vi.hoisted(() => vi.fn());

vi.mock("everything-dev/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("everything-dev/config")>();
  return { ...actual, buildRuntimeConfigEffect: vi.fn() };
});

vi.mock("../../src/services/ui-compose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/ui-compose")>();
  return {
    ...actual,
    composeUi: composeUiMock,
  };
});

const buildRuntimeConfigMock = vi.mocked(buildRuntimeConfigEffect);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const until = async (probe: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await sleep(25);
  }
  throw new Error("timed out waiting for the reconciler scenario to advance");
};

const getJson = async (origin: string, path: string): Promise<Record<string, unknown>> =>
  (await (await realFetch(`${origin}${path}`)).json()) as Record<string, unknown>;

describe("the held-generation reconciler (issue #941)", () => {
  let snapshotDir: string;
  let originA: string;
  let originB: string;
  let serverA: ServerHandle | null = null;
  let serverB: ServerHandle | null = null;
  let replacementSignals = 0;
  let onSigterm: (() => void) | null = null;

  beforeAll(async () => {
    snapshotDir = await mkdtemp(path.join(tmpdir(), "snapshot-reconciler-"));
    buildRuntimeConfigMock.mockImplementation(deriveFromPointer as never);
    composeUiMock.mockReturnValue(Effect.succeed({ digest: "digest-prewarm" }));
    onSigterm = () => {
      replacementSignals += 1;
    };
    process.on("SIGTERM", onSigterm);
    vi.stubGlobal("fetch", vi.fn(fakeFetch) as unknown as typeof fetch);
  });

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HOST", "127.0.0.1");
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (onSigterm) process.off("SIGTERM", onSigterm);
    await serverA?.shutdown();
    await serverB?.shutdown();
    await rm(snapshotDir, { recursive: true, force: true });
  });

  it("holds a moved api pin, commits the replacement, and the replacement boots the moved pin whole", {
    timeout: 60_000,
  }, async () => {
    const env = {
      BOS_HOLD_ON_BACKEND_CHANGE: "1",
      BOS_RECONCILE_HELD_GENERATIONS: "1",
      BOS_SNAPSHOT_WATCH_INTERVAL_MS: "25",
      BOS_SNAPSHOT_DIR: snapshotDir,
    };
    const portA = await getAvailablePort();
    originA = `http://127.0.0.1:${portA}`;

    const bootConfig = derivedFor(2, 0);
    serverA = runServer({ config: bootConfig, env, port: portA });
    await serverA.ready;

    registryState.pointer = pointerFor({ uiIndex: 0, apiIndex: 0 });
    const gen1 = pointerFor({ uiIndex: 0, apiIndex: 0 });
    await until(async () => {
      const version = await getJson(originA, "/.well-known/version");
      return version.pointerDigest === pointerDigest(gen1);
    });

    const before = await getJson(originA, "/health");
    expect(before.pendingRestart).toBeUndefined();

    registryState.pointer = pointerFor({ uiIndex: 1, apiIndex: 1 });
    let held: Record<string, unknown> | null = null;
    await until(async () => {
      const health = await getJson(originA, "/health");
      if (health.pendingRestart === undefined) return false;
      held = health;
      return true;
    });
    expect(held!.pendingRestart).toEqual(["app.api"]);
    expect(String(held!.note)).toContain("coherence guard refuses a partial swap");

    const neverSplit: Array<{ digest: unknown; apiPin: unknown }> = [];
    for (let i = 0; i < 20; i += 1) {
      const version = await getJson(originA, "/.well-known/version");
      const remotes = version.remotes as Record<string, string>;
      neverSplit.push({ digest: version.deploymentDigest, apiPin: remotes["app.api"] });
      await sleep(30);
    }
    for (const sample of neverSplit) {
      expect(sample.digest).toBe(deploymentDigest(derivedFor(0, 0)));
      expect(sample.apiPin).toBe(`versions/${apiVersions[0].id}.json`);
    }

    await until(async () => (await getJson(originA, "/health")).pendingRestart === undefined);
    await until(async () => replacementSignals > 0);

    const after = await getJson(originA, "/.well-known/version");
    expect(after.deploymentDigest).toBe(deploymentDigest(derivedFor(0, 0)));
    expect(after.pendingRestart).toBeUndefined();

    const snapshot = await readBootSnapshot(ACCOUNT, GATEWAY, { dir: snapshotDir });
    expect(snapshot).not.toBeNull();
    expect(snapshotDigestMatches(snapshot!)).toBe(true);
    const stored = snapshot!.config as BosConfig;
    const storedApi = (stored.app as { api?: { digest?: { integrity?: string } } }).api;
    expect(storedApi?.digest?.integrity).toBe(
      sriOf(cdnRoutes[`${CDN}/api/versions/${apiVersions[1].id}.json`]),
    );

    const portB = await getAvailablePort();
    originB = `http://127.0.0.1:${portB}`;
    const bootstrapped = await readBootSnapshot(ACCOUNT, GATEWAY, { dir: snapshotDir });
    expect(bootstrapped).not.toBeNull();
    const replacementConfig = await Effect.runPromise(
      buildRuntimeConfigEffect(bootstrapped!.config, process.cwd(), "production"),
    );
    serverB = runServer({ config: replacementConfig, env, port: portB });
    await serverB.ready;

    const versionB = await getJson(originB, "/.well-known/version");
    expect(versionB.deploymentDigest).toBe(deploymentDigest(derivedFor(1, 1)));
    expect(versionB.pendingRestart).toBeUndefined();

    const healthB = await getJson(originB, "/health");
    expect(healthB.pendingRestart).toBeUndefined();
    expect(healthB.status).toBe("ready");
  });
});
