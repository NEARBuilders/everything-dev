import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearHttpCache } from "../../src/http-client";
import { buildRollbackPayload, verifyRollbackSnapshot } from "../../src/rollback";
import { type BosConfigInput, BosConfigSchema } from "../../src/types";

beforeEach(() => {
  clearHttpCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const manifestBody = JSON.stringify({ entry: "ui/entry.abc123.js" });

function sriFor(body: string): string {
  return `sha384-${createHash("sha384").update(body).digest("base64")}`;
}

function configWithSlots(slots: Record<string, Record<string, unknown>>) {
  return BosConfigSchema.parse({
    account: "v1.citynode.near",
    domain: "citynode.app",
    app: {
      host: slots.host ?? { development: "local:host", production: "https://cdn/host/" },
      ui: slots.ui ?? { development: "local:ui", production: "https://cdn/ui/" },
      api: slots.api ?? { development: "local:api", production: "https://cdn/api/" },
    },
    ...(slots.plugins ? { plugins: slots.plugins } : {}),
  });
}

describe("verifyRollbackSnapshot", () => {
  it("accepts when every pinned slot's manifest still serves and matches its SRI", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("versions/aaa.json");
      return new Response(manifestBody, { status: 200 });
    });
    const config = configWithSlots({
      ui: {
        development: "local:ui",
        production: "https://cdn/ui/",
        pin: { manifest: "versions/aaa.json", integrity: sriFor(manifestBody) },
      },
    });

    const report = await verifyRollbackSnapshot(config, { fetchImpl: fetchMock as typeof fetch });

    expect(report.ok).toBe(true);
    expect(report.verifiable).toBe(true);
    expect(report.slots[0]?.ok).toBe(true);
  });

  it("refuses with a per-slot report when a manifest 404s", async () => {
    const fetchMock = vi.fn(async () => new Response("gone", { status: 404 }));
    const config = configWithSlots({
      ui: {
        development: "local:ui",
        production: "https://cdn/ui/",
        pin: { manifest: "versions/gone.json", integrity: sriFor(manifestBody) },
      },
    });

    const report = await verifyRollbackSnapshot(config, { fetchImpl: fetchMock as typeof fetch });

    expect(report.ok).toBe(false);
    expect(report.slots[0]?.ok).toBe(false);
    expect(report.slots[0]?.reason).toContain("404");
  });

  it("refuses when a manifest's bytes no longer match the pinned SRI", async () => {
    const fetchMock = vi.fn(async () => new Response(manifestBody, { status: 200 }));
    const config = configWithSlots({
      ui: {
        development: "local:ui",
        production: "https://cdn/ui/",
        pin: { manifest: "versions/aaa.json", integrity: "sha384-doesnotmatch" },
      },
    });

    const report = await verifyRollbackSnapshot(config, { fetchImpl: fetchMock as typeof fetch });

    expect(report.ok).toBe(false);
    expect(report.slots[0]?.reason).toContain("integrity");
  });

  it("rejects a partial pin (manifest without integrity) at the schema boundary — the pin is atomic", () => {
    expect(() =>
      BosConfigSchema.parse({
        account: "v1.citynode.near",
        domain: "citynode.app",
        app: {
          ui: {
            development: "local:ui",
            production: "https://cdn/ui/",
            pin: { manifest: "versions/aaa.json" },
          },
        },
      }),
    ).toThrow(/integrity/i);
  });

  it("treats a raw partial pin as unpinned — the snapshot is unverifiable so --force is required", async () => {
    const config = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      app: {
        ui: {
          development: "local:ui",
          production: "https://cdn/ui/",
          pin: { manifest: "versions/aaa.json" },
        },
      },
    } as BosConfigInput;

    const report = await verifyRollbackSnapshot(config, { fetchImpl: vi.fn() as typeof fetch });

    expect(report.ok).toBe(false);
    expect(report.verifiable).toBe(false);
    expect(report.slots).toHaveLength(0);
  });

  it("flags a pre-pin snapshot (no pins) as unverifiable so --force is required", async () => {
    const config = configWithSlots({});

    const report = await verifyRollbackSnapshot(config, { fetchImpl: vi.fn() as typeof fetch });

    expect(report.ok).toBe(false);
    expect(report.verifiable).toBe(false);
    expect(report.slots).toHaveLength(0);
  });

  it("reports every slot, not just the first failure", async () => {
    const fetchMock = vi.fn(async () => new Response("gone", { status: 404 }));
    const config = configWithSlots({
      ui: {
        development: "local:ui",
        production: "https://cdn/ui/",
        pin: { manifest: "versions/gone.json", integrity: sriFor(manifestBody) },
      },
      plugins: {
        auth: {
          name: "auth",
          development: "local:plugins/auth",
          production: "https://cdn/auth/",
          pin: { manifest: "versions/gone2.json", integrity: sriFor(manifestBody) },
        },
      },
    });

    const report = await verifyRollbackSnapshot(config, { fetchImpl: fetchMock as typeof fetch });

    expect(report.ok).toBe(false);
    expect(report.slots).toHaveLength(2);
    expect(report.slots.map((s) => s.slot).sort()).toEqual(["app.ui", "auth"]);
  });
});

describe("buildRollbackPayload", () => {
  it("stamps rolledBackFrom so the dedup comparison treats the republish as distinct state", () => {
    const target = {
      account: "a.near",
      app: {
        host: { development: "local:host", production: "https://cdn/host/" },
        ui: { development: "local:ui", production: "https://cdn/ui/" },
        api: { development: "local:api", production: "https://cdn/api/" },
      },
    } as Record<string, unknown>;
    const payload = buildRollbackPayload(target, "2026-01-01T00:00:00.000Z");

    expect(payload.rolledBackFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(BosConfigSchema.parse(payload).rolledBackFrom).toBe("2026-01-01T00:00:00.000Z");
  });

  it("leaves the target config's other fields untouched", () => {
    const target = {
      account: "a.near",
      title: "t",
      app: {
        host: { development: "local:host", production: "https://cdn/host/" },
        ui: { development: "local:ui", production: "https://cdn/ui/" },
        api: { development: "local:api", production: "https://cdn/api/" },
      },
    } as Record<string, unknown>;
    const payload = buildRollbackPayload(target, "2026-01-01T00:00:00.000Z");

    expect(payload.title).toBe("t");
    expect(target).not.toHaveProperty("rolledBackFrom");
  });
});

describe("rollback dedup guard", () => {
  it("treats a rolledBackFrom-stamped payload as distinct from the live pointer", async () => {
    clearHttpCache();
    const liveConfig = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      app: {
        host: {
          development: "local:host",
          production: "https://cdn/host/",
          pin: { manifest: "versions/old.json", integrity: "sha384-old-pin" },
        },
        ui: { development: "local:ui", production: "https://cdn/ui/" },
        api: { development: "local:api", production: "https://cdn/api/" },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ entries: [{ value: JSON.stringify(liveConfig) }] }), {
            status: 200,
          }),
      ),
    );
    const { isConfigAlreadyPublished } = await import("../../src/publish");

    const unstamped = await isConfigAlreadyPublished({
      account: "v1.citynode.near",
      gateway: "citynode.app",
      publishConfig: BosConfigSchema.parse(liveConfig),
    });
    const stamped = await isConfigAlreadyPublished({
      account: "v1.citynode.near",
      gateway: "citynode.app",
      publishConfig: BosConfigSchema.parse(
        buildRollbackPayload(liveConfig as Record<string, unknown>, "2026-01-01T00:00:00.000Z"),
      ),
    });

    expect(unstamped).toBe(true);
    expect(stamped).toBe(false);
  });
});
