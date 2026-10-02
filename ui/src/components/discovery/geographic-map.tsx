import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/app";
import "leaflet/dist/leaflet.css";

type Node = Awaited<ReturnType<ApiClient["listDiscovery"]>>[number];
export function GeographicMap({
  nodes,
  onSelect,
  selectedId,
}: {
  nodes: Node[];
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const select = useRef(onSelect);
  const selected = useRef(selectedId);
  const redraw = useRef<() => void>(undefined);
  const apply = useRef<(nodes: Node[]) => void>(undefined);
  const mapRef = useRef<{ panTo: (latlng: [number, number]) => void } | null>(null);
  const nodesRef = useRef(nodes);
  select.current = onSelect;
  selected.current = selectedId;
  nodesRef.current = nodes;
  // The map is created once and then fed new nodes; rebuilding it on every
  // refetch made it flash and lose the viewport while typing in search.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    setFailed(false);
    import("leaflet")
      .then((L) => {
        if (cancelled || !container.current) return;
        const map = L.map(container.current, {
          scrollWheelZoom: false,
          minZoom: 2,
          maxZoom: 18,
        }).setView([20, 0], 2);
        mapRef.current = {
          panTo: (latlng) => map.panTo(latlng, { animate: true }),
        };
        const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          referrerPolicy: "origin",
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);
        tiles.on("tileerror", () => setFailed(true));
        let points: { node: Node; point: ReturnType<typeof L.latLng> }[] = [];
        let fitted = "";
        const markers = L.layerGroup().addTo(map);
        const draw = () => {
          markers.clearLayers();
          const groups = new Map<string, typeof points>();
          for (const p of points) {
            const pixel = map.project(p.point);
            const key = `${Math.floor(pixel.x / 48)}:${Math.floor(pixel.y / 48)}`;
            groups.set(key, [...(groups.get(key) ?? []), p]);
          }
          for (const group of groups.values()) {
            const first = group[0];
            if (!first) continue;
            const active = group.some((entry) => entry.node.nodeId === selected.current);
            const label =
              group.length > 1
                ? `${group.length} communities near ${first.node.location}`
                : first.node.name;
            const content = document.createElement("span");
            content.className = `flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold shadow-lg ${
              active
                ? "border-primary bg-primary text-primary-foreground ring-2 ring-ring ring-offset-2 ring-offset-background"
                : "border-background bg-primary text-primary-foreground"
            }`;
            content.textContent = group.length > 1 ? String(group.length) : "";
            const marker = L.marker(first.point, {
              title: label,
              alt: label,
              icon: L.divIcon({ html: content, className: "", iconSize: [32, 32] }),
            }).addTo(markers);
            marker.getElement()?.setAttribute("aria-label", label);
            marker.getElement()?.setAttribute("aria-current", active ? "true" : "false");
            marker
              .getElement()
              ?.setAttribute("data-testid", `discovery-map-marker-${first.node.nodeId}`);
            marker.on("click", () => {
              if (group.length === 1) {
                select.current(first.node.nodeId);
                return;
              }
              const list = document.createElement("div");
              list.className = "flex max-h-64 flex-col gap-1 overflow-y-auto";
              for (const { node } of group) {
                const button = document.createElement("button");
                button.type = "button";
                button.dataset.testid = `discovery-cluster-node-${node.nodeId}`;
                button.className = "rounded-lg px-3 py-2 text-left text-sm hover:bg-muted";
                button.textContent = node.name;
                button.addEventListener("click", () => {
                  marker.getElement()?.focus();
                  select.current(node.nodeId);
                  map.closePopup();
                });
                list.append(button);
              }
              marker.bindPopup(list).openPopup();
            });
          }
        };
        const update = (next: Node[]) => {
          points = next.flatMap((node) =>
            node.latitude !== null && node.longitude !== null
              ? [{ node, point: L.latLng(node.latitude, node.longitude) }]
              : [],
          );
          // Only move the viewport when the result set itself changed, so a
          // background refetch of the same communities leaves it alone.
          const key = points
            .map((entry) => entry.node.nodeId)
            .sort()
            .join(",");
          if (key !== fitted) {
            fitted = key;
            if (points.length)
              map.fitBounds(L.latLngBounds(points.map((p) => p.point)), {
                padding: [35, 35],
                maxZoom: 8,
              });
            const focused = points.find((entry) => entry.node.nodeId === selected.current);
            if (focused) map.panTo(focused.point);
          }
          draw();
        };
        redraw.current = draw;
        apply.current = update;
        update(nodesRef.current);
        map.on("zoomend", draw);
        const observer = new ResizeObserver(() => map.invalidateSize());
        observer.observe(container.current);
        dispose = () => {
          observer.disconnect();
          map.remove();
          mapRef.current = null;
          redraw.current = undefined;
          apply.current = undefined;
        };
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
  useEffect(() => {
    apply.current?.(nodes);
  }, [nodes]);
  useEffect(() => {
    redraw.current?.();
    const node = nodesRef.current.find((entry) => entry.nodeId === selectedId);
    if (node && node.latitude !== null && node.longitude !== null)
      mapRef.current?.panTo([node.latitude, node.longitude]);
  }, [selectedId]);
  return (
    <section aria-label="Map" className="flex flex-col">
      {failed && (
        <p role="status" className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
          Map isn’t loading. Use the list instead.
        </p>
      )}
      <div ref={container} className="relative z-0 h-87.5 w-full sm:h-110 lg:h-160" />
    </section>
  );
}
