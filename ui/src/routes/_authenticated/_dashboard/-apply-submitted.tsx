import { CheckCircleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { PageContainer } from "@/components";
import { Button } from "@/components/ui/button";

export function ApplySubmitted({ proposalId, name }: { proposalId: string; name?: string }) {
  return (
    <PageContainer variant="narrow">
      <div
        className="flex flex-col items-center gap-6 py-12 text-center"
        data-testid="apply.submitted"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-success-muted text-success-muted-foreground">
          <CheckCircleIcon className="size-7" weight="fill" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-foreground">Application submitted</h1>
          <p className="text-base text-muted-foreground">
            {name ? `${name} is` : "Your community is"} waiting for an admin to review it.
          </p>
          <p className="font-mono text-xs break-all text-muted-foreground">{proposalId}</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center">
          <Button
            nativeButton={false}
            render={<Link to="/dashboard/node/proposals" />}
            data-testid="apply.view-proposals"
          >
            View proposals
          </Button>
          <Button variant="ghost" nativeButton={false} render={<Link to="/dashboard" />}>
            Back to Home
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
