import { AsyncLocalStorage } from "node:async_hooks";
import {
  fromJsonSchema,
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { OpenAPIGenerator } from "@orpc/openapi";
import type { OpenAPIHandler } from "@orpc/openapi/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import type { Context, Hono } from "hono";
import type { AuthPluginContext, HonoEnv } from "../lib/auth";
import { logger } from "../utils/logger";
import { buildPluginContext } from "./auth";
import type { RuntimeConfig } from "./config";

interface McpRequestContext {
  context: AuthPluginContext;
  baseUrl: string;
}

const mcpRequestStorage = new AsyncLocalStorage<McpRequestContext>();

let mcpTransport: WebStandardStreamableHTTPServerTransport | null = null;

export function closeMcpServer(): Promise<void> {
  if (!mcpTransport) return Promise.resolve();
  const t = mcpTransport;
  mcpTransport = null;
  return t.close();
}

export async function mountMcpRoute(
  app: Hono<HonoEnv>,
  options: {
    apiRouter: unknown;
    apiHandler: OpenAPIHandler<any>;
    config: RuntimeConfig;
  },
) {
  const { apiRouter, apiHandler, config } = options;

  const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

  const spec = await generator.generate(apiRouter as any, {
    info: {
      title: `${config.title ?? config.account} API`,
      version: "1.0.0",
    },
  });

  const server = new McpServer({
    name: `${config.title ?? config.account} MCP`,
    version: "1.0.0",
  });

  const paths = (spec as any).paths ?? {};

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      const operationId = operation.operationId;
      if (!operationId) continue;

      const responses = operation.responses ?? {};
      const hasSseResponse = Object.values(responses).some(
        (resp: any) => resp?.content && "text/event-stream" in resp.content,
      );
      if (hasSseResponse) continue;

      const methodUpper = method.toUpperCase();
      const isBodyMethod = ["POST", "PUT", "PATCH"].includes(methodUpper);
      const parameters = operation.parameters ?? [];
      const pathParamNames = parameters
        .filter((p: any) => p.in === "path")
        .map((p: any) => p.name as string);
      const queryParamNames = parameters
        .filter((p: any) => p.in === "query")
        .map((p: any) => p.name as string);

      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const param of parameters) {
        properties[param.name] = param.schema ?? { type: "string" };
        if (param.required) required.push(param.name);
      }

      const bodySchema = operation.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema) {
        if (bodySchema.type === "object" && bodySchema.properties) {
          for (const [key, value] of Object.entries(bodySchema.properties)) {
            properties[key] = value;
          }
          if (Array.isArray(bodySchema.required)) {
            required.push(...bodySchema.required);
          }
        } else {
          properties.body = bodySchema;
          required.push("body");
        }
      }

      const inputSchema = {
        type: "object" as const,
        properties,
        ...(required.length > 0 ? { required } : {}),
      };

      const description = operation.description ?? operation.summary ?? `${methodUpper} ${path}`;

      server.registerTool(
        operationId,
        {
          description,
          inputSchema: fromJsonSchema(inputSchema as any) as any,
        },
        async (args: Record<string, unknown>) => {
          const store = mcpRequestStorage.getStore();
          if (!store) {
            return {
              content: [{ type: "text" as const, text: "Internal error: no request context" }],
              isError: true,
            };
          }

          let resolvedPath = path;
          const queryParts: string[] = [];
          const bodyFields: Record<string, unknown> = {};

          for (const [key, value] of Object.entries(args ?? {})) {
            if (pathParamNames.includes(key)) {
              resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(String(value)));
            } else if (queryParamNames.includes(key)) {
              if (value !== undefined && value !== null) {
                queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
              }
            } else {
              bodyFields[key] = value;
            }
          }

          const url = new URL(`/api${resolvedPath}`, store.baseUrl);
          if (queryParts.length > 0) {
            url.search = queryParts.join("&");
          }

          const headers = store.context.reqHeaders
            ? new Headers(store.context.reqHeaders)
            : new Headers();
          headers.delete("content-length");
          const isJsonBody = isBodyMethod && Object.keys(bodyFields).length > 0;
          if (isJsonBody) {
            headers.set("content-type", "application/json");
          }

          const req = new Request(url, {
            method: methodUpper,
            headers,
            body: isJsonBody ? JSON.stringify(bodyFields) : undefined,
          });

          try {
            const result = await apiHandler.handle(req, {
              prefix: "/api",
              context: store.context,
            });

            if (!result.response) {
              return {
                content: [{ type: "text" as const, text: "Not Found" }],
                isError: true,
              };
            }

            const response = result.response;
            let text: string;
            try {
              text = await response.text();
            } catch {
              text = response.statusText || `HTTP ${response.status}`;
            }
            return {
              content: [{ type: "text" as const, text: text || response.statusText }],
              isError: !response.ok,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[MCP] Tool "${operationId}" failed: ${message}`);
            return {
              content: [{ type: "text" as const, text: message }],
              isError: true,
            };
          }
        },
      );
    }
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  mcpTransport = transport;

  app.all("/api/mcp", async (c: Context<HonoEnv>) => {
    const context = buildPluginContext(c);
    const baseUrl = new URL(c.req.url).origin;

    let parsedBody: unknown;
    if (c.req.method === "POST") {
      try {
        const clone = c.req.raw.clone();
        parsedBody = await clone.json();
      } catch {
        // Body is not valid JSON — transport will handle the error
      }
    }

    return mcpRequestStorage.run({ context, baseUrl }, () =>
      transport.handleRequest(c.req.raw, { parsedBody }),
    );
  });
}
