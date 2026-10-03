# Request Context Reference

The host injects a per-request context object into every plugin. The plugin **must declare the fields it uses** in its context zod schema. Only declared fields are available to route handlers and middleware — the schema is a filter.

## Full Schema

```ts
context: z.object({
  userId: z.string().optional(),
  user: z.object({
    id: z.string(),
    role: z.string().optional(),   // "admin", "member", or null for anon
    email: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
  organizationId: z.string().optional(),   // Active organization UUID
  organization: z.object({
    activeOrganizationId: z.string().nullable().optional(),
    organization: z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      logo: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),  // daoAccountId lives here
    }).nullable().optional(),
    member: z.object({
      id: z.string(),
      role: z.string(),   // User's role within this org ("admin", "member")
    }).nullable().optional(),
    isPersonal: z.boolean(),
    hasOrganization: z.boolean(),
  }).optional(),
  near: z.object({
    primaryAccountId: z.string().nullable(),
    linkedAccounts: z.array(z.object({
      accountId: z.string(),
      network: z.string(),
      publicKey: z.string(),
      isPrimary: z.boolean(),
    })),
    hasNearAccount: z.boolean(),
  }).optional(),
  walletAddress: z.string().optional(),
  apiKey: z.object({
    id: z.string(),
    name: z.string().nullable().optional(),
    permissions: z.record(z.string(), z.array(z.string())).nullable().optional(),
  }).optional(),
  reqHeaders: z.custom<Headers>().optional(),
  getRawBody: z.custom<() => Promise<string>>().optional(),
}),
```

## Field Summary

| Field | Description |
|-------|-------------|
| `userId` | Authenticated user id (absent for anon) |
| `user` | Full user record (id, role, email, name) |
| `organizationId` / `organization` | Active org envelope from Better Auth: `activeOrganizationId`, org details (`metadata.daoAccountId`), and the user's `member.role` |
| `near` | Primary NEAR account + linked accounts (accountId, network, publicKey, isPrimary) |
| `walletAddress` | Primary NEAR account id, flat |
| `apiKey` | API key auth: `id`, `name`, `permissions` (resource → action list) |
| `reqHeaders` | Incoming request `Headers` (forward to auth client) |
| `getRawBody` | Raw body accessor (webhook-style handlers) |

For pre-built auth/organization middleware, see the `api-and-auth` skill.
