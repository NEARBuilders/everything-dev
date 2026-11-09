import { useQuery } from "@tanstack/react-query";
import { Badge, SectionHeader } from "@/components";

interface VersionEndpointResponse {
  deploymentDigest?: string;
  remotes?: Record<string, string>;
  watch?: { lastOutcome?: string };
}

const OUTCOME_LABELS: Record<string, { label: string; tone: "info" | "success" | "danger" }> = {
  clean: { label: "clean", tone: "success" },
  swapped: { label: "swapped", tone: "info" },
  "swap-failed": { label: "swap-failed", tone: "danger" },
  "pointer-unreachable": { label: "pointer-unreachable", tone: "danger" },
};

export function VersionCard() {
  const query = useQuery({
    queryKey: ["deployed-version"],
    queryFn: async (): Promise<VersionEndpointResponse> => {
      const response = await fetch("/.well-known/version");
      if (!response.ok) throw new Error(`version endpoint returned ${response.status}`);
      return response.json();
    },
    refetchInterval: 30_000,
  });

  const version = query.data;
  const outcome = version?.watch?.lastOutcome;
  const outcomeMeta = outcome ? OUTCOME_LABELS[outcome] : undefined;

  return (
    <div data-testid="admin-version-card" className="rounded-lg border bg-background p-4">
      <SectionHeader title="Deployed version" sectionTestId="admin-version-heading" />
      {query.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : query.isError || !version?.deploymentDigest ? (
        <p className="text-muted-foreground text-sm">Version endpoint unreachable.</p>
      ) : (
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Serving digest</dt>
            <dd className="font-mono">{version.deploymentDigest}</dd>
            {outcomeMeta && (
              <Badge
                variant={
                  outcomeMeta.tone === "danger"
                    ? "destructive"
                    : outcomeMeta.tone === "success"
                      ? "success"
                      : "secondary"
                }
              >
                {outcomeMeta.label}
              </Badge>
            )}
          </div>
          {Object.keys(version.remotes ?? {}).length > 0 && (
            <div>
              <dt className="text-muted-foreground">Remotes</dt>
              <dd className="mt-1 space-y-0.5">
                {Object.entries(version.remotes ?? {}).map(([remote, pin]) => (
                  <div key={remote} className="flex gap-2 font-mono text-xs">
                    <span className="text-muted-foreground">{remote}</span>
                    <span>{pin}</span>
                  </div>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
