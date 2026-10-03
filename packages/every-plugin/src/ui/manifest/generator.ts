import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";
import {
  MANIFEST_FILENAME,
  type PluginManifest,
  PluginManifestSchema,
  ROUTE_CONFIG_FILENAME,
  type RouteRecord,
  resolveMountSegment,
} from "./index";
import { MOUNT_REGISTRY } from "./mount-registry";
import { ROUTE_OPTION_KEYS } from "./route-config";

/**
 * The load-bearing generator step (ADR 0008 §2). Rides
 * `@tanstack/router-generator`'s scan (Generator.run + getCrawlingResult)
 * and emits, per ui source workspace:
 *
 *   - src/routeTree.gen.ts   via the stock generator run (plugin-local
 *                            standalone DX — never consumed by the host)
 *   - src/manifest.gen.json  pure data: ids, paths, nesting, mounts, files
 *   - src/routeConfig.gen.ts generated import map of per-route option
 *                            bundles + lifted `__root` meta
 *
 * Nothing hand-maintained: the only inputs are the route files. Root-level
 * pathless layouts derive mounts via the registry; unknown mounts, routes
 * under a missing mount layout, and duplicate sibling paths are hard errors
 * here (cross-plugin path collisions are enforced at construction time —
 * see `constructTree`).
 */

const MANIFEST_VERSION = 1;

export interface ManifestGeneratorOptions {
  /** ui source workspace root (ui/ or plugins/<id>/ui/) */
  workspaceRoot: string;
  /** composition-identity plugin key written into the manifest */
  pluginName: string;
  routesDirectory?: string;
  generatedRouteTree?: string;
  srcDir?: string;
  /** module specifier the generated routeConfig imports its types from */
  typeImport?: string;
  /**
   * When false, the stock routeTree write is redirected to a scratch path —
   * for builds where TanStackRouterRspack owns src/routeTree.gen.ts (its
   * autoCodeSplitting options differ); only manifest + routeConfig persist.
   */
  emitRouteTree?: boolean;
}

interface ScanNode {
  routePath?: string;
  cleanedPath?: string;
  filePath?: string;
  parent?: ScanNode | undefined;
  _fsRouteType?: string;
}

const idOf = (node: { routePath?: string }): string => (node.routePath ?? "").replace(/^\//, "");

function importPathOf(file: string): string {
  return `./routes/${file.replace(/\.tsx$/, "").replace(/\.ts$/, "")}`;
}

export async function generateUiManifest(
  options: ManifestGeneratorOptions,
): Promise<PluginManifest> {
  const {
    workspaceRoot,
    pluginName,
    routesDirectory = "./src/routes",
    generatedRouteTree = "./src/routeTree.gen.ts",
    srcDir = "./src",
    typeImport = "everything-dev/ui/manifest",
    emitRouteTree = true,
  } = options;

  const routeTreeTarget = emitRouteTree
    ? generatedRouteTree
    : "./node_modules/.cache/manifest-compose/routeTree.gen.ts";

  const generator = new Generator({
    config: getConfig(
      {
        target: "react",
        routesDirectory,
        generatedRouteTree: routeTreeTarget,
        routeFileIgnorePrefix: "-",
        routeFileIgnorePattern: "\\.(test|spec)\\.(ts|tsx)$",
        disableLogging: true,
      },
      workspaceRoot,
    ),
    root: workspaceRoot,
  });
  await generator.run();
  const crawling = await generator.getCrawlingResult();
  if (!crawling) throw new Error(`scan produced no result for ${pluginName}`);

  const { rootRouteNode, routeFileResult } = crawling;
  if (!rootRouteNode) throw new Error(`no __root found for ${pluginName}`);

  const routes: RouteRecord[] = [];
  const errors: string[] = [];

  for (const node of routeFileResult as ScanNode[]) {
    const isRootLevel = node.parent === undefined || node.parent === rootRouteNode;

    if (node._fsRouteType === "__root") {
      continue;
    }

    if (
      isRootLevel &&
      (node._fsRouteType === "pathless_layout" || node._fsRouteType === "layout")
    ) {
      const id = idOf(node);
      const segment = id.split("/").at(-1) ?? "";
      if (!segment.startsWith("_")) continue;
      const mount = resolveMountSegment(segment.slice(1));
      if (!mount) {
        errors.push(
          `unknown mount "_${segment.slice(1)}" (${node.filePath}); known: ${Object.keys(MOUNT_REGISTRY).join(", ")}`,
        );
        continue;
      }
      routes.push({ id, isLayout: true, mount, file: node.filePath });
      continue;
    }

    const isIndex = node._fsRouteType === "static" && node.cleanedPath === "/";
    routes.push({
      id: idOf(node),
      path: isIndex
        ? "/"
        : node.cleanedPath === "/" || node.cleanedPath === ""
          ? undefined
          : node.cleanedPath,
      isLayout: node._fsRouteType === "pathless_layout" || node._fsRouteType === "layout",
      isIndex,
      file: node.filePath,
      parentId: node.parent && node.parent !== rootRouteNode ? idOf(node.parent) : undefined,
    });
  }

  for (const record of routes) {
    if (record.isLayout && record.mount) continue;
    if (record.parentId) continue;
    const firstSegment = record.id.split("/")[0] ?? "";
    if (firstSegment.startsWith("_")) {
      const mount = resolveMountSegment(firstSegment.slice(1));
      if (!mount) {
        errors.push(
          `unknown mount "_${firstSegment.slice(1)}" (${record.file}); known: ${Object.keys(MOUNT_REGISTRY).join(", ")}`,
        );
      }
    } else {
      errors.push(
        `route "${record.id}" (${record.file}) must live under a mount — root-level pathed routes have no gate`,
      );
    }
  }

  const siblingPathClaims = new Map<string, string>();
  for (const record of routes) {
    if (record.isLayout || record.path === undefined) continue;
    const claimKey = `${record.parentId ?? ""}::${record.path}`;
    const claimant = siblingPathClaims.get(claimKey);
    if (claimant) {
      errors.push(
        `duplicate path "${record.path}" under "${record.parentId ?? "mount root"}": "${claimant}" and "${record.id}" (${record.file})`,
      );
      continue;
    }
    siblingPathClaims.set(claimKey, record.id);
  }

  if (errors.length > 0) {
    throw new Error(`manifest generation failed for ${pluginName}:\n  ${errors.join("\n  ")}`);
  }

  const manifest: PluginManifest = PluginManifestSchema.parse({
    name: pluginName,
    manifestVersion: MANIFEST_VERSION,
    routes,
  });

  const resolvedSrc = path.resolve(workspaceRoot, srcDir);
  await mkdir(resolvedSrc, { recursive: true });
  await writeIfChanged(
    path.join(resolvedSrc, MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const loaderLines = routes
    .filter((r) => r.file)
    .map(
      (r) =>
        `  ${JSON.stringify(r.id)}: () => import(${JSON.stringify(importPathOf(r.file!))}).then((m) => pick(m.Route.options)),`,
    );
  const rootImport = `import { Route as __rootRoute } from ${JSON.stringify(importPathOf(rootRouteNode.filePath ?? "__root"))};`;

  const routeConfigSource = `// Generated by manifest-gen. DO NOT EDIT.
// Inputs: src/routes/** only.
import type { RouteConfigModule, RouteOptionsBundle } from ${JSON.stringify(typeImport)};

const pick = (o: any): RouteOptionsBundle => ({
${ROUTE_OPTION_KEYS.map((key) => `  ${key}: o?.${key},`).join("\n")}
});

${rootImport}

export const routeConfigLoaders: RouteConfigModule["routeConfigLoaders"] = {
${loaderLines.join("\n")}
};

export const rootMeta = pick(__rootRoute.options);
`;

  await writeIfChanged(path.join(resolvedSrc, ROUTE_CONFIG_FILENAME), routeConfigSource);

  return manifest;
}

/**
 * Identical content is never re-written: the dev watcher is timestamp-based,
 * so an unconditional write re-triggers compilation — which runs this
 * generator again — an infinite regen loop.
 */
async function writeIfChanged(file: string, contents: string): Promise<void> {
  const existing = await readFile(file, "utf8").catch(() => undefined);
  if (existing === contents) return;
  await writeFile(file, contents);
}
