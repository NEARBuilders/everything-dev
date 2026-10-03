---
"ui": minor
---

Tenant pages are addressable by slug, NEAR account id, or internal UUID: `/tenant/<slug>` resolves through the tenant's primary domain binding (falling back to the node slug), `/tenant/<accountId>` through the public account resolver, and `/tenant/<uuid>` keeps working for existing links. Tenant detail pages gain a breadcrumb showing the directory slug, and all tenant links the UI generates (admin tenants list, wizard post-creation) now prefer the slug over the opaque UUID.
