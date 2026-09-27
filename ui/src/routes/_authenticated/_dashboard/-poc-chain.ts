/**
 * Chain layer for the node lifecycle prototype.
 *
 * Every treasury action is described as a `DaoPlan` before it is signed. That
 * split matters because Trezu turns a DAO-signed call into a sputnik-dao
 * proposal: the same plan is used to stage the proposal, to match it against
 * the DAO's pending proposals, and to show the exact call in the UI.
 */

import { Amount, type FinalExecutionOutcome, Near } from "near-kit";
import { getDaoConnector, toNearKitWallet } from "@/lib/dao-connect";
import { type DaoPlan, getNear } from "@/lib/sputnik-proposals";

export { parseNearAmount } from "@/lib/near-amount";
export type {
  ApprovalThreshold,
  DaoPlan,
  SputnikFunctionCallAction,
  SputnikPolicy,
  SputnikProposal,
  SputnikRole,
} from "@/lib/sputnik-proposals";
export {
  ANY_RECEIVER,
  approvalThreshold,
  approverRoles,
  canAccountApprove,
  canAccountPropose,
  fetchDaoProposals,
  fetchSputnikPolicy,
  findPendingProposalForPlan,
  getNear,
  isPendingProposal,
  proposalMatchesPlan,
  roleMembers,
  waitFor,
} from "@/lib/sputnik-proposals";

export const VENEAR_ACCOUNT = "venear.dao";
export const VOTING_ACCOUNT = "vote.dao";
export const WHITELIST_ACCOUNT = "lockup-whitelist.near";

export const REGISTER_DEPOSIT = "100000000000000000000000";
export const LOCKUP_DEPLOY_DEPOSIT = "2000000000000000000000000";
export const DELEGATE_DEPOSIT = "100000000000000000000000";
export const VOTE_STORAGE_FEE_FALLBACK = "1250000000000000000000";
export const ONE_YOCTO = "1";
/** The team's direct stake only counts as skin in the game from 1 NEAR up. */
export const MIN_TEAM_STAKE_YOCTO = 10n ** 24n;

export const ACTIVE_VOTE_STATUSES = ["Voting", "Sandbox", "Created"];
export const VOTE_OPTIONS = ["For", "Against", "Abstain"] as const;
export type VoteOption = (typeof VOTE_OPTIONS)[number];

/* ---------------------------------------------------------------- formatting */

export function formatNear(yocto: string | undefined | null): string {
  if (!yocto) return "0 NEAR";
  try {
    const units = Number(BigInt(yocto) / 10n ** 20n) / 10000;
    if (!Number.isFinite(units)) return yocto;
    return `${units.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    })} NEAR`;
  } catch {
    return yocto;
  }
}

export function isPositive(yocto: string | undefined | null): boolean {
  if (!yocto) return false;
  try {
    return BigInt(yocto) > 0n;
  } catch {
    return false;
  }
}

/** True when the team's staked balance reaches the 1 NEAR minimum. */
export function meetsTeamStakeMinimum(yocto: string | undefined | null): boolean {
  return yoctoArg(yocto) >= MIN_TEAM_STAKE_YOCTO;
}

function balanceOf(value: string | undefined | null): bigint {
  try {
    return value ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}

export function yoctoArg(value: unknown): bigint {
  try {
    return value == null ? 0n : BigInt(String(value));
  } catch {
    return 0n;
  }
}

/**
 * Re-run math: steps must top up what is missing instead of re-sending the
 * full configured amount, so retrying a half-done station never double-funds.
 */
export function remainingToFund(
  fundingYocto: string,
  state: LockupState | null | undefined,
): bigint {
  const want = BigInt(fundingYocto);
  if (!state) return want;
  const have = balanceOf(state.liquid) + balanceOf(state.locked);
  return want > have ? want - have : 0n;
}

export function remainingToStake(
  stakeYocto: string,
  state: LockupState | null | undefined,
): bigint {
  const want = BigInt(stakeYocto);
  if (!state) return want;
  const staked = balanceOf(state.knownDeposited);
  return want > staked ? want - staked : 0n;
}

export function txHash(result: unknown): string | undefined {
  const hash = (result as { transaction?: { hash?: string } } | null)?.transaction?.hash;
  return hash ?? undefined;
}

export function nearblocksAccount(accountId: string): string {
  return `https://nearblocks.io/address/${accountId}`;
}

/** Sputnik treasuries read best on trezu.app; everything else on nearblocks. */
export function accountExplorerUrl(accountId: string): string {
  return accountId.endsWith(".sputnik-dao.near")
    ? `https://trezu.app/${accountId}`
    : nearblocksAccount(accountId);
}

export function poolValidatorUrl(poolAccountId: string): string {
  return `https://nodestats.nearcatalog.xyz/validators/${poolAccountId}`;
}

/** Renders a staking-pool fee fraction ("5/100") as a percent ("5%"). */
export function poolFeePercent(fee: string | undefined | null): string | null {
  if (!fee) return null;
  const [numerator, denominator] = fee.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return `${Math.round((numerator / denominator) * 10000) / 100}%`;
}

/* -------------------------------------------------------------- view models */

export interface PoolAccountView {
  account_id: string;
  unstaked_balance: string;
  staked_balance: string;
  can_withdraw: boolean;
}

export interface PoolMeta {
  owner: string | null;
  paused: boolean;
  fee: string;
  totalStaked: string;
}

export interface VenearBalanceView {
  near_balance: string;
  extra_venear_balance: string;
}

export interface VenearAccountView {
  account: {
    account_id: string;
    balance: VenearBalanceView;
    delegated_balance: VenearBalanceView;
    delegations: { account_id: string; bps: number }[];
  };
  internal: {
    lockup_version: number | null;
    deposit: string;
    lockup_update_nonce: number;
  };
}

export interface LockupState {
  owner: string | null;
  liquid: string;
  locked: string;
  stakingPool: string | null;
  knownDeposited: string;
}

export interface GovProposalView {
  id: number;
  title: string | null;
  description: string | null;
  status: string;
  flow: string;
}

export function sumVenear(balance: VenearBalanceView | undefined): string | null {
  if (!balance) return null;
  return (BigInt(balance.near_balance) + BigInt(balance.extra_venear_balance)).toString();
}

export async function fetchPoolMeta(pool: string): Promise<PoolMeta | null> {
  try {
    const [owner, paused, fee, totalStaked] = await Promise.all([
      getNear().view<string>(pool, "get_owner_id", {}),
      getNear().view<boolean>(pool, "is_staking_paused", {}),
      getNear().view<{ numerator: string; denominator: string }>(
        pool,
        "get_reward_fee_fraction",
        {},
      ),
      getNear().view<string>(pool, "get_total_staked_balance", {}),
    ]);
    return {
      owner: owner ?? null,
      paused: !!paused,
      fee: fee ? `${fee.numerator}/${fee.denominator}` : "—",
      totalStaked: totalStaked ?? "0",
    };
  } catch {
    return null;
  }
}

export async function fetchLockupState(lockup: string): Promise<LockupState | null> {
  if (!lockup) return null;
  try {
    const [owner, liquid, locked, stakingPool, knownDeposited] = await Promise.all([
      getNear().view<string>(lockup, "get_owner_account_id", {}),
      getNear().view<string>(lockup, "get_venear_liquid_balance", {}),
      getNear().view<string>(lockup, "get_venear_locked_balance", {}),
      getNear().view<string | null>(lockup, "get_staking_pool_account_id", {}),
      getNear().view<string>(lockup, "get_known_deposited_balance", {}),
    ]);
    return {
      owner: owner ?? null,
      liquid: liquid ?? "0",
      locked: locked ?? "0",
      stakingPool: stakingPool ?? null,
      knownDeposited: knownDeposited ?? "0",
    };
  } catch {
    return null;
  }
}

export function fetchVenearAccount(accountId: string) {
  return getNear().view<VenearAccountView | null>(VENEAR_ACCOUNT, "get_account_info", {
    account_id: accountId,
  });
}

export function fetchLockupAccountId(accountId: string) {
  return getNear().view<string>(VENEAR_ACCOUNT, "get_lockup_account_id", {
    account_id: accountId,
  });
}

/** The deposit `vote.dao.vote` expects — `vote_storage_fee` from its config. */
export async function fetchVoteStorageFee(): Promise<string> {
  const config = await getNear()
    .view<{ vote_storage_fee?: string }>(VOTING_ACCOUNT, "get_config", {})
    .catch(() => null);
  return config?.vote_storage_fee ?? VOTE_STORAGE_FEE_FALLBACK;
}

/** Raw liquid balance of an account in yoctoNEAR, or null when unreadable. */
export async function fetchAccountBalance(accountId: string): Promise<string | null> {
  if (!accountId) return null;
  try {
    const response = await fetch("https://rpc.mainnet.near.org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "poc-balance",
        method: "query",
        params: {
          request_type: "view_account",
          account_id: accountId,
          finality: "optimistic",
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { result?: { amount?: string } };
    return body.result?.amount ?? null;
  } catch {
    return null;
  }
}

export async function fetchActiveGovProposals(): Promise<GovProposalView[]> {
  const all = await getNear().view<GovProposalView[]>(VOTING_ACCOUNT, "get_proposals", {
    from_index: 0,
    limit: 100,
  });
  return (all ?? []).filter((proposal) => ACTIVE_VOTE_STATUSES.includes(proposal.status));
}

/* ----------------------------------------------------------------- dao plans */

export function describePlan(plan: DaoPlan): string {
  if (plan.kind === "transfer") {
    return `transfer ${formatNear(plan.amountYocto)} to ${plan.receiverId}`;
  }
  return `${plan.receiverId}.${plan.methodName}()`;
}

/* -------------------------------------------------------------------- signing */

function daoNear(): Near {
  return new Near({
    network: "mainnet",
    wallet: toNearKitWallet(getDaoConnector()),
  });
}

/**
 * Signs a plan as the connected DAO. With a multi-member threshold this creates
 * a pending sputnik proposal rather than executing immediately.
 */
export async function signPlanAsDao(
  daoAccountId: string,
  plan: DaoPlan,
): Promise<FinalExecutionOutcome> {
  if (plan.kind === "transfer") {
    return daoNear()
      .transaction(daoAccountId)
      .transfer(plan.receiverId, Amount.yocto(BigInt(plan.amountYocto)))
      .send({ waitUntil: "EXECUTED" });
  }
  return daoNear()
    .transaction(daoAccountId)
    .functionCall(plan.receiverId, plan.methodName, plan.args as Record<string, never>, {
      gas: plan.gas as `${number} Tgas`,
      attachedDeposit: plan.attachedDeposit
        ? Amount.yocto(BigInt(plan.attachedDeposit))
        : Amount.ZERO,
    })
    .send({ waitUntil: "EXECUTED" });
}

/* ------------------------------------------------- proposal staging (no connect) */

function gasToRaw(gas: string): string {
  const match = gas.match(/([\d.]+)\s*Tgas/);
  if (!match) return gas.replace(/\D/g, "") || "0";
  return BigInt(Math.round(Number(match[1]) * 1e12)).toString();
}

/**
 * Sputnik `add_proposal` args carrying the plan as a proposal — the session
 * wallet can stage treasury actions on a DAO it may propose to, without the
 * DAO's own wallet connection.
 */
export function buildAddProposalArgs(plan: DaoPlan, description: string) {
  const kind =
    plan.kind === "transfer"
      ? { Transfer: { token_id: "", receiver_id: plan.receiverId, amount: plan.amountYocto } }
      : {
          FunctionCall: {
            receiver_id: plan.receiverId,
            actions: [
              {
                method_name: plan.methodName,
                args: btoa(JSON.stringify(plan.args)),
                deposit: plan.attachedDeposit ?? "0",
                gas: gasToRaw(plan.gas),
              },
            ],
          },
        };
  return { proposal: { description, kind } };
}

async function fetchProposalBond(daoAccountId: string): Promise<string> {
  const policy = await getNear()
    .view<{ proposal_bond?: string }>(daoAccountId, "get_policy", {})
    .catch(() => null);
  return policy?.proposal_bond ?? "0";
}

/** Stages the plan as a proposal on the DAO, signed by the session wallet. */
export async function proposeAsSession(
  wallet: SessionWallet,
  daoAccountId: string,
  plan: DaoPlan,
  description: string,
): Promise<FinalExecutionOutcome> {
  const connected = await wallet.ensureConnected();
  const accountId = wallet.getAccountId();
  if (!connected || !accountId) throw new Error("Connect your NEAR wallet first");
  const bond = await fetchProposalBond(daoAccountId);
  return wallet
    .getNearClient()
    .transaction(accountId)
    .functionCall(
      daoAccountId,
      "add_proposal",
      buildAddProposalArgs(plan, description) as unknown as Record<string, never>,
      {
        gas: "100 Tgas",
        attachedDeposit: bond ? Amount.yocto(BigInt(bond)) : Amount.ZERO,
      },
    )
    .send({ waitUntil: "EXECUTED" });
}

export interface SessionSigner {
  accountId: string;
  send(plan: Extract<DaoPlan, { kind: "call" }>): Promise<FinalExecutionOutcome>;
}

/** The wallet surface the session-account actions need, satisfied by the auth client. */
export interface SessionWallet {
  ensureConnected(): Promise<boolean>;
  getAccountId(): string | null;
  getNearClient(): Near;
}

/** Sends NEAR straight from the session wallet — the admin funding the treasury. */
export async function transferFromSessionWallet(
  wallet: SessionWallet,
  receiverId: string,
  amountYocto: bigint,
): Promise<FinalExecutionOutcome> {
  const connected = await wallet.ensureConnected();
  const accountId = wallet.getAccountId();
  if (!connected || !accountId) throw new Error("Connect your NEAR wallet first");
  return wallet
    .getNearClient()
    .transaction(accountId)
    .transfer(receiverId, Amount.yocto(amountYocto))
    .send({ waitUntil: "EXECUTED" });
}

/** Votes on a pending DAO proposal as a policy member, signed by the session wallet. */
export function approveProposalPlan(
  daoAccountId: string,
  proposalId: number,
): Extract<DaoPlan, { kind: "call" }> {
  return {
    kind: "call",
    receiverId: daoAccountId,
    methodName: "act_proposal",
    args: { id: proposalId, action: "VoteApprove" },
    gas: "200 Tgas",
  };
}

export function fetchGovVoteRecord(accountId: string, proposalId: number) {
  return getNear().view<number | null>(VOTING_ACCOUNT, "get_vote", {
    account_id: accountId,
    proposal_id: proposalId,
  });
}

export function fetchGovProof(accountId: string) {
  return getNear().view<[unknown, unknown]>(VENEAR_ACCOUNT, "get_proof", {
    account_id: accountId,
  });
}
