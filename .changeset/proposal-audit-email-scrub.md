---
"@everything-dev/proposals-plugin": patch
"ui": patch
---

Proposal privacy hardening: non-admin readers no longer receive `createdBy` identities or `payload` contents from `getProposals` (both replaced with `[hidden]`/`null`), `getAuditLog` now requires a platform admin, and new audit-log rows stop falling back to the actor's email as the label. The node proposal detail page renders the payload's motivation field instead of dumping the raw payload JSON. A data migration scrubs existing email-shaped labels from `proposal_audit_log.actor_label`.
