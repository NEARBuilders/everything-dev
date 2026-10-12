import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouterModule, RuntimeConfig } from "@/types";
import { createTestApiClient } from "../helpers/api-client";
import { loadBundledRouterModule } from "../helpers/bundled-ssr-module";
import {
  buildTestRenderOptions,
  createMockAuthClient,
  loadTestRuntimeConfig,
} from "../helpers/runtime-config";

/**
 * Head/nonce liveness: every SSR document's head markup (script nonce
 * attributes, the hydrate bootstrap's `window.__CSP_NONCE__`, and the entry
 * script src) must be generated from THAT request's render inputs — never
 * reused from a previous render. A stale nonce under a fresh per-request CSP
 * header makes the browser block every script (silent un-hydrated page —
 * see the start:ssr theme regression: `waitForApp` hung 60s on
 * `__RUNTIME_CONFIG__` with CSP violations in the console).
 *
 * Two liveness dimensions, mirroring the failure shape:
 *  1. request-scoped: two renders through the same router module (the compose
 *     cache-hit path — one shared routeTree instance), distinct CSP nonces.
 *  2. deployment-scoped: a render after the render options' runtime config
 *     flips (the snapshot-swap path — assetsUrl moves generations) must emit
 *     the NEW deployment's entry src.
 */

const NONCE_A = "bm9uY2UtYQ==";
const NONCE_B = "bm9uY2UtYg==";

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

describe("SSR head/nonce liveness", () => {
  let routerModule: RouterModule;
  let config: RuntimeConfig;
  let cleanup: () => Promise<void>;
  const mockApiClient = createTestApiClient({});
  const mockAuthClient = createMockAuthClient();

  beforeAll(async () => {
    config = await loadTestRuntimeConfig();
    const bundled = await loadBundledRouterModule();
    routerModule = bundled.routerModule;
    cleanup = bundled.cleanup;
  });

  afterAll(async () => {
    await cleanup();
  });

  const renderLogin = async (cspNonce: string, runtimeConfig?: unknown) => {
    const options = buildTestRenderOptions(config, mockApiClient, mockAuthClient);
    const result = await routerModule.renderToStream(new Request("http://localhost/login"), {
      ...options,
      ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
      cspNonce,
    } as Parameters<typeof routerModule.renderToStream>[1]);
    return consumeStream(result.stream);
  };

  it("a second render through the same router module never emits the first render's nonce", async () => {
    const htmlA = await renderLogin(NONCE_A);

    expect(cspNonceInBootstrap(htmlA)).toBe(NONCE_A);
    const attrsA = scriptNonceAttrs(htmlA);
    expect(attrsA.length).toBeGreaterThan(0);
    for (const nonce of attrsA) expect(nonce).toBe(NONCE_A);

    const htmlB = await renderLogin(NONCE_B);

    expect(cspNonceInBootstrap(htmlB)).toBe(NONCE_B);
    const attrsB = scriptNonceAttrs(htmlB);
    expect(attrsB.length).toBeGreaterThan(0);
    for (const nonce of attrsB) {
      expect(nonce, "stale nonce from a previous render leaked into the head").toBe(NONCE_B);
    }
  });

  it("a render after the runtime config flips emits the new deployment's assets", async () => {
    const flippedConfig = {
      ...config,
      ui: { ...config.ui, url: "https://cdn.flipped.invalid/ui" },
    };
    const flippedClientConfig = {
      ...buildTestRenderOptions(config, mockApiClient, mockAuthClient).runtimeConfig,
      assetsUrl: "https://cdn.flipped.invalid/ui",
    };

    await renderLogin(NONCE_A);

    const htmlB = await renderLogin(NONCE_B, flippedClientConfig);

    expect(cspNonceInBootstrap(htmlB)).toBe(NONCE_B);
    for (const nonce of scriptNonceAttrs(htmlB)) {
      expect(nonce, "stale nonce from a previous render leaked into the head").toBe(NONCE_B);
    }
    expect(htmlB).toContain("https://cdn.flipped.invalid/ui");
    expect(htmlB).not.toContain(flippedConfig.ui.url);
  });
});
