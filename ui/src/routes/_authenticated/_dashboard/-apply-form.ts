import { useForm } from "@tanstack/react-form";
import type { NodeApplicationValues } from "./-node-application";
import { nodeApplicationSchema } from "./-node-application";

const defaultValues: NodeApplicationValues = {
  kind: "country",
  parentId: null,
  name: "",
  slug: "",
  motivation: "",
};

export function useApplicationForm(onSubmit: (values: NodeApplicationValues) => Promise<unknown>) {
  return useForm({
    defaultValues,
    validators: { onChange: nodeApplicationSchema, onSubmit: nodeApplicationSchema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
}

export type ApplicationForm = ReturnType<typeof useApplicationForm>;
