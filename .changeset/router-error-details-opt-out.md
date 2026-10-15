---
"everything-dev": minor
---

`RouterError` gains a `showErrorDetails` prop and no longer renders the error-details `<details>` block in server-rendered fallbacks by default — SSR HTML is what gets indexed, cached, and logged, so internal messages (RPC endpoints, digests, provider errors) stay out of it. Pass `showErrorDetails={true}` to render the (React-escaped) block everywhere, or `false` to never render it.
