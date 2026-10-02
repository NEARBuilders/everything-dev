import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import type { AuthClient } from "@/app";
import { orgMembersQueryKey } from "./-organization-query-keys";

type Router = ReturnType<typeof useRouter>;

export function useOrganizationSettings(
  auth: AuthClient,
  orgId: string,
  router: Router,
  onUpdated: () => void,
) {
  const queryClient = useQueryClient();
  const updateOrgMutation = useMutation({
    mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
      const { error } = await auth.organization.update({
        organizationId: orgId,
        data: { name, slug },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Organization updated");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await queryClient.invalidateQueries({ queryKey: orgMembersQueryKey(orgId) });
      onUpdated();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to update organization"),
  });
  const leaveOrgMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.organization.leave({ organizationId: orgId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("You have left the organization");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await router.navigate({ to: "/orgs" });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to leave organization"),
  });
  const deleteOrgMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.organization.delete({ organizationId: orgId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Organization deleted");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await router.navigate({ to: "/orgs" });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete organization"),
  });

  return { deleteOrgMutation, leaveOrgMutation, updateOrgMutation };
}
