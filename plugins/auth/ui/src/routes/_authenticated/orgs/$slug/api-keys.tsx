import { createFileRoute } from "@tanstack/react-router";
import { OrgApiKeysPage } from "@/components/org/api-keys-page";

export const Route = createFileRoute("/_authenticated/orgs/$slug/api-keys")({
  component: OrgApiKeysPage,
});
