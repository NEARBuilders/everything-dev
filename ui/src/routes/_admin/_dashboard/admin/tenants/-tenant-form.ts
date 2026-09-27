import { useForm } from "@tanstack/react-form";
import { type TenantWizardValues, tenantWizardSchema } from "./-tenant-wizard";

export const tenantWizardDefaultValues: TenantWizardValues = {
  kind: "country",
  parentId: "",
  name: "",
  slug: "",
  tenantName: "",
};

export function useTenantWizardForm(onSubmit: (values: TenantWizardValues) => Promise<unknown>) {
  return useForm({
    defaultValues: tenantWizardDefaultValues,
    validators: {
      onChange: tenantWizardSchema,
      onSubmit: tenantWizardSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}

export type TenantWizardForm = ReturnType<typeof useTenantWizardForm>;
