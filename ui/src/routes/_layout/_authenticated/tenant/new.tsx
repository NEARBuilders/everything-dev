import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import type { TransactionBuilder } from "near-kit";
import { useState } from "react";
import { toast } from "sonner";
import { getAccount, getActiveRuntime, useApiClient, useAuthClient } from "@/app";
import { Button, Card, CardContent, Field, FieldLabel, Input } from "@/components";
import { PageContainer } from "@/components/layout/page-container";
import { StepList, useStepper } from "@/components/ui/stepper";

export const Route = createFileRoute("/_layout/_authenticated/tenant/new")({
  head: () => ({
    title: "New Tenant | app",
    meta: [{ name: "description", content: "Create a new tenant." }],
  }),
  component: NewTenantPage,
});

const RESERVED_SUBDOMAINS = [
  "root",
  "www",
  "admin",
  "api",
  "dashboard",
  "mail",
  "status",
  "help",
  "support",
  "docs",
  "blog",
  "dev",
  "test",
  "app",
  "beta",
  "demo",
  "staging",
  "internal",
  "moderation",
  "abuse",
];

const CREATION_STEPS = [
  { label: "Checking subaccount availability", blocking: true },
  { label: "Creating organization", blocking: true },
  { label: "Creating NEAR subaccount", blocking: true },
  { label: "Registering tenant", blocking: true },
  { label: "Setting active organization", blocking: false },
  { label: "Publishing registry metadata", blocking: false },
  { label: "Publishing tenant config", blocking: false },
  { label: "Redirecting", blocking: false },
] as const;

const METADATA_GAS = "10000000000000";
const CONFIG_GAS = "300000000000000";

function NewTenantPage() {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const [subdomain, setSubdomain] = useState("");
  const [name, setName] = useState("");

  const gatewayId = getActiveRuntime()?.gatewayId ?? "everything.dev";
  const parentAccount = getAccount();

  const { data: preflight } = useQuery({
    queryKey: ["tenant-preflight", subdomain, parentAccount],
    queryFn: () => apiClient.tenantPreflight({ subdomain, parentAccount }),
    enabled: !!subdomain && /^[a-z0-9-]+$/.test(subdomain),
  });

  const generateSubdomain = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const [autoSync, setAutoSync] = useState(true);

  const handleNameChange = (value: string) => {
    setName(value);
    if (autoSync) {
      setSubdomain(generateSubdomain(value));
    }
  };

  const handleSubdomainChange = (value: string) => {
    setSubdomain(value.replace(/[^a-z0-9-]/g, ""));
    if (!value && autoSync === false) {
      setAutoSync(true);
    } else if (value) {
      setAutoSync(false);
    }
  };

  const { steps, resetSteps, runStep, updateStep } = useStepper(CREATION_STEPS);

  const createMutation = useMutation({
    mutationFn: async () => {
      resetSteps();

      const nearAccountId = auth.near.getAccountId();
      if (!nearAccountId) {
        throw new Error("Connect a NEAR wallet first");
      }

      const publicKey = auth.near.getState()?.publicKey;
      if (!publicKey) {
        throw new Error("No NEAR public key available");
      }

      if (RESERVED_SUBDOMAINS.includes(subdomain)) {
        throw new Error(`"${subdomain}" is a reserved subdomain`);
      }

      const parentAccount = getAccount();

      updateStep(0, "running");
      let availability: Awaited<ReturnType<typeof auth.near.checkSubAccountAvailability>>;
      try {
        availability = await auth.near.checkSubAccountAvailability({
          subAccountName: subdomain,
        });
        updateStep(0, "success");
      } catch (err) {
        updateStep(0, "failed", err instanceof Error ? err.message : String(err));
        throw err;
      }
      if (availability.error) throw new Error(availability.error.message);
      if (!availability.data?.available) {
        throw new Error(`Subdomain "${subdomain}" is already taken`);
      }

      const org = await runStep(1, () =>
        auth.organization.create({
          name,
          slug: subdomain,
        }),
      );
      if (!org) throw new Error(steps[1].error ?? "Failed to create organization");
      if (org.error) throw new Error(org.error.message);
      if (!org.data) throw new Error("Organization creation returned no data");
      const orgData = org.data;

      const rollbackOrg = async () => {
        try {
          await auth.organization.delete({ organizationId: orgData.id });
        } catch (rollbackErr) {
          console.warn("Failed to roll back organization", rollbackErr);
        }
      };

      let accountId: string;
      try {
        updateStep(2, "running");
        const subAccount = await auth.near.createSubAccount({
          subAccountName: subdomain,
          publicKey,
        });
        updateStep(2, "success");
        if (subAccount.error) throw new Error(subAccount.error.message);
        accountId = subAccount.data?.accountId;
        if (!accountId) {
          throw new Error("Subaccount created but no accountId returned");
        }
      } catch (err) {
        updateStep(2, "failed", err instanceof Error ? err.message : String(err));
        await rollbackOrg();
        throw err;
      }

      let tenant: Awaited<ReturnType<typeof apiClient.createTenant>> | undefined;
      try {
        tenant = await runStep(3, () =>
          apiClient.createTenant({
            subdomain,
            name,
            accountId,
            orgId: orgData.id,
          }),
        );
        if (!tenant) {
          throw new Error(steps[3].error ?? "Failed to register tenant");
        }
      } catch (err) {
        await rollbackOrg();
        throw err;
      }

      const setActive = await runStep(4, () =>
        auth.organization.setActive({ organizationId: orgData.id }),
      );
      let hadFailures = false;
      if (!setActive) {
        hadFailures = true;
        toast.warning("Failed to set active organization");
      }

      const metadata = await runStep(5, async () => {
        const prepared = await apiClient.apps.prepareRegistryMetadataWrite({
          accountId,
          gatewayId,
          claimedBy: nearAccountId,
          title: name,
          homepageUrl: `https://${subdomain}.${gatewayId}`,
        });

        const signed = await auth.near.buildSignedDelegateAction(
          prepared.data.contractId,
          (builder: TransactionBuilder) =>
            builder.functionCall(
              prepared.data.contractId,
              prepared.data.methodName,
              prepared.data.args,
              { gas: METADATA_GAS, attachedDeposit: 0n },
            ),
        );

        const relayed = await auth.near.relayTransaction({ payload: signed });
        if (relayed.error) throw new Error(relayed.error.message);
        return relayed;
      });
      if (!metadata) {
        hadFailures = true;
        toast.warning("Registry metadata publish failed — non-blocking");
      }

      const config = await runStep(6, async () => {
        const tenantConfig = {
          extends: `bos://${parentAccount}/${gatewayId}`,
          account: accountId,
          domain: `${subdomain}.${gatewayId}`,
          title: name,
          description: name,
        };

        const prepared = await apiClient.apps.prepareRegistryConfigWrite({
          accountId,
          gatewayId,
          config: tenantConfig,
        });

        const signed = await auth.near.buildSignedDelegateAction(
          prepared.data.contractId,
          (builder: TransactionBuilder) =>
            builder.functionCall(
              prepared.data.contractId,
              prepared.data.methodName,
              prepared.data.args,
              { gas: CONFIG_GAS, attachedDeposit: 0n },
            ),
        );

        const relayed = await auth.near.relayTransaction({ payload: signed });
        if (relayed.error) throw new Error(relayed.error.message);
        return relayed;
      });
      if (!config) {
        hadFailures = true;
        toast.warning("Tenant config publish failed — non-blocking");
      }

      return {
        tenant,
        accountId,
        orgId: orgData.id,
        hadFailures,
      };
    },
    onSuccess: async (result) => {
      if (result.hadFailures) {
        toast.warning(
          `Tenant "${name}" created — some non-critical steps failed. See details below.`,
        );
      } else {
        toast.success(`Tenant "${name}" created`);
      }

      updateStep(7, "running");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      updateStep(7, "success");

      window.location.href = `/tenant/${result.tenant.id}`;
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create tenant");
    },
  });

  const isCreating = createMutation.isPending;

  return (
    <PageContainer variant="narrow">
      <div className="space-y-8">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            Create
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            New Tenant
          </h1>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
          className="space-y-6"
        >
          <Card>
            <CardContent className="p-6 space-y-4">
              <Field>
                <FieldLabel htmlFor="tenant-name">tenant name</FieldLabel>
                <Input
                  id="tenant-name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="My App"
                  required
                  disabled={isCreating}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tenant-subdomain">subdomain</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="tenant-subdomain"
                    value={subdomain}
                    onChange={(e) => handleSubdomainChange(e.target.value)}
                    placeholder="my-app"
                    pattern="[a-z0-9-]+"
                    required
                    disabled={isCreating}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap font-mono">
                    .{gatewayId}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Only lowercase letters, numbers, and hyphens.
                </p>
                {preflight && !preflight.subdomain.available && (
                  <p className="text-xs text-destructive mt-2">
                    {preflight.subdomain.reserved
                      ? `"${subdomain}" is a reserved subdomain`
                      : `"${subdomain}" is already taken`}
                  </p>
                )}
              </Field>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={
                isCreating ||
                !name ||
                !subdomain ||
                (preflight ? !preflight.subdomain.available : false)
              }
              variant="outline"
            >
              {isCreating ? "creating..." : "create tenant"}
            </Button>
          </div>
        </form>

        {isCreating || createMutation.isSuccess || createMutation.isError ? (
          <section className="space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Progress
            </h2>
            <Card>
              <CardContent className="p-4 space-y-3">
                <StepList steps={steps} />
              </CardContent>
            </Card>
          </section>
        ) : (
          <section className="space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              What Happens
            </h2>
            <Card>
              <CardContent className="p-4 space-y-2 text-xs text-muted-foreground">
                <p>
                  1. <strong>Organization</strong> — A Better-Auth organization is created first
                  (you become owner)
                </p>
                <p>
                  2. <strong>NEAR subaccount</strong> — {subdomain || "{subdomain}"}.{gatewayId} is
                  created and linked to your wallet
                </p>
                <p>
                  3. <strong>Tenant row</strong> — The tenant is registered in the database
                </p>
                <p>
                  4. <strong>Active org</strong> — Your session switches to the new organization
                </p>
                <p>
                  5. <strong>Registry metadata</strong> — Title and homepage published to the apps
                  registry
                </p>
                <p>
                  6. <strong>Tenant config</strong> — A bos.config.json extending this gateway is
                  published to FastKV, making your app live at{" "}
                  <code className="font-mono">
                    {subdomain || "{subdomain}"}.{gatewayId}
                  </code>
                </p>
                <p>
                  7. <strong>Redirect</strong> — You're sent to your tenant listing
                </p>
                <p className="text-muted-foreground/60 pt-1">
                  Funded subaccount (≥0.1 NEAR). Parent retains full-access key for recovery. You
                  can delete and reclaim later.
                </p>
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </PageContainer>
  );
}
