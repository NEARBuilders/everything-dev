---
"everything-dev": minor
"host": minor
"ui": patch
---

Version observability (atomic-deploys 12): `GET /.well-known/version` now returns the per-slot manifest pins from the adopted pointer and the watch fiber's last-tick outcome beside the fingerprint; `pointerFingerprint`/`slotPins` are shared so CLI and host compute the same identity. Every publish writes the per-deploy manifest key (audit trail, previously wallet-only), prints the fingerprint + pins, and returns them. `bos deploy --status` lists recent publishes newest-first from the manifests key family; `bos status` reports the deployed-vs-served fingerprint delta — the split-brain detector. The admin dashboard gains a version card (`admin-version-card`) reading the version endpoint, and `/llms.txt` + `/skill.md` document the surface for agents.
