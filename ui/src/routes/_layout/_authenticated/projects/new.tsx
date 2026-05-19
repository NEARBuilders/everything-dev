import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { customAlphabet } from "nanoid";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { ProjectFormLayout, type ProjectFormValues } from "@/components/project-form";
import { parseProjectListSearch } from "./-search";

const STORAGE_KEY_PROJECT = "projects:new:project";
const STORAGE_KEY_IDEA = "projects:new:idea";

const loadDraft = (kind: "project" | "idea"): ProjectFormValues | null => {
  try {
    const raw = localStorage.getItem(kind === "project" ? STORAGE_KEY_PROJECT : STORAGE_KEY_IDEA);
    if (!raw) return null;
    return JSON.parse(raw) as ProjectFormValues;
  } catch {
    return null;
  }
};

const saveDraft = (values: ProjectFormValues) => {
  try {
    const key = values.kind === "project" ? STORAGE_KEY_PROJECT : STORAGE_KEY_IDEA;
    localStorage.setItem(key, JSON.stringify(values));
  } catch {}
};

const clearDraft = (kind: "project" | "idea") => {
  try {
    localStorage.removeItem(kind === "project" ? STORAGE_KEY_PROJECT : STORAGE_KEY_IDEA);
  } catch {}
};

type SearchParams = ReturnType<typeof parseProjectListSearch> & {
  tab: "write" | "preview";
};

export const Route = createFileRoute("/_layout/_authenticated/projects/new")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    ...parseProjectListSearch(search),
    tab: search.tab === "preview" ? "preview" : "write",
  }),
  head: () => ({
    meta: [
      { title: "New | Projects" },
      { name: "description", content: "Create a new project or idea." },
    ],
  }),
  component: NewProjectPage,
});

const slugId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);
const slugSuffixRef: { current: string } = { current: "" };

const generateSlug = (v: string) => {
  const base = v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return "";
  if (!slugSuffixRef.current) slugSuffixRef.current = slugId();
  return `${base}-${slugSuffixRef.current}`;
};

function NewProjectPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const { data: session } = useQuery(sessionQueryOptions(auth, undefined));
  const nearAccountId = auth.near.getAccountId();
  const isAdmin = session?.user?.role === "admin";
  const canCreate = Boolean(session?.user && !session.user.isAnonymous);
  const search = Route.useSearch();
  const { tab } = search;
  const defaultOwnerId =
    nearAccountId ??
    (session?.user as { walletAddress?: string | null } | null)?.walletAddress ??
    session?.user?.id ??
    "";

  const setTab = (value: string) => {
    void navigate({
      search: (prev) => ({ ...prev, tab: value as "write" | "preview" }),
      replace: true,
    });
  };

  const initialDraft = {
    ...(loadDraft("project") ?? {
      kind: "project" as const,
      title: "",
      description: "",
      repository: "",
      content: "",
      visibility: "public" as const,
      ownerId: "",
      domain: "",
    }),
  } satisfies ProjectFormValues;

  const form = useForm({
    defaultValues: initialDraft as ProjectFormValues,
    canSubmitWhenInvalid: true,
    onSubmit: async ({ value }) => {
      if (!canCreate) {
        toast.error("Link an identity in settings before publishing.");
        return;
      }
      await createMutation.mutateAsync(value);
    },
    onSubmitInvalid: () => {
      toast.error("Please fix the highlighted fields before creating your project.");
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      apiClient.projects.createProject({
        kind: values.kind,
        title: values.title.trim(),
        slug: generateSlug(values.title),
        description: values.description?.trim() || undefined,
        repository: values.repository?.trim() || undefined,
        content: values.content?.trim() || undefined,
        visibility: values.visibility,
        ownerId: values.ownerId?.trim() || undefined,
        domain: values.domain?.trim() || undefined,
      }),
    onSuccess: (result) => {
      clearDraft(result.kind === "idea" ? "idea" : "project");
      toast.success(`${result.kind === "idea" ? "Idea" : "Project"} created`);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate({
        to: "/projects/$id",
        params: { id: result.id },
        search: {
          kind: search.kind,
          personal: search.personal,
          private: search.private,
        },
      });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create"),
  });

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submitForm = useCallback(() => {
    void form.handleSubmit();
  }, [form]);

  const persist = useCallback(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      saveDraft(form.store.state.values);
    }, 300);
  }, [form]);

  useEffect(() => {
    const subscription = form.store.subscribe(() => {
      persist();
    });
    return () => {
      subscription.unsubscribe();
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [form, persist]);

  const title = useStore(form.store, (s) => s.values.title);
  const slugPreview = generateSlug(title) || undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/projects"
            search={{
              preview: undefined,
              kind: search.kind,
              personal: search.personal,
              private: search.private,
            }}
            aria-label="Back to projects"
            className="flex items-center justify-center w-8 h-8 border-2 border-outset border-border-strong bg-card shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:bg-muted rounded-[10px]"
          >
            <ArrowLeft size={13} className="text-foreground" />
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground" style={{ fontSize: 13, fontWeight: 600 }}>
            New
          </span>
        </div>

        <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:justify-end">
          {!canCreate && (
            <span className="text-muted-foreground" style={{ fontSize: 12 }}>
              Link an identity in settings to publish
            </span>
          )}
          <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting, kind: s.values.kind })}>
            {({ isSubmitting, kind }) => (
              <button
                type="button"
                onClick={submitForm}
                disabled={!canCreate || isSubmitting || createMutation.isPending}
                className={`${canCreate && !isSubmitting && !createMutation.isPending ? "bg-primary text-primary-foreground hover:bg-foreground" : "bg-disabled text-primary-foreground"}`}
                style={{
                  height: 36,
                  padding: "0 20px",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  border: "none",
                  cursor:
                    !canCreate || isSubmitting || createMutation.isPending
                      ? "not-allowed"
                      : "pointer",
                  transition: "background 0.12s",
                }}
              >
                {createMutation.isPending
                  ? "Creating…"
                  : kind === "idea"
                    ? "Create Idea"
                    : "Create Project"}
              </button>
            )}
          </form.Subscribe>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          submitForm();
        }}
        className="flex flex-1 overflow-y-auto lg:min-h-0 lg:overflow-hidden"
      >
        <ProjectFormLayout
          form={form}
          mode="create"
          isAdmin={isAdmin}
          defaultOwnerId={defaultOwnerId}
          tab={tab}
          setTab={setTab}
          slugPreview={slugPreview}
        />
      </form>
    </div>
  );
}
