import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Reorder } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Pencil,
  Plus,
  Share2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { Markdown } from "@/components/ui/markdown";
import { fetchRepositoryReadme } from "@/lib/repository-content";

interface VoteEvent {
  type: "upvote" | "downvote";
  thingId: string;
  userId: string;
  timestamp: string;
  totalCount: number;
}

type VoteDirection = "up" | "down" | null;

type ProjectKindFilter = "all" | "project" | "idea";
type ProjectKind = "project" | "idea";

interface RankedProject {
  id: string;
  ownerId: string;
  organizationId: string | null;
  kind: ProjectKind;
  slug: string;
  title: string;
  description: string | null;
  content: string | null;
  status: "active" | "paused" | "archived";
  visibility: "private" | "unlisted" | "public";
  repository: string | null;
  domain: string | null;
  createdAt: string;
  updatedAt: string;
  upvoteCount: number;
}

const PAGE_SIZE = 24;

export const Route = createFileRoute("/_layout/_authenticated/projects/")({
  validateSearch: (search: Record<string, unknown>) => ({
    preview: typeof search.preview === "string" ? search.preview : undefined,
    kind:
      search.kind === "project" || search.kind === "idea" || search.kind === "all"
        ? search.kind
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Projects | app" },
      { name: "description", content: "Browse projects and ideas, ranked live by votes." },
    ],
  }),
  loaderDeps: ({ search }) => ({ kind: search.kind }),
  loader: ({ context, deps }) => {
    const { queryClient, apiClient } = context;
    const { kind } = deps;
    const activeKind = kind === "project" || kind === "idea" || kind === "all" ? kind : "all";

    void queryClient.prefetchInfiniteQuery({
      queryKey: ["projects", activeKind],
      queryFn: ({ pageParam }) =>
        apiClient.projects.listProjects({
          limit: PAGE_SIZE,
          cursor: pageParam as string | undefined,
          kind: activeKind === "all" ? undefined : activeKind,
        }),
      initialPageParam: undefined,
    });
  },
  component: ProjectsList,
});

function isGithubUrl(url: string) {
  return /github\.com/i.test(url);
}

function GithubIcon({ size = 13 }: { size?: number }) {
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
) {
  if (!ownerId) return false;
  return [user?.id, user?.walletAddress].some((candidate) => candidate === ownerId);
}

function ProjectsList() {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const search = Route.useSearch();
  const activeKind =
    search.kind === "project" || search.kind === "idea" || search.kind === "all"
      ? search.kind
      : "all";

  const { data: session } = useQuery(sessionQueryOptions(auth, undefined));
  const user = session?.user;
  const canParticipate = Boolean(user && !user.isAnonymous);
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback((projectId: string) => {
    const url =
      typeof window !== "undefined" ? `${window.location.origin}/projects/${projectId}` : "";
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const {
    data: pages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["projects", activeKind],
    queryFn: ({ pageParam }) =>
      apiClient.projects.listProjects({
        limit: PAGE_SIZE,
        cursor: pageParam,
        kind: activeKind === "all" ? undefined : activeKind,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.nextCursor : undefined),
  });

  const projects = useMemo(() => pages?.pages.flatMap((page) => page.data) ?? [], [pages]);

  const upvoteCounts = useQuery({
    queryKey: ["upvoteCounts", projects.map((p) => p.id)],
    queryFn: async () => {
      const counts: Record<string, number> = {};
      await Promise.all(
        projects.map(async (p) => {
          try {
            const result = await apiClient.getUpvoteCount({ thingId: p.id });
            counts[p.id] = result.totalCount ?? 0;
          } catch {
            counts[p.id] = 0;
          }
        }),
      );
      return counts;
    },
    enabled: projects.length > 0,
  });

  const counts = upvoteCounts.data ?? {};
  const rankedProjects = useMemo<RankedProject[]>(() => {
    return projects
      .map((p) => ({ ...p, upvoteCount: counts[p.id] ?? 0 }))
      .sort((a, b) => b.upvoteCount - a.upvoteCount);
  }, [projects, counts]);
  const projectIds = useMemo(() => rankedProjects.map((p) => p.id), [rankedProjects]);

  const userVoteStates = useQuery({
    queryKey: ["userVoteStates", projects.map((p) => p.id)],
    queryFn: async () => {
      const votes: Record<string, VoteDirection> = {};
      await Promise.all(
        projects.map(async (p) => {
          try {
            const result = await apiClient.getUserVote({ thingId: p.id });
            votes[p.id] = result.hasUpvote ? "up" : null;
          } catch {
            votes[p.id] = null;
          }
        }),
      );
      return votes;
    },
    enabled: canParticipate && projects.length > 0,
  });

  const userVoteMap = userVoteStates.data ?? {};

  const selectedProjectId =
    rankedProjects.find((p) => p.id === search.preview)?.id ?? rankedProjects[0]?.id;

  const selectedProjectQuery = useQuery({
    queryKey: ["project", selectedProjectId],
    queryFn: () => apiClient.projects.getProject({ id: selectedProjectId! }),
    enabled: Boolean(selectedProjectId),
  });

  const selectedProject = selectedProjectQuery.data?.data;

  const isAdminUser = user?.role === "admin";
  const canManageSelected = isAdminUser || isCurrentUserOwner(selectedProject?.ownerId, user);

  const selectedReadmeQuery = useQuery({
    queryKey: ["projectPreviewReadme", selectedProject?.id, selectedProject?.repository],
    queryFn: async () => {
      if (!selectedProject?.repository) return null;
      return await fetchRepositoryReadme(selectedProject.repository);
    },
    enabled: selectedProject?.kind === "project" && Boolean(selectedProject?.repository),
  });

  const upvoteMutation = useMutation({
    mutationFn: (thingId: string) => apiClient.upvoteThing({ thingId }),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["upvoteCounts", projects.map((p) => p.id)],
        (old: Record<string, number> | undefined) => ({ ...old, [data.thingId]: data.totalCount }),
      );
      queryClient.setQueryData(
        ["userVoteStates", projects.map((p) => p.id)],
        (old: Record<string, VoteDirection> | undefined) => ({ ...old, [data.thingId]: "up" }),
      );
    },
    onError: (err: Error) => toast.error(err.message || "Failed to upvote"),
  });

  const downvoteMutation = useMutation({
    mutationFn: (thingId: string) => apiClient.downvoteThing({ thingId }),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["upvoteCounts", projects.map((p) => p.id)],
        (old: Record<string, number> | undefined) => ({ ...old, [data.thingId]: data.totalCount }),
      );
      queryClient.setQueryData(
        ["userVoteStates", projects.map((p) => p.id)],
        (old: Record<string, VoteDirection> | undefined) => ({ ...old, [data.thingId]: "down" }),
      );
    },
    onError: (err: Error) => toast.error(err.message || "Failed to downvote"),
  });

  useEffect(() => {
    const es = new EventSource("/api/upvotes/stream");
    es.addEventListener("vote", (event) => {
      try {
        const detail = JSON.parse(event.data) as VoteEvent;
        queryClient.setQueryData(
          ["upvoteCounts", projects.map((p) => p.id)],
          (old: Record<string, number> | undefined) => ({
            ...old,
            [detail.thingId]: detail.totalCount,
          }),
        );
      } catch {
        return;
      }
    });
    return () => es.close();
  }, [queryClient, projects]);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node || !hasNextPage || isFetchingNextPage) return;
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      });
      observerRef.current.observe(node);
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  );

  // On mobile, tapping a row goes straight to the detail page.
  // On desktop (lg+), tapping updates ?preview= and shows the split panel.
  const handleMobileRowTap = (projectId: string) => {
    void navigate({ to: "/projects/$id", params: { id: projectId } });
  };

  const handleDesktopRowSelect = (projectId: string) => {
    void navigate({
      to: "/projects",
      search: (prev) => ({ ...prev, preview: projectId, kind: search.kind }),
    });
  };

  const handleKindChange = (kind: ProjectKindFilter) => {
    void navigate({ to: "/projects", search: () => ({ kind, preview: undefined }) });
  };

  const runVote = (direction: "up" | "down", projectId: string) => {
    if (!canParticipate) {
      toast.error("Link an identity in settings before voting.");
      return;
    }
    if (direction === "up") upvoteMutation.mutate(projectId);
    else downvoteMutation.mutate(projectId);
  };

  const previewContent =
    selectedProject?.kind === "idea"
      ? selectedProject.content
      : (selectedReadmeQuery.data ?? selectedProject?.description ?? null);

  const filterButtons = (
    <div className="flex items-center gap-1">
      {(
        [
          { value: "all", label: "All" },
          { value: "project", label: "Projects" },
          { value: "idea", label: "Ideas" },
        ] as const
      ).map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => handleKindChange(opt.value)}
          className={`border ${activeKind === opt.value ? "border-brand-accent bg-brand-accent-light text-foreground" : "border-border text-muted-foreground"}`}
          style={{
            height: 32,
            padding: "0 10px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const newButton = canParticipate ? (
    <Link
      to="/projects/new"
      search={{ tab: "write" }}
      className="bg-primary text-primary-foreground hover:bg-foreground"
      style={{
        height: 36,
        padding: "0 14px",
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        textDecoration: "none",
        transition: "background 0.15s",
        flexShrink: 0,
      }}
    >
      <Plus size={14} />
      New
    </Link>
  ) : (
    <span
      className="bg-disabled text-primary-foreground"
      style={{
        height: 36,
        padding: "0 14px",
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        cursor: "not-allowed",
        flexShrink: 0,
      }}
    >
      <Plus size={14} />
      New
    </span>
  );

  const projectList = (
    <div className="flex flex-col overflow-hidden flex-1 min-h-0">
      {isLoading ? (
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse bg-secondary"
              style={{ height: 72, borderRadius: 10 }}
            />
          ))}
        </div>
      ) : rankedProjects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-muted-foreground" style={{ fontSize: 14 }}>
            No entries yet.
          </p>
          {canParticipate && (
            <Link
              to="/projects/new"
              search={{ tab: "write" }}
              className="text-brand-accent"
              style={{ fontSize: 14, fontWeight: 700, textDecoration: "none" }}
            >
              Create the first one
            </Link>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Reorder.Group
            as="div"
            axis="y"
            values={projectIds}
            onReorder={() => {}}
            className="flex flex-col gap-0"
          >
            {rankedProjects.map((project, index) => (
              <Reorder.Item
                as="div"
                key={project.id}
                value={project.id}
                layout="position"
                drag={false}
                dragListener={false}
                transition={{ layout: { type: "spring", stiffness: 300, damping: 30 } }}
              >
                <ListRow
                  rank={index + 1}
                  project={project}
                  isSelected={selectedProjectId === project.id}
                  voteDirection={userVoteMap[project.id] ?? null}
                  isUpvoting={upvoteMutation.isPending && upvoteMutation.variables === project.id}
                  isDownvoting={
                    downvoteMutation.isPending && downvoteMutation.variables === project.id
                  }
                  onMobileTap={() => handleMobileRowTap(project.id)}
                  onDesktopSelect={() => handleDesktopRowSelect(project.id)}
                  onUpvote={() => runVote("up", project.id)}
                  onDownvote={() => runVote("down", project.id)}
                />
              </Reorder.Item>
            ))}
          </Reorder.Group>

          <div
            ref={sentinelRef}
            className="flex justify-center py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
          >
            {isFetchingNextPage && (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-transparent" />
            )}
            {hasNextPage && !isFetchingNextPage && (
              <button
                type="button"
                onClick={() => fetchNextPage()}
                className="text-muted-foreground bg-transparent border-none"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <ChevronDown size={14} />
                Load more
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── header ── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <h1 className="text-foreground" style={{ fontSize: 18, fontWeight: 600 }}>
            Projects
          </h1>
          {filterButtons}
        </div>
        {newButton}
      </div>

      {/* ── mobile: full-width list only ── */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        {projectList}
        {!canParticipate && (
          <div
            className="shrink-0 border-t border-border bg-card px-4 py-2 text-center text-muted-foreground"
            style={{
              fontSize: 13,
              paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
            }}
          >
            Anonymous sessions can browse.{" "}
            <Link
              to="/settings"
              className="text-brand-accent"
              style={{ fontWeight: 600, textDecoration: "none" }}
            >
              Link an identity
            </Link>{" "}
            to publish and vote.
          </div>
        )}
      </div>

      {/* ── desktop: split panel ── */}
      <div className="hidden min-h-0 flex-1 lg:flex">
        <div
          className="flex flex-col overflow-hidden border-r border-border"
          style={{ width: 380, flexShrink: 0 }}
        >
          {projectList}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-muted">
          {!selectedProject || selectedProjectQuery.isLoading ? (
            <div className="flex flex-1 flex-col gap-3 p-8">
              <div
                className="animate-pulse bg-border"
                style={{ height: 28, width: 200, borderRadius: 6 }}
              />
              <div
                className="animate-pulse bg-border"
                style={{ height: 16, width: "80%", borderRadius: 6 }}
              />
              <div
                className="animate-pulse bg-border"
                style={{ height: 16, width: "60%", borderRadius: 6 }}
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border bg-card px-6 py-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <KindBadge kind={selectedProject.kind} />
                    <StatusBadge status={selectedProject.status} />
                  </div>
                  <h2
                    className="mt-1 text-foreground"
                    style={{ fontSize: 18, fontWeight: 600, lineHeight: "1.3" }}
                  >
                    {selectedProject.title}
                  </h2>
                  {selectedProject.description && (
                    <p
                      className="mt-0.5 line-clamp-2 text-muted-foreground"
                      style={{ fontSize: 14 }}
                    >
                      {selectedProject.description}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <div
                    className="bg-secondary"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      borderRadius: 10,
                      padding: "4px 10px",
                    }}
                  >
                    <VoteButton
                      icon={<TrendingUp size={14} />}
                      onClick={() => runVote("up", selectedProject.id)}
                      disabled={
                        !canParticipate ||
                        (upvoteMutation.isPending &&
                          upvoteMutation.variables === selectedProject.id)
                      }
                      active={userVoteMap[selectedProject.id] === "up"}
                      activeColor="text-brand-accent"
                    />
                    <span
                      className="text-foreground"
                      style={{
                        minWidth: 24,
                        textAlign: "center",
                        fontSize: 14,
                        fontWeight: 700,
                      }}
                    >
                      {counts[selectedProject.id] ?? 0}
                    </span>
                    <VoteButton
                      icon={<TrendingDown size={14} />}
                      onClick={() => runVote("down", selectedProject.id)}
                      disabled={
                        !canParticipate ||
                        (downvoteMutation.isPending &&
                          downvoteMutation.variables === selectedProject.id)
                      }
                      active={userVoteMap[selectedProject.id] === "down"}
                      activeColor="text-status-danger-fg"
                    />
                  </div>

                  {selectedProject.repository && (
                    <a
                      href={selectedProject.repository}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={selectedProject.repository}
                      className="bg-secondary text-foreground hover:bg-border border-none"
                      style={{
                        height: 34,
                        width: 34,
                        borderRadius: 10,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        textDecoration: "none",
                        transition: "background 0.12s",
                        flexShrink: 0,
                      }}
                    >
                      {isGithubUrl(selectedProject.repository) ? (
                        <GithubIcon size={14} />
                      ) : (
                        <Globe size={14} />
                      )}
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => handleShare(selectedProject.id)}
                    title="Copy link"
                    className={`bg-secondary ${copied ? "text-brand-accent" : "text-muted-foreground"} hover:bg-border border-none`}
                    style={{
                      height: 34,
                      width: 34,
                      borderRadius: 10,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      transition: "all 0.12s",
                      flexShrink: 0,
                    }}
                  >
                    {copied ? <Check size={14} /> : <Share2 size={14} />}
                  </button>

                  <Link
                    to="/projects/$id"
                    params={{ id: selectedProject.id }}
                    className="bg-primary text-primary-foreground hover:bg-foreground"
                    style={{
                      height: 36,
                      padding: "0 14px",
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      textDecoration: "none",
                      transition: "background 0.15s",
                    }}
                  >
                    Open
                    <ArrowUpRight size={13} />
                  </Link>

                  {canManageSelected && (
                    <Link
                      to="/projects/$id/edit"
                      params={{ id: selectedProject.id }}
                      search={{ tab: "write" }}
                      className="bg-secondary text-foreground hover:bg-border"
                      style={{
                        height: 36,
                        padding: "0 14px",
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        textDecoration: "none",
                        transition: "background 0.15s",
                      }}
                    >
                      <Pencil size={13} />
                      Edit
                    </Link>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
                {selectedProject.kind === "project" && selectedReadmeQuery.isLoading ? (
                  <div className="text-muted-foreground" style={{ fontSize: 14 }}>
                    Loading README…
                  </div>
                ) : previewContent ? (
                  <Markdown content={previewContent} />
                ) : (
                  <div className="text-muted-foreground" style={{ fontSize: 14 }}>
                    {selectedProject.kind === "project"
                      ? "No README available for this repository."
                      : "No content written yet."}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {!canParticipate && (
          <div
            className="absolute bottom-0 left-0 right-0 shrink-0 border-t border-border bg-card px-6 py-2 text-center text-muted-foreground"
            style={{ fontSize: 13 }}
          >
            Anonymous sessions can browse.{" "}
            <Link
              to="/settings"
              className="text-brand-accent"
              style={{ fontWeight: 600, textDecoration: "none" }}
            >
              Link an identity
            </Link>{" "}
            to publish and vote.
          </div>
        )}
      </div>
    </div>
  );
}

function ListRow({
  rank,
  project,
  isSelected,
  voteDirection,
  isUpvoting,
  isDownvoting,
  onMobileTap,
  onDesktopSelect,
  onUpvote,
  onDownvote,
}: {
  rank: number;
  project: RankedProject;
  isSelected: boolean;
  voteDirection: VoteDirection;
  isUpvoting: boolean;
  isDownvoting: boolean;
  onMobileTap: () => void;
  onDesktopSelect: () => void;
  onUpvote: () => void;
  onDownvote: () => void;
}) {
  return (
    <div
      className={`border-b border-border ${isSelected ? "lg:bg-brand-accent-light lg:border-l-[3px] lg:border-brand-accent" : "border-l-[3px] border-transparent"}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "13px 14px",
        transition: "all 0.12s",
      }}
    >
      {/* rank — desktop only */}
      <span
        className={`hidden lg:block shrink-0 text-center ${isSelected ? "text-brand-accent" : "text-disabled"}`}
        style={{ width: 24, fontSize: 12, fontWeight: 700 }}
      >
        {rank}
      </span>

      {/* mobile: full row is the tap target */}
      <button
        type="button"
        onClick={onMobileTap}
        className="flex flex-1 min-w-0 items-center gap-3 text-left lg:hidden"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
      >
        <span
          className="text-disabled shrink-0"
          style={{ width: 20, fontSize: 11, fontWeight: 700, textAlign: "center" }}
        >
          {rank}
        </span>
        <div className="flex-1 min-w-0">
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
            <KindBadge kind={project.kind} compact />
            <span
              className="text-foreground"
              style={{
                fontSize: 14,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {project.title}
            </span>
          </div>
          {project.description && (
            <p
              className="text-muted-foreground"
              style={{
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {project.description}
            </p>
          )}
        </div>
      </button>

      {/* desktop: click anywhere in middle area selects */}
      <div
        onClick={onDesktopSelect}
        className="hidden lg:flex flex-1 min-w-0 items-center gap-2"
        style={{ cursor: "pointer" }}
      >
        <div className="flex-1 min-w-0">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <KindBadge kind={project.kind} compact />
            <span
              className="text-foreground"
              style={{
                fontSize: 14,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}
            >
              {project.title}
            </span>
            {project.repository && (
              <a
                href={project.repository}
                target="_blank"
                rel="noopener noreferrer"
                title={project.repository}
                onClick={(e) => e.stopPropagation()}
                className="text-disabled hover:text-foreground"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  flexShrink: 0,
                  transition: "color 0.12s",
                }}
              >
                {isGithubUrl(project.repository) ? (
                  <GithubIcon size={12} />
                ) : (
                  <Globe size={12} />
                )}
              </a>
            )}
          </div>
          {project.description && (
            <p
              className="text-muted-foreground"
              style={{
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {project.description}
            </p>
          )}
        </div>
      </div>

      {/* vote column — always visible, stops propagation */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
          flexShrink: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <VoteButton
          icon={<TrendingUp size={13} />}
          onClick={onUpvote}
          disabled={isUpvoting}
          active={voteDirection === "up"}
          activeColor="text-brand-accent"
        />
        <span className="text-foreground" style={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>
          {project.upvoteCount}
        </span>
        <VoteButton
          icon={<TrendingDown size={13} />}
          onClick={onDownvote}
          disabled={isDownvoting}
          active={voteDirection === "down"}
          activeColor="text-status-danger-fg"
        />
      </div>
    </div>
  );
}

function VoteButton({
  icon,
  onClick,
  disabled,
  active,
  activeColor,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  activeColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${disabled ? "text-disabled" : active ? (activeColor ?? "text-brand-accent") : "text-muted-foreground hover:text-foreground"} border-none bg-transparent`}
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.12s",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {icon}
    </button>
  );
}

function KindBadge({ kind, compact }: { kind: ProjectKind; compact?: boolean }) {
  return (
    <span
      className={`border border-border text-foreground ${kind === "idea" ? "bg-muted" : "bg-secondary"}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: compact ? "1px 6px" : "3px 8px",
        borderRadius: 4,
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {kind === "idea" ? <FileText size={compact ? 9 : 10} /> : null}
      {kind}
    </span>
  );
}

function StatusBadge({ status }: { status: "active" | "paused" | "archived" }) {
  const classes = {
    active: "bg-brand-accent-light border-brand-accent text-foreground",
    paused: "bg-secondary border-border text-foreground",
    archived: "bg-status-danger-bg border-destructive text-status-danger-fg",
  };
  return (
    <span
      className={`border ${classes[status]}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}
