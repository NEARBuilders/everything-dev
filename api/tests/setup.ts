import { createServer } from "node:http";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { RPCHandler } from "@orpc/server/node";
import { createPluginRuntime } from "every-plugin";
import type { contract } from "@/contract";
import Plugin from "@/index";
import pluginDevConfig from "../plugin.dev";

const TEST_PLUGIN_ID = pluginDevConfig.pluginId;
const TEST_CONFIG = pluginDevConfig.config;

const TEST_REGISTRY = {
  [TEST_PLUGIN_ID]: {
    module: Plugin,
    description: "API integration test runtime",
  },
} as const;

export const runtime = createPluginRuntime({
  registry: TEST_REGISTRY,
  secrets: {},
});

let server: ReturnType<typeof createServer> | null = null;
let baseUrl = "";
let port = 0;

export async function getPluginClient(context?: Record<string, unknown>) {
  if (!server) {
    const { router } = await runtime.usePlugin(TEST_PLUGIN_ID, TEST_CONFIG);
    const rpcHandler = new RPCHandler(router);

    // Find an available port
    const testPort = 3000 + Math.floor(Math.random() * 1000);
    port = testPort;
    baseUrl = `http://localhost:${port}`;

    server = createServer(async (req, res) => {
      const url = new URL(req.url!, baseUrl);

      if (url.pathname.startsWith("/rpc")) {
        // Initialize empty context for each request to prevent closure capture
        let requestContext = {};

        // Allow overriding context via headers for flexibility
        if (req.headers["x-test-context"]) {
          requestContext = JSON.parse(req.headers["x-test-context"] as string);
        }

        const result = await rpcHandler.handle(req, res, {
          prefix: "/rpc",
          context: requestContext,
        });
        if (result.matched) return;
      }

      res.statusCode = 404;
      res.end("Route not found");
    });

    await new Promise<void>((resolve, reject) => {
      server?.listen(port, "127.0.0.1", () => resolve());
      server?.on("error", reject);
    });
  }

  const link = new RPCLink({
    url: `${baseUrl}/rpc`,
    fetch: globalThis.fetch,
    headers: context
      ? {
          "x-test-context": JSON.stringify(context),
        }
      : {},
  });

  const client: ContractRouterClient<typeof contract> = createORPCClient(link);
  return client;
}

export function authedContext(userId = "user-1"): Record<string, unknown> {
  return {
    userId,
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: "Test User",
    },
  };
}

export function orgContext(
  userId = "user-1",
  activeOrganizationId = "org-1",
): Record<string, unknown> {
  return {
    ...authedContext(userId),
    organization: {
      activeOrganizationId,
      organization: {
        id: activeOrganizationId,
        slug: activeOrganizationId,
        metadata: null,
      },
    },
  };
}

export async function teardown() {
  if (server) {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
    server = null;
  }
  await runtime.shutdown();
}
