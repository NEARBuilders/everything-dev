import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { Badge, Button } from "@/components";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_layout/_public/things/$thingId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.thingId} | Things | everything.dev` },
      { name: "description", content: `Detail view for thing ${params.thingId}.` },
    ],
  }),
  component: ThingDetailPage,
});

function ThingDetailPage() {
  const { thingId } = Route.useParams();
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const router = useRouter();
  const canGoBack = router.history.canGoBack?.() ?? false;

  const { data: session } = useQuery(sessionQueryOptions(auth, undefined));
  const isAdmin = session?.user?.role === "admin";

  const thingQuery = useQuery({
    queryKey: ["thing", thingId],
    queryFn: () => apiClient.template.getThing({ thingId }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.template.deleteThing({ thingId }),
    onSuccess: () => {
      toast.success("Thing deleted");
      void router.navigate({ to: "/things" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const thing = thingQuery.data;

  if (thingQuery.isLoading) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6 sm:py-3">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-8 w-48" />
        </div>
      </div>
    );
  }

  if (!thing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-24 text-center">
        <p className="text-base font-semibold text-foreground">Thing not found.</p>
        <Button asChild variant="ghost" size="sm">
          <a href="/things">back to things</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6 sm:py-3">
        {canGoBack ? (
          <button
            type="button"
            onClick={() => router.history.back()}
            className="flex items-center justify-center w-8 h-8 border-2 border-outset border-border-strong bg-card shadow-sm rounded-[10px] hover:bg-muted"
          >
            <ArrowLeft size={14} />
          </button>
        ) : (
          <a
            href="/things"
            className="flex items-center justify-center w-8 h-8 border-2 border-outset border-border-strong bg-card shadow-sm rounded-[10px] hover:bg-muted"
          >
            <ArrowLeft size={14} />
          </a>
        )}
        <h1 className="text-sm font-semibold text-foreground font-mono truncate min-w-0">
          {thing.thingId}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-lg space-y-4">
          <div className="rounded-[12px] border border-border bg-card p-6 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs font-mono">
                {thing.type}
              </Badge>
            </div>

            <div className="space-y-1.5 text-sm">
              <MetaRow label="thingId" mono>
                {thing.thingId}
              </MetaRow>
              <MetaRow label="type" mono>
                {thing.type}
              </MetaRow>
              <MetaRow label="created">{new Date(thing.createdAt).toLocaleString()}</MetaRow>
              <MetaRow label="updated">{new Date(thing.updatedAt).toLocaleString()}</MetaRow>
            </div>

            <div className="rounded-[8px] border border-border bg-muted/10 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Payload
              </div>
              <pre className="font-mono text-xs text-foreground whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(thing.payload, null, 2)}
              </pre>
            </div>
          </div>

          {isAdmin && (
            <div className="rounded-[12px] border border-destructive/30 bg-destructive/5 p-6 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-destructive">
                  Admin
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  if (window.confirm("Delete this thing permanently?")) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 size={12} />
                {deleteMutation.isPending ? "Deleting..." : "Delete thing"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaRow({
  label,
  mono,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2 rounded-[6px] bg-muted/10 px-2.5 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={`text-foreground break-all ${mono ? "font-mono text-xs" : "text-sm"}`}>
        {children}
      </span>
    </div>
  );
}
