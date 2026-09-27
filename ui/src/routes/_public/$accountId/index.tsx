import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_public/$accountId/")({
  component: AccountOverviewPage,
});

function AccountOverviewPage() {
  return null;
}
