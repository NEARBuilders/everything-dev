import { createRootRouteWithContext, createRoute, Outlet } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createServerRouterModule } from "../../src/ui/router-server";
import type { RenderOptionsWithApi, RouterContextWithApi } from "../../src/ui/types";

const root = createRootRouteWithContext<RouterContextWithApi>()({
  component: function Document() {
    const { locale } = root.useRouteContext();
    return (
      <html lang={locale}>
        <head />
        <body>
          <Outlet />
        </body>
      </html>
    );
  },
});
const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <h1>Home</h1> });
const about = createRoute({
  getParentRoute: () => root,
  path: "/about",
  component: () => <h1>About</h1>,
});
const module = createServerRouterModule({
  defaultRouteTree: root.addChildren([home, about]),
  locale: { locales: ["en", "es", "fr", "zh"], defaultLocale: "en", cookieName: "citynode_locale" },
});
const options = {
  runtimeConfig: {
    hostUrl: "http://localhost",
    rpcBase: "/api",
    authBase: "/api/auth",
    networkId: "mainnet",
    auth: { variables: { siwn: { recipient: "app.near" } } },
  },
  session: null,
} as RenderOptionsWithApi;

async function render(path: string, headers: HeadersInit) {
  const result = await module.renderToStream(
    new Request(`http://localhost${path}`, { headers }),
    options,
  );
  expect(result.headers.get("Vary")).toContain("Cookie");
  expect(result.headers.get("Vary")).toContain("Accept-Language");
  return new Response(result.stream).text();
}

describe("request-scoped SSR locale", () => {
  it("renders the requested route and cookie language independently for concurrent requests", async () => {
    const [french, spanish, chinese] = await Promise.all([
      render("/about", { cookie: "citynode_locale=fr", "accept-language": "es" }),
      render("/", { "accept-language": "es-MX, en;q=0.5" }),
      render("/about", { cookie: "citynode_locale=zh" }),
    ]);
    expect(french).toContain('<html lang="fr"');
    expect(french).toContain("About");
    expect(spanish).toContain('<html lang="es"');
    expect(spanish).toContain("Home");
    expect(chinese).toContain('<html lang="zh"');
    expect(await render("/", {})).toContain('<html lang="en"');
  });
});
