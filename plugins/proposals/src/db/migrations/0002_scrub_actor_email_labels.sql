UPDATE "proposal_audit_log"
SET "actor_label" = NULL
WHERE "actor_label" IS NOT NULL
  AND "actor_label" LIKE '%@%.%'
  AND "actor_label" NOT LIKE '% %';
