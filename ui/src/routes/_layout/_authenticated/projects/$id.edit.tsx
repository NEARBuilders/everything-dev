import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { ProjectFormLayout, type ProjectFormValues } from "@/components/project-form";
import { parseProjectListSearch } from "./-search";

function isCurrentUserOwner(
  ownerId: string | null | undefined,
  user:
    | { id?: string | null; walletAddress?: string | null; role?: string | null }
    | null
    | undefined,
  nearAccountId?: string | null,
) {
  if (!ownerId) return false;
  return [nearAccountId, user?.walletAddress, user?.id].some((candidate) => candidate === ownerId);
}

type SearchParams = ReturnType<typeof parseProjectListSearch> & {
  tab: "write" | "preview";
};

export const Route = createFileRoute("/_layout/_authenticated/projects/$id/edit")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    ...parseProjectListSearch(search),
    tab: search.tab === "preview" ? "preview" : "write",
  }),
  head: () => ({
    meta: [
      { title: "Edit | Projects" },
      { name: "description", content: "Edit a project or idea." },
    ],
  }),
  loader: async ({ params }) => ({ projectId: params.id }),
  component: EditProjectPage,
});

function EditProjectPage() {
  const { id: projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const search = Route.useSearch();
  const { tab } = search;

  const { data: session } = useQuery(sessionQueryOptions(auth, undefined));
  const nearAccountId = auth.near.getAccountId();
  const isAdmin = session?.user?.role === "admin";

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => apiClient.projects.getProject({ id: projectId }),
  });

  const project = projectQuery.data?.data;

  const defaultOwnerId =
    nearAccountId ??
    (session?.user as { walletAddress?: string | null } | null)?.walletAddress ??
    session?.user?.id ??
    "";

  const canManage = isAdmin || isCurrentUserOwner(project?.ownerId, session?.user, nearAccountId);

  const setTab = (value: string) => {
    void navigate({
      search: {
        tab: value as "write" | "preview",
        kind: search.kind,
        personal: search.personal,
        private: search.private,
      },
      replace: true,
    });
  };

  const updateMutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      apiClient.projects.updateProject({
        id: projectId,
        kind: values.kind,
        title: values.title.trim(),
        description: values.description?.trim() || undefined,
        repository: values.kind === "project" ? values.repository?.trim() || undefined : undefined,
        content: values.kind === "idea" ? values.content?.trim() || undefined : undefined,
        visibility: values.visibility,
        status: values.status,
        domain: values.domain?.trim() || undefined,
        ownerId:
          isAdmin && (values.ownerId?.trim() ?? "") !== (project?.ownerId ?? "")
            ? values.ownerId?.trim() || undefined
            : undefined,
      }),
    onSuccess: () => {
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate({
        to: "/projects/$id",
        params: { id: projectId },
        search: {
          kind: search.kind,
          personal: search.personal,
          private: search.private,
        },
      });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.projects.deleteProject({ id: projectId }),
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate({
        to: "/projects",
        search: {
          preview: undefined,
          kind: search.kind,
          personal: search.personal,
          private: search.private,
        },
      });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete"),
  });

  if (projectQuery.isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-6 py-3">
          <div
            style={{ height: 20, width: 120, borderRadius: 6 }}
            className="animate-pulse bg-secondary"
          />
        </div>
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div
            style={{ height: 32, width: 300, borderRadius: 8 }}
            className="animate-pulse bg-secondary"
          />
        </div>
      </div>
    );
  }

  if (projectQuery.isError || !project) {
    return (
      <div className="flex min-h-[calc(100dvh-48px)] flex-col items-center justify-center gap-4">
        <p style={{ fontSize: 16, fontWeight: 600 }} className="text-foreground">
          Project not found.
        </p>
        <Link
          to="/projects"
          search={{
            preview: undefined,
            kind: search.kind,
            personal: search.personal,
            private: search.private,
          }}
          className="text-brand-accent"
          style={{ fontWeight: 700, fontSize: 14, textDecoration: "none" }}
        >
          ← Back to projects
        </Link>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex min-h-[calc(100dvh-48px)] flex-col items-center justify-center gap-4">
        <p style={{ fontSize: 16, fontWeight: 600 }} className="text-foreground">
          You don't have permission to edit this project.
        </p>
        <Link
          to="/projects/$id"
          params={{ id: projectId }}
          search={{
            kind: search.kind,
            personal: search.personal,
            private: search.private,
          }}
          className="text-brand-accent"
          style={{ fontWeight: 700, fontSize: 14, textDecoration: "none" }}
        >
          ← Back to project
        </Link>
      </div>
    );
  }

  return (
    <EditFormInner
      project={project}
      projectId={projectId}
      isAdmin={isAdmin}
      defaultOwnerId={defaultOwnerId}
      search={search}
      tab={tab}
      setTab={setTab}
      updateMutation={updateMutation}
      deleteMutation={deleteMutation}
    />
  );
}

function EditFormInner({
  project,
  projectId,
  isAdmin,
  defaultOwnerId,
  search,
  tab,
  setTab,
  updateMutation,
  deleteMutation,
}: {
  project: any;
  projectId: string;
  isAdmin: boolean;
  defaultOwnerId: string;
  search: SearchParams;
  tab: "write" | "preview";
  setTab: (tab: "write" | "preview") => void;
  updateMutation: any;
  deleteMutation: any;
}) {
  const form = useForm({
    defaultValues: {
      kind: project.kind as "project" | "idea",
      title: project.title ?? "",
      description: project.description ?? "",
      repository: project.repository ?? "",
      content: project.content ?? "",
      visibility: (project.visibility ?? "public") as "private" | "unlisted" | "public",
      status: (project.status ?? "active") as "active" | "paused" | "archived",
      ownerId: project.ownerId ?? "",
      domain: project.domain ?? "",
    } satisfies ProjectFormValues,
    canSubmitWhenInvalid: true,
    onSubmit: async ({ value }) => {
      await updateMutation.mutateAsync(value);
    },
    onSubmitInvalid: () => {
      toast.error("Please fix the highlighted fields before saving.");
    },
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
        <div className="flex items-center gap-3">
          <Link
            to="/projects/$id"
            params={{ id: projectId }}
            search={{
              kind: search.kind,
              personal: search.personal,
              private: search.private,
            }}
            aria-label="Back to project"
            className="flex items-center justify-center w-8 h-8 border-2 border-outset border-border-strong bg-card shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:bg-muted rounded-[10px]"
          >
            <ArrowLeft size={13} className="text-foreground" />
          </Link>
          <span className="text-border">/</span>
          <span style={{ fontSize: 13, fontWeight: 600 }} className="text-foreground">
            Edit
          </span>
        </div>

        <div className="flex items-center gap-2">
          <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting })}>
            {({ isSubmitting }) => (
              <PillButton
                onClick={() => form.handleSubmit()}
                disabled={isSubmitting || updateMutation.isPending}
                primary
              >
                {updateMutation.isPending ? "Saving…" : "Save"}
              </PillButton>
            )}
          </form.Subscribe>

          <PillButton
            onClick={() => {
              if (confirm("Delete this project permanently?")) deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
            danger
          >
            <Trash2 size={13} />
            Delete
          </PillButton>

          <Link
            to="/projects/$id"
            params={{ id: projectId }}
            search={{
              kind: search.kind,
              personal: search.personal,
              private: search.private,
            }}
            className="bg-secondary text-foreground hover:bg-border"
            style={{
              height: 34,
              padding: "0 14px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              textDecoration: "none",
              transition: "background 0.12s",
            }}
          >
            <X size={13} />
            Cancel
          </Link>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="flex flex-1 overflow-y-auto lg:min-h-0 lg:overflow-hidden"
      >
        <ProjectFormLayout
          form={form}
          mode="edit"
          isAdmin={isAdmin}
          defaultOwnerId={defaultOwnerId}
          tab={tab}
          setTab={setTab}
        />
      </form>
    </div>
  );
}

function PillButton({
  onClick,
  disabled,
  children,
  primary,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${
        disabled
          ? "bg-disabled text-primary-foreground"
          : primary
            ? "bg-primary text-primary-foreground hover:bg-foreground"
            : danger
              ? "bg-status-danger-bg text-status-danger-fg hover:bg-status-danger-border"
              : "bg-secondary text-foreground hover:bg-border"
      }`}
      style={{
        height: 34,
        padding: "0 14px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.12s",
      }}
    >
      {children}
    </button>
  );
}
