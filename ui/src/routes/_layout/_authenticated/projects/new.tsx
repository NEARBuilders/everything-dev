import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, FileText, Globe, Link as LinkIcon, Lock, Type } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useApiClient } from "@/app";
import { Badge, Button, Card, CardContent, Input } from "@/components";

const schema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Max 200 characters"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(100, "Max 100 characters")
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
  description: z.string().max(1000, "Max 1000 characters").optional(),
  repository: z.union([z.literal(""), z.string().url("Must be a valid URL").max(500)]).optional(),
  visibility: z.enum(["private", "unlisted", "public"]),
});

function errorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

export const Route = createFileRoute("/_layout/_authenticated/projects/new")({
  head: () => ({
    meta: [
      { title: "New Project | app" },
      { name: "description", content: "Create a new project." },
    ],
  }),
  component: NewProjectPage,
});

function NewProjectPage() {
  const navigate = useNavigate();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) =>
      apiClient.projects.createProject({
        kind: "project",
        title: values.title.trim(),
        slug: values.slug.trim(),
        description: values.description?.trim() || undefined,
        repository: values.repository?.trim() || undefined,
        visibility: values.visibility,
      }),
    onSuccess: (result) => {
      toast.success("Project created");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate({ to: "/projects/$id", params: { id: result.id } });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create project");
    },
  });

  const form = useForm({
    defaultValues: {
      title: "",
      slug: "",
      description: "",
      repository: "",
      visibility: "private" as "private" | "unlisted" | "public",
    } as z.infer<typeof schema>,
    validators: {
      onSubmit: schema,
    },
    onSubmit: async ({ value }) => {
      createMutation.mutate(value);
    },
  });

  const generateSlug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-muted-foreground">
          <a href="/home" className="hover:text-foreground transition-colors">
            home
          </a>
          <span>/</span>
          <span>projects</span>
          <span>/</span>
          <span>new</span>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Badge variant="outline">new project</Badge>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Create Project</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Projects organize your NEAR apps. Add a repository and README will render
                automatically.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
        className="space-y-6"
      >
        <Card>
          <CardContent className="p-6 space-y-6">
            {/* Title */}
            <form.Field name="title">
              {(field) => {
                const error = errorMessage(field.state.meta.errors[0]);
                return (
                  <div className="space-y-2">
                    <label
                      htmlFor="title"
                      className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"
                    >
                      <Type className="h-3.5 w-3.5" />
                      Title
                    </label>
                    <Input
                      id="title"
                      value={field.state.value}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                        const slugField = form.getFieldValue("slug");
                        if (
                          !slugField ||
                          slugField === generateSlug(field.state.value.slice(0, -1))
                        ) {
                          form.setFieldValue("slug", generateSlug(e.target.value));
                        }
                      }}
                      placeholder="My Project"
                      className={error ? "border-destructive" : ""}
                    />
                    {error && <p className="text-xs text-destructive">{error}</p>}
                  </div>
                );
              }}
            </form.Field>

            {/* Slug */}
            <form.Field name="slug">
              {(field) => {
                const error = errorMessage(field.state.meta.errors[0]);
                return (
                  <div className="space-y-2">
                    <label
                      htmlFor="slug"
                      className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                      Slug
                    </label>
                    <Input
                      id="slug"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(generateSlug(e.target.value))}
                      placeholder="my-project"
                      className={`font-mono ${error ? "border-destructive" : ""}`}
                    />
                    {error && <p className="text-xs text-destructive">{error}</p>}
                    <p className="text-xs text-muted-foreground">
                      Used in URLs. Lowercase letters, numbers, and hyphens only.
                    </p>
                  </div>
                );
              }}
            </form.Field>

            {/* Description */}
            <form.Field name="description">
              {(field) => {
                const error = errorMessage(field.state.meta.errors[0]);
                return (
                  <div className="space-y-2">
                    <label
                      htmlFor="description"
                      className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Description (optional)
                    </label>
                    <textarea
                      id="description"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      rows={3}
                      className="flex min-h-[80px] w-full rounded-md border-2 border-inset border-[rgb(51,51,51)] bg-[rgb(255,255,255)] px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus:ring-2 focus:ring-ring dark:bg-[rgb(40,40,40)] dark:border-[rgb(100,100,100)]"
                      placeholder="Describe your project..."
                    />
                    {error && <p className="text-xs text-destructive">{error}</p>}
                  </div>
                );
              }}
            </form.Field>

            {/* Repository */}
            <form.Field name="repository">
              {(field) => {
                const error = errorMessage(field.state.meta.errors[0]);
                return (
                  <div className="space-y-2">
                    <label
                      htmlFor="repository"
                      className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                      Repository URL (optional)
                    </label>
                    <Input
                      id="repository"
                      type="url"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="https://github.com/user/repo"
                      className={`font-mono text-sm ${error ? "border-destructive" : ""}`}
                    />
                    {error && <p className="text-xs text-destructive">{error}</p>}
                    <p className="text-xs text-muted-foreground">
                      README will be fetched from the default branch.
                    </p>
                  </div>
                );
              }}
            </form.Field>

            {/* Visibility */}
            <form.Field name="visibility">
              {(field) => (
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Visibility
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(
                      [
                        {
                          value: "private" as const,
                          label: "Private",
                          desc: "Only you can view",
                          icon: Lock,
                        },
                        {
                          value: "unlisted" as const,
                          label: "Unlisted",
                          desc: "Anyone with link can view",
                          icon: Eye,
                        },
                        {
                          value: "public" as const,
                          label: "Public",
                          desc: "Anyone can view",
                          icon: Globe,
                        },
                      ] as const
                    ).map((option) => {
                      const Icon = option.icon;
                      const active = field.state.value === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => field.handleChange(option.value)}
                          className={`rounded-sm border p-4 text-left transition-colors ${
                            active
                              ? "border-foreground bg-muted/20"
                              : "border-border hover:border-muted-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4" />
                            <div className="font-medium">{option.label}</div>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{option.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </form.Field>

            <div className="flex gap-3">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "creating..." : "create project"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: "/projects" })}
                disabled={createMutation.isPending}
              >
                cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
