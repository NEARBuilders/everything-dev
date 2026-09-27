---
"@everything-dev/auth-plugin": patch
"api": patch
"ui": patch
---

Bind wallet invitations to their NEAR network, guard invitation status transitions, and align wallet membership limits with email invitations. Refresh workspace state after team changes and invitation acceptance, and defer membership loading until the Teams tab is opened.

Existing wallet invitations without a network must be reissued; email invitations are unaffected.
