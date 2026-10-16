import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findUnpublishedFrameworkPackages,
  npmVersionPublished,
} from "../../src/services/deploy/preflight";

const fetchResponse = vi.hoisted(() => vi.fn());

vi.mock("../../src/http-client", () => ({
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
