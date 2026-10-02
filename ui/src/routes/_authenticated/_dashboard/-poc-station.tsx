import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  PlayIcon,
  ProhibitIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Badge, Button, InfoPopover } from "@/components";
import { Spinner } from "@/components/ui/spinner";
import { approvalThreshold, describePlan, type SputnikProposal } from "./-poc-chain";
import {
  type LensId,
  SIGNER_LABEL,
  type StationState,
  type StepStatus,
  signerLens,
} from "./-poc-stations";

type BadgeVariant = "success" | "warning" | "destructive" | "secondary" | "outline";

export function stationStatusMeta(
  status: StationState["status"],
  hasPendingSteps: boolean,
): { label: string; variant: BadgeVariant; id: string } {
  switch (status) {
    case "done":
      return { label: "Done", variant: "success", id: "done" };
    case "staged":
      return hasPendingSteps
        ? { label: "Pending", variant: "warning", id: "pending" }
        : { label: "Awaiting votes", variant: "warning", id: "awaiting-votes" };
    case "failed":
      return { label: "Failed", variant: "destructive", id: "failed" };
    case "blocked":
      return { label: "Blocked", variant: "secondary", id: "blocked" };
    case "running":
      return { label: "Running", variant: "secondary", id: "running" };
    case "skipped":
      return { label: "Skipped", variant: "outline", id: "skipped" };
    default:
      return { label: "Ready", variant: "outline", id: "ready" };
  }
}

export function StationStatusBadge({ station }: { station: StationState }) {
  const meta = stationStatusMeta(
    station.status,
    station.steps.some((step) => step.status === "pending"),
  );
  return (
    <Badge variant={meta.variant} data-testid={`poc-status-${meta.id}`}>
      {meta.label}
    </Badge>
  );
}

export function StationIcon({ status }: { status: StationState["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircleIcon className="size-5 shrink-0 text-success" weight="fill" />;
    case "running":
      return <Spinner className="size-5 shrink-0" />;
    case "staged":
      return <CircleDashedIcon className="size-5 shrink-0 text-warning" />;
    case "failed":
      return <XCircleIcon className="size-5 shrink-0 text-destructive" weight="fill" />;
    case "skipped":
      return <ProhibitIcon className="size-5 shrink-0 text-muted-foreground" />;
    default:
      return <CircleIcon className="size-5 shrink-0 text-muted-foreground" />;
  }
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return <CheckCircleIcon className="size-4 shrink-0 text-success" weight="fill" />;
    case "staged":
      return <CircleDashedIcon className="size-4 shrink-0 text-warning" />;
    case "skipped":
      return <ProhibitIcon className="size-4 shrink-0 text-muted-foreground" />;
    default:
      return <CircleIcon className="size-4 shrink-0 text-muted-foreground" />;
  }
}

export const signerName = (station: StationState) =>
  station.def.signer === "session" ? "you" : SIGNER_LABEL[station.def.signer];

export function StationListRow({
  station,
  active,
  dimmed,
  onSelect,
}: {
  station: StationState;
  active: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const { def, status } = station;
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      className="h-auto w-full justify-start text-left"
      onClick={onSelect}
      aria-current={active ? "step" : undefined}
      data-testid={`poc-station-${def.id}`}
      data-status={status}
    >
      <span className={cn("flex min-w-0 flex-1 items-center gap-3 py-2.5", dimmed && "opacity-60")}>
        <StationIcon status={status} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{def.title}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {signerName(station)} · {stationStatusMeta(status, false).label.toLowerCase()}
          </span>
        </span>
      </span>
    </Button>
  );
}

export function StationPanel({
  station,
  lens,
  busy,
  policy,
  warning,
  membersHref,
  next,
  extra,
  onRun,
  onConnect,
  onApprove,
  onLens,
  onNext,
}: {
  station: StationState;
  lens: LensId;
  busy: boolean;
  policy: Parameters<typeof approvalThreshold>[0];
  warning?: string | null;
  membersHref?: string | null;
  next: StationState | null;
  extra?: ReactNode;
  onRun: () => void;
  onConnect: () => void;
  onApprove: (proposalId: number) => void;
  onLens: (lens: LensId) => void;
  onNext: (station: StationState) => void;
}) {
  const { def, status } = station;
  const settled = status === "done" || status === "skipped";
  const stationLens = signerLens(def.signer);
  const otherLens = stationLens !== lens;
  const stagedSteps = station.steps.filter((step) => step.pendingProposal);
  const reason = settled
    ? station.skipReason
    : (station.blockedReason ?? (station.canRun ? null : station.runBlockReason));

  const primary = settled ? (
    next ? (
      <Button onClick={() => onNext(next)} data-testid="poc-next-station">
        Next: {next.def.title}
        <ArrowRightIcon />
      </Button>
    ) : null
  ) : otherLens ? (
    <Button variant="outline" onClick={() => onLens(stationLens)} data-testid="poc-switch-lens">
      Act as {stationLens}
    </Button>
  ) : !station.signerConnected ? (
    <Button onClick={onConnect} disabled={busy} data-testid="poc-connect-signer">
      Connect {def.signer === "endowment" ? "endowment" : "team"}
    </Button>
  ) : (
    <Button
      onClick={onRun}
      disabled={!station.canRun || busy}
      title={station.runBlockReason ?? undefined}
      data-testid={`poc-run-${def.id}`}
    >
      {status === "running" ? <Spinner /> : <PlayIcon />}
      {status === "running" ? "Running…" : "Run"}
    </Button>
  );

  return (
    <div
      className="flex flex-col gap-6 rounded-3xl border border-border bg-card p-5 sm:p-6"
      data-testid={`poc-panel-${def.id}`}
      data-status={status}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Station {def.index}</span>
          <StationStatusBadge station={station} />
          {warning && (
            <InfoPopover
              icon={<WarningIcon className="text-warning" />}
              title="Platform audit seat"
              body={warning}
              links={membersHref ? [{ label: "Add members on Trezu", href: membersHref }] : []}
              testId={`poc-warning-${def.id}`}
            />
          )}
        </div>
        <h3 className="text-2xl font-semibold text-foreground">{def.title}</h3>
        <p className="max-w-2xl text-base text-muted-foreground">{def.purpose}</p>
        <p className="text-sm text-muted-foreground">
          Signed by <span className="font-medium text-foreground">{signerName(station)}</span>
          {station.signerAccountId ? (
            <span className="font-mono break-all"> · {station.signerAccountId}</span>
          ) : null}
        </p>
      </div>

      <ol className="flex flex-col gap-2" data-testid={`poc-steps-${def.id}`}>
        {station.steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3">
            <span className="mt-0.5">
              <StepIcon status={step.status} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm text-foreground">{step.label}</span>
              <span className="font-mono text-xs break-all text-muted-foreground">
                {step.plan ? describePlan(step.plan) : "off-chain"}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {extra}

      {stagedSteps.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Awaiting votes</span>
          {stagedSteps.map((step) => {
            const proposal = step.pendingProposal as SputnikProposal;
            const threshold = approvalThreshold(policy, proposal);
            const alreadyVoted = station.signerAccountId
              ? !!proposal.votes[station.signerAccountId]
              : false;
            return (
              <div
                key={step.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3"
                data-testid={`poc-staged-${def.id}-${step.id}`}
              >
                <span className="min-w-0 text-sm text-foreground">
                  <span className="font-mono">#{proposal.id}</span> {step.label}
                  <span className="text-muted-foreground">
                    {" "}
                    · {threshold.approved}
                    {threshold.required == null ? "" : `/${threshold.required}`} approvals
                  </span>
                </span>
                {!otherLens && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onApprove(proposal.id)}
                    disabled={busy || !station.signerConnected || alreadyVoted}
                    data-testid={`poc-approve-${proposal.id}`}
                  >
                    {alreadyVoted
                      ? "Voted"
                      : station.signerConnected
                        ? "Approve"
                        : "Connect to approve"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-5">
        {reason && (
          <p
            className={cn(
              "text-sm",
              status === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
            data-testid={`poc-reason-${def.id}`}
          >
            {reason}
            {reason.includes("is not a member of") && membersHref && (
              <>
                {" · "}
                <a
                  href={membersHref}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Add members on Trezu
                </a>
              </>
            )}
          </p>
        )}
        {!reason && !settled && otherLens && (
          <p className="text-sm text-muted-foreground">
            This station is signed by {signerName(station)}.
          </p>
        )}
        {primary && <div className="flex flex-wrap items-center gap-3">{primary}</div>}
      </div>
    </div>
  );
}
