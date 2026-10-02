import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Button, PageHeader, type Step } from "@/components";
import { ConnectDao } from "@/components/connect-dao";
import { Spinner } from "@/components/ui/spinner";
import { TenantStep } from "./-tenant-step";
import { resolveTenantDeploySteps } from "./-tenant-wizard";

export function TenantDeployPhase({
  steps,
  verifyState,
  verifyMessage,
  hostname,
  daoAccountId,
  createdTenantId,
  tenantSlug,
  publishPending,
  allDone,
  onRecheck,
  onSubmitPublish,
  onResetPublish,
}: {
  steps: Step[];
  verifyState: "idle" | "checking" | "verified" | "failed";
  verifyMessage: string | null;
  hostname: string;
  daoAccountId: string | null;
  createdTenantId: string | null;
  tenantSlug: string;
  publishPending: boolean;
  allDone: boolean;
  onRecheck: () => void;
  onSubmitPublish: () => void;
  onResetPublish: () => void;
}) {
  const createStep = steps[0];
  const publishStep = steps[1];
  const status = resolveTenantDeploySteps({
    create: createStep?.state ?? "pending",
    publish: publishStep?.state ?? "pending",
    verified: verifyState === "verified",
  });
  const live = verifyState === "verified";
  const tenantLink = createdTenantId ? (
    <Link to="/tenant/$tenantId" params={{ tenantId: tenantSlug || createdTenantId }} />
  ) : null;

  return (
    <>
      <PageHeader
        title={live ? "Tenant is live" : allDone ? "Waiting for the DAO" : "Finish deploying"}
        subtitle={hostname}
        headerTestId="admin-tenant-deploy.heading"
      />

      <ol className="flex flex-col" data-testid="admin-tenant-deploy-steps">
        <TenantStep
          id="deploy-create"
          number={1}
          title="Create site, community and domain"
          status={status.create}
          summary="Records created"
        >
          {createStep?.error && (
            <p role="alert" className="text-sm break-all text-destructive">
              {createStep.error}
            </p>
          )}
        </TenantStep>

        <TenantStep
          id="deploy-publish"
          number={2}
          title="Publish settings through the DAO"
          status={status.publish}
          summary={daoAccountId ? `Submitted as ${daoAccountId}` : "Submitted"}
        >
          <div className="flex max-w-xl flex-col gap-4">
            {publishStep?.state === "pending" && (
              <>
                <ConnectDao purpose="tenant-deploy" />
                <Button
                  className="w-full sm:w-auto sm:self-start"
                  onClick={onSubmitPublish}
                  disabled={publishPending || !daoAccountId}
                  data-testid="admin-tenant-publish"
                >
                  Publish settings
                </Button>
              </>
            )}
            {publishStep?.state === "running" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                Waiting for the DAO wallet…
              </p>
            )}
            {publishStep?.state === "failed" && (
              <>
                {publishStep.error && (
                  <p role="alert" className="text-sm break-all text-destructive">
                    {publishStep.error}
                  </p>
                )}
                <Button
                  variant="outline"
                  className="w-full sm:w-auto sm:self-start"
                  onClick={onResetPublish}
                >
                  Retry publish
                </Button>
              </>
            )}
          </div>
        </TenantStep>

        <TenantStep
          id="deploy-live"
          number={3}
          title="Approve in Trezu"
          status={status.live}
          summary={`Live at ${hostname}`}
          last
        >
          <div className="flex max-w-xl flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Sign in to trezu.app as{" "}
              <span className="font-mono break-all text-foreground">{daoAccountId}</span> to
              approve, or wait for the council, then check again.
            </p>
            {verifyMessage && verifyState !== "verified" && (
              <p
                className="text-sm text-muted-foreground"
                data-testid="admin-tenant-verify-message"
              >
                {verifyMessage}
              </p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                onClick={onRecheck}
                disabled={verifyState === "checking"}
                data-testid="admin-tenant-recheck"
              >
                {verifyState === "checking" ? "Checking…" : "Check again"}
              </Button>
              <Button variant="ghost" onClick={onResetPublish}>
                Submit again
              </Button>
            </div>
          </div>
        </TenantStep>
      </ol>

      {live && tenantLink && (
        <div className="flex flex-col gap-4" data-testid="admin-tenant-live">
          <p className="text-base text-foreground">
            Tenant deployed at <span className="font-mono break-all">{hostname}</span>
          </p>
          <Button
            className="w-full sm:w-auto sm:self-start"
            nativeButton={false}
            render={tenantLink}
          >
            Open community settings
            <ArrowRightIcon />
          </Button>
        </div>
      )}

      {!live && tenantLink && status.create === "complete" && (
        <Button
          variant="ghost"
          className="w-full sm:w-auto sm:self-start"
          nativeButton={false}
          render={tenantLink}
        >
          Finish later in community settings
        </Button>
      )}
    </>
  );
}
