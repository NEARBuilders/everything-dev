import { GlobeIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { FormEvent, MutableRefObject } from "react";
import type { ApiClient } from "@/app";
import { Badge, Button, Field, FieldError, FieldLabel, InfoRow, Input } from "@/components";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { humanize } from "../-admin-ui";
import type { TenantWizardForm } from "./-tenant-form";
import { deriveTenantWizardNameFields, type NodeKind, nodeKinds } from "./-tenant-wizard";

type Node = Awaited<ReturnType<ApiClient["listRootNodes"]>>[number];
type BindingPreflight = Awaited<ReturnType<ApiClient["bindingPreflight"]>>;

const DIRECT_COUNTRY_PARENT = "__direct-country__";

export function TenantDetailsFields({
  form,
  kind,
  rootNodes,
  stateNodes,
  rootParentId,
  setRootParentId,
  slugManuallyEdited,
  tenantNameManuallyEdited,
  hostname,
  preflight,
  canContinue,
  onContinue,
}: {
  form: TenantWizardForm;
  kind: NodeKind;
  rootNodes: Node[];
  stateNodes: Node[];
  rootParentId: string;
  setRootParentId: (value: string) => void;
  slugManuallyEdited: MutableRefObject<boolean>;
  tenantNameManuallyEdited: MutableRefObject<boolean>;
  hostname: string;
  preflight: BindingPreflight | undefined;
  canContinue: boolean;
  onContinue: () => void;
}) {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <FieldGroup>
        <form.Field name="kind">
          {(field) => (
            <Field>
              <FieldLabel id="tenant-kind-label">Kind</FieldLabel>
              <ToggleGroup
                aria-labelledby="tenant-kind-label"
                variant="outline"
                value={[field.state.value]}
                onValueChange={(values) => {
                  const nodeKind = nodeKinds.find((value) => value === values[0]);
                  if (!nodeKind) return;
                  field.handleChange(nodeKind);
                  const nextRootParentId =
                    nodeKind === "country" ? "" : rootParentId || rootNodes[0]?.id || "";
                  setRootParentId(nextRootParentId);
                  form.setFieldValue("parentId", nextRootParentId, { dontUpdateMeta: true });
                }}
                data-testid="admin-tenant-kind"
              >
                {nodeKinds.map((nodeKind) => (
                  <ToggleGroupItem key={nodeKind} value={nodeKind}>
                    {humanize(nodeKind)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          )}
        </form.Field>

        {kind !== "country" && (
          <form.Field name="parentId">
            {(field) => {
              const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
              const countryValue = kind === "city" ? rootParentId : field.state.value;
              return (
                <div className="flex flex-col gap-4 sm:flex-row">
                  <Field className="sm:flex-1" data-invalid={errors.length > 0 || undefined}>
                    <FieldLabel htmlFor="parent-root">Country</FieldLabel>
                    <Select
                      value={countryValue}
                      items={rootNodes.map((node) => ({ label: node.name, value: node.id }))}
                      onValueChange={(value) => {
                        if (value === null) return;
                        setRootParentId(value);
                        field.handleChange(value);
                      }}
                      required
                    >
                      <SelectTrigger
                        id="parent-root"
                        className="w-full"
                        aria-invalid={errors.length > 0 || undefined}
                      >
                        <SelectValue placeholder="Choose a country" />
                      </SelectTrigger>
                      <SelectContent>
                        {rootNodes.map((node) => (
                          <SelectItem key={node.id} value={node.id}>
                            {node.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={errors} />
                  </Field>

                  {kind === "city" && rootParentId && stateNodes.length > 0 && (
                    <Field className="sm:flex-1">
                      <FieldLabel htmlFor="parent-state">State</FieldLabel>
                      <Select
                        value={
                          field.state.value === rootParentId
                            ? DIRECT_COUNTRY_PARENT
                            : field.state.value
                        }
                        items={[
                          { label: "None", value: DIRECT_COUNTRY_PARENT },
                          ...stateNodes.map((node) => ({ label: node.name, value: node.id })),
                        ]}
                        onValueChange={(value) => {
                          if (value === null) return;
                          field.handleChange(
                            value === DIRECT_COUNTRY_PARENT ? rootParentId : value,
                          );
                        }}
                      >
                        <SelectTrigger id="parent-state" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DIRECT_COUNTRY_PARENT}>None</SelectItem>
                          {stateNodes.map((node) => (
                            <SelectItem key={node.id} value={node.id}>
                              {node.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </div>
              );
            }}
          </form.Field>
        )}

        <form.Field name="name">
          {(field) => {
            const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
            return (
              <Field data-invalid={errors.length > 0 || undefined}>
                <FieldLabel htmlFor="node-name">Name</FieldLabel>
                <Input
                  id="node-name"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    const value = event.target.value;
                    const derived = deriveTenantWizardNameFields(
                      value,
                      {
                        slug: form.getFieldValue("slug"),
                        tenantName: form.getFieldValue("tenantName"),
                      },
                      {
                        slug: slugManuallyEdited.current,
                        tenantName: tenantNameManuallyEdited.current,
                      },
                    );

                    field.handleChange(value);
                    if (!slugManuallyEdited.current) {
                      form.setFieldValue("slug", derived.slug, { dontUpdateMeta: true });
                    }
                    if (!tenantNameManuallyEdited.current) {
                      form.setFieldValue("tenantName", derived.tenantName, {
                        dontUpdateMeta: true,
                      });
                    }
                  }}
                  placeholder="Chicago"
                  aria-invalid={errors.length > 0 || undefined}
                  required
                />
                <FieldError errors={errors} />
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="slug">
          {(field) => {
            const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
            return (
              <Field data-invalid={errors.length > 0 || undefined}>
                <FieldLabel htmlFor="node-slug">Address</FieldLabel>
                <Input
                  id="node-slug"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    slugManuallyEdited.current = true;
                    field.setMeta((meta) => ({ ...meta, isTouched: true }));
                    field.handleChange(event.target.value.replace(/[^a-z0-9-]/g, ""));
                  }}
                  placeholder="chicago"
                  pattern="[a-z0-9-]+"
                  aria-invalid={errors.length > 0 || undefined}
                  required
                  className="font-mono"
                />
                <div
                  className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
                  data-testid="admin-tenant-hostname"
                >
                  <GlobeIcon className="size-4 shrink-0" />
                  <span className="min-w-0 font-mono break-all">{hostname || "—"}</span>
                  {preflight?.hostname.available === true && (
                    <Badge variant="success">Available</Badge>
                  )}
                  {preflight?.hostname.available === false && (
                    <Badge variant="destructive">Taken</Badge>
                  )}
                </div>
                <FieldError errors={errors} />
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="tenantName">
          {(field) => {
            const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
            return (
              <Field data-invalid={errors.length > 0 || undefined}>
                <FieldLabel htmlFor="tenant-name">Site name</FieldLabel>
                <Input
                  id="tenant-name"
                  name={field.name}
                  value={field.state.value}
                  placeholder="Chicago City Node"
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    tenantNameManuallyEdited.current = true;
                    field.setMeta((meta) => ({ ...meta, isTouched: true }));
                    field.handleChange(event.target.value);
                  }}
                  aria-invalid={errors.length > 0 || undefined}
                  required
                />
                <FieldDescription>Shown as the site title. Defaults to the name.</FieldDescription>
                <FieldError errors={errors} />
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>

      <Button
        type="button"
        className="w-full sm:w-auto sm:self-start"
        disabled={!canContinue}
        onClick={onContinue}
        data-testid="admin-tenant-details-continue"
      >
        Continue
      </Button>
    </div>
  );
}

export function TenantReview({
  summary,
  baseAccount,
  gatewayId,
  submitPending,
  canSubmit,
  blockedReason,
  onSubmit,
}: {
  summary: {
    name: string;
    kind: NodeKind;
    parentName: string | null;
    tenantName: string;
    hostname: string;
    daoAccountId: string | null;
  };
  baseAccount: string;
  gatewayId: string | null;
  submitPending: boolean;
  canSubmit: boolean;
  blockedReason: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col">
        <InfoRow
          label="Community"
          value={`${summary.name} · ${humanize(summary.kind)}${summary.parentName ? ` in ${summary.parentName}` : ""}`}
        />
        <InfoRow label="Site" value={summary.tenantName} />
        <InfoRow label="Address" value={summary.hostname} mono />
        <InfoRow label="Owning DAO" value={summary.daoAccountId ?? "—"} mono />
        <InfoRow
          label="Extends"
          value={gatewayId ? `bos://${baseAccount}/${gatewayId}` : "—"}
          mono
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Creates the tenant, its node and domain; you'll publish its settings through the DAO next.
      </p>
      {blockedReason && (
        <p role="alert" className="text-sm text-destructive">
          {blockedReason}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="submit"
          disabled={submitPending || !canSubmit}
          data-testid="admin-tenant-create"
        >
          {submitPending ? "Creating…" : "Create site"}
        </Button>
        <Button variant="ghost" nativeButton={false} render={<Link to="/admin/tenants" />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
