---
"@everything-dev/auth-plugin": minor
---

redeemOnboardingCode returns the organizationId

The redemption output now includes `organizationId` alongside `organizationName`, so children can link the freshly-joined member to the organization's public page without a second lookup. Restores a field the local template snapshot carried before the published contract dropped it.
