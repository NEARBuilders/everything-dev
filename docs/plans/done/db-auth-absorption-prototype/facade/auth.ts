import type { z } from "zod";

export interface AuthContextShape {
  userId?: string;
  user?: unknown;
  apiKey?: unknown;
  organization?: unknown;
  session?: unknown;
}

type OrgMetaType<TSchema extends z.ZodType | undefined> = TSchema extends z.ZodType
  ? z.infer<TSchema>
  : Record<string, unknown>;

function parseOrgMetadata<TSchema extends z.ZodType | undefined>(
  raw: Record<string, unknown> | null | undefined,
  schema: TSchema | undefined,
): OrgMetaType<TSchema> | null {
  if (!raw) return null;
  if (!schema) return raw as OrgMetaType<TSchema>;
  const result = schema.safeParse(raw);
  if (result.success) return result.data as OrgMetaType<TSchema>;
  throw new Error("Invalid organization metadata");
}

interface MiddlewareLike {
  middleware: (fn: any) => any;
}

export function createAuthMiddleware<
  TAuthContext extends AuthContextShape = AuthContextShape,
  TOrgMetaSchema extends z.ZodType | undefined = undefined,
>(builder: MiddlewareLike, options?: { orgMetaSchema?: TOrgMetaSchema }) {
  const requireAuth = builder.middleware(async ({ context, next }: { context: TAuthContext; next: any }) => {
    if (!context.user || !context.userId) {
      throw new Error("UNAUTHORIZED: Authentication required");
    }
    return next({ context: { userId: context.userId, user: context.user } });
  });

  const requireAuthOrApiKey = builder.middleware(
    async ({ context, next }: { context: TAuthContext; next: any }) => {
      if (!context.user && !context.userId && !context.apiKey) {
        throw new Error("UNAUTHORIZED: Authentication required");
      }
      return next({ context });
    },
  );

  const requireApiKey = builder.middleware(
    async ({ context, next }: { context: TAuthContext; next: any }) => {
      if (!context.apiKey) {
        throw new Error("UNAUTHORIZED: API key required");
      }
      return next({ context: { apiKey: context.apiKey } });
    },
  );

  const parseOrgMeta = (raw: Record<string, unknown> | null | undefined) =>
    parseOrgMetadata(raw, options?.orgMetaSchema);

  return { requireAuth, requireAuthOrApiKey, requireApiKey, parseOrgMeta };
}
