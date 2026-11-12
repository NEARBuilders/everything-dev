import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

const CONFIG_ID_LOCATION: Record<string, "body" | "query"> = {
  "/api-key/create": "body",
  "/api-key/update": "body",
  "/api-key/delete": "body",
  "/api-key/get": "query",
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function defaultConfigIdFor(path: string, input: Record<string, unknown>): string {
  if (
    path === "/api-key/create" &&
    typeof input.organizationId === "string" &&
    input.organizationId
  ) {
    return "org-keys";
  }
  return "user-keys";
}

export function apiKeyDefaultConfig() {
  return {
    id: "api-key-default-config",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path !== undefined && ctx.path in CONFIG_ID_LOCATION,
          handler: createAuthMiddleware(async (ctx) => {
            const location = CONFIG_ID_LOCATION[ctx.path];
            if (!location) return;
            const input = asRecord(ctx[location]);
            if (typeof input.configId === "string" && input.configId) return;
            const configId = defaultConfigIdFor(ctx.path, input);
            return { context: { [location]: { ...input, configId } } };
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
