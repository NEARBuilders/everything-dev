import { ArrowRightIcon, BuildingsIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { nodeKindLabel } from "@/lib/node-kind";

type DirectoryNode = {
  id: string;
  kind: string | null;
  name: string;
  slug: string;
  hostname: string | null;
};

export function StakeDirectory({
  gateway,
  isLoading,
  nodes,
}: {
  /** Gateway domain from the runtime config — null when misconfigured; nodes then show only their own hostname. */
  gateway: string | null;
  isLoading: boolean;
  nodes: DirectoryNode[];
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {["a", "b", "c", "d"].map((key) => (
          <Skeleton key={key} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={BuildingsIcon}
        title="No communities to stake to yet"
        description="Start one and it can run its own validator."
        action={
          <Button nativeButton={false} render={<Link to="/apply" />}>
            Start a community
          </Button>
        }
      />
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="stake.directory">
      {nodes.map((node) => (
        <li key={node.id}>
          <Item
            variant="outline"
            data-testid={`stake.community-${node.slug}`}
            render={<Link to="/stake" search={{ node: node.slug }} />}
          >
            <ItemContent className="min-w-0">
              <ItemTitle className="max-w-full">
                <span className="truncate capitalize">{node.name}</span>
              </ItemTitle>
              <ItemDescription>
                <span className="block truncate">
                  {node.hostname ?? (gateway ? `${node.slug}.${gateway}` : null)}
                </span>
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="secondary">
                <span className="capitalize">{nodeKindLabel(node.kind)}</span>
              </Badge>
              <ArrowRightIcon className="text-muted-foreground" />
            </ItemActions>
          </Item>
        </li>
      ))}
    </ul>
  );
}
