import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pointerDigest } from "../../src/services/registry/digest";
import {
  bootSnapshotOf,
  readBootSnapshot,
  writeBootSnapshot,
} from "../../src/services/snapshot/schema";
import { createRegistryConfigSource } from "../../src/services/start/snapshot-source";
import { BosConfigSchema } from "../../src/types";

/**
 * The restart-under-outage regression (ADR 0041 ticket 04): the rung is
 * exercised against REAL snapshot bytes on a real filesystem — the writer the
 * coordinator uses, the reader the boot path uses, and the pointer digest
 * verification — with only the network stubbed (a registry outage is the one
 * thing that can't be reproduced portably). The out-of-the-box assertion:
 * a restart during an outage serves the last verified generation; corrupt
 * bytes on disk refuse, naming both causes.
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
const OUTAGE = new Error("connect ECONNREFUSED 127.0.0.1:1 (the registry is down)");

let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function realSource() {
  return createRegistryConfigSource({
    fetchPublishedConfig: async () => {
      throw OUTAGE;
    },
    loadSnapshot: (account, gateway, snapshotDir) =>
      readBootSnapshot(account, gateway, snapshotDir ? { dir: snapshotDir } : undefined),
    persistSnapshot: async (account, gateway, resolved) => {
      await writeBootSnapshot(bootSnapshotOf({ account, gateway, config: resolved }));
    },
  });
}

async function persistAsCoordinatorWould(): Promise<void> {
  const snapshot = bootSnapshotOf({
    account: ACCOUNT,
    gateway: GATEWAY,
    config,
    manifestTag: { version: "2.0.0-rc.37", digest: "b143bf5f" },
  });
  await writeBootSnapshot(snapshot, { dir });
}

describe("the boot rung against real snapshot bytes (restart-under-outage)", () => {
  it("a restart during an outage serves the persisted generation, digest-verified", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-rung-"));
    await persistAsCoordinatorWould();
    const resolved = await realSource().resolve({
      account: ACCOUNT,
      gateway: GATEWAY,
      allowSnapshot: true,
      dir,
    });
    expect(resolved?.source).toBe("snapshot");
    expect(resolved?.config).toEqual(config);
    expect(pointerDigest(resolved?.config ?? ({} as never))).toBe(pointerDigest(config));
    expect(resolved?.warnings.join(" ")).toContain("registry unreachable");
  });

  it("on-disk corruption (a flipped digest byte) refuses, naming both causes", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-rung-"));
    await persistAsCoordinatorWould();
    const target = path.join(dir, ACCOUNT, `${GATEWAY}.json`);
    const bytes = JSON.parse(await readFile(target, "utf8")) as { pointerDigest: string };
    bytes.pointerDigest = bytes.pointerDigest
      .split("")
      .map((c, i) => (i === 0 ? (c === "0" ? "1" : "0") : c))
      .join("");
    await writeFile(target, `${JSON.stringify(bytes, null, 2)}\n`);
    await expect(
      realSource().resolve({ account: ACCOUNT, gateway: GATEWAY, allowSnapshot: true, dir }),
    ).rejects.toThrow(/registry is unreachable.*digest mismatch/s);
  });

  it("unparseable bytes on disk refuse, naming both causes", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-rung-"));
    const target = path.join(dir, ACCOUNT, `${GATEWAY}.json`);
    await writeBootSnapshot(bootSnapshotOf({ account: ACCOUNT, gateway: GATEWAY, config }), {
      dir,
    });
    await writeFile(target, "{ truncated");
    await expect(
      realSource().resolve({ account: ACCOUNT, gateway: GATEWAY, allowSnapshot: true, dir }),
    ).rejects.toThrow(/registry is unreachable.*unusable/s);
  });

  it("a healthy resolution persists through the writer seam — the next restart is covered", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "boot-snapshot-rung-"));
    const healthy = createRegistryConfigSource({
      fetchPublishedConfig: async () => config,
      loadSnapshot: async () => null,
      persistSnapshot: async (account, gateway, resolved) => {
        await writeBootSnapshot(bootSnapshotOf({ account, gateway, config: resolved }), { dir });
      },
    });
    const resolved = await healthy.resolve({
      account: ACCOUNT,
      gateway: GATEWAY,
      allowSnapshot: true,
      dir,
    });
    expect(resolved?.source).toBe("registry");
    const stored = await readBootSnapshot(ACCOUNT, GATEWAY, { dir });
    expect(stored).not.toBeNull();
    expect(stored?.config).toEqual(config);
  });
});
