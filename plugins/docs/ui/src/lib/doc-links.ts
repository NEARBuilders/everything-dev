import { useMemo } from "react";
import type { DocLinkContext } from "@/components/docs/doc-links";
import type { NavNodeShape } from "../../../src/contract";

/** Every page slug in the navigation tree, in reading order. */
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

/**
 * What a rendered document needs to route its repository links: the corpus
 * it can open in the reader, and the repository everything else opens in.
 * Without a nav tree the corpus is unknown and documents are assumed
 * compiled.
 */
export function useDocLinks(
  nav: readonly NavNodeShape[] | undefined,
  repository: string | undefined,
): DocLinkContext {
  return useMemo(
    () => ({ slugs: nav ? new Set(slugsOf(nav)) : undefined, repository }),
    [nav, repository],
  );
}
