import type { DaoPlan, PoolAccountView } from "./-poc-chain";
import {
  fetchLockupState,
  fetchVenearAccount,
  formatNear,
  getNear,
  isPositive,
  remainingToFund,
  remainingToStake,
  yoctoArg,
} from "./-poc-chain";
import type { SignerKind, StationState, StepState } from "./-poc-stations";

export interface PrecheckContext {
  pool: string;
  teamLockup: string;
  endowmentLockup: string;
  accountFor: (signer: SignerKind) => string | null;
  log: (label: string, detail?: string) => void;
  fetchPublishedNow: () => Promise<unknown>;
  fetchTeamPoolAccount: () => Promise<PoolAccountView | null | undefined>;
}

/**
 * Re-checks a step against fresh chain state right before signing. Returns
 * the plan to sign (possibly narrowed to the remaining amount), or null when
 * the step is already done and must be skipped instead of re-signed.
 */
export function createPrecheckPlan(ctx: PrecheckContext) {
  const {
    pool,
    teamLockup,
    endowmentLockup,
    accountFor,
    log,
    fetchPublishedNow,
    fetchTeamPoolAccount,
  } = ctx;
  return async (station: StationState, step: StepState): Promise<DaoPlan | null> => {
    const plan = step.plan;
    if (!plan) return null;
    if (plan.kind === "transfer") {
      if (step.id !== "fund-lockup") return plan;
      if (!endowmentLockup) {
        throw new Error("resolving the endowment lockup — run again in a moment");
      }
      const state = await fetchLockupState(endowmentLockup).catch(() => null);
      if (!state) return plan;
      const remaining = remainingToFund(plan.amountYocto, state);
      if (remaining <= 0n) {
        log("lockup already funded — skipping");
        return null;
      }
      if (remaining < BigInt(plan.amountYocto)) {
        log(`topping up ${formatNear(remaining.toString())} — part of it is already there`);
      }
      return { kind: "transfer", receiverId: plan.receiverId, amountYocto: remaining.toString() };
    }
    if (plan.kind !== "call") return plan;
    const signerLockup = station.def.signer === "endowment" ? endowmentLockup : teamLockup;
    switch (step.id) {
      case "publish": {
        const live = await fetchPublishedNow();
        if (live) {
          log("config already live — skipping");
          return null;
        }
        return plan;
      }
      case "register":
      case "register-endowment": {
        const account = accountFor(station.def.signer) ?? "";
        const ve = await fetchVenearAccount(account).catch(() => null);
        if (ve) {
          log("already registered in veNEAR — skipping");
          return null;
        }
        return plan;
      }
      case "deploy-lockup":
      case "deploy-lockup-endowment": {
        if (!signerLockup) {
          throw new Error("resolving the lockup — run again in a moment");
        }
        const state = await fetchLockupState(signerLockup).catch(() => null);
        if (state) {
          log("lockup already deployed — skipping");
          return null;
        }
        return plan;
      }
      case "lock":
      case "lock-endowment": {
        if (!signerLockup) {
          throw new Error("resolving the lockup — run again in a moment");
        }
        const state = await fetchLockupState(signerLockup).catch(() => null);
        if (!state) throw new Error("the lockup is not deployed yet — deploy it first");
        if (isPositive(state.liquid)) return plan;
        if (isPositive(state.locked)) {
          log("already locked — skipping");
          return null;
        }
        throw new Error("nothing in the lockup to lock yet — fund it first");
      }
      case "stake": {
        const want = yoctoArg(plan.attachedDeposit);
        if (want <= 0n) return plan;
        const current = await fetchTeamPoolAccount();
        if (!current) return plan;
        const staked = yoctoArg(current.staked_balance);
        const remaining = want > staked ? want - staked : 0n;
        if (remaining <= 0n) {
          log("team already staked at least 1 NEAR — skipping");
          return null;
        }
        return { ...plan, attachedDeposit: remaining.toString() };
      }
      case "select-pool": {
        if (!endowmentLockup) {
          throw new Error("resolving the endowment lockup — run again in a moment");
        }
        const state = await fetchLockupState(endowmentLockup).catch(() => null);
        if (state?.stakingPool && state.stakingPool === String(plan.args.staking_pool_account_id)) {
          log("pool already selected — skipping");
          return null;
        }
        return plan;
      }
      case "unselect-old-pool": {
        if (!endowmentLockup) {
          throw new Error("resolving the endowment lockup — run again in a moment");
        }
        const state = await fetchLockupState(endowmentLockup).catch(() => null);
        if (!state?.stakingPool) {
          log("no pool selected — skipping");
          return null;
        }
        if (state.stakingPool === pool) {
          log("the lockup already points at the node's pool — skipping");
          return null;
        }
        if (isPositive(state.knownDeposited)) {
          throw new Error("unstake first — the pool still holds a deposit");
        }
        return plan;
      }
      case "stake-endowment": {
        if (!endowmentLockup) {
          throw new Error("resolving the endowment lockup — run again in a moment");
        }
        const want = yoctoArg(plan.args.amount);
        if (want <= 0n) return plan;
        const state = await fetchLockupState(endowmentLockup).catch(() => null);
        if (!state) return plan;
        const remaining = remainingToStake(want.toString(), state);
        if (remaining <= 0n) {
          log("already staked from the lockup — skipping");
          return null;
        }
        return { ...plan, args: { ...plan.args, amount: remaining.toString() } };
      }
      case "set-delegations": {
        const entries = plan.args.entries as { account_id: string; bps: number }[] | undefined;
        if (!entries) return plan;
        const ve = await fetchVenearAccount(accountFor("endowment") ?? "").catch(() => null);
        if (
          ve &&
          ve.account.delegations.length === entries.length &&
          entries.every((entry) =>
            ve.account.delegations.some(
              (delegation) =>
                delegation.account_id === entry.account_id && delegation.bps === entry.bps,
            ),
          )
        ) {
          log("delegation already set — skipping");
          return null;
        }
        return plan;
      }
      case "unstake-all": {
        const current = await fetchTeamPoolAccount();
        if (!current || !isPositive(current.staked_balance)) {
          log("nothing staked by the team — skipping");
          return null;
        }
        return plan;
      }
      case "withdraw": {
        const current = await fetchTeamPoolAccount();
        if (!current || !isPositive(current.unstaked_balance)) {
          log("nothing for the team to withdraw — skipping");
          return null;
        }
        if (!current.can_withdraw) {
          throw new Error(
            "unstaked balance is still locked in the epoch window — run again in a couple of days",
          );
        }
        return plan;
      }
      case "unstake-endowment": {
        if (!endowmentLockup) {
          throw new Error("resolving the endowment lockup — run again in a moment");
        }
        const state = await fetchLockupState(endowmentLockup).catch(() => null);
        if (state && !isPositive(state.knownDeposited)) {
          log("nothing staked — skipping");
          return null;
        }
        return plan;
      }
      case "withdraw-endowment": {
        if (!endowmentLockup) {
          throw new Error("resolving the endowment lockup — run again in a moment");
        }
        const state = await fetchLockupState(endowmentLockup).catch(() => null);
        if (!state?.stakingPool) {
          log("no pool selected — skipping");
          return null;
        }
        const staked = await getNear()
          .view<PoolAccountView>(state.stakingPool, "get_account", { account_id: endowmentLockup })
          .catch(() => null);
        if (!staked || !isPositive(staked.unstaked_balance)) {
          log("nothing to withdraw — skipping");
          return null;
        }
        if (!staked.can_withdraw) {
          throw new Error(
            "unstaked balance is still locked in the epoch window — run again in a couple of days",
          );
        }
        return plan;
      }
      case "unselect-pool": {
        if (!endowmentLockup) {
          throw new Error("resolving the endowment lockup — run again in a moment");
        }
        const state = await fetchLockupState(endowmentLockup).catch(() => null);
        if (!state?.stakingPool) {
          log("pool already released — skipping");
          return null;
        }
        if (isPositive(state.knownDeposited)) {
          throw new Error("unstake first — the pool still holds a deposit");
        }
        return plan;
      }
      case "clear-delegations": {
        const ve = await fetchVenearAccount(accountFor("endowment") ?? "").catch(() => null);
        if (ve && ve.account.delegations.length === 0) {
          log("no delegations — skipping");
          return null;
        }
        return plan;
      }
      default:
        return plan;
    }
  };
}
