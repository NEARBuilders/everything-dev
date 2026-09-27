import { toast } from "sonner";
import type { useApiClient, useAuthClient } from "@/app";
import { publishDaoTenantConfig } from "@/lib/tenant-deploy";
import { proposeNodeApplication } from "./-node-application";
import {
  type DaoPlan,
  describePlan,
  type fetchActiveGovProposals,
  fetchDaoProposals,
  fetchGovProof,
  formatNear,
  proposeAsSession,
  signPlanAsDao,
  transferFromSessionWallet,
  txHash,
  VOTE_STORAGE_FEE_FALLBACK,
  VOTING_ACCOUNT,
  waitFor,
} from "./-poc-chain";
import type { PocFormValues } from "./-poc-form";
import type { SignerKind, StationState, StepState } from "./-poc-stations";

type GovProposal = Awaited<ReturnType<typeof fetchActiveGovProposals>>[number];

export interface StepRunnerContext {
  apiClient: ReturnType<typeof useApiClient>;
  auth: ReturnType<typeof useAuthClient>;
  activeOrgId: string | null;
  sessionAccount: string | null;
  isAdmin: boolean;
  values: PocFormValues;
  slug: string;
  team: string;
  endowment: string;
  pool: string;
  gatewayId: string;
  baseAccount: string;
  tenantBinding: unknown;
  orgTenant: unknown;
  treasuryFunded: boolean;
  fundYocto: bigint;
  tenantUrl: string | null;
  govProposal: GovProposal | null;
  voteStorageFee: string | undefined;
  accountFor: (signer: SignerKind) => string | null;
  log: (label: string, detail?: string) => void;
  fetchPublishedNow: () => Promise<unknown>;
  precheckPlan: (station: StationState, step: StepState) => Promise<DaoPlan | null>;
  viaSessionProposal: (signer: SignerKind) => boolean;
}

/** Executes one step of a station as its declared signer. */
export function createStepRunner(ctx: StepRunnerContext) {
  const {
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
  } = ctx;
  return async (station: StationState, stepId: string) => {
    const step = station.steps.find((entry) => entry.id === stepId);
    if (!step) throw new Error(`unknown step ${stepId}`);
    const signerId = accountFor(station.def.signer);

    if (stepId === "propose") {
      if (!activeOrgId || !sessionAccount)
        throw new Error("Organization and NEAR account required");
      const result = await proposeNodeApplication(
        apiClient,
        {
          kind: "country",
          parentId: null,
          name: values.name.trim(),
          slug,
          motivation: `Prototype application for ${values.name.trim()}`,
        },
        { orgId: activeOrgId, daoAccountId: team, submitterAccountId: sessionAccount },
      );
      log(`applied for ${slug} as ${sessionAccount}`, `proposal ${result.data.entityId}`);
      return;
    }

    if (stepId === "approve") {
      if (!isAdmin) {
        throw new Error("admin access required — sign in as an admin");
      }
      const current = await apiClient.proposals.getProposals({
        pluginId: "node",
        entityId: slug,
        limit: 1,
      });
      const proposal = current.data[0];
      if (!proposal) throw new Error("No application to approve");
      let updatedAt = proposal.updatedAt;
      if (proposal.reviewStatus !== "approved") {
        const approved = await apiClient.proposals.approve({
          pluginId: "node",
          entityId: slug,
          expectedUpdatedAt: proposal.updatedAt,
        });
        updatedAt = approved.data.updatedAt;
        log(`approved the application for ${slug}`);
      }
      if (tenantBinding || orgTenant) {
        log("application already approved and node created — skipping");
        return;
      }
      try {
        const node = await apiClient.applyNodeProposal({
          kind: "country",
          parentId: null,
          name: values.name.trim(),
          slug,
          motivation: `Prototype application for ${values.name.trim()}`,
          orgId: activeOrgId ?? "",
          accountId: team,
          submitterAccountId: sessionAccount ?? "",
          hostname: `${slug}.${gatewayId}`,
          ...(pool ? { poolAccountId: pool } : {}),
        });
        log(
          `created tenant, node and binding for ${slug}${pool ? `, assigned pool ${pool}` : ""}`,
          `node ${node.nodeId}`,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await apiClient.proposals
          .markApplyFailed({
            pluginId: "node",
            entityId: slug,
            expectedUpdatedAt: updatedAt,
            error: detail.slice(0, 4000),
          })
          .catch(() => {});
        throw new Error(detail);
      }
      return;
    }

    if (stepId === "fund-treasury") {
      if (!team) throw new Error("Connect the team DAO first");
      if (!sessionAccount) throw new Error("Sign in with your NEAR wallet first");
      if (!isAdmin) throw new Error("admin access required — the admin's wallet does the funding");
      if (treasuryFunded) {
        log("treasury already funded — skipping");
        return;
      }
      const result = await transferFromSessionWallet(auth.near, team, fundYocto);
      log(
        `funded ${team} with ${formatNear(fundYocto.toString())} from ${sessionAccount}`,
        txHash(result),
      );
      return;
    }

    if (stepId === "publish") {
      const result = await publishDaoTenantConfig(apiClient, {
        daoAccountId: team,
        gatewayId,
        baseAccount,
        hostname: `${slug}.${gatewayId}`,
        title: values.name.trim() || slug,
      });
      const immediate = await waitFor(async () => !!(await fetchPublishedNow()), 30_000, 3_000);
      if (immediate) {
        log(`published the tenant config as ${team}`, txHash(result));
        toast.success(`tenant config is live — ${tenantUrl ?? `${slug}.${gatewayId}`}`);
      } else {
        const latest = await fetchDaoProposals(team).catch(() => []);
        const detail =
          [txHash(result), latest[0] ? `latest proposal #${latest[0].id}` : null]
            .filter(Boolean)
            .join(" · ") || undefined;
        log(`publish proposal signed as ${team} — config goes live when it passes`, detail);
        toast.info("publish proposal awaiting votes — the config goes live once it passes");
      }
      return;
    }

    if (stepId === "mark-applied") {
      if (!isAdmin) {
        log("mark-applied needs an admin session — deferred");
        toast.info("mark-applied needs an admin session — run this again signed in as an admin");
        return;
      }
      const published = await fetchPublishedNow();
      if (!published) {
        log("tenant config not live yet — mark-applied deferred");
        toast.info("the publish proposal is still awaiting votes — run this again once it passes");
        return;
      }
      const current = await apiClient.proposals.getProposals({
        pluginId: "node",
        entityId: slug,
        limit: 1,
      });
      const proposal = current.data[0];
      if (!proposal) throw new Error("Application disappeared");
      await apiClient.proposals.markApplied({
        pluginId: "node",
        entityId: slug,
        expectedUpdatedAt: proposal.updatedAt,
        appliedResourceId: slug,
      });
      log(`marked ${slug} applied`);
      return;
    }

    if (stepId === "vote") {
      if (!govProposal) throw new Error("No active proposal selected");
      if (!signerId) throw new Error("Team wallet not set");
      const proof = await fetchGovProof(signerId);
      if (!proof) throw new Error(`${signerId} has no veNEAR account — register it first`);
      const result = await signPlanAsDao(signerId, {
        kind: "call",
        receiverId: VOTING_ACCOUNT,
        methodName: "vote",
        args: {
          proposal_id: govProposal.id,
          vote: values.voteOption,
          merkle_proof: proof[0],
          v_account: proof[1],
        },
        gas: "300 Tgas",
        attachedDeposit: voteStorageFee ?? VOTE_STORAGE_FEE_FALLBACK,
      });
      log(
        `voted ${values.voteOption} on proposal ${govProposal.id} as ${signerId}`,
        txHash(result),
      );
      return;
    }

    if (!step.plan) throw new Error(`step ${stepId} has no plan`);
    if (!signerId) throw new Error("Signer account not set");
    const plan = await precheckPlan(station, step);
    if (!plan) return;
    if (viaSessionProposal(station.def.signer)) {
      const description = `* Title: ${step.label} <br>* Summary: staged from the node lifecycle — ${describePlan(plan)}`;
      const result = await proposeAsSession(auth.near, endowment, plan, description);
      log(`staged a proposal on ${endowment} — ${describePlan(plan)}`, txHash(result));
      return;
    }
    if (station.def.signer === "endowment") {
      throw new Error(
        "connect the endowment in Trezu, or hold AddProposal rights on its policy, to stage this step",
      );
    }
    const result = await signPlanAsDao(signerId, plan);
    log(`${describePlan(plan)} as ${signerId}`, txHash(result));
  };
}
