import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { type ApiClient, useApiClient } from "@/app";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type Activity = Awaited<ReturnType<ApiClient["saveDiscoveryActivity"]>>;
export type ActivityDraft = Parameters<ApiClient["saveDiscoveryActivity"]>[0];
export type ActivityKind = "event" | "social";

export function blankActivity(nodeId: string, kind: ActivityKind): ActivityDraft {
  return {
    ownerNodeId: nodeId,
    nodeIds: [nodeId],
    kind,
    title: "",
    summary: "",
    url: "",
    source: "",
    publishedAt: new Date().toISOString(),
    startsAt: null,
    endsAt: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    venue: "",
    status: "draft",
  };
}

export function activitiesQueryOptions(api: ApiClient, nodeId: string) {
  return {
    queryKey: ["discovery-activities", nodeId],
    queryFn: () => api.listDiscoveryActivities({ nodeId }),
    retry: false,
  };
}

export function ActivityFormPage({
  nodeId,
  title,
  description,
  headerTestId,
  children,
}: {
  nodeId: string;
  title: ReactNode;
  description?: ReactNode;
  headerTestId: string;
  children: ReactNode;
}) {
  return (
    <PageContainer variant="narrow">
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 self-start"
          nativeButton={false}
          data-testid="activity-form.back"
          render={
            <Link to="/nodes/$nodeId/content" params={{ nodeId }} search={{ tab: "events" }} />
          }
        >
          <ArrowLeftIcon />
          Events
        </Button>
        <PageHeader title={title} description={description} headerTestId={headerTestId} />
      </div>
      {children}
    </PageContainer>
  );
}

export function ActivityForm({
  nodeId,
  initial,
  imported,
}: {
  nodeId: string;
  initial: ActivityDraft;
  imported?: Activity["luma"];
}) {
  const api = useApiClient();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ActivityDraft>(initial);
  const nodes = useQuery({
    queryKey: ["discovery-editor-nodes"],
    queryFn: () => api.listNodes({}),
  });
  const backToEvents = () =>
    navigate({ to: "/nodes/$nodeId/content", params: { nodeId }, search: { tab: "events" } });
  const save = useMutation({
    mutationFn: (input: ActivityDraft) => api.saveDiscoveryActivity(input),
    onSuccess: async (saved) => {
      toast.success(saved.status === "published" ? "Published on Explore" : "Saved");
      await client.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("discovery"),
      });
      await backToEvents();
    },
  });
  const update = (key: keyof ActivityDraft, value: string | null) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const locked = Boolean(imported);

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(draft);
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="activity-title">Title</FieldLabel>
          <Input
            id="activity-title"
            readOnly={locked}
            required
            maxLength={160}
            value={draft.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="activity-summary">Summary</FieldLabel>
          <Textarea
            readOnly={locked}
            id="activity-summary"
            maxLength={2000}
            value={draft.summary}
            onChange={(e) => update("summary", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="activity-url">Link</FieldLabel>
          <Input
            id="activity-url"
            readOnly={locked}
            required
            type="url"
            maxLength={2000}
            placeholder="https://"
            value={draft.url}
            onChange={(e) => update("url", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="activity-source">Organizer</FieldLabel>
          <Input
            id="activity-source"
            readOnly={locked}
            required
            maxLength={160}
            value={draft.source}
            onChange={(e) => update("source", e.target.value)}
          />
        </Field>
      </FieldGroup>
      {draft.kind === "event" ? (
        <FieldSet>
          <FieldLegend>When and where</FieldLegend>
          <FieldGroup>
            {(
              [
                ["startsAt", "Starts"],
                ["endsAt", "Ends"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key}>
                <FieldLabel htmlFor={`activity-${key}`}>{label}</FieldLabel>
                <Input
                  id={`activity-${key}`}
                  readOnly={locked}
                  type="datetime-local"
                  required
                  value={localTime(draft[key])}
                  onChange={(e) =>
                    update(key, e.target.value ? new Date(e.target.value).toISOString() : null)
                  }
                />
              </Field>
            ))}
            <Field>
              <FieldLabel htmlFor="activity-timezone">Event timezone</FieldLabel>
              <Input
                readOnly={locked}
                id="activity-timezone"
                required
                value={draft.timezone}
                onChange={(e) => update("timezone", e.target.value)}
              />
              <FieldDescription>
                Enter times in your own timezone; visitors see them in this one.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="activity-venue">Venue or meeting link</FieldLabel>
              <Input
                readOnly={locked}
                id="activity-venue"
                required
                value={draft.venue}
                onChange={(e) => update("venue", e.target.value)}
              />
            </Field>
          </FieldGroup>
        </FieldSet>
      ) : (
        <Field>
          <FieldLabel htmlFor="activity-published">Posted on</FieldLabel>
          <Input
            readOnly={locked}
            id="activity-published"
            type="datetime-local"
            required
            value={localTime(draft.publishedAt)}
            onChange={(e) =>
              update("publishedAt", e.target.value ? new Date(e.target.value).toISOString() : "")
            }
          />
        </Field>
      )}
      {draft.kind === "event" && (nodes.data?.length ?? 0) > 1 && (
        <FieldSet>
          <FieldLegend variant="label">Also show in</FieldLegend>
          <FieldGroup>
            {nodes.data
              ?.filter((n) => n.id !== nodeId)
              .map((n) => (
                <Field orientation="horizontal" key={n.id}>
                  <Checkbox
                    id={`activity-node-${n.id}`}
                    checked={draft.nodeIds.includes(n.id)}
                    onCheckedChange={(checked) =>
                      setDraft({
                        ...draft,
                        nodeIds: checked
                          ? [...draft.nodeIds, n.id]
                          : draft.nodeIds.filter((id) => id !== n.id),
                      })
                    }
                  />
                  <FieldLabel htmlFor={`activity-node-${n.id}`}>{n.name}</FieldLabel>
                </Field>
              ))}
          </FieldGroup>
        </FieldSet>
      )}
      <Field>
        <FieldLabel htmlFor="activity-status">Visibility</FieldLabel>
        <Select
          items={[
            { label: "Draft", value: "draft" },
            { label: "Published on Explore", value: "published" },
            { label: "Cancelled", value: "cancelled" },
          ]}
          value={draft.status}
          onValueChange={(value) => {
            if (value === "draft" || value === "published" || value === "cancelled")
              setDraft({ ...draft, status: value });
          }}
        >
          <SelectTrigger id="activity-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published" disabled={imported?.available === false}>
              Published on Explore
            </SelectItem>
            {draft.kind === "event" && (
              <SelectItem value="cancelled" disabled={imported?.available === false}>
                Cancelled
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>
      {save.isError && (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" data-testid="discovery-activity-save" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="ghost"
          data-testid="discovery-activity-cancel"
          nativeButton={false}
          render={
            <Link to="/nodes/$nodeId/content" params={{ nodeId }} search={{ tab: "events" }} />
          }
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function localTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
