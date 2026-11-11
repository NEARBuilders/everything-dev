---
"every-plugin": patch
---

Plugin client factories warn at construction time in development when the caller omits context keys the plugin's declared context schema marks required — naming the keys and the deep failure the omission would cause. The auth plugin's credential-less in-process client now fails with a message that names the missing `reqHeaders` forwarding instead of generic auth-required prose, and the plugin's declared context marks `reqHeaders` as required so typed registries surface the omission at compile time (#860 stage 1, #882).
