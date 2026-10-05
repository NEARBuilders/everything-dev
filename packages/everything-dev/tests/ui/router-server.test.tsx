import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerRouterModule } from "../../src/ui/router-server";

vi.mock("../../src/ui/auth", () => ({ createAuthClient: vi.fn(() => ({})) }));

const RUNTIME_CONFIG = { hostUrl: "https://example.test", rpcBase: "/api" };

function buildCoreTree() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <div>ssr-home-marker</div>,
  });
  return rootRoute.addChildren([indexRoute]);
}

function makeRequest(path: string): Request {
  return new Request(`https://example.test${path}`);
}

async function streamText(result: { stream: ReadableStream }): Promise<string> {
  const reader = result.stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

afterEach(() => vi.restoreAllMocks());

describe("SSR router module — injected app factory", () => {
  it("mints each request's router through the injected factory", async () => {
    const tree = buildCoreTree();
    const framework = createServerRouterModule({ defaultRouteTree: tree });
    const factory = vi.fn((opts: Parameters<typeof framework.createRouter>[0]) =>
      framework.createRouter(opts),
    );
    const module = createServerRouterModule({ defaultRouteTree: tree, createRouter: factory });

    const result = await module.renderToStream(makeRequest("/"), {
      runtimeConfig: RUNTIME_CONFIG,
      apiClient: {} as never,
      routeTree: tree,
    });

    expect(factory).toHaveBeenCalledOnce();
    const opts = factory.mock.calls[0]![0]!;
    expect(opts.routeTree).toBe(tree);
    expect(opts.history?.location?.href).toBe("/");
    expect(opts.context?.runtimeConfig).toMatchObject({ hostUrl: RUNTIME_CONFIG.hostUrl });
    expect(await streamText(result)).toContain("ssr-home-marker");
  });

  it("renders through the framework factory when none is injected", async () => {
    const tree = buildCoreTree();
    const module = createServerRouterModule({ defaultRouteTree: tree });

    const result = await module.renderToStream(makeRequest("/"), {
      runtimeConfig: RUNTIME_CONFIG,
      apiClient: {} as never,
      routeTree: tree,
    });

    expect(await streamText(result)).toContain("ssr-home-marker");
  });
});
