# Middleware Reference

## Available Middlewares

| Middleware | Narrows |
|---|---|
| `requireAuth` | `userId: string`, `user: RequestAuthUser` |
| `requireAuthOrApiKey` | gate only — allows session or API key auth, no narrowing |
| `requireRole("admin")` | `userId`, `user` |
| `requireOrganization` | `userId`, `user`, `organization.activeOrganizationId: string` |
| `requireOrgRole("owner")` | all of above + `organization.member` non-null with `id`, `role` |
| `requireApiKey` | `apiKey: ApiKeyContext` |

## Org Metadata Validation

Pass an optional Zod schema to `createAuthMiddleware` for runtime validation:

```ts
import { z } from "zod";

const orgMetaSchema = z.object({ plan: z.enum(["free", "pro"]), seats: z.number() });
const { requireOrganization } = createAuthMiddleware(builder, { orgMetaSchema });
```

When a schema is provided, `requireOrganization` and `requireOrgRole` call `schema.safeParse()` on the org metadata. On parse failure, throws `INTERNAL_SERVER_ERROR` (data integrity issue). When no schema is passed, metadata stays `Record<string, unknown>` with no validation.

## Typed Org Context Helpers

```ts
import type { OrgAuthenticatedContext } from "./lib/auth";

type MyOrgMeta = { plan: "free" | "pro"; seats: number };

const ctx = context as OrgAuthenticatedContext<MyOrgMeta>;
ctx.organization.organization?.metadata?.plan;
```

Also available: `OrgMemberAuthenticatedContext<TMeta>` (guarantees `organization.member` is non-null).
