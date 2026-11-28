import { useMemo } from "react";
import type { DocLinkContext } from "@/components/docs/doc-links";
import type { NavNodeShape } from "../../../src/contract";

export function slugsOf(nav: readonly NavNodeShape[]): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly NavNodeShape[]): void => {
    for (const node of nodes) {
      if (node.slug) out.push(node.slug);
      walk(node.children);
    }
  };
  walk(nav);
  return out;
}

export function useDocLinks(
  nav: readonly NavNodeShape[] | undefined,
  repository: string | undefined,
): DocLinkContext {
  return useMemo(
    () => ({ slugs: nav ? new Set(slugsOf(nav)) : undefined, repository }),
    [nav, repository],
  );
}
