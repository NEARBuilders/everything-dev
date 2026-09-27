import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { pluginPath, pluginSearch, useApiClient } from "@/app";
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageContainer,
  PageHeader,
  Textarea,
} from "@/components";
import { FieldGroup } from "@/components/ui/field";
import { pageTitle } from "@/lib/page-title";
import { invalidateThingAfterProposal } from "./-thing-cache";
import {
  DEFAULT_THING_PAYLOAD,
  formatThingPayload,
  isSignInError,
  parseThingPayload,
} from "./-thing-form";

export const Route = createFileRoute("/_authenticated/_dashboard/things/new")({
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("New Thing", match.context.runtimeConfig) },
      { name: "description", content: "Submit a new thing for community review." },
    ],
  }),
  component: CreateThingPage,
});

function CreateThingPage() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [thingId, setThingId] = useState("");
  const [payloadRaw, setPayloadRaw] = useState(DEFAULT_THING_PAYLOAD);
  const payload = parseThingPayload(payloadRaw);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!thingId.trim()) throw new Error("thingId is required");
      const parsed = parseThingPayload(payloadRaw);
      if (!parsed.ok) throw new Error("Invalid JSON payload");
      return apiClient.proposals.propose({
        pluginId: "template",
        entityId: thingId.trim(),
        payload: parsed.value,
        source: "things/new",
      });
    },
    onSuccess: async ({ data: proposal }) => {
      toast.success("Proposal submitted", {
        description: "Your thing is pending admin review.",
      });
      try {
        await invalidateThingAfterProposal(queryClient, proposal.entityId);
      } catch {
        toast.warning("Proposal submitted, but its review status could not refresh.");
      }
      void navigate({
        to: "/things/$thingId",
        params: { thingId: proposal.entityId },
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submitError = submitMutation.isError ? submitMutation.error : null;
  const needsSignIn = submitError ? isSignInError(submitError) : false;

  return (
    <PageContainer variant="narrow">
      <PageHeader
        title="New thing"
        description="An admin reviews it before it goes live."
        headerTestId="things.new.heading"
      />

      <form
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          submitMutation.mutate();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="thing-id">Thing ID</FieldLabel>
            <Input
              id="thing-id"
              type="text"
              className="font-mono"
              value={thingId}
              onChange={(e) => setThingId(e.target.value)}
              placeholder="community-garden"
              autoComplete="off"
              data-testid="things-new-id"
            />
            <FieldDescription>Must be unique.</FieldDescription>
          </Field>

          <Field data-invalid={!payload.ok || undefined}>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel htmlFor="payload-json">Payload</FieldLabel>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={!payload.ok}
                onClick={() => setPayloadRaw(formatThingPayload(payloadRaw))}
              >
                Format
              </Button>
            </div>
            <Textarea
              id="payload-json"
              className="font-mono"
              value={payloadRaw}
              onChange={(e) => setPayloadRaw(e.target.value)}
              rows={10}
              spellCheck={false}
              aria-invalid={!payload.ok || undefined}
              data-testid="things-new-payload"
            />
            {payload.ok ? (
              <FieldDescription>JSON object stored with the thing.</FieldDescription>
            ) : (
              <FieldError>{payload.error}</FieldError>
            )}
          </Field>
        </FieldGroup>

        {submitError && (
          <div className="flex flex-col gap-1" role="alert" data-testid="things-new-error">
            <p className="text-sm text-destructive">
              {needsSignIn
                ? "Your session has expired."
                : submitError.message || "Unable to submit this proposal."}
            </p>
            {needsSignIn && (
              <Link
                to={pluginPath("/login")}
                search={pluginSearch({ redirect: "/things/new" })}
                className="text-sm font-medium text-foreground underline underline-offset-4"
              >
                Sign in again
              </Link>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="submit"
            disabled={submitMutation.isPending || !thingId.trim() || !payload.ok}
            data-testid="things-new-submit"
          >
            {submitMutation.isPending ? "Submitting…" : "Submit for review"}
          </Button>
          <Button variant="ghost" nativeButton={false} render={<Link to="/things" />}>
            Cancel
          </Button>
        </div>
      </form>
    </PageContainer>
  );
}
