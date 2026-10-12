import path from "node:path";
import { createInstance } from "@module-federation/enhanced/runtime";
import { patchManifestFetchForSsrPublicPath } from "everything-dev/mf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouterModule, RuntimeConfig } from "@/types";
import { createTestApiClient } from "../helpers/api-client";
import { ensureUiServerDistBuild } from "../helpers/bundled-ssr-module";
import {
  buildTestClientRuntimeConfig,
  createMockAuthClient,
  loadTestRuntimeConfig,
} from "../helpers/runtime-config";
import { type StaticDistServer, startStaticDistServer } from "../helpers/static-dist-server";

/**
 * Generation-swap SSR head liveness — the dual-container shape: the host's
 * composition instance re-registers the ui remote onto a new entry (snapshot
 * swap adopts the published CDN runtime) and bypasses the runtime module
 * cache, so the next load executes a FRESH router-module copy while the share
 * scope (react, react-dom, @tanstack/*) stays settled. The post-swap render
 * must emit ONLY the new generation's head: new assets URL, new CSP nonce.
 *
 * Mirrors host/src/services/federation.server.ts getCompositionInstance +
 * loadRemoteExpose (entryChanged → bypassModuleCache).
 */

const NONCE_A = "bm9uY2UtYQ==";
const NONCE_B = "bm9uY2UtYg==";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");

async function consumeStream(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return html;
}

function scriptNonceAttrs(html: string): string[] {
  return [...html.matchAll(/<script[^>]*\bnonce="([^"]+)"/g)].map((m) => m[1]!);
}

function cspNonceInBootstrap(html: string): string | undefined {
  return html.match(/window\.__CSP_NONCE__="([^"]*)"/)?.[1];
}

describe("SSR head liveness across a federation generation swap", () => {
  let config: RuntimeConfig;
  let serverA: StaticDistServer;
  let serverB: StaticDistServer;
  let mf: ReturnType<typeof createInstance> | null = null;

  const renderThrough = async (
    routerModule: RouterModule,
    nonce: string,
    assetsBase: string,
  ): Promise<string> => {
    const runtimeConfig = {
      ...buildTestClientRuntimeConfig(config),
      assetsUrl: assetsBase,
      ui: {
        ...buildTestClientRuntimeConfig(config).ui,
        url: assetsBase,
      },
    };
    const result = await routerModule.renderToStream(new Request("http://localhost/login"), {
      runtimeConfig,
      apiClient: createTestApiClient({}),
      authClient: createMockAuthClient(),
      session: null,
      cspNonce: nonce,
    } as Parameters<typeof routerModule.renderToStream>[1]);
    return consumeStream(result.stream);
  };

  beforeAll(async () => {
    config = await loadTestRuntimeConfig();
    await ensureUiServerDistBuild();
    const distDir = path.join(workspaceRoot, "ui", "dist");
    serverA = await startStaticDistServer(distDir);
    serverB = await startStaticDistServer(distDir);
  });

  afterAll(async () => {
    if (mf) {
      try {
        (
          mf as unknown as { remoteHandler?: { removeRemote?: (r: unknown) => void } }
        ).remoteHandler?.removeRemote?.(undefined);
      } catch {
        /* noop */
      }
    }
    await Promise.allSettled([serverA?.stop(), serverB?.stop()]);
  });

  it("the post-swap render emits only the new generation's assets and nonce", async () => {
    const entryA = `${serverA.baseUrl}/ssr/mf-manifest.json`;
    const entryB = `${serverB.baseUrl}/ssr/mf-manifest.json`;

    mf = createInstance({
      name: "ssr-swap-host",
      remotes: [{ name: "ui", entry: entryA, alias: "ui" }],
    });
    patchManifestFetchForSsrPublicPath(mf as never);
    await (
      mf as unknown as { initializeSharing?: (scope: string) => Promise<unknown> }
    ).initializeSharing?.("default");

    const modA = await (
      mf as never as { loadRemote: (id: string, o: object) => Promise<{ default: unknown }> }
    ).loadRemote("ui/Router", { from: "build" });
    const routerModuleA = modA.default as RouterModule;
    expect(routerModuleA).toBeDefined();

    const htmlA = await renderThrough(routerModuleA, NONCE_A, serverA.baseUrl);
    expect(cspNonceInBootstrap(htmlA)).toBe(NONCE_A);
    for (const nonce of scriptNonceAttrs(htmlA)) expect(nonce).toBe(NONCE_A);

    // swap: entry change → re-register in place + bypass the runtime module
    // cache so the next load executes a fresh container (federation.server.ts
    // loadRemoteExpose's entryChanged path)
    const remoteHandler = (
      mf as unknown as { remoteHandler?: { removeRemote?: (remote: unknown) => void } }
    ).remoteHandler;
    const registered = (mf as unknown as { options: { remotes: Array<unknown> } }).options.remotes;
    for (const remote of registered) remoteHandler?.removeRemote?.(remote);
    (mf as never as { registerRemotes: (remotes: Array<unknown>) => void }).registerRemotes([
      { name: "ui", entry: entryB, alias: "ui" },
    ]);
    (mf as unknown as { moduleCache?: Map<string, unknown> }).moduleCache?.delete("ui");

    const modB = await (
      mf as never as { loadRemote: (id: string, o: object) => Promise<{ default: unknown }> }
    ).loadRemote("ui/Router", { from: "build" });
    const routerModuleB = modB.default as RouterModule;
    expect(routerModuleB).toBeDefined();

    const htmlB = await renderThrough(routerModuleB, NONCE_B, serverB.baseUrl);

    expect(
      cspNonceInBootstrap(htmlB),
      "head bootstrap must carry the fresh per-request nonce",
    ).toBe(NONCE_B);
    const attrsB = scriptNonceAttrs(htmlB);
    expect(attrsB.length).toBeGreaterThan(0);
    for (const nonce of attrsB) {
      expect(nonce, "stale nonce from the previous generation leaked into the head").toBe(NONCE_B);
    }
    expect(htmlB, "post-swap head must reference the new generation's assets").toContain(
      serverB.baseUrl,
    );
    expect(
      htmlB,
      "post-swap head must not reference the previous generation's assets",
    ).not.toContain(serverA.baseUrl);
  });
});
