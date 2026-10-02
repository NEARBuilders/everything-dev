import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { SectionHeader } from "@/components";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";

type ChildNode = { id: string; name: string; slug: string };

export function StakeNoValidator({ name, childNodes }: { name: string; childNodes: ChildNode[] }) {
  return (
    <section className="flex flex-col gap-4" data-testid="stake.no-validator">
      <SectionHeader
        title={`${name} doesn't have a validator yet`}
        description={
          childNodes.length > 0
            ? "Pick a community inside it instead."
            : "Check back once it sets one up."
        }
      />
      {childNodes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {childNodes.map((child) => (
            <li key={child.id}>
              <Item
                variant="outline"
                size="sm"
                render={<Link to="/stake" search={{ node: child.slug, nodeId: child.id }} />}
              >
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    <span className="capitalize">{child.name}</span>
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <ArrowRightIcon className="text-muted-foreground" />
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
