import type { ApiClient } from "@/app";
import type { TenantWizardValues } from "./-tenant-wizard";

type TenantCreationApi = Pick<
  ApiClient,
  "createTenant" | "createNode" | "createBinding" | "deleteNode" | "deleteTenant"
>;

export async function createTenantResources({
  apiClient,
  values,
  daoAccountId,
  gatewayId,
  onStep,
  onTenantCreated,
}: {
  apiClient: TenantCreationApi;
  values: TenantWizardValues;
  daoAccountId: string;
  gatewayId: string;
  onStep: (state: "running" | "success" | "failed", error?: string) => void;
  onTenantCreated: (tenantId: string) => void;
}) {
  onStep("running");

  let tenantId: string | null = null;
  let nodeId: string | null = null;

  try {
    const tenant = await apiClient.createTenant({
      name: values.tenantName,
      accountId: daoAccountId,
      status: "active",
    });
    tenantId = tenant.id;

    const node = await apiClient.createNode({
      kind: values.kind,
      slug: values.slug,
      name: values.name,
      parentId: values.kind === "country" ? null : values.parentId,
      tenantId: tenant.id,
    });
    nodeId = node.id;

    const binding = await apiClient.createBinding({
      tenantId: tenant.id,
      hostname: `${values.slug}.${gatewayId}`,
      isPrimary: true,
    });

    onTenantCreated(tenant.id);
    onStep("success");
    return { tenant, node, binding };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onStep("failed", message);

    if (nodeId) {
      try {
        await apiClient.deleteNode({ nodeId });
      } catch {}
    }
    if (tenantId) {
      try {
        await apiClient.deleteTenant({ tenantId });
      } catch {}
    }
    throw err;
  }
}
