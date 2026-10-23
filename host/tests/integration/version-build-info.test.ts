import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runServer, type ServerHandle } from "../../src/program";
import type { RuntimeConfig } from "../../src/services/config";
import { getAvailablePort } from "../helpers/ports";

const PLATFORM = {
  frameworkVersion: "2.0.0-rc.18",
  everyPluginVersion: "3.0.0-rc.10",
  gitSha: "553a9b21abcdef1234567890abcdef1234567890",
  image: { ref: "ghcr.io/nearbuilders/everything-dev", tags: ["sha-553a9b2"] },
};

const UPSTREAM_PAYLOAD = JSON.stringify({ ok: true });

function upstream(): Promise<{ server: ReturnType<typeof createServer>; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(UPSTREAM_PAYLOAD);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("GET /.well-known/version build identity (#537)", () => {
  let proxies: Array<ReturnType<typeof createServer>> = [];
  let host: ServerHandle;
  let origin: string;
  let port: number;

  beforeAll(async () => {
    port = await getAvailablePort();
    origin = `http://127.0.0.1:${port}`;
  });

  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HOST", "127.0.0.1");
    process.argv.push("--proxy");
    vi.stubEnv("PORT", String(port));
  });

  afterEach(async () => {
    await host?.shutdown();
    for (const proxy of proxies) {
      await close(proxy);
    }
    proxies = [];
    process.argv.pop();
    vi.unstubAllEnvs();
  });

  const config = (upstreamUrl: string): RuntimeConfig =>
    ({
      env: "production",
      account: "version.build.testnet",
      domain: "version.build.test",
      networkId: "testnet",
      host: { name: "host", url: origin, entry: `${origin}/mf-manifest.json`, source: "local" },
      ui: {
        name: "ui",
        url: upstreamUrl,
        entry: `${upstreamUrl}/mf-manifest.json`,
        source: "remote",
      },
      api: {
        name: "api",
        url: upstreamUrl,
        entry: `${upstreamUrl}/mf-manifest.json`,
        source: "remote",
        proxy: upstreamUrl,
      },
    }) as RuntimeConfig;

  it("omits the build object when no platform manifest was injected", async () => {
    await withUpstream(async (upstreamUrl) => {
      host = runServer({ config: config(upstreamUrl) });
      await host.ready;

      const res = await fetch(`${origin}/.well-known/version`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.build).toBeUndefined();
      expect(body.fingerprint).toBeDefined();
    });
  });

  it("serves the injected platform manifest as the build object", async () => {
    await withUpstream(async (upstreamUrl) => {
      host = runServer({ config: config(upstreamUrl), platform: PLATFORM });
      await host.ready;

      const res = await fetch(`${origin}/.well-known/version`);
      expect(res.headers.get("cache-control")).toContain("max-age=30");
      const body = (await res.json()) as {
        build?: typeof PLATFORM;
      };
      expect(body.build).toEqual({
        frameworkVersion: PLATFORM.frameworkVersion,
        everyPluginVersion: PLATFORM.everyPluginVersion,
        gitSha: PLATFORM.gitSha,
        image: PLATFORM.image,
      });
    });
  });

  async function withUpstream(run: (upstreamUrl: string) => Promise<void>): Promise<void> {
    const { server, baseUrl } = await upstream();
    proxies.push(server);
    await run(baseUrl);
  }
});
