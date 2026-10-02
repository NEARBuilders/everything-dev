import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useAppTranslation } from "@/i18n/runtime";
import type { ApplicationForm } from "./-apply-form";

export function ApplyApplicantFields({ form }: { form: ApplicationForm }) {
  const t = useAppTranslation();
  return (
    <form.Field name="motivation">
      {(field) => {
        const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
        return (
          <Field data-invalid={errors.length > 0 || undefined}>
            <FieldLabel htmlFor="application-motivation">{t("apply.motivation.label")}</FieldLabel>
            <Textarea
              id="application-motivation"
              data-testid="apply.motivation"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              rows={5}
              placeholder={t("apply.motivation.placeholder")}
              aria-invalid={errors.length > 0 || undefined}
            />
            <FieldDescription>{t("apply.motivation.description")}</FieldDescription>
            <FieldError errors={errors} />
          </Field>
        );
      }}
    </form.Field>
  );
}
