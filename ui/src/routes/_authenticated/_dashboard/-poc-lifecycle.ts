import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildRegistryConfigUrl } from "everything-dev/fastkv";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { buildTenantUrl, getAccount, getGatewayId, useApiClient, useAuthClient } from "@/app";
import {
  describeDaoError,
  isExplicitDaoMember,
  useDaoAutoRestore,
  useDaoConnection,
  verifyDaoAccount,
} from "@/lib/dao-connect";
import { organizationsQueryOptions } from "@/lib/queries/organizations";
import { generateSlug } from "@/lib/slug";
import { useNearAccount } from "@/lib/use-near-account";
import { parseNodeProposalPayload } from "./-node-application";
import {
  approveProposalPlan,
  canAccountPropose,
  fetchAccountBalance,
  fetchActiveGovProposals,
  fetchDaoProposals,
  fetchGovVoteRecord,
  fetchLockupAccountId,
  fetchLockupState,
  fetchPoolMeta,
  fetchSputnikPolicy,
  fetchVenearAccount,
  fetchVoteStorageFee,
  getNear,
  isPositive,
  LOCKUP_DEPLOY_DEPOSIT,
  lockupAvailableYocto,
  meetsTeamStakeMinimum,
  type PoolAccountView,
  parseNearAmount,
  signPlanAsDao,
  txHash,
  WHITELIST_ACCOUNT,
  yoctoArg,
} from "./-poc-chain";
import { buildPocFormValues, prefillIfEmpty, usePocForm, usePocFormValues } from "./-poc-form";
import { createPrecheckPlan } from "./-poc-precheck";
import { createStepRunner } from "./-poc-run-step";
import {
  buildStations,
  type ChainFacts,
  deriveStations,
  nextStation,
  pendingProposalCount,
  runnableRun,
  type SignerKind,
  type StationId,
  type StationState,
  teamTreasuryRequirementYocto,
} from "./-poc-stations";

const REFETCH_MS = 15_000;
export const TREZU_CREATE_URL = "https://trezu.app/create";
export const HOS_URL = "https://gov.houseofstake.org";
export const POOL_PLACEHOLDER = "everything.pool.near";
const TREASURY_FUND_FLOOR_YOCTO = 4n * 10n ** 24n;
const TREASURY_FUND_BUFFER_YOCTO = 10n ** 24n;
export const hosDelegateUrl = (accountId: string) => `${HOS_URL}/delegates/${accountId}`;

export interface LogEntry {
  id: string;
  at: number;
  label: string;
  detail?: string;
}

/** "near builders" → "Near Builders" — the default node name from the org name. */
const titleCase = (value: string) =>
  value.replace(/(^|[\s-])[a-z]/g, (match) => match.toUpperCase());

type RuntimeConfig = Parameters<typeof getAccount>[0];

export interface PocRouteAuth {
  activeOrganizationId: string | null;
  isAdmin: boolean;
}

/** Every query, derived fact, and signed action behind the node lifecycle walkthrough. */
export function usePocLifecycle(routeAuth: PocRouteAuth, runtimeConfig: RuntimeConfig) {
  const sessionAccount = useNearAccount();
  useDaoAutoRestore(sessionAccount);
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const connection = useDaoConnection();
  const queryClient = useQueryClient();

  const gatewayId = getGatewayId(runtimeConfig);
  const baseAccount = getAccount(runtimeConfig);
  const activeOrgId = routeAuth.activeOrganizationId;
  const isAdmin = routeAuth.isAdmin;

  const initialFormValues = useMemo(() => buildPocFormValues(activeOrgId), [activeOrgId]);
  const form = usePocForm(activeOrgId, initialFormValues);
  const values = usePocFormValues(form);

  const [connectedTeamDao, setConnectedTeamDao] = useState<string | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [runningStation, setRunningStation] = useState<StationId | null>(null);
  const [failures, setFailures] = useState<Partial<Record<StationId, string>>>({});

  const log = (label: string, detail?: string) => {
    setEntries((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random()}`,
          at: Date.now(),
          label,
          detail,
        },
        ...prev,
      ].slice(0, 40),
    );
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["poc"] });

  /* ------------------------------------------------------------------ queries */

  const { data: organizations = [] } = useQuery(organizationsQueryOptions(apiClient));

  const activeOrg = organizations.find((org) => org.id === activeOrgId);
  const activeOrgName = activeOrg?.name ?? null;
  /** An org can override the name its node gets with `metadata.name`. */
  const orgNamePrefill = (() => {
    const override = activeOrg?.metadata?.name;
    if (typeof override === "string" && override.trim()) return override.trim();
    return activeOrgName ? titleCase(activeOrgName) : null;
  })();

  const lastOrgId = useRef<string | null>(null);
  const lastPrefillKey = useRef<string | null>(null);
  useEffect(() => {
    const prefillKey = `${activeOrgId ?? ""}:${orgNamePrefill ?? ""}`;
    if (activeOrgId === lastOrgId.current && prefillKey === lastPrefillKey.current) return;
    const orgChanged = lastOrgId.current !== activeOrgId;
    lastOrgId.current = activeOrgId;
    lastPrefillKey.current = prefillKey;
    if (orgChanged) {
      setFailures({});
      setConnectedTeamDao(null);
    }
    form.reset(buildPocFormValues(activeOrgId, orgNamePrefill ? { name: orgNamePrefill } : {}));
  }, [activeOrgId, orgNamePrefill, form]);

  const poc = <T>(key: readonly unknown[], queryFn: () => Promise<T>, enabled = true) =>
    ({ queryKey: ["poc", ...key], queryFn, enabled, refetchInterval: REFETCH_MS }) as const;

  /** Org-linked DAO wins; the application payload keeps it stable once proposed. */
  const { data: orgDao } = useQuery(
    poc(
      ["org-dao", activeOrgId],
      () => apiClient.auth.getDao({ organizationId: activeOrgId ?? "" }).catch(() => null),
      !!activeOrgId,
    ),
  );
  const orgDaoAccountId = orgDao?.daoAccountId ?? null;

  /** The node slug is pinned to the organization; the node name is the custom part. */
  const slug = generateSlug(activeOrg?.slug ?? "");

  const { data: application } = useQuery(
    poc(
      ["application", slug],
      async () => {
        const result = await apiClient.proposals.getProposals({
          pluginId: "node",
          entityId: slug,
          limit: 1,
        });
        return result.data[0] ?? null;
      },
      !!slug,
    ),
  );
  const proposedDaoAccountId = useMemo(() => {
    if (!application) return null;
    try {
      return parseNodeProposalPayload(application.payload).accountId;
    } catch {
      return null;
    }
  }, [application]);

  const team = orgDaoAccountId ?? proposedDaoAccountId ?? connectedTeamDao ?? "";
  const endowment = values.endowmentLinked ? team : values.endowment.trim();
  const pool = values.pool.trim();
  const treasuriesShared = !!team && team === endowment;

  const sponsorYocto = useMemo(() => parseNearAmount(values.sponsorAmount), [values.sponsorAmount]);
  const sponsorStakeYocto = sponsorYocto;

  const { data: teamVe } = useQuery(poc(["venear", team], () => fetchVenearAccount(team), !!team));
  const { data: endowmentVe } = useQuery(
    poc(["venear", endowment], () => fetchVenearAccount(endowment), !!endowment),
  );
  const { data: teamLockupId } = useQuery(
    poc(["lockup-id", team], () => fetchLockupAccountId(team), !!team),
  );
  const teamLockup = teamLockupId ?? "";
  const { data: endowmentLockupId } = useQuery(
    poc(["lockup-id", endowment], () => fetchLockupAccountId(endowment), !!endowment),
  );
  const endowmentLockup = endowmentLockupId ?? "";

  const { data: teamLockupState } = useQuery(
    poc(["lockup-state", teamLockup], () => fetchLockupState(teamLockup), !!teamLockup),
  );
  const { data: endowmentLockupState } = useQuery(
    poc(
      ["lockup-state", endowmentLockup],
      () => fetchLockupState(endowmentLockup),
      !!endowmentLockup,
    ),
  );
  const { data: endowmentLockupBalance } = useQuery(
    poc(
      ["lockup-balance", endowmentLockup],
      () => fetchAccountBalance(endowmentLockup),
      !!endowmentLockup,
    ),
  );
  /** The lockup can stake its balance minus the storage reserve it refuses to spend. */
  const endowmentAvailableYocto = useMemo(
    () => (endowmentLockupBalance == null ? null : lockupAvailableYocto(endowmentLockupBalance)),
    [endowmentLockupBalance],
  );
  const { data: poolMeta } = useQuery(poc(["pool-meta", pool], () => fetchPoolMeta(pool), !!pool));
  const { data: teamPoolAccount } = useQuery(
    poc(
      ["pool-account", pool, team],
      () => getNear().view<PoolAccountView>(pool, "get_account", { account_id: team }),
      !!pool && !!team,
    ),
  );
  const { data: endowmentPoolAccount } = useQuery(
    poc(
      ["pool-account", pool, endowmentLockup],
      () => getNear().view<PoolAccountView>(pool, "get_account", { account_id: endowmentLockup }),
      !!pool && !!endowmentLockup,
    ),
  );
  const { data: whitelisted } = useQuery(
    poc(
      ["whitelist", pool],
      () =>
        getNear().view<boolean>(WHITELIST_ACCOUNT, "is_whitelisted", {
          staking_pool_account_id: pool,
        }),
      !!pool,
    ),
  );
  const { data: treasuryBalance } = useQuery(
    poc(["treasury-balance", team], () => fetchAccountBalance(team), !!team),
  );
  const { data: voteStorageFee } = useQuery({
    queryKey: ["poc", "vote-fee"],
    queryFn: fetchVoteStorageFee,
  });
  const { data: govProposals = [] } = useQuery(poc(["gov-proposals"], fetchActiveGovProposals));
  const { data: daoPolicyForAudit } = useQuery(
    poc(["audit-policy", team], () => fetchSputnikPolicy(team), !!team),
  );
  const { data: endowmentPolicy } = useQuery(
    poc(["policy", endowment], () => fetchSputnikPolicy(endowment), !!endowment),
  );
  const { data: teamPolicy } = useQuery(
    poc(["policy", team], () => fetchSputnikPolicy(team), !!team),
  );
  const { data: endowmentProposals = [] } = useQuery(
    poc(["dao-proposals", endowment], () => fetchDaoProposals(endowment), !!endowment),
  );
  const { data: teamProposals = [] } = useQuery(
    poc(["dao-proposals", team], () => fetchDaoProposals(team), !!team),
  );

  const govProposal =
    govProposals.find((p) => String(p.id) === values.govProposalId) ?? govProposals[0] ?? null;

  const { data: voteRecord } = useQuery(
    poc(
      ["vote-record", team, govProposal?.id],
      () => fetchGovVoteRecord(team, govProposal?.id ?? -1),
      !!team && !!govProposal,
    ),
  );
  const { data: tenantBinding } = useQuery(
    poc(
      ["binding", slug],
      () => apiClient.resolveBindingByHostname({ hostname: `${slug}.${gatewayId}` }),
      !!slug && !!gatewayId,
    ),
  );
  const { data: registryApp } = useQuery(
    poc(
      ["registry-app", team, gatewayId],
      async () => {
        if (!team || !gatewayId) return null;
        try {
          const result = await apiClient.registry.getRegistryApp({
            accountId: team,
            gatewayId,
          });
          return result.data ?? null;
        } catch {
          return null;
        }
      },
      !!team && !!gatewayId,
    ),
  );

  /** Conflict preflight: one DAO owns at most one tenant, and one org one node. */
  const { data: tenantByDao } = useQuery(
    poc(["tenant-by-dao", team], () => apiClient.resolveTenant({ accountId: team }), !!team),
  );
  const { data: orgTenant } = useQuery(
    poc(
      ["tenant-by-org", activeOrgId],
      () => apiClient.resolveTenantByOrgId({ orgId: activeOrgId ?? "" }).catch(() => null),
      !!activeOrgId,
    ),
  );

  /** The admin-assigned pool, once the node exists: its default staking validator. */
  const { data: nodeBySlug } = useQuery(
    poc(
      ["node-by-slug", slug],
      () => apiClient.resolveNodeBySlug({ slug }).catch(() => null),
      !!slug,
    ),
  );
  const { data: stakingValidators } = useQuery(
    poc(
      ["staking-validators", nodeBySlug?.id],
      () => apiClient.resolveStakingValidators({ nodeId: nodeBySlug?.id ?? "" }),
      !!nodeBySlug?.id,
    ),
  );
  const savedPool =
    stakingValidators?.validators.find((validator) => validator.isDefault)?.accountId ??
    stakingValidators?.validators[0]?.accountId ??
    null;

  useEffect(() => {
    prefillIfEmpty(form, "pool", savedPool ?? "");
  }, [form, savedPool]);

  /* -------------------------------------------------------------------- model */

  const factsPartial: ChainFacts = {
    applicationProposed: !!application,
    applicationApplied: application?.applyStatus === "applied",
    tenantDeployed: !!tenantBinding || !!orgTenant,
    poolAssigned: !!pool,
    treasuryFunded: false,
    configPublished: !!registryApp,
    teamStaked: meetsTeamStakeMinimum(teamPoolAccount?.staked_balance),
    teamRegistered: teamVe != null,
    lockupDeployed: teamVe?.internal.lockup_version != null,
    nearLocked: isPositive(teamLockupState?.locked),
    endowmentRegistered: endowmentVe != null,
    endowmentLockupDeployed: endowmentVe?.internal.lockup_version != null,
    endowmentFunded:
      yoctoArg(endowmentLockupState?.liquid) + yoctoArg(endowmentLockupState?.locked) >
      BigInt(LOCKUP_DEPLOY_DEPOSIT),
    endowmentLocked: isPositive(endowmentLockupState?.locked),
    endowmentPoolSelected:
      !!endowmentLockupState?.stakingPool && endowmentLockupState.stakingPool === pool,
    endowmentStaked: isPositive(endowmentLockupState?.knownDeposited),
    delegated: !!endowmentVe?.account.delegations.some((entry) => entry.account_id === team),
    voteCast: voteRecord != null,
    teamUnstaked: teamPoolAccount ? !isPositive(teamPoolAccount.staked_balance) : true,
    teamWithdrawn: teamPoolAccount ? !isPositive(teamPoolAccount.unstaked_balance) : true,
    endowmentUnstaked: !isPositive(endowmentLockupState?.knownDeposited),
    endowmentWithdrawn: endowmentPoolAccount
      ? !isPositive(endowmentPoolAccount.unstaked_balance)
      : true,
    endowmentPoolReleased: !endowmentLockupState?.stakingPool,
    delegationsCleared: endowmentVe ? endowmentVe.account.delegations.length === 0 : true,
    treasuriesShared,
  };

  const requirementYocto = teamTreasuryRequirementYocto(factsPartial);
  const treasuryFunded =
    !!team && treasuryBalance != null && BigInt(treasuryBalance) >= requirementYocto;
  const facts: ChainFacts = { ...factsPartial, treasuryFunded };
  const fundYocto =
    requirementYocto + TREASURY_FUND_BUFFER_YOCTO >= TREASURY_FUND_FLOOR_YOCTO
      ? requirementYocto + TREASURY_FUND_BUFFER_YOCTO
      : TREASURY_FUND_FLOOR_YOCTO;

  const daoTakenElsewhere =
    !!team && !!tenantByDao && tenantByDao.orgId != null && tenantByDao.orgId !== activeOrgId;
  const daoBlocked = daoTakenElsewhere
    ? "this organization's DAO already runs a tenant elsewhere"
    : null;

  const blockers: Partial<Record<StationId, string>> = {};
  if (!activeOrgId) blockers.apply = "select an organization";
  else if (!team) blockers.apply = "connect your team DAO with Trezu";
  else if (daoBlocked) blockers.apply = daoBlocked;
  else if (!sessionAccount) blockers.apply = "sign in with your NEAR wallet";
  else if (!values.name.trim()) blockers.apply = "enter a node name";
  if (!sessionAccount) blockers.approve = "sign in to approve";
  else if (!isAdmin) blockers.approve = "admin access required — sign in as an admin";
  else if (!team) blockers.approve = "connect your team DAO with Trezu";
  else if (daoBlocked) blockers.approve = daoBlocked;
  else if (daoPolicyForAudit && !isExplicitDaoMember(daoPolicyForAudit, sessionAccount)) {
    blockers.approve = `${sessionAccount} is not a member of ${team}`;
  }
  if (!team) blockers.fund = "connect your team DAO with Trezu";
  else if (!sessionAccount) blockers.fund = "sign in with your NEAR wallet";
  else if (!isAdmin) blockers.fund = "admin access required — the admin's wallet does the funding";
  if (!team) blockers.publish = "connect your team DAO with Trezu";
  else if (application && facts.configPublished && !isAdmin) {
    blockers.publish = "config is live — an admin must mark the application applied";
  }
  if (!team) blockers.stake = "connect your team DAO with Trezu";
  else if (!pool) blockers.stake = "enter the staking pool";
  if (!team) blockers["setup-hos"] = "connect your team DAO with Trezu";
  if (!endowment) blockers["sponsor-lock"] = "set the endowment treasury";
  else if (!sponsorYocto) blockers["sponsor-lock"] = "enter the sponsor amount";
  if (!endowment) blockers["sponsor-stake"] = "set the endowment treasury";
  else if (!pool) blockers["sponsor-stake"] = "enter the staking pool";
  else if (!sponsorYocto) blockers["sponsor-stake"] = "enter the sponsor amount";
  if (!endowment) blockers["sponsor-delegate"] = "set the endowment treasury";
  if (!team) blockers.vote = "connect your team DAO with Trezu";
  else if (!govProposal) blockers.vote = "no active House of Stake proposal";
  if (!team) blockers.unstake = "connect your team DAO with Trezu";
  else if (!pool) blockers.unstake = "enter the staking pool";
  if (!endowment) blockers["sponsor-unwind"] = "set the endowment treasury";

  const platformAuditWarning =
    daoPolicyForAudit && baseAccount && !isExplicitDaoMember(daoPolicyForAudit, baseAccount) && team
      ? `the platform audit account ${baseAccount} is not a member of ${team}`
      : null;
  const trezuMembersUrl = team ? `https://trezu.app/${team}/members` : null;

  const stationDefs = useMemo(
    () =>
      buildStations({
        slug,
        pool,
        teamAccount: team,
        endowmentAccount: endowment,
        teamLockup,
        endowmentLockup,
        sponsorYocto,
        sponsorStakeYocto,
        govProposalId: govProposal?.id ?? null,
      }),
    [slug, pool, team, endowment, teamLockup, endowmentLockup, sponsorYocto, govProposal?.id],
  );

  /** The session wallet connects to the endowment through policy membership. */
  const sessionCanProposeEndowment = canAccountPropose(endowmentPolicy, sessionAccount);

  const stations = deriveStations({
    stations: stationDefs,
    facts,
    proposalsBySigner: { endowment: endowmentProposals, team: teamProposals },
    accounts: { session: sessionAccount, endowment, team },
    connectedDao: connection.daoAccountId,
    sessionProposerSigners: sessionCanProposeEndowment ? (["endowment"] as const) : [],
    blockers,
    runningStation,
    failedStations: failures,
  });

  const accountFor = (signer: SignerKind) =>
    signer === "session" ? sessionAccount : signer === "endowment" ? endowment : team;
  const policyFor = (signer: SignerKind) => (signer === "endowment" ? endowmentPolicy : teamPolicy);

  const runnable = runnableRun(stations);
  const upcoming = nextStation(stations);
  const stagedCount = pendingProposalCount(stations);
  const tenantHostname =
    tenantBinding?.hostname ?? (slug && gatewayId ? `${slug}.${gatewayId}` : "");
  const tenantUrl = tenantHostname && gatewayId ? buildTenantUrl(tenantHostname, gatewayId) : null;
  const tenantDisplayHost = tenantUrl ? new URL(tenantUrl).host : tenantHostname || "—";
  const tenantRecord = orgTenant ?? tenantByDao ?? null;
  const publishPendingProposal =
    stations
      .find((station) => station.def.id === "publish")
      ?.steps.find((step) => step.id === "publish")?.pendingProposal ?? null;
  const fastKvUrl = team && gatewayId ? buildRegistryConfigUrl(team, gatewayId) : null;

  /* ------------------------------------------------------------------ actions */

  const requireConnected = async (signer: SignerKind) => {
    const want = accountFor(signer);
    if (signer === "session") {
      if (!sessionAccount) throw new Error("Sign in with your NEAR wallet first");
      return;
    }
    if (!want) throw new Error("Set the treasury account first");
    if (connection.daoAccountId === want && (await verifyDaoAccount(want))) return;
    if (connection.daoAccountId) await connection.disconnect();
    try {
      const connected = await connection.connect();
      if (connected !== want) {
        throw new Error(`Trezu connected ${connected}, but this step must be signed by ${want}`);
      }
    } catch (error) {
      throw new Error(describeDaoError(error, want));
    }
  };

  /** Fresh read of the published tenant config — the truth for publish/mark-applied. */
  const fetchPublishedNow = () =>
    team && gatewayId
      ? apiClient.registry
          .getRegistryApp({ accountId: team, gatewayId })
          .then((result) => result.data ?? null)
          .catch(() => null)
      : Promise.resolve(null);

  /** Fresh read of the team's account in the pool — the truth for the team stake stations. */
  const fetchTeamPoolAccount = () =>
    pool && team
      ? getNear()
          .view<PoolAccountView>(pool, "get_account", { account_id: team })
          .catch(() => null)
      : Promise.resolve(null);

  /**
   * True when an endowment step stages as a proposal from the session wallet
   * instead of being signed by a connected endowment wallet.
   */
  const viaSessionProposal = (signer: SignerKind) =>
    signer === "endowment" && connection.daoAccountId !== endowment && sessionCanProposeEndowment;

  /** Executes one station's remaining steps in order, as its declared signer. */
  const runStation = async (station: StationState) => {
    const { def } = station;
    setRunningStation(def.id);
    setFailures((prev) => ({ ...prev, [def.id]: undefined }));
    try {
      if (!viaSessionProposal(def.signer)) await requireConnected(def.signer);
      for (const step of station.steps) {
        if (step.status !== "pending") continue;
        try {
          await runStep(station, step.id);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`${step.label} — ${detail}`);
        }
      }
      toast.success(`${def.title} — done`);
    } catch (error) {
      const message = describeDaoError(error, accountFor(def.signer) ?? def.signer);
      setFailures((prev) => ({ ...prev, [def.id]: message }));
      toast.error(message);
      log(`${def.title} failed`, message);
      throw error;
    } finally {
      setRunningStation(null);
      refresh();
    }
  };

  const precheckPlan = createPrecheckPlan({
    pool,
    teamLockup,
    endowmentLockup,
    accountFor,
    log,
    fetchPublishedNow,
    fetchTeamPoolAccount,
  });

  const runStep = gatewayId
    ? createStepRunner({
        apiClient,
        auth,
        activeOrgId,
        sessionAccount,
        isAdmin,
        values,
        slug,
        team,
        endowment,
        pool,
        gatewayId,
        baseAccount,
        tenantBinding,
        orgTenant,
        treasuryFunded,
        fundYocto,
        tenantUrl,
        govProposal,
        voteStorageFee,
        accountFor,
        log,
        fetchPublishedNow,
        precheckPlan,
        viaSessionProposal,
      })
    : async () => {
        throw new Error(
          "Runtime configuration is missing the gateway id — this deployment is misconfigured",
        );
      };

  const runChainMutation = useMutation({
    mutationFn: async () => {
      for (const station of runnable) {
        await runStation(station);
      }
    },
    onError: () => {},
  });

  /**
   * Approves a staged proposal with the connected Trezu wallet — never the
   * session wallet. A mismatched treasury is disconnected and reconnected as
   * the proposal's DAO before the vote is signed.
   */
  const approveMutation = useMutation({
    mutationFn: async ({
      signer,
      dao,
      proposalId,
    }: {
      signer: SignerKind;
      dao: string;
      proposalId: number;
    }) => {
      if (!dao) throw new Error("Set the treasury account first");
      await requireConnected(signer);
      return signPlanAsDao(dao, approveProposalPlan(dao, proposalId));
    },
    onSuccess: (result, variables) => {
      toast.success(`approved proposal ${variables.proposalId}`);
      log(`voted Approve on ${variables.dao} proposal ${variables.proposalId}`, txHash(result));
      refresh();
    },
    onError: (error: Error, variables) => toast.error(describeDaoError(error, variables.dao)),
  });

  const connectTeamDaoMutation = useMutation({
    mutationFn: async () => {
      let dao = connection.daoAccountId;
      if (dao && !(await verifyDaoAccount(dao).catch(() => false))) {
        await connection.disconnect();
        dao = null;
      }
      if (!dao) dao = await connection.connect();
      setConnectedTeamDao(dao);
      if (activeOrgId && dao !== orgDaoAccountId) {
        await apiClient.auth
          .linkDao({ organizationId: activeOrgId, daoAccountId: dao })
          .catch(() => {});
      }
      return dao;
    },
    onSuccess: (dao) => {
      log(`team wallet set to ${dao} — linked to the organization`);
      refresh();
    },
    onError: (error: Error) =>
      toast.error(describeDaoError(error, connection.daoAccountId ?? "the treasury")),
  });

  const connectEndowmentMutation = useMutation({
    mutationFn: async () => {
      let dao = connection.daoAccountId;
      if (dao && !(await verifyDaoAccount(dao).catch(() => false))) {
        await connection.disconnect();
        dao = null;
      }
      if (!dao) dao = await connection.connect();
      form.setFieldValue("endowmentLinked", false);
      form.setFieldValue("endowment", dao);
      return dao;
    },
    onSuccess: (dao) => {
      log(`endowment treasury set to ${dao}`);
    },
    onError: (error: Error) =>
      toast.error(describeDaoError(error, connection.daoAccountId ?? "the treasury")),
  });

  /* --------------------------------------------------------------------- view */

  const busy = runChainMutation.isPending || !!runningStation;

  return {
    runtimeConfig,
    sessionAccount,
    connection,
    organizations,
    activeOrg,
    activeOrgId,
    isAdmin,
    form,
    values,
    slug,
    team,
    endowment,
    pool,
    treasuriesShared,
    entries,
    refresh,
    application,
    facts,
    stations,
    runnable,
    upcoming,
    stagedCount,
    busy,
    runningStation,
    policyFor,
    platformAuditWarning,
    trezuMembersUrl,
    sessionCanProposeEndowment,
    tenantUrl,
    tenantDisplayHost,
    tenantRecord,
    tenantBinding,
    publishPendingProposal,
    fastKvUrl,
    govProposals,
    govProposal,
    fundYocto,
    requirementYocto,
    teamVe,
    treasuryBalance,
    treasuryFunded,
    voteRecord,
    endowmentLockup,
    endowmentLockupState,
    endowmentAvailableYocto,
    endowmentPoolAccount,
    endowmentVe,
    poolMeta,
    whitelisted,
    teamPoolAccount,
    runStation,
    requireConnected,
    runChainMutation,
    approveMutation,
    connectTeamDaoMutation,
    connectEndowmentMutation,
  };
}

export type PocLifecycle = ReturnType<typeof usePocLifecycle>;
