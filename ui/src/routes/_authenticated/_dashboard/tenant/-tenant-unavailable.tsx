import { BankIcon, WarningIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Button, EmptyState, PageContainer } from "@/components";

export function TenantUnavailable({ gatewayId }: { gatewayId?: string }) {
  return (
    <PageContainer variant="wide">
      {!gatewayId ? (
        <EmptyState
          icon={WarningIcon}
          title="Gateway not configured"
          description="Set domain in bos.config.json and rebuild the host to load community settings."
          action={
            <Button variant="outline" nativeButton={false} render={<Link to="/dashboard" />}>
              Back home
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={BankIcon}
          title="Community not found"
          description="It may have been deleted, or you don't have access."
          action={
            <Button variant="outline" nativeButton={false} render={<Link to="/dashboard" />}>
              Back home
            </Button>
          }
        />
      )}
    </PageContainer>
  );
}
