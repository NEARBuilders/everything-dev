import {
  BuildingsIcon,
  CaretRightIcon,
  GlobeHemisphereWestIcon,
  MapTrifoldIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import type { ReactNode } from "react";
import { buildTenantUrl } from "@/app";
import { nodeKindLabel } from "@/lib/node-kind";
import { NodeDirectorySkeleton } from "./node-directory-skeleton";
import { Badge } from "./ui/badge";

export interface NodeDirectoryNode {
  id: string;
  name: string;
  slug: string;
  kind: string | null;
  parentId?: string | null;
  hostname?: string | null;
}

interface NodeDirectoryProps {
  nodes: NodeDirectoryNode[];
  /** Gateway domain from the runtime config — null when misconfigured; nodes then link only via their own hostname. */
  gateway: string | null;
  validatorNodeIds?: ReadonlySet<string>;
  isLoading?: boolean;
  emptyMessage?: string;
  empty?: ReactNode;
  layout?: "list" | "grid";
  linkTo?: "/stake" | "/n/$slug";
  linkSearch?: (node: NodeDirectoryNode) => { node?: string } | undefined;
}

function KindIcon({ kind, className }: { kind: string | null; className?: string }) {
  if (kind === "country") return <GlobeHemisphereWestIcon className={className} />;
  if (kind === "state") return <MapTrifoldIcon className={className} />;
  return <BuildingsIcon className={className} />;
}

export function NodeDirectory({
  nodes,
  gateway,
  validatorNodeIds,
  isLoading = false,
  emptyMessage = "No communities yet.",
  empty,
  layout = "list",
  linkTo,
  linkSearch,
}: NodeDirectoryProps) {
  if (isLoading) {
    return <NodeDirectorySkeleton layout={layout} />;
  }

  if (nodes.length === 0) {
    return empty ?? <p className="py-4 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const grid = layout === "grid";

  return (
    <ul
      className={cn(
        grid
          ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          : "flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border",
      )}
    >
      {nodes.map((node) => {
        const hostname = node.hostname ?? (gateway ? `${node.slug}.${gateway}` : null);
        const href = hostname
          ? gateway
            ? (buildTenantUrl(hostname, gateway, { path: "/" }) ?? `https://${hostname}/`)
            : `https://${hostname}/`
          : null;
        const className = cn(
          "group flex min-h-16 items-center gap-4 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          grid
            ? "h-full rounded-2xl border border-border bg-card p-4 hover:bg-muted"
            : "bg-card px-4 py-3 hover:bg-muted",
        );
        const content = (
          <>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground group-hover:bg-background">
              <KindIcon kind={node.kind} className="size-5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="truncate text-base font-medium text-foreground">{node.name}</div>
              <div className="truncate text-sm text-muted-foreground">{hostname}</div>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              {validatorNodeIds?.has(node.id) && <Badge variant="success">Validator</Badge>}
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {nodeKindLabel(node.kind)}
              </Badge>
              <CaretRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </span>
          </>
        );
        return (
          <li key={node.id}>
            {linkTo === "/n/$slug" ? (
              <Link
                to="/n/$slug"
                params={{ slug: node.slug }}
                search={{ parentId: node.parentId ?? undefined }}
                className={className}
              >
                {content}
              </Link>
            ) : linkTo ? (
              <Link to={linkTo} search={linkSearch?.(node) ?? {}} className={className}>
                {content}
              </Link>
            ) : href ? (
              <a href={href} className={className}>
                {content}
              </a>
            ) : (
              <div className={className}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
