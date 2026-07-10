---
"everything-dev": patch
"api": patch
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
