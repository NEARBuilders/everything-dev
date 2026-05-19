import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileCode2,
  FileText,
  Globe,
  Info,
  Lock,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { Markdown } from "@/components/ui/markdown";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fetchRepositoryReadme } from "@/lib/repository-content";
import { parseProjectListSearch } from "./-search";

export const Route = createFileRoute("/_layout/_authenticated/projects/$id")({
  validateSearch: parseProjectListSearch,
  head: () => ({
    meta: [{ title: `Project | app` }, { name: "description", content: "Project details." }],
  }),
  loader: async ({ params }) => ({ projectId: params.id }),
  component: ProjectDetailPage,
});

function isGithubUrl(url: string) {
  return /github\.com/i.test(url);
}

function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577v-2.165c-3.338.726-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.52 11.52 0 0 1 12 6.803c1.02.005 2.047.138 3.006.404 2.29-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.91 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.218.694.825.576C20.565 21.796 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

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

function ProjectDetailPage() {
  const { id: projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const search = Route.useSearch();

  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { data: session } = useQuery(sessionQueryOptions(auth, undefined));
  const nearAccountId = auth.near.getAccountId();

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => apiClient.projects.getProject({ id: projectId }),
  });

  const project = projectQuery.data?.data;
  const canParticipate = Boolean(session?.user && !session.user.isAnonymous);

  const readmeQuery = useQuery({
    queryKey: ["readme", project?.id, project?.repository],
    queryFn: async () => {
      if (!project?.repository) return null;
      return await fetchRepositoryReadme(project.repository);
    },
    enabled: project?.kind === "project" && Boolean(project?.repository),
  });

  const upvoteCountQuery = useQuery({
    queryKey: ["upvoteCount", projectId],
    queryFn: () => apiClient.getUpvoteCount({ thingId: projectId }),
  });

  const userVoteQuery = useQuery({
    queryKey: ["userVoteState", projectId],
    queryFn: () => apiClient.getUserVote({ thingId: projectId }),
    select: (data): "up" | "down" | null => (data.hasUpvote ? "up" : null),
    enabled: canParticipate,
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

  const upvoteMutation = useMutation({
    mutationFn: () => apiClient.upvoteThing({ thingId: projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upvoteCount", projectId] });
      queryClient.invalidateQueries({ queryKey: ["upvoteCounts"] });
      queryClient.setQueryData(["userVoteState", projectId], "up" as "up" | "down" | null);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to upvote"),
  });

  const downvoteMutation = useMutation({
    mutationFn: () => apiClient.downvoteThing({ thingId: projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upvoteCount", projectId] });
      queryClient.invalidateQueries({ queryKey: ["upvoteCounts"] });
      queryClient.setQueryData(["userVoteState", projectId], "down" as "up" | "down" | null);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to downvote"),
  });

  const runVote = (direction: "up" | "down") => {
    if (!canParticipate) {
      toast.error("Link an identity in settings before voting.");
      return;
    }
    if (direction === "up") upvoteMutation.mutate();
    else downvoteMutation.mutate();
  };

  const handleShare = useCallback(() => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  if (projectQuery.isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
          <div
            style={{ height: 20, width: 120, borderRadius: 6 }}
            className="animate-pulse bg-secondary"
          />
        </div>
        <div className="flex flex-1 flex-col gap-4 p-6">
          <div
            style={{ height: 32, width: 240, borderRadius: 8 }}
            className="animate-pulse bg-secondary"
          />
          <div
            style={{ height: 16, width: "70%", borderRadius: 6 }}
            className="animate-pulse bg-secondary"
          />
          <div
            style={{ height: 16, width: "50%", borderRadius: 6 }}
            className="animate-pulse bg-secondary"
          />
        </div>
      </div>
    );
  }

  if (projectQuery.isError || !project) {
    return (
      <div className="flex min-h-[calc(100dvh-48px)] flex-col items-center justify-center gap-4 p-6">
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

  const isAdmin = session?.user?.role === "admin";
  const canManage = isAdmin || isCurrentUserOwner(project.ownerId, session?.user, nearAccountId);
  const voteCount = upvoteCountQuery.data?.totalCount ?? 0;
  const voteDirection = userVoteQuery.data ?? null;

  const renderedContent =
    project.kind === "idea" ? project.content : (readmeQuery.data ?? project.description ?? null);

  const metaItems = (
    <div className="space-y-4">
      <MetaSectionLabel>Details</MetaSectionLabel>
      <MetaItem label="Visibility" value={project.visibility} />
      <MetaItem label="Owner" value={shortenId(project.ownerId)} mono />
      <MetaItem label="Slug" value={project.slug} mono />
      {project.domain && <MetaItem label="Domain" value={project.domain} mono />}
      <MetaItem label="Created" value={formatDate(project.createdAt)} />
      <MetaItem label="Updated" value={formatDate(project.updatedAt)} />
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── top bar ── */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5 sm:px-6 sm:py-3">
        {/* breadcrumb */}
        <div className="flex items-center gap-2">
          <Link
            to="/projects"
            search={{
              preview: project.id,
              kind: search.kind,
              personal: search.personal,
              private: search.private,
            }}
            aria-label="Back to projects"
            className="flex items-center justify-center w-8 h-8 border-2 border-outset border-border-strong bg-card shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:bg-muted rounded-[10px]"
          >
            <ArrowLeft size={13} className="text-foreground" />
          </Link>
          <span className="hidden text-border sm:inline">/</span>
          <span
            style={{ fontSize: 13, fontWeight: 600 }}
            className="hidden max-w-[160px] truncate text-foreground sm:block"
          >
            {project.slug}
          </span>
        </div>

        {/* actions */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* vote widget */}
          <div
            className="bg-secondary"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              borderRadius: 10,
              padding: "2px 6px",
            }}
          >
            <IconButton
              onClick={() => runVote("up")}
              label="Upvote"
              disabled={!canParticipate || upvoteMutation.isPending}
              active={voteDirection === "up"}
              activeColor="text-brand-accent"
            >
              <ChevronUp size={18} strokeWidth={2.25} />
            </IconButton>
            <span
              className="text-foreground"
              style={{ minWidth: 20, textAlign: "center", fontSize: 13, fontWeight: 700 }}
            >
              {voteCount}
            </span>
            <IconButton
              onClick={() => runVote("down")}
              label="Downvote"
              disabled={!canParticipate || downvoteMutation.isPending}
              active={voteDirection === "down"}
              activeColor="text-status-danger-fg"
            >
              <ChevronDown size={18} strokeWidth={2.25} />
            </IconButton>
          </div>

          {/* repo link — hidden on very small screens */}
          {project.repository && (
            <a
              href={project.repository}
              target="_blank"
              rel="noopener noreferrer"
              title={project.repository}
              className="hidden sm:inline-flex bg-secondary hover:bg-border text-foreground"
              style={{
                height: 34,
                padding: "0 10px",
                borderRadius: 10,
                fontSize: 12,
                fontWeight: 600,
                alignItems: "center",
                gap: 5,
                textDecoration: "none",
                transition: "background 0.12s",
                flexShrink: 0,
                maxWidth: 140,
                overflow: "hidden",
              }}
            >
              {isGithubUrl(project.repository) ? <GithubIcon size={13} /> : <Globe size={13} />}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {project.repository
                  .replace(/^https?:\/\/(www\.)?/, "")
                  .split("/")
                  .slice(0, 2)
                  .join("/")}
              </span>
            </a>
          )}

          {/* share */}
          <IconButton
            onClick={handleShare}
            label={copied ? "Link copied" : "Copy link"}
            active={copied}
            activeColor="text-brand-accent"
          >
            {copied ? <Check size={14} /> : <Share2 size={14} />}
          </IconButton>

          {/* details sheet trigger — mobile only */}
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="sm:hidden inline-flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground"
            title="Show details"
          >
            <Info size={15} />
          </button>

          {canManage && (
            <>
              <Link
                to="/projects/$id/edit"
                params={{ id: projectId }}
                search={{
                  tab: "write",
                  kind: search.kind,
                  personal: search.personal,
                  private: search.private,
                }}
                className="bg-secondary text-foreground hover:bg-border"
                style={{
                  height: 34,
                  padding: "0 10px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  textDecoration: "none",
                  transition: "background 0.12s",
                }}
              >
                <Pencil size={13} />
                <span className="hidden sm:inline">Edit</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Delete this project permanently?")) deleteMutation.mutate();
                }}
                disabled={deleteMutation.isPending}
                className="inline-flex h-[34px] items-center gap-1 rounded-[10px] px-2.5 text-[13px] font-bold bg-status-danger-bg text-status-danger-fg hover:bg-status-danger-border transition-colors sm:px-3"
              >
                <Trash2 size={13} />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* main content */}
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <KindChip kind={project.kind} />
                {project.status !== "active" && <StatusChip status={project.status as any} />}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  style={{ fontSize: 26, fontWeight: 600, lineHeight: "1.2" }}
                  className="text-foreground sm:text-[30px]"
                >
                  {project.title}
                </h1>
                {project.visibility === "private" && <PrivateIndicator />}
              </div>
              {project.description && (
                <p style={{ fontSize: 15, lineHeight: "1.5" }} className="text-muted-foreground">
                  {project.description}
                </p>
              )}
              {project.repository && (
                <a
                  href={project.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-border bg-secondary hover:bg-border text-foreground"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 10px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: "none",
                    transition: "background 0.12s",
                    maxWidth: "fit-content",
                  }}
                >
                  {isGithubUrl(project.repository) ? <GithubIcon size={13} /> : <Globe size={13} />}
                  <span
                    style={{
                      maxWidth: 220,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {project.repository.replace(/^https?:\/\/(www\.)?/, "")}
                  </span>
                  <ExternalLink
                    size={11}
                    className="text-muted-foreground"
                    style={{ flexShrink: 0 }}
                  />
                </a>
              )}
            </div>

            <div className="h-px bg-border" />

            {project.kind === "project" && readmeQuery.isLoading ? (
              <div style={{ fontSize: 14 }} className="text-muted-foreground">
                Loading README…
              </div>
            ) : renderedContent ? (
              <Markdown content={renderedContent} />
            ) : (
              <div
                className="border border-dashed border-border text-muted-foreground"
                style={{
                  padding: "32px 24px",
                  borderRadius: 12,
                  textAlign: "center",
                  fontSize: 14,
                }}
              >
                {project.kind === "project"
                  ? "No README available for this repository."
                  : "This idea has no content yet."}
              </div>
            )}
          </div>
        </div>

        {/* desktop sidebar */}
        <div className="hidden sm:block w-[220px] shrink-0 border-l border-border overflow-y-auto bg-muted px-5 py-6">
          {metaItems}
        </div>
      </div>

      {/* ── mobile details sheet ── */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="bottom" hideCloseButton={false}>
          <SheetHeader>
            <SheetTitle>Details</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto px-5 pb-2 pt-1">
            <div className="space-y-4">
              <MetaItem label="Visibility" value={project.visibility} />
              <MetaItem label="Owner" value={shortenId(project.ownerId)} mono />
              <MetaItem label="Slug" value={project.slug} mono />
              {project.domain && <MetaItem label="Domain" value={project.domain} mono />}
              <MetaItem label="Created" value={formatDate(project.createdAt)} />
              <MetaItem label="Updated" value={formatDate(project.updatedAt)} />
            </div>
          </div>
          <div
            className="shrink-0 px-5 pt-3"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <SheetClose asChild>
              <button
                type="button"
                className="w-full rounded-xl border-2 border-outset border-border-strong bg-secondary py-3 text-sm font-semibold text-foreground"
              >
                Close
              </button>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function IconButton({
  onClick,
  label,
  disabled,
  children,
  active,
  activeColor,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: ReactNode;
  active?: boolean;
  activeColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-[10px] border border-transparent ${disabled ? "text-disabled bg-transparent" : active ? `${activeColor ?? "text-brand-accent"} bg-card shadow-sm` : "text-muted-foreground hover:text-foreground hover:bg-muted bg-transparent"}`}
      style={{
        width: 40,
        height: 40,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "color 0.12s, background 0.12s",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

function PrivateIndicator() {
  return (
    <span
      title="Private"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-secondary p-1 text-muted-foreground"
    >
      <Lock size={12} />
    </span>
  );
}

function KindChip({ kind }: { kind: "project" | "idea" }) {
  return (
    <span
      className="border border-border bg-secondary text-foreground"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 10px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {kind === "idea" ? <FileText size={11} /> : <FileCode2 size={11} />}
      {kind}
    </span>
  );
}

function StatusChip({ status }: { status: "active" | "paused" | "archived" }) {
  return (
    <span
      className={`border ${
        status === "active"
          ? "border-brand-accent-border bg-brand-accent-light text-foreground"
          : status === "paused"
            ? "border-border bg-secondary text-foreground"
            : "border-status-danger-border bg-status-danger-bg text-status-danger-fg"
      }`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

function MetaSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-muted-foreground"
      style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}
    >
      {children}
    </div>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div style={{ fontSize: 11, fontWeight: 600 }} className="text-muted-foreground">
        {label}
      </div>
      <div
        className="text-foreground"
        style={{
          fontSize: 13,
          fontFamily: mono ? "ui-monospace, SFMono-Regular, monospace" : undefined,
          wordBreak: "break-all",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function shortenId(id: string): string {
  if (id.length <= 20) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
