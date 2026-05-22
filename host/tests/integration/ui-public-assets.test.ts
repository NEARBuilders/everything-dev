import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runServer } from "../../src/program";
import type { RuntimeConfig } from "../../src/services/config";
import { startJsonProxyTarget } from "../helpers/json-proxy-target";
import { getAvailablePort } from "../helpers/ports";
import { startStaticDistServer } from "../helpers/static-dist-server";
import { loadHostTestEnv } from "../helpers/test-env";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const uiPublicDir = path.join(workspaceRoot, "ui", "public");
const uiDistDir = path.join(workspaceRoot, "ui", "dist");

loadHostTestEnv(workspaceRoot);

function buildUiProxyConfig(
  uiAssetsUrl: string,
  apiProxyUrl: string,
  hostUrl: string,
): RuntimeConfig {
  return {
    env: "development",
    account: "dev.everything.near",
    title: "everything.dev",
    repository: "https://github.com/nearbuilders/everything-dev",
    host: {
      name: "host",
      url: hostUrl,
      entry: `${hostUrl}/mf-manifest.json`,
      source: "remote",
    },
    ui: {
      name: "ui",
      url: uiAssetsUrl,
      entry: `${uiAssetsUrl}/mf-manifest.json`,
      source: "remote",
    },
    api: {
      name: "api",
      url: apiProxyUrl,
      entry: `${apiProxyUrl}/mf-manifest.json`,
      source: "remote",
      proxy: apiProxyUrl,
    },
  } as RuntimeConfig;
}

describe("UI public asset proxying through host", () => {
  let uiServer: Awaited<ReturnType<typeof startStaticDistServer>>;
  let apiProxy: Awaited<ReturnType<typeof startJsonProxyTarget>>;
  let hostHandle: ReturnType<typeof runServer>;
  let baseUrl: string;
  const envSnapshot = { ...process.env };

  beforeAll(async () => {
    if (!existsSync(uiPublicDir)) {
      throw new Error(`ui/public/ not found at ${uiPublicDir} — run UI build first`);
    }

    uiServer = await startStaticDistServer(uiDistDir);
    apiProxy = await startJsonProxyTarget();

    const hostPort = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${hostPort}`;
    process.env.NODE_ENV = "development";
    process.env.HOST = "127.0.0.1";
    process.env.PORT = String(hostPort);
    process.env.CSP_STRICT = "false";

    const config = buildUiProxyConfig(uiServer.baseUrl, apiProxy.baseUrl, baseUrl);
    hostHandle = runServer({ config });
    await hostHandle.ready;
  }, 30000);

  afterAll(async () => {
    await hostHandle?.shutdown();
    await uiServer?.stop();
    await apiProxy?.stop();
    process.env = { ...envSnapshot };
  });

  describe("text assets from ui/public", () => {
    it("proxies /skill.md from UI dist", async () => {
      const response = await fetch(`${baseUrl}/skill.md`);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text.length).toBeGreaterThan(0);
    });

    it("proxies /llms.txt from UI dist", async () => {
      const response = await fetch(`${baseUrl}/llms.txt`);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text.length).toBeGreaterThan(0);
    });

    it("proxies /robots.txt from UI dist", async () => {
      const response = await fetch(`${baseUrl}/robots.txt`);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text.length).toBeGreaterThan(0);
    });

    it("proxies /README.md from UI dist", async () => {
      const response = await fetch(`${baseUrl}/README.md`);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe("binary assets from ui/public", () => {
    it("proxies /favicon.ico from UI dist", async () => {
      const response = await fetch(`${baseUrl}/favicon.ico`);

      expect(response.status).toBe(200);
      const buf = await response.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(0);
    });

    it("proxies /icon.svg from UI dist", async () => {
      const response = await fetch(`${baseUrl}/icon.svg`);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("<svg");
    });

    it("proxies /manifest.json from UI dist", async () => {
      const response = await fetch(`${baseUrl}/manifest.json`);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toHaveProperty("name");
    });
  });

  describe("non-asset paths are not proxied", () => {
    it("/ (root) renders client shell, not proxied", async () => {
      const response = await fetch(`${baseUrl}/`);

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("window.__RUNTIME_CONFIG__");
      expect(html).toContain("remoteEntry.js");
    });

    it("/health is handled by host directly", async () => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("OK");
    });

    it("/api/ping is routed to API proxy, not UI proxy", async () => {
      const response = await fetch(`${baseUrl}/api/ping`);
      const json = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(json).toMatchObject({ status: "ok" });
    });

    it("paths without file extensions are not proxied to UI", async () => {
      const response = await fetch(`${baseUrl}/nonexistent-page`);

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("window.__RUNTIME_CONFIG__");
    });
  });

  describe("missing UI assets return 404", () => {
    it("returns 404 for a file extension path that does not exist in UI dist", async () => {
      const response = await fetch(`${baseUrl}/nonexistent-file.css`);

      expect(response.status).toBe(404);
    });
  });
});
