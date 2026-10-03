import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type SessionData, sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { useState } from "react";
import { AddEmailDialog } from "@/components/add-email-dialog";
import { SectionHeader } from "@/components/layout/section-header";
import { isSyntheticEmail } from "@/lib/synthetic-email";
import { useNetworkId } from "@/lib/use-network-id";
import { EmailMethod } from "./-email-method";
import { NearMethod } from "./-near-method";
import { PasskeysMethod } from "./-passkeys-method";

export const Route = createFileRoute("/_authenticated/settings/auth-methods")({
  component: AuthMethodsSettings,
});

function AuthMethodsSettings() {
  const auth = useAuthClient();
  const { data: session } = useQuery<SessionData | null>(sessionQueryOptions(auth));
  const user = session?.user;
  const networkId = useNetworkId();
  const [addEmailOpen, setAddEmailOpen] = useState(false);

  if (!user) return null;

  const emailIsSynthetic = isSyntheticEmail(user.email);
  const showEmailMethod = !user.isAnonymous;

  return (
    <div className="flex flex-col gap-10">
      <SectionHeader
        title="Sign-in methods"
        description="Ways you can get back into this account."
        sectionTestId="settings.auth-methods-heading"
      />
      <PasskeysMethod />
      <NearMethod networkId={networkId} />
      {showEmailMethod && (
        <EmailMethod
          email={emailIsSynthetic ? null : (user.email ?? null)}
          onAdd={() => setAddEmailOpen(true)}
        />
      )}
      <AddEmailDialog open={addEmailOpen} onOpenChange={setAddEmailOpen} />
    </div>
  );
}
