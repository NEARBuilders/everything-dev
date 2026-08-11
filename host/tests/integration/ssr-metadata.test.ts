import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RenderOptionsWithApi, RouterModule, RuntimeConfig } from "@/types";
import { createTestApiClient } from "../helpers/api-client";
import { loadBundledRouterModule } from "../helpers/bundled-ssr-module";
import {
  buildTestClientRuntimeConfig,
  createMockSession,
  loadTestRuntimeConfig,
} from "../helpers/runtime-config";

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

const mockApiClient = createTestApiClient({});

function extractMetaContent(html: string, attr: string, attrValue: string): string | null {
  const patterns = [
    new RegExp(`<meta\\s+${attr}="${escapeRegex(attrValue)}"\\s+content="([^"]*)"`, "i"),
    new RegExp(`<meta\\s+content="([^"]*)"\\s+${attr}="${escapeRegex(attrValue)}"`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("SSR Social Metadata", () => {
  let routerModule: RouterModule;
  let config: RuntimeConfig;
  let cleanup: () => Promise<void>;
  let streamHtml: string;

  beforeAll(async () => {
    config = await loadTestRuntimeConfig();
    const bundled = await loadBundledRouterModule();
    routerModule = bundled.routerModule;
    cleanup = bundled.cleanup;

    const clientConfig = buildTestClientRuntimeConfig(config);
    const renderOptions: RenderOptionsWithApi = {
      runtimeConfig: {
        ...clientConfig,
        hostUrl: "https://dev.everything.dev",
        runtime: {
          ...(clientConfig.runtime ?? {}),
          accountId: config.account,
          gatewayId: config.domain ?? config.account,
          runtimeBasePath: "/",
          title: "everything.dev",
          description: "Open runtime for apps on NEAR",
          hostUrl: "https://dev.everything.dev",
        },
      },
      apiClient: mockApiClient,
      session: createMockSession(),
    };

    const result = await routerModule.renderToStream(
      new Request("http://localhost/"),
      renderOptions,
    );
    streamHtml = await consumeStream(result.stream);
  }, 10000);

  afterAll(async () => {
    await cleanup();
  });

  describe("Full SSR stream output", () => {
    it("produces valid HTML", () => {
      expect(streamHtml).toContain("<!DOCTYPE html>");
      expect(streamHtml).toContain("</html>");
    });

    it("includes title tag with content", () => {
      const match = streamHtml.match(/<title>([^<]*)<\/title>/);
      expect(match).toBeDefined();
      expect(match![1].trim().length).toBeGreaterThan(0);
    });

    it("includes description meta tag with content", () => {
      const content = extractMetaContent(streamHtml, "name", "description");
      expect(content).toBeDefined();
      expect(content!.trim().length).toBeGreaterThan(0);
    });

    it("includes og:title meta tag with content", () => {
      const content = extractMetaContent(streamHtml, "property", "og:title");
      expect(content).toBeDefined();
      expect(content!.trim().length).toBeGreaterThan(0);
    });

    it("includes og:description meta tag with content", () => {
      const content = extractMetaContent(streamHtml, "property", "og:description");
      expect(content).toBeDefined();
      expect(content!.trim().length).toBeGreaterThan(0);
    });

    it("includes og:type meta tag set to website", () => {
      const content = extractMetaContent(streamHtml, "property", "og:type");
      expect(content).toBe("website");
    });

    it("includes og:image meta tag", () => {
      const content = extractMetaContent(streamHtml, "property", "og:image");
      expect(content).toBeDefined();
    });

    it("includes og:image:width with dimensions", () => {
      const content = extractMetaContent(streamHtml, "property", "og:image:width");
      expect(content).toBeDefined();
      expect(Number(content)).toBeGreaterThan(0);
    });

    it("includes og:image:height with dimensions", () => {
      const content = extractMetaContent(streamHtml, "property", "og:image:height");
      expect(content).toBeDefined();
      expect(Number(content)).toBeGreaterThan(0);
    });

    it("includes twitter:card set to summary_large_image", () => {
      const content = extractMetaContent(streamHtml, "name", "twitter:card");
      expect(content).toBe("summary_large_image");
    });

    it("includes twitter:title meta tag with content", () => {
      const content = extractMetaContent(streamHtml, "name", "twitter:title");
      expect(content).toBeDefined();
      expect(content!.trim().length).toBeGreaterThan(0);
    });

    it("includes twitter:image meta tag", () => {
      const content = extractMetaContent(streamHtml, "name", "twitter:image");
      expect(content).toBeDefined();
    });

    it("og:image URL is absolute", () => {
      const content = extractMetaContent(streamHtml, "property", "og:image");
      expect(
        content,
        "og:image must be an absolute URL for social scrapers (metatags.io, Facebook, Twitter). Got relative URL.",
      ).toBeDefined();
      expect(content!.toString()).toMatch(/^https?:\/\//);
    });

    it("twitter:image URL is absolute", () => {
      const content = extractMetaContent(streamHtml, "name", "twitter:image");
      expect(
        content,
        "twitter:image must be an absolute URL for social scrapers. Got relative URL.",
      ).toBeDefined();
      expect(content!.toString()).toMatch(/^https?:\/\//);
    });
  });
});
