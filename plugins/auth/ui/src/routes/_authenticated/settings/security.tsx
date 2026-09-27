import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type SessionData, sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { SecurityTab } from "./-security-tab";

export const Route = createFileRoute("/_authenticated/settings/security")({
  component: SecuritySettings,
});

function SecuritySettings() {
  const auth = useAuthClient();
  const { data: session } = useQuery<SessionData | null>(sessionQueryOptions(auth));
  const user = session?.user;

  if (!user) return null;

  return <SecurityTab user={user} />;
}
