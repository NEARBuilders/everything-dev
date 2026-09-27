import { Effect, Layer } from "effect";
import type { ComposePayload } from "everything-dev/ui/manifest";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { SecurityMiddleware } from "../../src/middleware/security";
import { renderClientShellHtml } from "../../src/routes/html";
import {
  buildRuntimeClientConfig,
  ConfigService,
  type RuntimeConfig,
} from "../../src/services/config";
import { loadTestRuntimeConfig } from "../helpers/runtime-config";

function configWithPluginUi(config: RuntimeConfig): RuntimeConfig {
  return {
    ...config,
    plugins: {
      auth: {
        name: "@everything-dev/auth-plugin",
        url: "http://localhost:3018",
        entry: "http://localhost:3018/mf-manifest.json",
        source: "local",
        ui: {
          name: "auth-ui",
          url: "http://localhost:3011",
          entry: "http://localhost:3011/mf-manifest.json",
          source: "local",
        },
      },
    },
  } as RuntimeConfig;
}

function clientConfigWithCompose(
  config: RuntimeConfig,
  request: Request,
  composePayload?: ComposePayload,
) {
  const activeRuntime = {
    accountId: config.account,
    gatewayId: config.domain ?? "regression.test",
    runtimeBasePath: "/",
    title: config.title ?? config.account,
    description: null,
    hostUrl: new URL(request.url).origin,
  };
  return buildRuntimeClientConfig(config, request, activeRuntime, true, composePayload);
}

const composePayload: ComposePayload = {
  digest: "csp-compose-digest",
  remotes: [{ key: "auth", name: "auth-ui", entry: "http://localhost:3011/remoteEntry.js" }],
  manifests: [],
};

describe("CSP compose regression", () => {
  let config: RuntimeConfig;

  beforeAll(async () => {
    config = configWithPluginUi(await loadTestRuntimeConfig());
  });

  describe("CSR shell script tags", () => {
    it("emits plugin remoteEntry script tags when a compose payload is present", () => {
      const request = new Request("http://localhost/login");
      const runtimeConfig = clientConfigWithCompose(config, request, composePayload);

      const html = renderClientShellHtml(undefined, config, runtimeConfig);

      expect(html).toContain('src="http://localhost:3011/remoteEntry.js"');
    });

    it("nonce-carrying plugin script tags under CSP_STRICT", () => {
      const request = new Request("http://localhost/login");
      const runtimeConfig = clientConfigWithCompose(config, request, composePayload);

      const html = renderClientShellHtml("test-nonce-1", config, runtimeConfig);

      const pluginTag = html.match(
        /<script[^>]*src="http:\/\/localhost:3011\/remoteEntry\.js"[^>]*>/,
      );
      expect(pluginTag, "plugin remoteEntry script tag must exist").toBeTruthy();
      expect(pluginTag![0]).toContain('nonce="test-nonce-1"');
    });

    it("emits no plugin script tags without a compose payload (core-only fallback)", () => {
      const request = new Request("http://localhost/login");
      const runtimeConfig = clientConfigWithCompose(config, request, undefined);

      const html = renderClientShellHtml(undefined, config, runtimeConfig);

      expect(html, "core ui remote stays, plugin remotes do not").not.toContain(
        'src="http://localhost:3011/remoteEntry.js"',
      );
    });
  });

  describe("CSP header allows the plugin ui origin", () => {
    let cspHeader: (requestPath: string) => Promise<string | null>;

    beforeAll(async () => {
      const middleware = await Effect.runPromise(
        SecurityMiddleware.pipe(
          Effect.provide(SecurityMiddleware.Live),
          Effect.provide(Layer.succeed(ConfigService, config)),
        ),
      );
      const app = new Hono();
      app.use("*", middleware.csp);
      app.get("/*", (context) => context.text("ok"));
      cspHeader = async (requestPath) => {
        const response = await app.request(`http://localhost${requestPath}`);
        return response.headers.get("content-security-policy");
      };
    });

    it("strict script-src pins scripts to nonce + strict-dynamic (the nonce'd plugin tag path)", async () => {
      const policy = await cspHeader("/login");
      expect(policy).toBeTruthy();
      const scriptSrc = policy!.split("script-src")[1]?.split(";")[0] ?? "";
      expect(scriptSrc).toContain("strict-dynamic");
      expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
      expect(scriptSrc).not.toContain("http://localhost:3011");
    });

    it("connect-src includes the plugin ui origin in both modes", async () => {
      const policy = await cspHeader("/login");
      const connectSrc = policy!.split("connect-src")[1]?.split(";")[0] ?? "";
      expect(connectSrc).toContain("http://localhost:3011");
    });
  });
});
