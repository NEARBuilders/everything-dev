import { Link } from "@tanstack/react-router";
import type { NavNodeShape } from "../../../../src/contract";

interface NavTreeProps {
  nodes: readonly NavNodeShape[];
  currentSlug?: string;
  depth?: number;
}

const isAncestor = (dirPath: string, currentSlug?: string): boolean =>
  Boolean(
    dirPath && currentSlug && (currentSlug === dirPath || currentSlug.startsWith(`${dirPath}/`)),
  );

export function NavTree({ nodes, currentSlug, depth = 0 }: NavTreeProps) {
  const leadSection = depth === 0 ? nodes.find((node) => !node.slug)?.path : undefined;
  return (
    <ul
      className={`flex flex-col gap-0.5 ${depth > 0 ? "border-l border-border pl-3" : ""}`}
      data-testid={depth === 0 ? "docs.tree" : undefined}
    >
      {nodes.map((node) =>
        node.slug ? (
          <li key={node.slug}>
            <Link
              to="/docs/$"
              params={{ _splat: node.slug }}
              className={`block truncate rounded-md px-2 py-1 text-sm transition-colors ${
                currentSlug === node.slug
                  ? "bg-accent/60 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              }`}
              data-testid="docs.item"
            >
              {node.label}
            </Link>
          </li>
        ) : (
          <li key={node.path || `${node.label}-${node.children.length}`}>
            <details
              open={node.path === leadSection || isAncestor(node.path, currentSlug)}
              data-testid="docs.tree-dir"
            >
              <summary className="cursor-pointer list-none px-2 py-1 text-xs font-bold tracking-wider text-muted-foreground uppercase select-none hover:text-foreground">
                {node.label}
              </summary>
              <div className="mt-0.5 mb-1">
                <NavTree nodes={node.children} currentSlug={currentSlug} depth={depth + 1} />
              </div>
            </details>
          </li>
        ),
      )}
    </ul>
  );
}
