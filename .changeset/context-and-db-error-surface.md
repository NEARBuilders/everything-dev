---
"everything-dev": patch
---

Contract/error-surface fixes (#678, #798): the auth `getContext` contract now
declares the host-injected `nearAccountId` (nullable, optional), so plugin
ContextSchemas derived from the contract see it without a local widening and
output validation doesn't strip it; and `unwrapDatabaseError` stringifies
non-Error causes without ever throwing — a null-prototype cause (a rewrapped
fiber failure) used to raise `TypeError: Cannot convert object to primitive
value` from the message getter, masking the real database error everywhere it
was read.
