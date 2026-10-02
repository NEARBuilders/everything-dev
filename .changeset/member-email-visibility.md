---
"@everything-dev/auth-plugin": minor
"ui": minor
---

Member email visibility is now gated behind an `email: ["read"]` permission check. Organization member lists, invitation rows, and member cards only render a member's email to viewers who hold that permission (or the member themselves, or a platform admin); everyone else sees no email instead of the raw address.
