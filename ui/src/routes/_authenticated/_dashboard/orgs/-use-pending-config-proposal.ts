import { useQuery } from "@tanstack/react-query";
import {
  approvalThreshold,
  CONFIG_WRITE_PLAN,
  fetchDaoProposals,
  fetchSputnikPolicy,
  findPendingProposalForPlan,
  type SputnikPolicy,
  type SputnikProposal,
} from "@/lib/sputnik-proposals";
import { TENANT_CONFIG_REFETCH_MS } from "./-use-org-tenant-config";

export interface PendingConfigProposal {
  proposal: SputnikProposal | null;
  threshold: ReturnType<typeof approvalThreshold>;
  policy: SputnikPolicy | null | undefined;
}

export function usePendingConfigProposal(
  daoAccountId: string,
  enabled: boolean,
): PendingConfigProposal {
  const { data: daoProposals = [] } = useQuery({
    queryKey: ["node-config", "dao-proposals", daoAccountId],
    queryFn: () => fetchDaoProposals(daoAccountId),
    enabled: enabled && !!daoAccountId,
    refetchInterval: TENANT_CONFIG_REFETCH_MS,
  });
  const { data: policy } = useQuery({
    queryKey: ["node-config", "dao-policy", daoAccountId],
    queryFn: () => fetchSputnikPolicy(daoAccountId),
    enabled: enabled && !!daoAccountId,
    refetchInterval: TENANT_CONFIG_REFETCH_MS,
  });

  const proposal = enabled ? findPendingProposalForPlan(daoProposals, CONFIG_WRITE_PLAN) : null;
  const threshold = approvalThreshold(policy, proposal);

  return { proposal, threshold, policy };
}
