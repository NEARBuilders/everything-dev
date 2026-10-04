/**
 * Shared review/boot harness: resolvers, render, health-check runner.
 * One implementation, consumed by verify.tsx (disk gates), start.tsx
 * (dev boot) and server.tsx (bundled MF boot).
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createRequestHandler, renderRouterToStream, RouterServer } from "@tanstack/react-router/ssr/server";
import {
  PluginManifestSchema,
  resolveApp,
  type AppInput,
  type PluginManifest,
  type PluginRef,
  type ResolvedApp,
} from "@manifest-compose/shared";
import { constructTree, type ConstructedTree, type HostContext, type PluginResolver } from "./construct";

export const ANON: HostContext = {};
export const ADMIN: HostContext = { user: { id: "u1", name: "Ada", isAdmin: true } };
export const clean = (html: string) => html.replaceAll(/<!-- -->/g, "");

export function resolveAppOrThrow(apps: Record<string, AppInput>, key: string): ResolvedApp {
  const input = apps[key];
  if (!input) throw new Error(`unknown app "${key}" — known: ${Object.keys(apps).join(", ")}`);
  return resolveApp(input, apps);
}

export async function renderPath(
  urlPath: string,
  tree: ConstructedTree,
  context: HostContext,
  origin = "http://localhost:3000",
): Promise<Response> {
  const request = new Request(`${origin}${urlPath}`);
  const handler = createRequestHandler({
    request,
    createRouter: () =>
      createRouter({
        routeTree: tree.rootRoute as any,
        history: createMemoryHistory(),
        context,
      }),
  });
  return await handler(({ request, responseHeaders, router }) =>
    renderRouterToStream({
      request,
      responseHeaders,
      router,
      children: <RouterServer router={router} />,
    }),
  );
}

/** Consume an SSR response into text + status + redirect location. */
export async function readResponse(response: Response) {
  return {
    status: response.status,
    location: response.headers.get("location") ?? undefined,
    html: await new Response(response.body).text(),
  };
}

// ---- disk resolver: the DEV path (source manifests, no MF) ----

export const manifestCache = new Map<string, PluginManifest>();

export function diskResolver(protoRoot: string): PluginResolver {
  return async (ref: PluginRef) => {
    if (ref.source.kind !== "local") {
      throw new Error(
        `app declares remote ref for "${ref.key}" — remote refs boot through the bundled server (node dist), not the dev disk path`,
      );
    }
    const dir = path.join(protoRoot, ref.source.path);
    let manifest = manifestCache.get(dir);
    if (!manifest) {
      manifest = PluginManifestSchema.parse(
        JSON.parse(readFileSync(path.join(dir, "src/manifest.gen.json"), "utf8")),
      );
      manifestCache.set(dir, manifest);
    }
    const routeConfig = (await import(pathToFileURL(path.join(dir, "src/routeConfig.gen.ts")).href)) as any;
    return { key: ref.key, mfName: ref.key, manifest, routeConfig };
  };
}

// ---- boot health gate (fail-loud, ADR 0007 §2) ----

export interface HealthCase {
  path: string;
  ctx: HostContext;
  expect?: string;
  status?: number;
}

export async function bootHealth(
  tree: ConstructedTree,
  cases: HealthCase[],
): Promise<number> {
  let failures = 0;
  for (const c of cases) {
    try {
      const r = await readResponse(await renderPath(c.path, tree, c.ctx));
      const ok = c.expect ? clean(r.html).includes(c.expect) : r.status === c.status;
      if (!ok) failures++;
      console.log(`  ${ok ? "ok  " : "FAIL"}  ${c.path}  ${c.expect ? `contains "${c.expect}"` : `→ ${r.status} ${r.location ?? ""}`}`);
    } catch (err) {
      failures++;
      console.log(`  FAIL  ${c.path}  threw: ${(err as Error).message}`);
    }
  }
  return failures;
}
