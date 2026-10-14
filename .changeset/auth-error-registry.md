---
"@everything-dev/auth-plugin": minor
---

Error responses now carry typed `data` bodies declared from `every-plugin/errors` shapes: `UNAUTHORIZED` includes `apiKeyProvided` (plus `provider`/`authType` context), `FORBIDDEN` can include `requiredPermissions`/`action`, `NOT_FOUND` includes `resource`/`resourceId`, and `SERVICE_UNAVAILABLE`/`BAD_REQUEST` are now declared error codes. Infrastructure failures no longer masquerade as domain results — `getInvitation`, `getFullOrganization`, and `checkSlug` propagate server/DB errors (500/503) instead of returning `null`/`{ status: false }`; only the domain not-found kinds still map to those.
