---
"better-near-auth": patch
---

siwn verify logs the error cause chain (fixes elliotBraem/better-near-auth#91). The verify endpoint's catch logged only `error.message`; when the failure comes through Drizzle that is just the `Failed query: …` wrapper — the real database error (code, detail, constraint) lives on `error.cause` and was dropped, turning a five-minute diagnosis into an hour of archaeology (the hidden cause behind everything-dev#787's silent corruption was `duplicate key … user_email_unique`, 23505). The log line now walks the cause chain (`— cause: <message> | <code> | <detail> | <constraint> ← …`, bounded, self-referential-cause safe) via `formatErrorCauseChain` from `utils`. The client-facing `APIError` payload is unchanged.
