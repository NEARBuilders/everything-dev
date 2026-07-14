# API Keys Reference

## Route Table

All routes are exposed via the Better-Auth `apiKeyClient()` plugin (not the oRPC `apiClient`). Call them through `authClient.apiKey.*`:

| Method | Input | Output | Notes |
|--------|-------|--------|-------|
| `list` | `{ organizationId?, limit?, offset?, sortBy?, sortDirection?, configId? }` | `ApiKey[]` | Returns metadata only — no secret |
| `create` | `{ name?, prefix?, expiresIn?, permissions?, metadata?, rateLimit?, organizationId?, configId? }` | `ApiKey & { key: string }` | Full secret returned **once** |
| `update` | `{ id, name?, enabled?, permissions?, metadata?, expiresIn?, rateLimit? }` | `ApiKey` | No secret returned |
| `delete` | `{ id }` | `{ success: boolean }` | Irreversible |

### UI Usage

```ts
const authClient = useAuthClient();

// List keys for an organization
const { data } = await authClient.apiKey.list({
  query: { configId: "org-keys", organizationId: orgId },
});
const keys = data?.apiKeys ?? [];

// Create a key
const { data, error } = await authClient.apiKey.create({
  configId: "org-keys",
  organizationId: orgId,
  name: "CI deploy key",
  expiresIn: 60 * 60 * 24 * 30,  // 30 days
});
if (data) {
  saveSecret(data.apiKey.key);  // "edk_xxxxx..." — only available here
}

// Delete a key
const { error } = await authClient.apiKey.delete({
  keyId: "key_abc123",
  configId: "org-keys",
});
```

## ApiKey Shape

```ts
type ApiKey = {
  id: string;
  name: string | null;
  prefix: string;          // first chars for identification (e.g., "edk_abc")
  enabled: boolean;
  permissions: Record<string, string[]> | null;  // resource → actions
  requestCount: number;
  expiresAt: number | null;  // epoch seconds
  metadata: Record<string, unknown> | null;
  rateLimit: { limit: number; window: number } | null;
};
```

## Permission Schema

Permissions are a map of resource name to allowed action arrays:

```ts
{
  things: ["create", "read", "delete"],
  projects: ["read"],
  registry: ["publish", "relay"],
}
```

### Server-Side Permission Checks

`requireApiKey(requiredPermissions)` validates that the presented key's `permissions` cover all required entries:

```ts
const { requireApiKey } = createAuthMiddleware(builder);

builder.deleteThing
  .use(requireApiKey({ things: ["delete"] }))
  .handler(async ({ context }) => {
    context.apiKey;        // ApiKeyContext — non-null, narrowed by middleware
    context.apiKey.permissions;  // Record<string, string[]>
  });
```

If any required action is missing, throws `FORBIDDEN` with:

```ts
{
  message: "API key lacks permission: things:delete",
  data: { requiredPermissions, keyPermissions },
}
```

### Multi-Resource Permissions

```ts
builder.deployApp
  .use(requireApiKey({
    registry: ["publish"],
    projects: ["update"],
  }))
  .handler(...)
```

All specified resources must be satisfied — partial matches are rejected.

## Key Lifecycle

1. **Create** — `authClient.apiKey.create()` returns `{ ...apiKey, key }`. The `key` field is the full secret (`edk_...`). Save it now — it is never returned again.
2. **Identify** — subsequent `list` / `update` calls return only `prefix` (first few chars) for identification.
3. **Disable** — `update({ id, enabled: false })` revokes the key without deleting it.
4. **Delete** — `delete({ id })` permanently removes the key.

## Scoping

### `configId`

Keys can be grouped under a config ID (e.g., `"org-keys"`). This is an opaque label for organizing keys by purpose. Pass the same `configId` on create, list, and delete.

### `organizationId`

Keys scoped to an organization inherit the org's context. The host's session middleware resolves the active organization from the session, and `requireOrganization` / `requireOrgRole` middlewares check org membership.

## Browser vs Server Limitations

Permissions, rate limits, and refill configuration are **server-only** — they cannot be set from the browser client. The `create` call from the UI accepts `name`, `expiresIn`, `permissions` (if allowed), and `metadata`. Server-side key management (e.g., via a plugin route) can set the full set of options.

## Auth Context

When an API key is validated, the host's `getContext()` populates:

```ts
{
  authMethod: "apiKey",
  apiKey: {
    id: "key_abc123",
    name: "CI deploy key",
    permissions: { things: ["create", "read"], ... },
  },
  // user, organization, etc. are null unless the key is tied to a user/org
}
```

The `authMethod` field is one of `"session" | "anonymous" | "apiKey" | "none"`. Plugin routes can branch on this to customize responses for programmatic vs interactive access.
