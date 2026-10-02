import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BroadcastIcon,
  CalendarDotsIcon,
  CompassIcon,
  CopyIcon,
  GlobeIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  MapTrifoldIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/app";
import { Badge, Button, EmptyState } from "@/components";
import { PageHeader } from "@/components/layout/page-header";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAppLocale, useAppTranslation } from "@/i18n/runtime";
import { useDiscoveryMeasurement } from "./discovery-measurement";
import { activityDateTile, EventList } from "./event-list";
import { ReportContent } from "./report-content";

const GeographicMap = lazy(() =>
  import("./geographic-map")
    .then((m) => ({ default: m.GeographicMap }))
    .catch(() => ({
      default: MapUnavailable,
    })),
);

function MapUnavailable() {
  const t = useAppTranslation();
  return <p role="status">{t("explore.map.unavailable")}</p>;
}
export type DiscoverySearch = {
  campaign?: string;
  node?: string;
  query?: string;
  active?: boolean;
  upcoming?: boolean;
  region?: string;
  view?: "list" | "map";
};
type DiscoveryNode = Awaited<ReturnType<ApiClient["listDiscovery"]>>[number];
const ALL_REGIONS = "all";

export function DiscoveryExplorer({
  api,
  search,
  navigate,
}: {
  api: ApiClient;
  search: DiscoverySearch;
  navigate: (search: DiscoverySearch) => void;
}) {
  const { locale } = useAppLocale();
  const t = useAppTranslation();
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const measurement = useDiscoveryMeasurement(api, search.campaign);
  const [shareMessage, setShareMessage] = useState("");
  useEffect(() => {
    if (search.node) measurement.track("open", search.node);
  }, [search.node, measurement.track]);
  const origin = useRef<HTMLElement | null>(null);
  const lastNode = useRef<string | undefined>(undefined);
  if (search.node) lastNode.current = search.node;
  const nodeId = search.node ?? lastNode.current;
  const view = search.view ?? "map";
  const list = useQuery({
    queryKey: ["discovery", search.query, search.region, search.active, search.upcoming],
    queryFn: () =>
      api.listDiscovery({
        query: search.query,
        region: search.region,
        active: search.active,
        upcoming: search.upcoming,
      }),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const regions = useQuery({
    queryKey: ["discovery", undefined, undefined, undefined, undefined],
    queryFn: () => api.listDiscovery({}),
    staleTime: 30_000,
  });
  const regionItems = [
    { label: t("explore.region.all"), value: ALL_REGIONS },
    ...[...new Set([...(regions.data ?? []).map((node) => node.region), search.region ?? ""])]
      .filter(Boolean)
      .sort()
      .map((region) => ({ label: region, value: region })),
  ];
  const detail = useQuery({
    queryKey: ["discovery-node", nodeId],
    queryFn: () => api.getDiscoveryNode({ nodeId: nodeId! }),
    enabled: !!nodeId,
    refetchInterval: search.node ? 30_000 : false,
  });
  const selected = detail.data;
  const select = (node: string) => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    navigate({ ...search, node });
  };
  const filtered = !!(search.query || search.region || search.active || search.upcoming);
  const nodes = list.data ?? [];
  const upcomingCount = nodes.filter((node) => node.upcoming).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        headerTestId="explore.heading"
        title={t("explore.title")}
        description={t("explore.description")}
      />
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <InputGroup className="min-w-0 flex-1">
            <InputGroupAddon>
              <MagnifyingGlassIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="discovery-search"
              aria-label={t("explore.search.label")}
              value={search.query ?? ""}
              onChange={(e) => navigate({ ...search, query: e.target.value || undefined })}
              placeholder={t("explore.search.placeholder")}
            />
          </InputGroup>
          <ToggleGroup
            variant="outline"
            spacing={0}
            className="shrink-0"
            aria-label={t("explore.view.label")}
            value={[view]}
            onValueChange={(value) => {
              const next = value[0] as "list" | "map" | undefined;
              if (next) navigate({ ...search, view: next === "map" ? undefined : next });
            }}
          >
            <ToggleGroupItem
              value="list"
              aria-label={t("explore.view.list")}
              data-testid="explore-view-list"
            >
              <ListBulletsIcon />
              <span className="hidden sm:inline">{t("explore.view.list")}</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="map"
              aria-label={t("explore.view.map")}
              data-testid="explore-view-map"
            >
              <MapTrifoldIcon />
              <span className="hidden sm:inline">{t("explore.view.map")}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            items={regionItems}
            value={search.region ?? ALL_REGIONS}
            onValueChange={(value) =>
              navigate({ ...search, region: value && value !== ALL_REGIONS ? value : undefined })
            }
          >
            <SelectTrigger
              id="discovery-region"
              aria-label={t("explore.region.label")}
              className="w-full sm:w-auto sm:max-w-48"
            >
              <GlobeIcon />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {regionItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {[
            { key: "upcoming", label: t("explore.filter.upcoming"), icon: CalendarDotsIcon },
            { key: "active", label: t("explore.filter.active"), icon: BroadcastIcon },
          ].map(({ key, label, icon: Icon }) => (
            <Toggle
              key={key}
              variant="outline"
              data-testid={`explore-filter-${key}`}
              pressed={!!search[key as "active" | "upcoming"]}
              onPressedChange={(pressed) => navigate({ ...search, [key]: pressed || undefined })}
            >
              <Icon />
              {label}
            </Toggle>
          ))}
        </div>
      </div>

      {list.isError ? (
        <EmptyState
          icon={CompassIcon}
          title={t("explore.error.title")}
          description={t("explore.error.description")}
          action={<Button onClick={() => list.refetch()}>{t("explore.error.retry")}</Button>}
        />
      ) : list.isPending ? (
        <div
          role="status"
          aria-label={t("explore.loading")}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : (
        <section aria-label={t("explore.communities")} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground" data-testid="explore-result-count">
            {t(nodes.length === 1 ? "explore.results.one" : "explore.results.many", {
              count: new Intl.NumberFormat(locale).format(nodes.length),
            })}
            {upcomingCount > 0 &&
              ` · ${t("explore.results.upcoming", {
                count: new Intl.NumberFormat(locale).format(upcomingCount),
              })}`}
          </p>
          {view === "map" ? (
            <div className="overflow-hidden rounded-2xl border border-border">
              <Suspense
                fallback={
                  <div className="flex h-110 items-center justify-center text-sm text-muted-foreground lg:h-160">
                    {t("explore.map.loading")}
                  </div>
                }
              >
                <GeographicMap nodes={nodes} onSelect={select} selectedId={search.node} />
              </Suspense>
            </div>
          ) : null}
          {nodes.length === 0 ? (
            <EmptyState
              icon={MagnifyingGlassIcon}
              title={t("explore.empty.title")}
              description={t("explore.empty.description")}
              action={
                filtered ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigate({ node: search.node, campaign: search.campaign, view: search.view })
                    }
                  >
                    {t("explore.empty.clear")}
                  </Button>
                ) : undefined
              }
            />
          ) : view === "list" ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {nodes.map((node) => (
                <li key={node.nodeId} className="flex">
                  <CommunityCard
                    node={node}
                    selected={search.node === node.nodeId}
                    onSelect={() => select(node.nodeId)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {nodes.map((node) => (
                <li key={node.nodeId}>
                  <Button
                    variant={search.node === node.nodeId ? "secondary" : "ghost"}
                    size="sm"
                    data-testid={`discovery-node-${node.nodeId}`}
                    data-node-id={node.nodeId}
                    aria-pressed={search.node === node.nodeId}
                    onClick={() => select(node.nodeId)}
                  >
                    <MapPinIcon />
                    {node.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <Sheet
        open={!!search.node}
        onOpenChange={(open) => {
          if (!open) navigate({ ...search, node: undefined });
        }}
      >
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className="max-h-dvh w-full overflow-y-auto sm:max-w-lg"
          finalFocus={() => {
            const restore = origin.current;
            const id = lastNode.current;
            queueMicrotask(() => {
              if (restore?.isConnected) restore.focus();
              else document.querySelector<HTMLButtonElement>(`[data-node-id="${id}"]`)?.focus();
            });
            return false;
          }}
        >
          <SheetHeader className="gap-2 px-6 pt-8 pr-16 pb-2">
            <SheetTitle>{selected?.name ?? t("explore.detail.community")}</SheetTitle>
            <SheetDescription>
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPinIcon className="size-4 shrink-0" />
                {selected?.location || t("explore.detail.noLocation")}
                {selected?.region ? ` · ${selected.region}` : ""}
              </span>
            </SheetDescription>
          </SheetHeader>
          {search.node && detail.isPending && !selected ? (
            <div
              className="flex flex-col gap-3 px-6"
              role="status"
              aria-label={t("explore.detail.loading")}
            >
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : detail.isError ? (
            <p role="alert" className="px-6 text-sm">
              {t("explore.detail.error")}
            </p>
          ) : !selected ? (
            search.node ? (
              <p className="px-6 text-sm">{t("explore.detail.unavailable")}</p>
            ) : null
          ) : (
            <div className="flex flex-col gap-8 px-6 pb-8">
              <div className="flex flex-wrap gap-2">
                {selected.featured && (
                  <Badge>
                    <SparkleIcon />
                    {selected.featured}
                  </Badge>
                )}
                <Badge variant={selected.active ? "success" : "secondary"}>
                  <BroadcastIcon />
                  {selected.activityReason}
                </Badge>
              </div>
              {selected.summary && (
                <p className="text-base text-muted-foreground">{selected.summary}</p>
              )}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    nativeButton={false}
                    render={
                      <Link
                        to="/n/$slug"
                        params={{ slug: selected.slug }}
                        search={{ parentId: selected.parentId ?? undefined }}
                        data-testid="explore-open-community"
                      />
                    }
                  >
                    {t("explore.detail.open")}
                    <ArrowRightIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(window.location.href);
                        setShareMessage(t("explore.detail.copied"));
                        measurement.track("share", selected.nodeId);
                      } catch {
                        setShareMessage(t("explore.detail.copyFallback"));
                      }
                    }}
                  >
                    <CopyIcon /> {t("explore.detail.copy")}
                  </Button>
                </div>
                <p role="status" className="text-sm text-muted-foreground empty:hidden">
                  {shareMessage}
                </p>
              </div>
              {selected.channels.length > 0 && (
                <section className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    {t("explore.detail.channels")}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selected.channels.map((channel) => (
                      <Button
                        key={channel.url}
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={
                          <a
                            onClick={() =>
                              measurement.track("channel", selected.nodeId, channel.url)
                            }
                            href={channel.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {channel.label}
                            <ArrowUpRightIcon />
                          </a>
                        }
                      />
                    ))}
                  </div>
                </section>
              )}
              <section className="flex flex-col gap-4">
                <h3 className="text-lg font-medium">{t("explore.detail.upcoming")}</h3>
                {selected.events.length ? (
                  <EventList
                    events={selected.events}
                    nodeId={selected.nodeId}
                    campaign={search.campaign}
                    onOutbound={(activity) => {
                      if (activity.kind === "event")
                        measurement.track("event", selected.nodeId, activity.id);
                    }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{t("explore.detail.noEvents")}</p>
                )}
              </section>
              {selected.updates.length > 0 && (
                <section className="flex flex-col gap-4">
                  <h3 className="text-lg font-medium">{t("explore.detail.updates")}</h3>
                  <EventList
                    events={selected.updates}
                    nodeId={selected.nodeId}
                    campaign={search.campaign}
                    onOutbound={(activity) => {
                      if (activity.kind === "event")
                        measurement.track("event", selected.nodeId, activity.id);
                    }}
                  />
                </section>
              )}
              <div className="border-t border-border pt-4">
                <ReportContent targetId={selected.nodeId} kind="profile" />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CommunityCard({
  node,
  selected,
  onSelect,
}: {
  node: DiscoveryNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const { locale } = useAppLocale();
  const t = useAppTranslation();
  const next = node.events[0];
  const tile = next ? activityDateTile(next, locale) : null;
  return (
    <Item
      variant={selected ? "muted" : "outline"}
      className="h-full flex-col items-stretch gap-3"
      render={
        <button
          type="button"
          data-testid={`discovery-node-${node.nodeId}`}
          data-node-id={node.nodeId}
          aria-pressed={selected}
          onClick={onSelect}
        />
      }
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-base font-medium text-foreground">{node.name}</span>
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPinIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {node.location || t("explore.detail.noLocation")}
              {node.region ? ` · ${node.region}` : ""}
            </span>
          </span>
        </span>
        {node.featured ? (
          <Badge>
            <SparkleIcon />
            {node.featured}
          </Badge>
        ) : node.upcoming ? (
          <Badge variant="success">{t("explore.card.upcoming")}</Badge>
        ) : node.active ? (
          <Badge variant="secondary">{t("explore.card.active")}</Badge>
        ) : null}
      </span>
      {node.summary && (
        <span className="line-clamp-2 text-sm text-muted-foreground">{node.summary}</span>
      )}
      <span className="mt-auto flex items-center gap-2 border-t border-border pt-3 text-sm text-muted-foreground">
        <CalendarDotsIcon className="size-4 shrink-0" />
        {next ? (
          <span className="truncate">
            <span className="text-foreground">
              {tile ? `${tile.month} ${tile.day}` : t("explore.card.soon")}
            </span>
            {` · ${next.title}`}
          </span>
        ) : (
          <span>{t("explore.card.noEvents")}</span>
        )}
      </span>
    </Item>
  );
}
