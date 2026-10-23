---
"every-plugin": patch
"@everything-dev/auth-plugin": patch
"everything-dev": patch
---

Share sonner across the ui graph (tolerant singleton) and surface server errors at the right sites

The mounted Toaster lives in the core ui's sonner instance; plugin remotes bundled private copies, so every `toast()` fired from plugin ui code — 16 call sites in the auth plugin alone, plus `plugins/ai` — was invisible in production. `sonner` now joins `UI_SHARED_DEPS` as a tolerant singleton: remotes resolve the core's instance (toasts render), keep a bundled fallback copy, and waive `requiredVersion`, so old-provider/new-remote mixes degrade to today's behavior instead of failing a share negotiation (zod's critical:false precedent; the boot gate only checks effect-critical names). The version pins move to the pnpm catalog (`sonner: 2.0.8`) for lockstep. Recorded in ADR 0037.

Alongside, the login surfaces stop swallowing server errors:

- the login page renders sign-in failures inline (one concise line + collapsed "Details" disclosure with the server detail) instead of toasting into the void or claiming "no passkey on this device" for a 503; a failed session load during an API outage gets a login-branded `errorComponent` with a retry instead of the document-wide root error
- the device pairing/approve/verify pages append the server detail under their existing error lines
- the CLI's device login unwraps the `Effect.tryPromise` wrapper (the cause of the cryptic "An error occurred in Effect.tryPromise" output), carries the host 503 `detail` in its "could not start" message, and `parseSiteErrorDetail` now extracts the host's `detail`/`detailFull` fields
