import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pointerDigest } from "../../src/services/registry/digest";
import {
  BootSnapshotIntegrityError,
  bootSnapshotOf,
  parseBootSnapshot,
  readBootSnapshot,
  snapshotDigestMatches,
  snapshotPath,
  verifiedBootSnapshot,
  writeBootSnapshot,
} from "../../src/services/snapshot/schema";
import { BosConfigSchema } from "../../src/types";

/**
 * Golden wire tests for the approved boot snapshot (ADR 0041, ticket 01): the
 * file's own integrity check is the recomputed pointer digest (registry
 * not consulted), the pinned-remote mirror covers exactly the remotes with a
 * digest, and persist/load round-trips byte-stably. Wire ref:
 * `.bos/snapshot/<account>/<gateway>.json`.
 */

const config = BosConfigSchema.parse({
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    host: {
      development: "local:host",
      production: "https://cdn/host/",
      digest: { manifest: "versions/aaa.json", integrity: "sha384-host-manifest-sri" },
    },
    ui: {
      development: "local:ui",
      production: "https://cdn/ui/",
      digest: { manifest: "versions/bbb.json", integrity: "sha384-manifest-sri" },
      ssr: "https://cdn/ui/ssr/",
      ssrIntegrity: "sha384-ssr-sri",
    },
    api: {
      development: "local:api",
      production: "https://cdn/api/",
      digest: { manifest: "versions/ccc.json", integrity: "sha384-api-manifest-sri" },
    },
  },
  plugins: {
    votes: "votes",
    auth: {
      name: "@everything-dev/auth-plugin",
      development: "local:plugins/auth",
      production: "https://cdn/auth/",
      digest: { manifest: "versions/ddd.json", integrity: "sha384-auth-manifest-sri" },
      ui: {
        name: "auth-ui",
        development: "local:plugins/auth/ui",
        production: "https://cdn/auth-ui/",
        digest: { manifest: "versions/eee.json", integrity: "sha384-auth-ui-manifest-sri" },
      },
    },
  },
});

const ACCOUNT = "dev.everything.near";
const GATEWAY = "citynode.app";

describe("snapshotPath", () => {
  it("keys the file like the staged layout: <root>/<account>/<gateway>.json", () => {
    expect(snapshotPath(ACCOUNT, GATEWAY, { dir: "/state/snapshots" })).toBe(
      path.join("/state/snapshots", ACCOUNT, `${GATEWAY}.json`),
    );
  });

  it("defaults to .bos/snapshot beside the cwd", () => {
    expect(snapshotPath(ACCOUNT, GATEWAY)).toBe(
      path.join(process.cwd(), ".bos", "snapshot", ACCOUNT, `${GATEWAY}.json`),
    );
  });
});

describe("bootSnapshotOf", () => {
  it("computes pointerDigest as the pointer digest of the stored config", () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(snapshot.pointerDigest).toBe(pointerDigest(config));
  });

  it("mirrors exactly the pinned remotes — bare plugin refs stay out", () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(Object.keys(snapshot.remotes).sort()).toEqual([
      "app.api",
      "app.host",
      "app.ui",
      "plugins.auth",
      "plugins.auth.ui",
    ]);
    expect(snapshot.remotes["app.ui"]).toEqual({
      base: "https://cdn/ui/",
      digest: { manifest: "versions/bbb.json", integrity: "sha384-manifest-sri" },
    });
  });

  it("defaults the authorization facts: no manifest tag, no deploy record", () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(snapshot.manifestTag).toBeNull();
    expect(snapshot.deployRecordKey).toBeNull();
    expect(snapshot.runtimeRef).toBe(`bos://${ACCOUNT}/${GATEWAY}`);
  });

  it("records the manifest tag and deploy record when the caller has them", () => {
    const snapshot = bootSnapshotOf({
      account: ACCOUNT,
      gateway: GATEWAY,
      config,
      manifestTag: { version: "2.0.0-rc.37", digest: "b143bf5f" },
      deployRecordKey: "apps/dev.everything.near/everything.dev/deploys/2026-11-04T00:00:00Z.json",
      writtenAt: "2026-11-04T12:00:00.000Z",
    });
    expect(snapshot.manifestTag).toEqual({ version: "2.0.0-rc.37", digest: "b143bf5f" });
    expect(snapshot.deployRecordKey).toBe(
      "apps/dev.everything.near/everything.dev/deploys/2026-11-04T00:00:00Z.json",
    );
    expect(snapshot.writtenAt).toBe("2026-11-04T12:00:00.000Z");
  });
});

describe("snapshotDigestMatches", () => {
  it("holds for a snapshot built by bootSnapshotOf", () => {
    expect(
      snapshotDigestMatches(bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config })),
    ).toBe(true);
  });

  it("refuses a hand-edited pointerDigest — the file's own integrity check", () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(snapshotDigestMatches({ ...snapshot, pointerDigest: "0".repeat(16) })).toBe(false);
  });
});

describe("persist + load round-trip", () => {
  it("writes atomically under the runtime's key and reads back identically", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-"));
    const snapshot = bootSnapshotOf({
      account: ACCOUNT,
      gateway: GATEWAY,
      config,
      manifestTag: { version: "2.0.0-rc.37", digest: "b143bf5f" },
    });
    const target = await writeBootSnapshot(snapshot, { dir });
    expect(target).toBe(snapshotPath(ACCOUNT, GATEWAY, { dir }));
    expect(parseBootSnapshot(await readFile(target, "utf8"))).toEqual(snapshot);
  });

  it("round-trips through serialize/parse with the pointer digest stable", () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(parseBootSnapshot(`${JSON.stringify(snapshot, null, 2)}\n`)).toEqual(snapshot);
  });
});

describe("strictness", () => {
  it("rejects an unknown top-level key on load", () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    const bytes = JSON.stringify({ ...snapshot, extra: true });
    expect(() => parseBootSnapshot(bytes)).toThrow();
  });

  it("rejects a pointerDigest that is not the 16-hex digest shape", () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(() =>
      parseBootSnapshot(JSON.stringify({ ...snapshot, pointerDigest: "tooshort" })),
    ).toThrow();
  });
});

describe("readBootSnapshot", () => {
  it("returns null for an absent snapshot — the fresh-activation case", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-"));
    expect(await readBootSnapshot(ACCOUNT, GATEWAY, { dir })).toBeNull();
  });

  it("reads back a persisted snapshot", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-"));
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    await writeBootSnapshot(snapshot, { dir });
    expect(await readBootSnapshot(ACCOUNT, GATEWAY, { dir })).toEqual(snapshot);
  });

  it("throws on present-but-invalid bytes — distinct from absent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-"));
    const target = snapshotPath(ACCOUNT, GATEWAY, { dir });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "{ not json", "utf8");
    await expect(readBootSnapshot(ACCOUNT, GATEWAY, { dir })).rejects.toThrow();
  });
});

describe("verifiedBootSnapshot", () => {
  it("passes a snapshot built by bootSnapshotOf", () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(verifiedBootSnapshot(snapshot)).toBe(snapshot);
  });

  it("refuses a tampered pointerDigest with the named integrity error", () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(() => verifiedBootSnapshot({ ...snapshot, pointerDigest: "0".repeat(16) })).toThrow(
      BootSnapshotIntegrityError,
    );
  });
});

describe("the staging stamp (ADR 0043) — lockfileDigest on the approved snapshot", () => {
  it("carries the control plane's staging identity through persist + load", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-stage-"));
    const staged = bootSnapshotOf({
      account: ACCOUNT,
      gateway: GATEWAY,
      config,
      manifestTag: { version: "2.0.0-rc.37", digest: "b143bf5f" },
      lockfileDigest: "a".repeat(64),
    });
    expect(staged.lockfileDigest).toBe("a".repeat(64));
    await writeBootSnapshot(staged, { dir });
    const loaded = parseBootSnapshot(
      await readFile(snapshotPath(ACCOUNT, GATEWAY, { dir }), "utf8"),
    );
    expect(loaded.lockfileDigest).toBe("a".repeat(64));
    expect(snapshotDigestMatches(loaded)).toBe(true);
  });

  it("host-written snapshots (no staging) omit the key entirely", async () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(snapshot.lockfileDigest).toBeUndefined();
    expect("lockfileDigest" in snapshot).toBe(false);
  });

  it("refuses a lockfileDigest that is not 64-hex", () => {
    const snapshot = bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(() =>
      parseBootSnapshot(JSON.stringify({ ...snapshot, lockfileDigest: "nope" })),
    ).toThrow();
  });

  it("stages a stamped extends-chain payload whose app.auth.ui carries no name (#800)", async () => {
    const stamped = BosConfigSchema.parse({
      ...config,
      app: {
        ...config.app,
        auth: {
          ...(config.app as Record<string, unknown>).auth,
          ui: {
            production: "https://cdn/auth-ui/",
            digest: { manifest: "versions/eee.json", integrity: "sha384-auth-ui-manifest-sri" },
          },
        },
      },
    });
    const dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-stamped-"));
    const staged = bootSnapshotOf({
      account: ACCOUNT,
      gateway: GATEWAY,
      config: stamped,
      manifestTag: { version: "2.0.0-rc.38", digest: "b143bf5f" },
    });
    await writeBootSnapshot(staged, { dir });
    const loaded = parseBootSnapshot(
      await readFile(snapshotPath(ACCOUNT, GATEWAY, { dir }), "utf8"),
    );
    expect(snapshotDigestMatches(loaded)).toBe(true);
    expect(loaded.remotes["plugins.auth.ui"]).toBeDefined();
  });
});
