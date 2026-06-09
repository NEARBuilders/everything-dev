---
"everything-dev": minor
---

Auth types template now uses contract-based `InferOutput` instead of hardcoded `better-auth` fallback types, and adds `apiKey` and `organization.activeOrganizationId` overlay fields to `AuthRequestContext` to reflect what the host middleware injects at runtime.