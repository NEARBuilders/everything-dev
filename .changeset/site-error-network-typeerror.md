---
"@everything-dev/auth-plugin": patch
---

The auth ui's site-error extraction now treats the fetch layer's own network `TypeError` ("Failed to fetch", "Load failed") as carrying no server message, so every surface using `siteErrorMessage` (device verify, login, pair/approve) renders the translated "Check your connection and try again." line instead of the raw browser error. Server errors keep their messages unchanged.
