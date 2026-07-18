import type { AnyRouter } from "@tanstack/react-router";
import type { HeadData, HeadLink, HeadMeta, HeadScript } from "./types";

export function getMetaKey(meta: HeadMeta): string {
  if (!meta) return "null";
  if ("title" in meta) return "title";
  if ("charSet" in meta) return "charSet";
  if ("name" in meta) return `name:${(meta as { name: string }).name}`;
  if ("property" in meta) {
    return `property:${(meta as { property: string }).property}`;
  }
  if ("httpEquiv" in meta) {
    return `httpEquiv:${(meta as { httpEquiv: string }).httpEquiv}`;
  }
  return JSON.stringify(meta);
}

export function getLinkKey(link: HeadLink): string {
  const rel = (link as { rel?: string }).rel ?? "";
  const href = (link as { href?: string }).href ?? "";
  return `${rel}:${href}`;
}

export function getScriptKey(script: HeadScript): string {
  if (!script) return "null";
  if ("src" in script && script.src) return `src:${script.src}`;
  if ("children" in script && script.children) {
    return `children:${typeof script.children === "string" ? script.children : JSON.stringify(script.children)}`;
  }
  return JSON.stringify(script);
}

export async function collectHeadData(router: AnyRouter): Promise<HeadData> {
  await router.load();

  const metaMap = new Map<string, HeadMeta>();
  const linkMap = new Map<string, HeadLink>();
  const scriptMap = new Map<string, HeadScript>();

  for (const match of router.state.matches) {
    const route =
      (
        router as AnyRouter & {
          routesById?: Record<string, { options?: { head?: (...args: unknown[]) => unknown } }>;
        }
      ).routesById?.[(match as { routeId: string }).routeId] ??
      (match as { route?: { options?: { head?: (...args: unknown[]) => unknown } } }).route;
    const headFn = route?.options?.head;
    if (!headFn) continue;

    try {
      const headResult = (await headFn({
        loaderData: match.loaderData,
        matches: router.state.matches,
        match,
        params: match.params,
      })) as {
        meta?: HeadMeta[];
        links?: HeadLink[];
        scripts?: HeadScript[];
      };

      if (headResult?.meta) {
        for (const meta of headResult.meta) {
          metaMap.set(getMetaKey(meta), meta);
        }
      }
      if (headResult?.links) {
        for (const link of headResult.links) {
          linkMap.set(getLinkKey(link), link);
        }
      }
      if (headResult?.scripts) {
        for (const script of headResult.scripts) {
          scriptMap.set(getScriptKey(script), script);
        }
      }
    } catch (error) {
      console.warn(`[collectHeadData] head() failed for ${match.routeId}:`, error);
    }
  }

  return {
    meta: [...metaMap.values()],
    links: [...linkMap.values()],
    scripts: [...scriptMap.values()],
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeMeta(meta: HeadMeta): string {
  if (!meta) return "";
  if ("charSet" in meta) return `<meta charset="${escapeHtml(String(meta.charSet))}">`;
  if ("title" in meta) return `<title>${escapeHtml(String(meta.title))}</title>`;
  const attrs = Object.entries(meta as Record<string, unknown>)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`)
    .join(" ");
  return `<meta ${attrs}>`;
}

function serializeLink(link: HeadLink): string {
  if (!link) return "";
  const attrs = Object.entries(link as Record<string, unknown>)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`)
    .join(" ");
  return `<link ${attrs}>`;
}

function serializeScript(script: HeadScript, cspNonce?: string): string {
  if (!script) return "";
  if ("src" in script && script.src) {
    const attrs: string[] = [`src="${escapeHtml(script.src)}"`];
    if (script.integrity) attrs.push(`integrity="${escapeHtml(script.integrity)}"`);
    if (script.crossOrigin) attrs.push(`crossorigin="${escapeHtml(script.crossOrigin)}"`);
    if (script.type) attrs.push(`type="${escapeHtml(script.type)}"`);
    if (cspNonce) attrs.push(`nonce="${cspNonce}"`);
    return `<script ${attrs.join(" ")}></script>`;
  }
  if ("children" in script) {
    const attrs: string[] = [];
    if (script.type) attrs.push(`type="${escapeHtml(script.type)}"`);
    if (cspNonce) attrs.push(`nonce="${cspNonce}"`);
    const content =
      typeof script.children === "string" ? script.children : JSON.stringify(script.children);
    return `<script${attrs.length ? ` ${attrs.join(" ")}` : ""}>${content}</script>`;
  }
  return "";
}

export function serializeHeadData(
  headData: HeadData,
  cspNonce?: string,
): { metaHtml: string; linkHtml: string; scriptHtml: string } {
  return {
    metaHtml: headData.meta
      .filter(Boolean)
      .map((m) => serializeMeta(m))
      .join("\n"),
    linkHtml: headData.links
      .filter(Boolean)
      .map((l) => serializeLink(l))
      .join("\n"),
    scriptHtml: headData.scripts
      .filter(Boolean)
      .map((s) => serializeScript(s, cspNonce))
      .join("\n"),
  };
}
