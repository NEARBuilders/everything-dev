import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findUnpublishedFrameworkPackages,
  npmVersionPublished,
  waitForFrameworkPackages,
} from "../../src/services/deploy/preflight";

const fetchResponse = vi.hoisted(() => vi.fn());

vi.mock("../../src/utils/http-client", () => ({
  fetchResponse: (...args: unknown[]) => fetchResponse(...args),
}));

function fixtureConfigDir(packages: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "npm-gate-"));
  for (const [name, version] of Object.entries(packages)) {
    mkdirSync(join(dir, "packages", name), { recursive: true });
    writeFileSync(join(dir, "packages", name, "package.json"), JSON.stringify({ name, version }));
  }
  return dir;
}

beforeEach(() => {
  fetchResponse.mockReset();
});

describe("npmVersionPublished", () => {
  it("treats a 200 registry response as published", async () => {
    fetchResponse.mockResolvedValue({ status: 200 });
    expect(await npmVersionPublished("every-plugin", "3.0.0-rc.2")).toBe(true);
  });

  it("treats a 404 as definitively unpublished (the deploy-blocking case)", async () => {
    fetchResponse.mockResolvedValue({ status: 404 });
    expect(await npmVersionPublished("every-plugin", "3.0.0-rc.2")).toBe(false);
  });

  it("returns null on network failure so the gate cannot block on an unknown state", async () => {
    fetchResponse.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await npmVersionPublished("every-plugin", "3.0.0-rc.2")).toBeNull();
  });

  it("returns null on unexpected statuses (5xx rate limits, redirects)", async () => {
    fetchResponse.mockResolvedValue({ status: 503 });
    expect(await npmVersionPublished("every-plugin", "3.0.0-rc.2")).toBeNull();
  });
});

describe("findUnpublishedFrameworkPackages", () => {
  it("reports workspace framework packages npm does not serve", async () => {
    const configDir = fixtureConfigDir({
      "better-near-auth": "2.0.0-rc.0",
      "every-plugin": "3.0.0-rc.2",
      "everything-dev": "2.0.0-rc.3",
    });
    fetchResponse.mockImplementation(async (_url: string, _init?: unknown) => {
      const url = String(_url);
      if (url.endsWith("/every-plugin/3.0.0-rc.2")) return { status: 404 };
      return { status: 200 };
    });
    const unpublished = await findUnpublishedFrameworkPackages(configDir);
    expect(unpublished).toEqual([{ name: "every-plugin", version: "3.0.0-rc.2" }]);
  });

  it("passes when every workspace framework package is on npm", async () => {
    const configDir = fixtureConfigDir({ "everything-dev": "2.0.0-rc.3" });
    fetchResponse.mockResolvedValue({ status: 200 });
    expect(await findUnpublishedFrameworkPackages(configDir)).toEqual([]);
  });

  it("skips package sources that are not workspace-local (child projects stay unblocked)", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "npm-gate-empty-"));
    fetchResponse.mockResolvedValue({ status: 404 });
    expect(await findUnpublishedFrameworkPackages(configDir)).toEqual([]);
    expect(fetchResponse).not.toHaveBeenCalled();
  });

  it("continues past packages whose publishability cannot be determined", async () => {
    const configDir = fixtureConfigDir({
      "every-plugin": "3.0.0-rc.2",
      "everything-dev": "2.0.0-rc.3",
    });
    fetchResponse.mockImplementation(async (_url: string) => {
      const url = String(_url);
      if (url.endsWith("/every-plugin/3.0.0-rc.2")) return { status: 200 };
      throw new Error("network down");
    });
    const unpublished = await findUnpublishedFrameworkPackages(configDir);
    expect(unpublished).toEqual([]);
  });
});

describe("waitForFrameworkPackages", () => {
  it("returns ok immediately when every workspace framework package is on npm", async () => {
    const configDir = fixtureConfigDir({ "everything-dev": "2.0.0-rc.30" });
    fetchResponse.mockResolvedValue({ status: 200 });
    const sleep = vi.fn(async () => undefined);
    const result = await waitForFrameworkPackages(configDir, { sleep });
    expect(result).toEqual({ kind: "ok" });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("waits out the Release train's publish and resumes once npm serves the version", async () => {
    const configDir = fixtureConfigDir({ "everything-dev": "2.0.0-rc.30" });
    let probes = 0;
    let now = 0;
    const result = await waitForFrameworkPackages(configDir, {
      probe: async () => {
        probes += 1;
        now += 15_000;
        return probes < 3 ? false : true;
      },
      sleep: async () => undefined,
      now: () => now,
      budgetMs: 45_000,
      intervalMs: 15_000,
    });
    expect(probes).toBe(3);
    expect(result).toEqual({ kind: "ok" });
  });

  it("times out with the ship-ahead-of-registry refusal when npm never serves the version", async () => {
    const configDir = fixtureConfigDir({ "every-plugin": "3.0.0-rc.2" });
    fetchResponse.mockResolvedValue({ status: 404 });
    let now = 0;
    const result = await waitForFrameworkPackages(configDir, {
      sleep: async () => undefined,
      now: () => now,
      budgetMs: 30_000,
      intervalMs: 15_000,
      probe: async () => {
        now += 15_000;
        return false;
      },
    });
    expect(result.kind).toBe("error");
    expect(result).toMatchObject({
      error: expect.stringContaining("every-plugin@3.0.0-rc.2 were not published to npm within"),
    });
  });

  it("treats registry outages as unbeatable-down states, never blocking the deploy", async () => {
    const configDir = fixtureConfigDir({ "everything-dev": "2.0.0-rc.30" });
    fetchResponse.mockRejectedValue(new Error("registry down"));
    const result = await waitForFrameworkPackages(configDir, {
      sleep: async () => undefined,
    });
    expect(result).toEqual({ kind: "ok" });
  });

  it("skips the wait entirely when no framework sources are workspace-local", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "npm-wait-empty-"));
    const sleep = vi.fn(async () => undefined);
    const result = await waitForFrameworkPackages(configDir, { sleep });
    expect(result).toEqual({ kind: "ok" });
    expect(sleep).not.toHaveBeenCalled();
  });
});
