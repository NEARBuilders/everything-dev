import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { type ApiClient, useApiClient } from "@/app";
import {
  Button,
  Card,
  CardContent,
  Field,
  FieldLabel,
  LocalDate,
  PageHeader,
  Textarea,
} from "@/components";
import { pageTitle } from "@/lib/page-title";

const requestsKey = ["organization-requests"];
type Request = Awaited<ReturnType<ApiClient["auth"]["listOrganizationRequests"]>>[number];

export const Route = createFileRoute("/_admin/_dashboard/admin/organizations")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Organization requests", match.context.runtimeConfig) }],
  }),
  component: OrganizationRequests,
});

function OrganizationRequests() {
  const api = useApiClient();
  const requests = useQuery({
    queryKey: requestsKey,
    queryFn: () => api.auth.listOrganizationRequests(),
  });
  return (
    <>
      <PageHeader
        title="Organization requests"
        description="Approve an organization to activate it with its requester as owner."
        headerTestId="admin-organizations.heading"
      />
      {requests.isPending ? (
        <p className="text-sm text-muted-foreground">Loading requests…</p>
      ) : requests.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {requests.error.message}
        </p>
      ) : requests.data.length === 0 ? (
        <p data-testid="admin-organizations-empty">No pending organization requests.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {requests.data.map((request) => (
            <OrganizationRequest key={request.id} request={request} />
          ))}
        </div>
      )}
    </>
  );
}

function OrganizationRequest({ request }: { request: Request }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const review = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      api.auth.reviewOrganization(
        decision === "approve"
          ? { organizationId: request.id, decision }
          : { organizationId: request.id, decision, reason },
      ),
    onSuccess: async (_, decision) => {
      toast.success(decision === "approve" ? "Organization approved" : "Organization rejected");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: requestsKey }),
        queryClient.invalidateQueries({ queryKey: ["organizations"] }),
      ]);
      await router.invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Card data-testid={`admin-org-request-${request.slug}`}>
      <CardContent className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-lg font-medium">{request.name}</h2>
          <p className="text-sm text-muted-foreground">
            @{request.slug} · Requested <LocalDate value={request.createdAt} format="relative" />
          </p>
          <p className="break-all text-sm text-muted-foreground">
            Requester: {request.requestedBy}
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor={`reason-${request.id}`}>Rejection reason</FieldLabel>
          <Textarea
            id={`reason-${request.id}`}
            data-testid="admin-org-rejection-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={2000}
            placeholder="Explain why this request cannot be approved"
          />
        </Field>
        <div className="flex gap-2">
          <Button
            data-testid="admin-org-approve"
            disabled={review.isPending}
            onClick={() => review.mutate("approve")}
          >
            Approve
          </Button>
          <Button
            variant="destructive"
            data-testid="admin-org-reject"
            disabled={review.isPending || !reason.trim()}
            onClick={() => review.mutate("reject")}
          >
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
