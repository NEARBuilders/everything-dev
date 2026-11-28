import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { useForm, useSelector } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { organizationsQueryKey } from "@/lib/org-query-keys";
import { deriveSlug, generateSlug, suggestAvailableSlug } from "@/lib/slug";
import { useAuthApi } from "@/lib/use-auth-api";

export const Route = createFileRoute("/_authenticated/orgs/new")({
  head: () => ({
    meta: [
      { title: "New organization" },
      { name: "description", content: "Create a new organization." },
    ],
  }),
  component: NewOrganization,
});

function NewOrganization() {
  const router = useRouter();
  const api = useAuthApi();
  const queryClient = useQueryClient();
  const slugManuallyEdited = useRef(false);

  const createMutation = useMutation({
    mutationFn: async (values: { name: string; slug: string }) => {
      return api.createOrganization({ name: values.name, slug: values.slug });
    },
    onSuccess: async (data) => {
      toast.success(`Organization "${data?.name}" created`);
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
      await queryClient.refetchQueries({ queryKey: organizationsQueryKey });
      if (data?.slug) {
        await router.navigate({
          to: "/orgs/$slug",
          params: { slug: data.slug },
        });
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create organization");
    },
  });

  const form = useForm({
    defaultValues: {
      name: "",
      slug: "",
    },
    onSubmit: async ({ value }) => {
      await createMutation.mutateAsync(value);
    },
  });
  const formValues = useSelector(form.store, (state) => state.values);
  const slugValue = formValues.slug;

  const { data: slugCheck, isFetching: slugChecking } = useQuery({
    queryKey: ["org-slug-check", slugValue],
    queryFn: () => api.checkSlug({ slug: slugValue }),
    enabled: /^[a-z0-9-]+$/.test(slugValue),
    staleTime: 5_000,
  });
  const slugTaken = slugValue && slugCheck ? !slugCheck.status : false;

  useEffect(() => {
    if (!slugTaken || slugManuallyEdited.current) return;
    const base = generateSlug(formValues.name);
    if (!base || base === slugValue) return;
    let cancelled = false;
    void suggestAvailableSlug(base, async (candidate) => {
      const result = await api.checkSlug({ slug: candidate });
      return !result.status;
    }).then((suggestion) => {
      if (!cancelled && suggestion && suggestion !== slugValue) {
        form.setFieldValue("slug", suggestion, { dontUpdateMeta: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [slugTaken, formValues.name, slugValue, form, api]);

  const slugStatus = slugChecking
    ? "checking"
    : slugTaken
      ? "taken"
      : slugValue
        ? "available"
        : "idle";

  return (
    <PageContainer variant="narrow">
      <PageHeader
        title="New organization"
        description="Request an organization. Once a platform admin approves it, you'll be the owner and can invite people."
        headerTestId="orgs.new.heading"
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-8"
      >
        <FieldGroup>
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => (!value.trim() ? "Name is required" : undefined),
            }}
          >
            {(field) => {
              const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
              return (
                <Field data-invalid={errors.length > 0 || undefined}>
                  <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="text"
                    autoFocus
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                      form.setFieldValue(
                        "slug",
                        deriveSlug(
                          e.target.value,
                          form.getFieldValue("slug"),
                          slugManuallyEdited.current,
                        ),
                        { dontUpdateMeta: true },
                      );
                    }}
                    placeholder="My Team"
                    aria-invalid={errors.length > 0 || undefined}
                  />
                  {errors.length > 0 ? <FieldError>{errors.join(", ")}</FieldError> : null}
                </Field>
              );
            }}
          </form.Field>

          <form.Field
            name="slug"
            validators={{
              onChange: ({ value }) => {
                if (!value) return "Handle is required";
                if (!/^[a-z0-9-]+$/.test(value)) {
                  return "Use lowercase letters, numbers and hyphens";
                }
                return undefined;
              },
            }}
          >
            {(field) => {
              const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
              return (
                <Field data-invalid={errors.length > 0 || undefined}>
                  <FieldLabel htmlFor={field.name}>Handle</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <InputGroupText>@</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id={field.name}
                      name={field.name}
                      type="text"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        slugManuallyEdited.current = true;
                        field.setMeta((meta) => ({ ...meta, isTouched: true }));
                        field.handleChange(event.target.value.replace(/[^a-z0-9-]/g, ""));
                      }}
                      placeholder="my-team"
                      pattern="[a-z0-9-]+"
                      className="font-mono"
                      aria-invalid={errors.length > 0 || undefined}
                    />
                    <InputGroupAddon align="inline-end" data-testid="orgs.new.slug-status">
                      {slugStatus === "checking" ? (
                        <Spinner />
                      ) : slugStatus === "available" ? (
                        <CheckCircleIcon className="text-success" aria-label="available" />
                      ) : slugStatus === "taken" ? (
                        <XCircleIcon className="text-destructive" aria-label="taken" />
                      ) : null}
                    </InputGroupAddon>
                  </InputGroup>
                  {errors.length > 0 ? (
                    <FieldError>{errors.join(", ")}</FieldError>
                  ) : (
                    <FieldDescription>
                      {slugStatus === "taken"
                        ? "Taken. We'll suggest a free one, or pick your own."
                        : "Used in links to your organization."}
                    </FieldDescription>
                  )}
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>

        <div className="flex flex-wrap items-center gap-3">
          <form.Subscribe
            selector={(state) =>
              state.canSubmit && !!state.values.name.trim() && !!state.values.slug
            }
          >
            {(canSubmit) => (
              <Button
                type="submit"
                disabled={createMutation.isPending || !canSubmit}
                data-testid="orgs.new.submit"
              >
                {createMutation.isPending ? "Submitting…" : "Request organization"}
              </Button>
            )}
          </form.Subscribe>
          <Button variant="ghost" nativeButton={false} render={<Link to="/orgs" />}>
            Cancel
          </Button>
        </div>
      </form>
    </PageContainer>
  );
}
