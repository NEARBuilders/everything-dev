import { ChartBarIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { type ApiClient, useApiClient } from "@/app";
import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Kind = "open" | "event" | "channel" | "share";
export function useDiscoveryMeasurement(api: ApiClient, campaign = "") {
  const queue = useRef(Promise.resolve());
  const track = useCallback(
    (kind?: Kind, nodeId?: string, target = "") => {
      if (typeof navigator === "undefined" || navigator.doNotTrack === "1") return;
      queue.current = queue.current.then(async () => {
        let visit: { id: string; started: number; campaign: string } | undefined;
        try {
          const raw = sessionStorage.getItem("discovery-visit");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (
              typeof parsed.id === "string" &&
              typeof parsed.started === "number" &&
              typeof parsed.campaign === "string"
            )
              visit = parsed;
          }
          if (!visit || Date.now() - visit.started > 30 * 60000 || visit.campaign !== campaign) {
            visit = { id: crypto.randomUUID(), started: Date.now(), campaign };
            sessionStorage.setItem("discovery-visit", JSON.stringify(visit));
          }
          await api.trackDiscovery({
            visitId: visit.id,
            campaign,
            kind: "visit",
            nodeId: null,
            target: "",
            consent: true,
          });
          if (kind && nodeId)
            await api.trackDiscovery({
              visitId: visit.id,
              campaign,
              kind,
              nodeId,
              target,
              consent: true,
            });
        } catch {}
      });
    },
    [api, campaign],
  );
  useEffect(() => {
    track();
  }, [track]);
  return { track };
}
export function DiscoveryMetrics({ nodes = [] }: { nodes?: { nodeId: string; name: string }[] }) {
  const api = useApiClient();
  const metrics = useQuery({
    queryKey: ["discovery-metrics"],
    queryFn: () => api.getDiscoveryMetrics(),
    retry: false,
  });
  if (metrics.isPending)
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-7 w-40" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {["a", "b", "c"].map((key) => (
            <Skeleton key={key} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  if (metrics.isError)
    return (
      <EmptyState
        icon={ChartBarIcon}
        title="Couldn't load engagement"
        description="Check your connection and try again."
        action={
          <Button variant="outline" onClick={() => metrics.refetch()}>
            Try again
          </Button>
        }
      />
    );
  const { visits, activatedVisits, rows } = metrics.data;
  const stats = [
    { label: "Visits", value: visits },
    { label: "Visits with a link click", value: activatedVisits },
    {
      label: "Link click rate",
      value: `${visits ? Math.round((100 * activatedVisits) / visits) : 0}%`,
    },
  ];
  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Engagement"
        description="Last 28 days. Counts link clicks, not attendance; editors and do-not-track visitors are skipped."
      />
      <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {stats.map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-hidden rounded-2xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Community</TableHead>
              <TableHead className="hidden md:table-cell">From</TableHead>
              <TableHead>What they did</TableHead>
              <TableHead className="text-right">Count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.nodeId}:${row.campaign}:${row.kind}`}>
                <TableCell>
                  <span className="font-medium">
                    {nodes.find((node) => node.nodeId === row.nodeId)?.name ??
                      (row.nodeId ? "Unavailable community" : "Network")}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className="text-muted-foreground">{row.campaign || "Explore"}</span>
                </TableCell>
                <TableCell>{metricAction(row.kind)}</TableCell>
                <TableCell className="text-right">
                  <span className="tabular-nums">{row.count}</span>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  <span className="text-muted-foreground">
                    No clicks yet. Share Explore to see what people open.
                  </span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
function metricAction(kind: string) {
  if (kind === "visit") return "Opened Explore";
  if (kind === "open") return "Opened a community";
  if (kind === "event") return "Opened an event";
  if (kind === "channel") return "Opened a community link";
  if (kind === "share") return "Copied a link";
  return kind;
}
