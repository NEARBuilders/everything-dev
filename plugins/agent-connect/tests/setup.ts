import { createServer } from "node:http";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { RPCHandler } from "@orpc/server/node";
import type { Context } from "effect";

import { createPluginRuntime } from "every-plugin";
import type { contract } from "@/contract";
import Plugin from "@/index";
import packageJson from "../package.json" with { type: "json" };
import pluginDevConfig from "../plugin.dev";

const TEST_PLUGIN_ID = packageJson.name;
const TEST_CONFIG = pluginDevConfig.config;

const TEST_REGISTRY = {
  [TEST_PLUGIN_ID]: {
    module: Plugin,
    description: "Integration test runtime",
  },
} as const;

export const runtime = createPluginRuntime({
  registry: TEST_REGISTRY,
  secrets: {},
});

let server: ReturnType<typeof createServer> | null = null;
let baseUrl = "";
let port = 0;
let pluginEffectContext: Context.Context<any> | null = null;

/**
 * The plugin's initialized Effect context — services (AgentStore, …) can be
 * read from it in tests via `Context.get`.
 */
export function getPluginEffectContext(): Context.Context<any> {
  if (!pluginEffectContext) {
    throw new Error("getPluginClient() must run before getPluginEffectContext()");
  }
  return pluginEffectContext;
}

export async function getPluginClient(context?: {
  userId?: string;
  sessionId?: string;
  near?: unknown;
}) {
  if (!server) {
    const { router, initialized } = await runtime.usePlugin(TEST_PLUGIN_ID, TEST_CONFIG);
    const rpcHandler = new RPCHandler(router);
    const effectContext = initialized.effectContext;
    pluginEffectContext = effectContext;

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
        if (req.headers["x-test-user"]) {
          requestContext = {
            ...requestContext,
            userId: req.headers["x-test-user"] as string,
          };
        }
        if (req.headers["x-test-session"]) {
          requestContext = {
            ...requestContext,
            sessionId: req.headers["x-test-session"] as string,
          };
        }
        if (req.headers["x-test-near"]) {
          requestContext = {
            ...requestContext,
            near: JSON.parse(req.headers["x-test-near"] as string),
          };
        } else {
          requestContext = {
            ...requestContext,
            near: {
              primaryAccountId: "test.near",
              linkedAccounts: [
                {
                  accountId: "test.near",
                  network: "mainnet",
                  publicKey: "ed25519:abcdefghijklmnopqrstuvwxyz0123456789ABCD",
                  isPrimary: true,
                },
              ],
              hasNearAccount: true,
            },
          };
        }

        const result = await rpcHandler.handle(req, res, {
          prefix: "/rpc",
          context: { ...requestContext, "effect/context": effectContext },
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
    origin: baseUrl,
    url: "/rpc",
    fetch: globalThis.fetch,
    headers: context
      ? {
          ...(context.userId && { "x-test-user": context.userId }),
          ...(context.sessionId && { "x-test-session": context.sessionId }),
          ...(context.near !== undefined && {
            "x-test-near": JSON.stringify(context.near),
          }),
        }
      : {},
  });

  const client: ContractRouterClient<typeof contract> = createORPCClient(link);
  return client;
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
