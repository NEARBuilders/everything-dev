import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { ApplicationForm } from "./-apply-form";

export function ApplyApplicantFields({ form }: { form: ApplicationForm }) {
  return (
    <form.Field name="motivation">
      {(field) => {
        const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
        return (
          <Field data-invalid={errors.length > 0 || undefined}>
            <FieldLabel htmlFor="application-motivation">Why you want to run it</FieldLabel>
            <Textarea
              id="application-motivation"
              data-testid="apply.motivation"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              rows={5}
              placeholder="Who is the community, and what will you do for it?"
              aria-invalid={errors.length > 0 || undefined}
            />
            <FieldDescription>Reviewers read this before approving.</FieldDescription>
            <FieldError errors={errors} />
          </Field>
        );
      }}
    </form.Field>
  );
}
