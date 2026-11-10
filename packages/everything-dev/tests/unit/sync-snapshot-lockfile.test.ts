import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lockfileOf, parseLockfile } from "../../src/services/lockfile/schema";
import {
  absorbLegacySnapshot,
  readSnapshot,
  writeSnapshot,
} from "../../src/services/scaffold/snapshot";
import { BosConfigSchema } from "../../src/types";

/**
 * The sync baseline's two homes (ADR 0047): `bos.lock.json`'s `template.sync`
 * is the committed form — the legacy `.bos/sync-snapshot.json` file is the
 * fallback for lock-less repos and the migration's absorb source. The facade
 * is the only code that touches either.
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
    },
    api: {
      development: "local:api",
      production: "https://cdn/api/",
      digest: { manifest: "versions/ccc.json", integrity: "sha384-api-manifest-sri" },
    },
  },
});

const ACCOUNT = "dev.everything.near";
const GATEWAY = "citynode.app";
const LEGACY = { timestamp: "2026-11-01T00:00:00.000Z", files: { ".gitignore": "hash-1" } };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sync-snapshot-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeLegacySnapshot(snapshot: unknown): void {
  mkdirSync(path.join(dir, ".bos"), { recursive: true });
  writeFileSync(path.join(dir, ".bos", "sync-snapshot.json"), JSON.stringify(snapshot, null, 2));
}

describe("readSnapshot", () => {
  it("prefers the lock's template.sync — the committed form wins", async () => {
    writeLegacySnapshot(LEGACY);
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    writeFileSync(
      path.join(dir, "bos.lock.json"),
      JSON.stringify(
        { ...lock, template: { syncedAt: "2026-11-09T00:00:00.000Z", files: { x: "hash-2" } } },
        null,
        2,
      ),
    );
    const snapshot = await readSnapshot(dir);
    expect(snapshot).toEqual({ timestamp: "2026-11-09T00:00:00.000Z", files: { x: "hash-2" } });
  });

  it("falls back to the legacy file while the repo runs lock-less", async () => {
    writeLegacySnapshot(LEGACY);
    expect(await readSnapshot(dir)).toEqual(LEGACY);
  });

  it("falls back to the legacy file when the lock predates the baseline", async () => {
    writeLegacySnapshot(LEGACY);
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    writeFileSync(path.join(dir, "bos.lock.json"), JSON.stringify(lock, null, 2));
    expect(await readSnapshot(dir)).toEqual(LEGACY);
  });

  it("is null when neither home exists", async () => {
    expect(await readSnapshot(dir)).toBeNull();
  });
});

describe("writeSnapshot", () => {
  it("splices the template key into an existing lock without moving the composition", async () => {
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    writeFileSync(path.join(dir, "bos.lock.json"), JSON.stringify(lock, null, 2));

    await writeSnapshot(dir, { files: { ".gitignore": "hash-3" } });

    const onDisk = parseLockfile(readFileSync(path.join(dir, "bos.lock.json"), "utf8"));
    expect(onDisk.template).toEqual({
      syncedAt: expect.any(String),
      files: { ".gitignore": "hash-3" },
    });
    expect(onDisk.pointerDigest).toBe(lock.pointerDigest);
    expect(onDisk.remotes).toEqual(lock.remotes);
    expect(onDisk.release).toBe(lock.release);
  });

  it("deletes the legacy file on the absorb path — it stops regenerating beside the lock", async () => {
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    writeFileSync(path.join(dir, "bos.lock.json"), JSON.stringify(lock, null, 2));
    writeLegacySnapshot(LEGACY);

    await writeSnapshot(dir, { files: { ".gitignore": "hash-3" } });

    expect(existsSync(path.join(dir, ".bos", "sync-snapshot.json"))).toBe(false);
    const onDisk = parseLockfile(readFileSync(path.join(dir, "bos.lock.json"), "utf8"));
    expect(onDisk.template?.files).toEqual({ ".gitignore": "hash-3" });
  });

  it("writes the legacy file when no lock exists — lock-less repos keep a baseline", async () => {
    await writeSnapshot(dir, { files: { ".gitignore": "hash-4" } });

    const legacyPath = path.join(dir, ".bos", "sync-snapshot.json");
    expect(existsSync(legacyPath)).toBe(true);
    expect(JSON.parse(readFileSync(legacyPath, "utf8"))).toEqual({
      timestamp: expect.any(String),
      files: { ".gitignore": "hash-4" },
    });
    expect(existsSync(path.join(dir, "bos.lock.json"))).toBe(false);
  });
});

describe("absorbLegacySnapshot — the upgrade migration leg", () => {
  it("absorbs the legacy baseline into the lock and deletes the file", async () => {
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    writeFileSync(path.join(dir, "bos.lock.json"), JSON.stringify(lock, null, 2));
    writeLegacySnapshot(LEGACY);

    expect(await absorbLegacySnapshot(dir)).toBe("absorbed");

    expect(existsSync(path.join(dir, ".bos", "sync-snapshot.json"))).toBe(false);
    const onDisk = parseLockfile(readFileSync(path.join(dir, "bos.lock.json"), "utf8"));
    expect(onDisk.template).toEqual({ syncedAt: LEGACY.timestamp, files: LEGACY.files });
    expect(onDisk.pointerDigest).toBe(lock.pointerDigest);
  });

  it("removes a stale legacy duplicate beside an already-absorbed lock", async () => {
    const lock = {
      ...lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config }),
      template: { syncedAt: "2026-11-09T00:00:00.000Z", files: { x: "hash-5" } },
    };
    writeFileSync(path.join(dir, "bos.lock.json"), JSON.stringify(lock, null, 2));
    writeLegacySnapshot(LEGACY);

    expect(await absorbLegacySnapshot(dir)).toBe("removed");

    expect(existsSync(path.join(dir, ".bos", "sync-snapshot.json"))).toBe(false);
    const onDisk = parseLockfile(readFileSync(path.join(dir, "bos.lock.json"), "utf8"));
    expect(onDisk.template?.files).toEqual({ x: "hash-5" });
  });

  it("keeps the legacy file when no lock exists — it is still the only baseline", async () => {
    writeLegacySnapshot(LEGACY);

    expect(await absorbLegacySnapshot(dir)).toBeUndefined();

    expect(existsSync(path.join(dir, ".bos", "sync-snapshot.json"))).toBe(true);
  });

  it("removes an unparseable legacy file instead of failing the migration", async () => {
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    writeFileSync(path.join(dir, "bos.lock.json"), JSON.stringify(lock, null, 2));
    mkdirSync(path.join(dir, ".bos"), { recursive: true });
    writeFileSync(path.join(dir, ".bos", "sync-snapshot.json"), "{ not json");

    expect(await absorbLegacySnapshot(dir)).toBe("removed");
    expect(existsSync(path.join(dir, ".bos", "sync-snapshot.json"))).toBe(false);
    const onDisk = parseLockfile(readFileSync(path.join(dir, "bos.lock.json"), "utf8"));
    expect(onDisk.template).toBeUndefined();
  });

  it("is undefined when there is nothing to absorb", async () => {
    expect(await absorbLegacySnapshot(dir)).toBeUndefined();
  });
});
