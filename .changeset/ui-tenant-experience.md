---
"ui": minor
---

Add a tenant creation flow and make primary screens tenant-aware, alongside new reusable UI primitives.

- Add a new `/_layout/_authenticated/tenant/new` route with a multi-step `Stepper` flow for creating a tenant; create redirects to the new tenant detail page
- Add a `/_layout/_authenticated/tenant/$tenantId` detail page with inline name/subdomain editing, status badge, suspend/reactivate/delete actions (which republish the tenant config with the matching status), and links to the org and live site
- Make the home page, layout, settings, and organizations screens tenant-aware; replace the `wikiAccountId` org-metadata coupling with `resolveTenantByOrgId`
- Add reusable UI primitives: `field`, `info-row`, `network-toggle`, `spinner`, `stepper`, `textarea`, `app-detail-content`, and `json-highlight`
- Polish existing primitives (`button`, `checkbox`, `label`, `radio-group`, `separator`, `sonner`, `brand-element`, `theme-toggle`)