---
"everything-dev": patch
---

The release-pointer reads fetch the runtime-prefixed wire key exactly once.
`readPlatformPointer` / `readPlatformVersionSlot` passed a full key into
`fetchRegistryKey` (which wraps with `apps/<account>/<gateway>/`), so every
pointer and version-slot read resolved a double-prefixed key that can never
exist and returned null — the Nov-03 release-train deploy failed its smoke
leg on this ("release pointer serves nothing") and rolled back, and the
version-slot immutability check silently passed, burning the rc.35 slot.
Pointer keys are now derived from their relative forms in one place
(`registry/pointer.ts`), the release leg's pointer flip verifies as a
confirmed leg of the publish-confirmation machine (retry-until-deadline
through the pre-cutover transport, the wire key named on timeout), and
unit tests pin the exact read URLs so the seam gap that hid this cannot
reopen.
