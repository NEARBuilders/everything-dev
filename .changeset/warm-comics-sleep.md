---
"everything-dev": patch
"api": patch
"host": patch
---

fix(everything-dev): restore full AuthRequestContext type from auth plugin contract

The generated AuthRequestContext type was overriding the full organization
envelope (member, org metadata, isPersonal, hasOrganization) from the auth
plugin's getContext() with a narrower { activeOrganizationId } stub. This
caused type drift between the runtime context and the type system.

- Remove handwritten organization/apiKey overlay from AuthRequestContext in
  api-contract.ts generator and cli/init.ts scaffold template
- AuthRequestContext now aliases RawAuthRequestContext directly, preserving
  the full contract shape

fix(api): add requireOrgRole middleware for organization-level role checks

Reads context.organization.member.role from the host-injected context.
No extra round-trips, no type casts, no caching.

fix(api): remove dead requireUser middleware and AuthenticatedContext type

requireUser was functionally identical to requireAuth (same condition,
different error message) and never imported anywhere. AuthenticatedContext
was defined but never used by any route handler.

fix(api): correct misleading requireAuth hint

requireAuth said "Sign in or provide an API key" but never checked for
API keys. Now says "Sign in to continue". Only requireAuthOrApiKey
accepts either auth method.

feat(api): requireAuthOrApiKey now accepts optional permission checks

requireAuthOrApiKey() — no args, same behavior as before (session or any
API key). requireAuthOrApiKey({ resource: ["action"] }) — session passes
through without permission checks, API key requests are scoped to the
specified permissions. Call site updated to requireAuthOrApiKey().

fix(host): remove redundant AuthServices interface

interface AuthServices extends GeneratedAuthServices { auth: ... } re-declared
auth with the same inherited type. Replaced with type AuthServices = GeneratedAuthServices.

fix(_template): remove requireAuth from scaffold plugin

The template's requireAuth only checked context.userId (not context.user)
and its userId re-set was a no-op. getById is now public.
