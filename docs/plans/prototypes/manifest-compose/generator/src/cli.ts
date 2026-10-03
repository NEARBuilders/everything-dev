#!/usr/bin/env bun
/**
 * manifest-gen — the load-bearing generator step (ADR 0008 §2).
 *
 * Rides @tanstack/router-generator's scan (Generator.run + getCrawlingResult)
 * and emits, per remote workspace:
 *
 *   - src/routeTree.gen.ts   via the stock generator run (plugin-local
 *                            standalone DX — never consumed by the host)
 *   - src/manifest.gen.json  pure data: ids, paths, nesting, mounts, files
 *   - src/routeConfig.gen.ts generated import map of per-route option
 *                            bundles (loader/beforeLoad/head/staticData/
 *                            component) + lifted __root meta
 *
 * Nothing hand-maintained: the only inputs are the route files. Root-level
 * pathless layouts derive mounts via shared's registry; unknown mounts are
 * a hard generation error (no silent skip).
 */
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  Generator,
  getConfig,
} from "@tanstack/router-generator";
import {
  PluginManifestSchema,
  MOUNT_REGISTRY_VERSION,
  resolveMountSegment,
  type PluginManifest,
  type RouteRecord,
} from "@manifest-compose/shared";

interface GeneratorOpts {
  /** remote workspace root, e.g. ../remote-auth */
  remoteRoot: string;
  pluginName: string;
}

const MANIFEST_VERSION = 1;

async function exists(p: string): Promise<boolean> {
  return await readFile(p)
    .then(() => true)
    .catch(() => false);
}

export async function generateForRemote({ remoteRoot, pluginName }: GeneratorOpts) {
  const srcDir = path.join(remoteRoot, "src");
  const routesDir = path.join(srcDir, "routes");

  const generator = new Generator({
    config: getConfig(
      {
        target: "react",
        routesDirectory: "./src/routes",
        generatedRouteTree: "./src/routeTree.gen.ts",
        disableLogging: true,
      },
      remoteRoot,
    ),
    root: remoteRoot,
  });
  await generator.run();
  const crawling = await generator.getCrawlingResult();
  if (!crawling) throw new Error(`scan produced no result for ${pluginName}`);

  const { rootRouteNode, routeFileResult } = crawling;
  if (!rootRouteNode) throw new Error(`no __root found for ${pluginName}`);

  // id derivation: mirror the ids the stock generator writes into
  // routeTree.gen.ts (`/_public/login`, `/_public/` for index — trailing
  // slash kept, leading stripped).
  const idOf = (node: { routePath?: string }): string => {
    return (node.routePath ?? "").replace(/^\//, "");
  };

  const routes: RouteRecord[] = [];
  const errors: string[] = [];

  for (const node of routeFileResult) {
    const isRootLevel = node.parent === undefined || node.parent === rootRouteNode;
    let record: RouteRecord;

    if (node._fsRouteType === "__root") {
      continue; // root meta rides routeConfig, not a route record
    } else if (isRootLevel && (node._fsRouteType === "pathless_layout" || node._fsRouteType === "layout")) {
      // mount declaration: last `_`-prefixed segment of the id
      const id = idOf(node);
      const seg = id.split("/").at(-1) ?? "";
      if (!seg.startsWith("_")) continue; // pathless layouts w/o `_` prefix are internal
      const mount = resolveMountSegment(seg.slice(1));
      if (!mount) {
        errors.push(
          `unknown mount "_${seg.slice(1)}" (${node.filePath}); known: ${Object.keys(MOUNT_REGISTRY).join(", ")}`,
        );
        continue;
      }
      record = { id, isLayout: true, mount, file: node.filePath };
    } else {
      const isIndex = node._fsRouteType === "static" && node.cleanedPath === "/";
      const id = idOf(node);
      record = {
        id,
        path: isIndex ? "/" : node.cleanedPath === "/" || node.cleanedPath === "" ? undefined : node.cleanedPath,
        isLayout: node._fsRouteType === "pathless_layout" || node._fsRouteType === "layout",
        isIndex,
        file: node.filePath,
        parentId: node.parent ? idOf(node.parent) : undefined,
      };
    }
    routes.push(record);
  }

  if (errors.length > 0) {
    throw new Error(`manifest generation failed for ${pluginName}:\n  ${errors.join("\n  ")}`);
  }

  const manifest: PluginManifest = PluginManifestSchema.parse({
    name: pluginName,
    manifestVersion: MANIFEST_VERSION,
    routes,
  });

  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, "manifest.gen.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // route-config: dynamic import per route file (per-route chunks), options
  // destructured from the route module's named `Route` export.
  // node.filePath is routes-directory-relative (e.g. "_public/login.tsx").
  const importPath = (file: string) => "./routes/" + file.replace(/\.tsx$/, "").replace(/\.ts$/, "");
  const loaderLines = routes
    .filter((r) => r.file)
    .map((r) => {
      return `  ${JSON.stringify(r.id)}: () => import(${JSON.stringify(importPath(r.file!))}).then((m) => pick(m.Route.options)),`;
    });
  const rootImport = `import { Route as __rootRoute } from ${JSON.stringify(importPath(rootRouteNode.filePath))};`;

  const routeConfigSource = `// Generated by manifest-gen. DO NOT EDIT.
// Inputs: src/routes/** only.
import type { RouteConfigModule, RouteOptionsBundle } from "@manifest-compose/shared";

const pick = (o: any): RouteOptionsBundle => ({
  loader: o?.loader,
  beforeLoad: o?.beforeLoad,
  head: o?.head,
  staticData: o?.staticData,
  component: o?.component,
  errorComponent: o?.errorComponent,
  pendingComponent: o?.pendingComponent,
  notFoundComponent: o?.notFoundComponent,
});

${rootImport}

export const routeConfigLoaders: RouteConfigModule["routeConfigLoaders"] = {
${loaderLines.join("\n")}
};

export const rootMeta = pick(__rootRoute.options);
`;

  await writeFile(path.join(srcDir, "routeConfig.gen.ts"), routeConfigSource);

  return manifest;
}

// ---- CLI ----
if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("usage: bun run gen <pluginName> [--all]");
    process.exit(1);
  }
  const root = path.resolve(import.meta.dir, "../..");
  const targets =
    argv[0] === "--all"
      ? [
          { remoteRoot: path.join(root, "remote-auth"), pluginName: "auth" },
          { remoteRoot: path.join(root, "remote-landing"), pluginName: "landing" },
          { remoteRoot: path.join(root, "remote-landing-tenant"), pluginName: "landing" },
        ]
      : argv.map((name) => ({
          remoteRoot: path.join(root, `remote-${name}`),
          pluginName: name === "landing-tenant" ? "landing" : name,
        }));

  for (const t of targets) {
    const manifest = await generateForRemote(t);
    console.log(
      `manifest-gen: ${t.pluginName} (${path.basename(t.remoteRoot)}) — ${manifest.routes.length} routes, mounts: ${[...new Set(manifest.routes.map((r) => r.mount).filter(Boolean))].join(", ") || "none"}`,
    );
  }
}
