import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAppTranslation } from "@/i18n/runtime";
import { deriveSlug } from "@/lib/slug";
import type { ApplicationForm } from "./-apply-form";
import type { NodeApplicationValues } from "./-node-application";
import { nodeApplicationKinds } from "./-node-application";

const DIRECT_COUNTRY_PARENT = "__direct-country__";

const kindMessages = {
  country: "apply.kind.country",
  state: "apply.kind.state",
  city: "apply.kind.city",
} as const;

type NodeOption = { id: string; name: string; kind: string | null };

export function ApplyNodeFields({
  form,
  formValues,
  gatewayId,
  hostname,
  preflight,
  preflightLoading,
  rootNodes,
  rootParentId,
  setRootParentId,
  slugManuallyEdited,
  stateNodes,
  statesLoading,
}: {
  form: ApplicationForm;
  formValues: NodeApplicationValues;
  gatewayId: string | null;
  hostname: string;
  preflight: { hostname: { available: boolean } } | undefined;
  preflightLoading: boolean;
  rootNodes: NodeOption[];
  rootParentId: string;
  setRootParentId: (value: string) => void;
  slugManuallyEdited: { current: boolean };
  stateNodes: NodeOption[];
  statesLoading: boolean;
}) {
  const t = useAppTranslation();
  const stateOptions = stateNodes.filter((node) => node.kind === "state");
  return (
    <>
      <form.Field name="kind">
        {(field) => (
          <Field>
            <FieldLabel id="application-kind-label">{t("apply.kind.label")}</FieldLabel>
            <ToggleGroup
              aria-labelledby="application-kind-label"
              variant="outline"
              value={[field.state.value]}
              onValueChange={(values) => {
                const kind = values[0] as NodeApplicationValues["kind"] | undefined;
                if (!kind) return;
                field.handleChange(kind);
                const parentId = kind === "country" ? null : rootParentId || null;
                form.setFieldValue("parentId", parentId, { dontUpdateMeta: true });
              }}
              data-testid="apply.kind"
            >
              {nodeApplicationKinds.map((kind) => (
                <ToggleGroupItem key={kind} value={kind} data-testid={`apply.kind-${kind}`}>
                  {t(kindMessages[kind])}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        )}
      </form.Field>

      {formValues.kind !== "country" && (
        <form.Field name="parentId">
          {(field) => {
            const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
            return (
              <div className="flex flex-col gap-4 sm:flex-row">
                <Field className="sm:flex-1" data-invalid={errors.length > 0 || undefined}>
                  <FieldLabel htmlFor="application-country">{t("apply.country.label")}</FieldLabel>
                  <Select
                    items={rootNodes.map((node) => ({ label: node.name, value: node.id }))}
                    value={rootParentId || null}
                    onValueChange={(countryId) => {
                      if (countryId === null) return;
                      setRootParentId(countryId);
                      field.handleChange(countryId);
                    }}
                  >
                    <SelectTrigger id="application-country" className="w-full">
                      <SelectValue placeholder={t("apply.country.choose")} />
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

                {formValues.kind === "city" && rootParentId && (
                  <Field className="sm:flex-1">
                    <FieldLabel htmlFor="application-state">{t("apply.state.label")}</FieldLabel>
                    <Select
                      value={
                        field.state.value === rootParentId
                          ? DIRECT_COUNTRY_PARENT
                          : (field.state.value ?? DIRECT_COUNTRY_PARENT)
                      }
                      items={[
                        { label: t("apply.state.none"), value: DIRECT_COUNTRY_PARENT },
                        ...stateOptions.map((node) => ({ label: node.name, value: node.id })),
                      ]}
                      onValueChange={(value) => {
                        if (value === null) return;
                        field.handleChange(value === DIRECT_COUNTRY_PARENT ? rootParentId : value);
                      }}
                    >
                      <SelectTrigger id="application-state" className="w-full">
                        <SelectValue
                          placeholder={t(
                            statesLoading ? "apply.state.loading" : "apply.state.choose",
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DIRECT_COUNTRY_PARENT}>
                          {t("apply.state.none")}
                        </SelectItem>
                        {stateOptions.map((node) => (
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
              <FieldLabel htmlFor="application-name">{t("apply.name.label")}</FieldLabel>
              <Input
                id="application-name"
                data-testid="apply.name"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const nextName = event.target.value;
                  field.handleChange(nextName);
                  form.setFieldValue(
                    "slug",
                    deriveSlug(nextName, form.getFieldValue("slug"), slugManuallyEdited.current),
                    { dontUpdateMeta: true },
                  );
                }}
                placeholder={t("apply.name.placeholder")}
                aria-invalid={errors.length > 0 || undefined}
              />
              <FieldError errors={errors} />
            </Field>
          );
        }}
      </form.Field>

      <form.Field name="slug">
        {(field) => {
          const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
          const available = preflight?.hostname.available;
          return (
            <Field data-invalid={errors.length > 0 || available === false || undefined}>
              <FieldLabel htmlFor="application-slug">{t("apply.slug.label")}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="application-slug"
                  data-testid="apply.slug"
                  className="font-mono"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    slugManuallyEdited.current = true;
                    field.setMeta((meta) => ({ ...meta, isTouched: true }));
                    field.handleChange(event.target.value.replace(/[^a-z0-9-]/g, ""));
                  }}
                  placeholder={t("apply.slug.placeholder")}
                  pattern="[a-z0-9-]+"
                  aria-invalid={errors.length > 0 || available === false || undefined}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>
                    <code className="font-mono">{gatewayId ? `.${gatewayId}` : ""}</code>
                  </InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription data-testid="apply.slug-status">
                {!hostname
                  ? t("apply.slug.rules")
                  : preflightLoading
                    ? t("apply.slug.checking")
                    : available === true
                      ? t("apply.slug.available", { hostname })
                      : available === false
                        ? t("apply.slug.taken", { hostname })
                        : hostname}
              </FieldDescription>
              <FieldError errors={errors} />
            </Field>
          );
        }}
      </form.Field>
    </>
  );
}
