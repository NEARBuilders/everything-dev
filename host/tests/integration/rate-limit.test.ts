import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as createProbeServer } from "node:net";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_MAX } from "../../src/middleware/security";
import { runServer, type ServerHandle } from "../../src/program";
import type { RuntimeConfig } from "../../src/services/config";
import { getAvailablePort } from "../helpers/ports";

describe("host rate limiting", () => {
  let upstream: ReturnType<typeof createServer>;
  let host: ServerHandle;
  let origin: string;
  let proxyArgIndex: number;
  let port: number;

  beforeAll(async () => {
    port = await getAvailablePort();
    origin = `http://127.0.0.1:${port}`;
  });

  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HOST", "127.0.0.1");
    proxyArgIndex = process.argv.length;
    process.argv.push("--proxy");
    upstream = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    vi.stubEnv("PORT", String(port));
    const config: RuntimeConfig = {
      env: "production",
      account: "rate-limit.testnet",
      domain: "rate-limit.test",
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
    };
    host = runServer({ config });
    await host.ready;
  });

  afterEach(async () => {
    await host?.shutdown();
    await new Promise<void>((resolve, reject) => {
      upstream?.close((error) => (error ? reject(error) : resolve()));
    });
    vi.unstubAllEnvs();
    process.argv.splice(proxyArgIndex, 1);
  });

  async function get(path: string, localAddress = "127.0.0.1", headers = {}) {
    return new Promise<{
      status: number;
      headers: import("node:http").IncomingHttpHeaders;
      body: string;
    }>((resolve, reject) => {
      const req = request(`${origin}${path}`, { localAddress, headers, agent: false }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("keeps health probes available without consuming the client's request budget", async () => {
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      expect((await get("/health")).status).toBe(200);
    }
    expect((await get("/api/ping")).status).toBe(200);
    for (let i = 1; i < RATE_LIMIT_MAX; i++) {
      expect((await get("/api/ping")).status).toBe(200);
    }
    const limited = await get("/api/ping");
    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.body)).toEqual({
      error: "Too many requests, please try again later.",
    });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect((await get("/health")).status).toBe(200);
  });

  it("isolates socket clients even when the public request URL is rewritten", async () => {
    const headers = { "x-forwarded-host": "rate-limit.test", "x-forwarded-proto": "https" };
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect((await get("/api/ping", "127.0.0.1", headers)).status).toBe(200);
    }
    expect((await get("/api/ping", "127.0.0.1", headers)).status).toBe(429);
    // Distinct 127/8 addresses bind natively on Linux; macOS needs an explicit
    // `ifconfig lo0 alias` — skip the second-client isolation when the local
    // alias does not exist rather than failing on an environment artifact.
    if (await localAddressAvailable("127.0.0.2")) {
      expect((await get("/api/ping", "127.0.0.2", headers)).status).toBe(200);
    }
  });

  it("keeps forwarded clients isolated and still limits page requests", async () => {
    const headers = { "x-forwarded-for": "192.0.2.1, 10.0.0.1" };
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect((await get("/api/ping", "127.0.0.1", headers)).status).toBe(200);
    }
    expect((await get("/", "127.0.0.1", headers)).status).toBe(429);
    expect((await get("/api/ping", "127.0.0.1", { "x-forwarded-for": "192.0.2.2" })).status).toBe(
      200,
    );
  });
});

async function localAddressAvailable(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createProbeServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(0, address);
  });
}
