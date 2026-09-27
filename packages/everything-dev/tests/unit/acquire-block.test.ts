import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PortAllocator, PortAllocatorLive, type PortBlockRequest } from "../../src/app";
import { isPidAlive, readRegistry, registerStandalone } from "../../src/process-registry";

let tempDir: string;
let registryPath: string;
const blockers: Array<{ server: ReturnType<typeof createServer>; port: number }> = [];

const blockOn = (port: number) =>
  new Promise<ReturnType<typeof createServer>>((resolve) => {
    const server = createServer();
    server.once("listening", () => resolve(server));
    server.listen(port, "127.0.0.1");
  });

const runAllocate = (request: PortBlockRequest) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const allocator = yield* PortAllocator;
      return yield* allocator.acquireBlock(request);
    }).pipe(Effect.provide(Layer.mergeAll(PortAllocatorLive))),
  );

describe("PortAllocator.acquireBlock", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "acquire-block-"));
    registryPath = join(tempDir, "pids.json");
    process.env.BO_PID_REGISTRY_PATH = registryPath;
  });

  afterEach(() => {
    for (const { server, port } of blockers.splice(0)) {
      server.close();
      void port;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("allocates the exact block when everything is free", async () => {
    const allocation = await runAllocate({
      base: 5300,
      entries: [
        { key: "host", preferred: 5300, pinned: false },
        { key: "api", preferred: 5301, pinned: false },
        { key: "ui", preferred: 5303, pinned: false },
        { key: "plugin:apps", preferred: 5310, pinned: false },
      ],
    });
    expect(allocation.base).toBe(5300);
    expect(allocation.ports).toEqual({
      host: 5300,
      api: 5301,
      ui: 5303,
      "plugin:apps": 5310,
    });
    expect(allocation.conflicts).toEqual([]);
  });

  it("moves the WHOLE block when a mid-block port is busy (no tail cascade)", async () => {
    blockers.push({ port: 5302, server: await blockOn(5302) });

    const allocation = await runAllocate({
      base: 5300,
      entries: [
        { key: "host", preferred: 5300, pinned: false },
        { key: "api", preferred: 5301, pinned: false },
        { key: "auth", preferred: 5302, pinned: false },
        { key: "plugin:apps", preferred: 5310, pinned: false },
      ],
    });
    expect(allocation.base).toBe(5400);
    expect(allocation.ports).toEqual({
      host: 5400,
      api: 5401,
      auth: 5402,
      "plugin:apps": 5410,
    });
    expect(allocation.conflicts).toEqual([{ key: "auth", port: 5302, claimed: false }]);
  });

  it("fails loud when a PINNED (explicit) port is occupied", async () => {
    blockers.push({ port: 5301, server: await blockOn(5301) });

    const error = await runAllocate({
      base: 5300,
      entries: [
        { key: "host", preferred: 5300, pinned: false },
        { key: "api", preferred: 5301, pinned: true },
      ],
    }).then(
      () => null,
      (err) => err as { cause?: unknown },
    );
    expect(error).not.toBeNull();
    expect(String(error?.cause)).toContain("5301");
    expect(String(error?.cause)).toContain("explicitly-requested");
  });

  it("reclaims a pinned port blocked only by a stale claim (PID reuse)", async () => {
    writeFileSync(
      registryPath,
      JSON.stringify([
        {
          pid: process.pid,
          configDir: tempDir,
          role: "standalone",
          ports: { host: 5300 },
          startedAt: Date.now(),
          processStart: "proc:999999999",
          description: "reused generation",
        },
      ]),
    );

    const allocation = await runAllocate({
      base: 5300,
      entries: [
        { key: "host", preferred: 5300, pinned: true },
        { key: "api", preferred: 5301, pinned: false },
      ],
    });
    expect(allocation.base).toBe(5300);
    expect(allocation.ports.host).toBe(5300);
  });

  it("skips blocks claimed by live sibling sessions via the registry", async () => {
    registerStandalone({
      pid: process.pid,
      configDir: tempDir,
      ports: { host: 5300, api: 5301, auth: 5302, ui: 5303 },
      startedAt: Date.now(),
      description: "sibling",
      leaseKey: "session:other",
    });
    expect(isPidAlive(process.pid)).toBe(true);

    const allocation = await runAllocate({
      base: 5300,
      entries: [
        { key: "host", preferred: 5300, pinned: false },
        { key: "api", preferred: 5301, pinned: false },
      ],
    });
    expect(allocation.base).toBe(5400);
    expect(allocation.conflicts[0]).toEqual({ key: "host", port: 5300, claimed: true });
    const entries = readRegistry();
    expect(entries.some((e) => e.leaseKey === "session:other")).toBe(true);
  });

  it("reads registry entries written by older versions without lease fields", () => {
    writeFileSync(
      registryPath,
      JSON.stringify([
        {
          pid: process.pid,
          configDir: tempDir,
          role: "standalone",
          ports: { host: 5300 },
          startedAt: Date.now(),
          description: "legacy",
        },
      ]),
    );
    const entries = readRegistry();
    expect(entries.length).toBe(1);
    expect(entries[0]?.leaseKey).toBeUndefined();
    expect(entries[0]?.ports.host).toBe(5300);
  });
});
