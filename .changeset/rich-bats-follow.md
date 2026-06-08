---
"everything-dev": minor
---

Expose `variables` on `api`, `auth`, and `plugins` in `ClientRuntimeConfig`. Previously `variables` was only available in the server-side `RuntimeConfig` and was stripped when building the client config passed to the UI. This meant external consumers calling `getAuthVariables()` would always throw because `runtimeConfig.auth.variables` was `undefined`. Now all three sections (`api`, `auth`, `plugins[id]`) include their `variables` in the client config, allowing UI code to read client-safe config like auth base URLs, SIWN recipients, passkey RP IDs, and plugin-specific settings. `secrets` remains server-only.