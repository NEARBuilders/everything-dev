---
"everything-dev": patch
"every-plugin": patch
---

oRPC v2 test scaffolds and skills: `RPCLink` snippets now teach `origin` plus a relative `url` (`StandardUrl` — a concatenated absolute URL fails typechecking at the link boundary), and client-side error guidance matches on `error.code` rather than message (oRPC v2 does not transport undefined-error messages). The `_template` integration test and the every-plugin request-context test were switched from message assertions to code assertions.
