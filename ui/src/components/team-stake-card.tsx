import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { describeDaoError, useDaoAutoRestore, useDaoConnection } from "@/lib/dao-connect";
import {
  formatNearBalance,
  invalidateStakePoolQueries,
  type StakePoolAccountView,
  stakePoolAccountQueryOptions,
  type TeamStakeTarget,
} from "@/lib/queries/stake-pool";
import { parseUnstakeAmount, proposeTeamPoolAction, yoctoToNearInput } from "@/lib/team-unstake";
import { useNearAccount } from "@/lib/use-near-account";

type PoolPhase = "unstake" | "pending-release" | "withdraw";
type PoolMethod = "unstake" | "withdraw";

const PHASE_METHOD: Record<PoolPhase, PoolMethod> = {
  unstake: "unstake",
  "pending-release": "unstake",
  withdraw: "withdraw",
};

const BUTTON_LABEL: Record<PoolMethod, string> = {
  unstake: "Propose unstake",
  withdraw: "Propose withdraw",
};

const DIALOG_TITLE: Record<PoolMethod, string> = {
  unstake: "Propose unstake",
  withdraw: "Propose withdraw",
};

function maxBalanceOf(method: PoolMethod, accountView: StakePoolAccountView | undefined) {
  return method === "unstake"
    ? (accountView?.stakedBalance ?? 0n)
    : (accountView?.unstakedBalance ?? 0n);
}

export function TeamStakeCard({
  target,
  pending = false,
}: {
  target: TeamStakeTarget | null;
  pending?: boolean;
}) {
  const queryClient = useQueryClient();
  const authClient = useAuthClient();
  const authAccountId = useNearAccount();
  const connection = useDaoConnection();
  useDaoAutoRestore(authAccountId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const account = useQuery(
    stakePoolAccountQueryOptions({
      poolAccountId: target?.poolAccountId ?? "",
      stakerAccountId: target?.teamAccountId ?? "",
      authClient,
      network: target?.network,
      protocol: target?.protocol,
    }),
  );
  const accountView = account.isError ? undefined : account.data;
  const loading = pending || (!!target && account.isLoading);
  const phase: PoolPhase | null = !accountView
    ? null
    : accountView.canWithdraw && accountView.unstakedBalance > 0n
      ? "withdraw"
      : accountView.stakedBalance > 0n
        ? "unstake"
        : accountView.unstakedBalance > 0n
          ? "pending-release"
          : null;
  const method: PoolMethod | null = phase ? PHASE_METHOD[phase] : null;
  const actionReady = !!target && !!phase && phase !== "pending-release";

  const balanceLabel = method === "withdraw" || phase === "pending-release" ? "Unstaked" : "Staked";

  return (
    <section className="flex flex-col gap-4" data-testid="dashboard-node.team-stake">
      <SectionHeader
        title="Team stake"
        description={
          target ? (
            <>
              <span className="font-mono break-all">{target.teamAccountId}</span> in{" "}
              <span className="font-mono break-all">{target.poolAccountId}</span>
            </>
          ) : undefined
        }
        action={
          target ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="dashboard-node.team-stake-unstake"
              disabled={!actionReady}
              onClick={() => setDialogOpen(true)}
            >
              {method ? BUTTON_LABEL[method] : BUTTON_LABEL.unstake}
            </Button>
          ) : null
        }
      />
      {target ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{balanceLabel}</span>
          <div
            data-testid="dashboard-node.team-stake-amount"
            className="text-3xl font-semibold tabular-nums wrap-anywhere text-foreground sm:text-4xl"
          >
            {loading ? (
              <Skeleton aria-label="Loading team stake" className="h-10 w-40" />
            ) : accountView ? (
              formatNearBalance(
                method === "withdraw" || phase === "pending-release"
                  ? accountView.unstakedBalance
                  : accountView.stakedBalance,
              )
            ) : (
              "—"
            )}
          </div>
          {phase === "pending-release" && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="dashboard-node.team-stake-pending-release"
            >
              Unlocks for withdrawal after about 2 days.
            </p>
          )}
          {phase === "unstake" && accountView && accountView.unstakedBalance > 0n && (
            <p className="text-sm text-muted-foreground">
              {accountView.canWithdraw ? "Ready to withdraw: " : "Unlocking: "}
              <span className="font-mono text-foreground">
                {formatNearBalance(accountView.unstakedBalance)}
              </span>
            </p>
          )}
          <PoolActionDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            accountView={accountView ?? null}
            method={method}
            pending={connection.status === "connecting"}
            onPropose={async (selected, amountYocto) => {
              try {
                await proposeTeamPoolAction({
                  teamAccountId: target.teamAccountId,
                  poolAccountId: target.poolAccountId,
                  method: selected,
                  amountYocto,
                  maxAmountYocto: maxBalanceOf(selected, accountView),
                  authAccountId,
                  connection,
                });
                toast.success(selected === "unstake" ? "Unstake proposed" : "Withdraw proposed", {
                  description:
                    selected === "unstake"
                      ? `Withdraw to ${target.teamAccountId} in about 2 days.`
                      : `Returns the NEAR to ${target.teamAccountId}.`,
                });
                setDialogOpen(false);
                await invalidateStakePoolQueries(queryClient, target.poolAccountId, target.network);
              } catch (error) {
                toast.error(describeDaoError(error, target.teamAccountId));
              }
            }}
          />
        </div>
      ) : loading ? (
        <Skeleton aria-label="Loading team stake" className="h-10 w-40" />
      ) : (
        <p className="text-sm text-muted-foreground">Link a team treasury to see its stake here.</p>
      )}
    </section>
  );
}

function PoolActionDialog({
  open,
  onOpenChange,
  accountView,
  method,
  pending,
  onPropose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountView: StakePoolAccountView | null;
  method: PoolMethod | null;
  pending: boolean;
  onPropose: (method: PoolMethod, amountYocto: bigint) => Promise<void>;
}) {
  const action: PoolMethod = method ?? "unstake";
  const max = maxBalanceOf(action, accountView ?? undefined);
  const [amount, setAmount] = useState("");
  const parsed = parseUnstakeAmount(amount, max);
  useEffect(() => {
    if (open) setAmount(yoctoToNearInput(max));
  }, [open, max]);
  const propose = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error(`Enter an amount within the available team ${action} balance.`);
      await onPropose(action, parsed);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{DIALOG_TITLE[action]}</DialogTitle>
          <DialogDescription>
            {action === "withdraw"
              ? "Creates a treasury proposal to move unstaked NEAR back to the team."
              : "Creates a treasury proposal. Rewards are already included; the NEAR unlocks after about 2 days."}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="team-pool-action-amount">Amount (NEAR)</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="team-pool-action-amount"
              data-testid="dashboard-node.team-stake-unstake-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton onClick={() => setAmount(yoctoToNearInput(max))}>
                Max
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            data-testid="dashboard-node.team-stake-unstake-confirm"
            disabled={!parsed || pending || propose.isPending}
            onClick={() => propose.mutate()}
          >
            {pending || propose.isPending ? "Proposing…" : BUTTON_LABEL[action]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
