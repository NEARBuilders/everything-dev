import { z } from "zod";
import { deriveSlug } from "@/lib/slug";

export { generateSlug } from "@/lib/slug";

export type NearNetworkId = "mainnet" | "testnet";

export type TenantKeyKind = "uuid" | "accountId" | "slug";

export const nodeKinds = ["country", "state", "city"] as const;

export type NodeKind = (typeof nodeKinds)[number];

export const tenantWizardSchema = z
  .object({
    kind: z.enum(nodeKinds),
    parentId: z.string(),
    name: z.string().trim().min(1, "name is required"),
    slug: z
      .string()
      .min(1, "slug is required")
      .regex(/^[a-z0-9-]+$/, "only lowercase letters, numbers, and hyphens"),
    tenantName: z.string().trim().min(1, "tenant name is required"),
  })
  .superRefine((values, context) => {
    if (values.kind !== "country" && !values.parentId) {
      context.addIssue({
        code: "custom",
        path: ["parentId"],
        message: "parent is required",
      });
    }
  });

export type TenantWizardValues = z.infer<typeof tenantWizardSchema>;

export function deriveTenantWizardNameFields(
  name: string,
  current: Pick<TenantWizardValues, "slug" | "tenantName">,
  touched: { slug: boolean; tenantName: boolean },
) {
  return {
    slug: deriveSlug(name, current.slug, touched.slug),
    tenantName: touched.tenantName ? current.tenantName : name,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function classifyTenantKey(key: string): TenantKeyKind {
  if (UUID_REGEX.test(key)) return "uuid";
  if (key.includes(".")) return "accountId";
  return "slug";
}

export interface TenantBindingLike {
  hostname: string;
  isPrimary: boolean;
}

export interface OrganizationLike {
  id: string;
  slug?: string | null;
}

export function resolvePrimaryHostname(
  bindings: readonly TenantBindingLike[] | null | undefined,
): string | null {
  if (!Array.isArray(bindings) || bindings.length === 0) return null;
  const primary = bindings.find((binding) => binding.isPrimary && !!binding.hostname);
  if (primary) return primary.hostname;
  const first = bindings.find((binding) => !!binding.hostname);
  return first?.hostname ?? null;
}

export function resolveOrgSlug(
  organizations: readonly OrganizationLike[] | null | undefined,
  orgId: string | null | undefined,
): string | null {
  if (!orgId || !Array.isArray(organizations)) return null;
  const org = organizations.find((candidate) => candidate.id === orgId);
  return typeof org?.slug === "string" && org.slug ? org.slug : null;
}

interface FilterableTenant {
  id: string;
  name: string;
  accountId: string;
  status: string;
}

export function filterTenants<T extends FilterableTenant>(
  tenants: readonly T[],
  {
    status,
    query,
    slugByTenantId,
  }: { status: string; query: string; slugByTenantId?: ReadonlyMap<string, string> },
): T[] {
  const needle = query.trim().toLowerCase();
  return tenants.filter((tenant) => {
    if (status !== "all") {
      const matchesStatus =
        status === "pending"
          ? tenant.status === "pending" || tenant.status === "pending_deletion"
          : tenant.status === status;
      if (!matchesStatus) return false;
    }
    if (!needle) return true;
    const slug = slugByTenantId?.get(tenant.id) ?? "";
    return [tenant.name, tenant.accountId, slug].some((value) =>
      value.toLowerCase().includes(needle),
    );
  });
}

export const tenantWizardStepIds = ["organization", "dao", "details", "review"] as const;

export type TenantWizardStepId = (typeof tenantWizardStepIds)[number];
export type TenantWizardStepStatus = "complete" | "current" | "upcoming";

export function resolveTenantWizardSteps(done: {
  organization: boolean;
  dao: boolean;
  details: boolean;
}) {
  const complete: Record<TenantWizardStepId, boolean> = { ...done, review: false };
  const current = tenantWizardStepIds.find((id) => !complete[id]) ?? "review";
  const status = (id: TenantWizardStepId): TenantWizardStepStatus =>
    id === current ? "current" : complete[id] ? "complete" : "upcoming";
  return { current, position: tenantWizardStepIds.indexOf(current) + 1, status };
}

type DeployProgress = "pending" | "running" | "success" | "failed";
type DeployStepStatus = TenantWizardStepStatus | "failed";

export function resolveTenantDeploySteps({
  create,
  publish,
  verified,
}: {
  create: DeployProgress;
  publish: DeployProgress;
  verified: boolean;
}): { create: DeployStepStatus; publish: DeployStepStatus; live: DeployStepStatus } {
  const createStatus: DeployStepStatus =
    create === "success" ? "complete" : create === "failed" ? "failed" : "current";
  if (createStatus !== "complete") {
    return { create: createStatus, publish: "upcoming", live: "upcoming" };
  }
  if (publish === "failed") return { create: "complete", publish: "failed", live: "upcoming" };
  if (publish !== "success") return { create: "complete", publish: "current", live: "upcoming" };
  return { create: "complete", publish: "complete", live: verified ? "complete" : "current" };
}
