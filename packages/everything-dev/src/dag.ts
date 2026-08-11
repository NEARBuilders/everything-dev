import type { JsonObject, RuntimeConfig, RuntimeDependencyNode } from "./types";

export interface DependencyDAG {
  nodes: Map<string, RuntimeDependencyNode>;
  sorted: string[];
}

export function normalizeToNodes(config: RuntimeConfig): Map<string, RuntimeDependencyNode> {
  const nodes = new Map<string, RuntimeDependencyNode>();

  if (config.api?.url) {
    nodes.set("api", {
      key: "api",
      kind: "api",
      name: config.api.name,
      url: config.api.url,
      entry: config.api.entry,
      source: config.api.source,
      localPath: config.api.localPath,
      port: config.api.port,
      proxy: config.api.proxy,
      variables: config.api.variables,
      secrets: config.api.secrets,
      integrity: config.api.integrity,
      shared: config.api.shared,
      dependsOn: config.api.dependsOn,
      sourceOrigin: "config",
      singletonKey: `api:${config.api.url}`,
    });
  }

  if (config.auth?.url) {
    nodes.set("auth", {
      key: "auth",
      kind: "auth",
      name: config.auth.name,
      url: config.auth.url,
      entry: config.auth.entry,
      source: config.auth.source,
      extendsRef: config.auth.extendsRef,
      localPath: config.auth.localPath,
      port: config.auth.port,
      proxy: config.auth.proxy,
      variables: config.auth.variables,
      secrets: config.auth.secrets,
      integrity: config.auth.integrity,
      shared: config.auth.shared,
      dependsOn: config.auth.dependsOn,
      sourceOrigin: "config",
      singletonKey: `auth:${config.auth.url}`,
    });
  }

  if (config.ui?.url) {
    nodes.set("ui", {
      key: "ui",
      kind: "ui",
      name: config.ui.name,
      url: config.ui.url,
      entry: config.ui.entry,
      source: config.ui.source,
      localPath: config.ui.localPath,
      port: config.ui.port,
      integrity: config.ui.integrity,
      dependsOn: config.ui.dependsOn,
      sourceOrigin: "config",
      singletonKey: `ui:${config.ui.url}`,
    });
  }

  for (const [key, plugin] of Object.entries(config.plugins ?? {})) {
    if (!plugin.url) continue;
    nodes.set(key, {
      key,
      kind: "plugin",
      name: plugin.name,
      url: plugin.url,
      entry: plugin.entry,
      source: plugin.source,
      extendsRef: plugin.extendsRef,
      localPath: plugin.localPath,
      port: plugin.port,
      proxy: plugin.proxy,
      variables: plugin.variables,
      secrets: plugin.secrets,
      integrity: plugin.integrity,
      shared: plugin.shared,
      ui: plugin.ui,
      routes: plugin.routes,
      dependsOn: plugin.dependsOn,
      sourceOrigin: "config",
      singletonKey: `plugin:${key}:${plugin.url}`,
    });
  }

  return nodes;
}

export function manifestPluginsToNodes(
  plugins: Array<{
    key: string;
    name: string;
    url: string;
    dependsOn?: string[];
    secrets?: string[];
    variables?: JsonObject;
  }>,
): RuntimeDependencyNode[] {
  if (!plugins?.length) return [];
  return plugins.map((p) => ({
    key: p.key,
    kind: "plugin" as const,
    name: p.name,
    url: p.url,
    entry: `${p.url}/mf-manifest.json`,
    source: "remote" as const,
    dependsOn: p.dependsOn,
    secrets: p.secrets,
    variables: p.variables,
    sourceOrigin: "manifest" as const,
    singletonKey: `plugin:${p.key}:${p.url}`,
  }));
}

export function buildDependencyDAG(config: RuntimeConfig): DependencyDAG {
  const nodes =
    config.nodes && Object.keys(config.nodes).length > 0
      ? new Map(Object.entries(config.nodes))
      : normalizeToNodes(config);
  const sorted = topologicalSort(nodes);
  return { nodes, sorted };
}

export function getImplicitApiDependencies(nodes: Map<string, RuntimeDependencyNode>): string[] {
  return [...nodes.values()].filter((n) => n.kind !== "api" && n.kind !== "ui").map((n) => n.key);
}

export function topologicalSort(nodes: Map<string, RuntimeDependencyNode>): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const key of nodes.keys()) {
    inDegree.set(key, 0);
    adjacency.set(key, new Set());
  }

  for (const [key, node] of nodes) {
    for (const dep of node.dependsOn ?? []) {
      if (nodes.has(dep)) {
        adjacency.get(dep)!.add(key);
        inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
      }
    }
  }

  const apiNode = nodes.get("api");
  if (apiNode && !apiNode.dependsOn?.length) {
    for (const depKey of getImplicitApiDependencies(nodes)) {
      if (!adjacency.get(depKey)!.has("api")) {
        adjacency.get(depKey)!.add("api");
        inDegree.set("api", (inDegree.get("api") ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [key, degree] of inDegree) {
    if (degree === 0) queue.push(key);
  }
  queue.sort();

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          const insertPos = queue.findIndex((k) => k > neighbor);
          if (insertPos === -1) queue.push(neighbor);
          else queue.splice(insertPos, 0, neighbor);
        }
      }
    }
  }

  if (result.length !== nodes.size) {
    const cyclic = [...nodes.keys()].filter((k) => !result.includes(k));
    throw new Error(
      `Circular dependency detected among: ${cyclic.join(" -> ")}. Check dependsOn declarations in bos.config.`,
    );
  }

  return result;
}

export function mergeManifestNodes(
  configNodes: Map<string, RuntimeDependencyNode>,
  manifestNodes: RuntimeDependencyNode[],
): Map<string, RuntimeDependencyNode> {
  const merged = new Map(configNodes);

  for (const node of manifestNodes) {
    if (merged.has(node.key) && merged.get(node.key)!.sourceOrigin === "config") {
      continue;
    }
    merged.set(node.key, node);
  }

  return merged;
}

export function getDependenciesForNode(
  node: RuntimeDependencyNode,
  allNodes: Map<string, RuntimeDependencyNode>,
): RuntimeDependencyNode[] {
  if (node.kind === "api" && !node.dependsOn?.length) {
    return getImplicitApiDependencies(allNodes)
      .map((k) => allNodes.get(k))
      .filter(Boolean) as RuntimeDependencyNode[];
  }

  const explicitDeps = (node.dependsOn ?? [])
    .map((k) => allNodes.get(k))
    .filter(Boolean) as RuntimeDependencyNode[];

  return explicitDeps;
}

export function getSingletonKey(node: RuntimeDependencyNode): string {
  return node.singletonKey ?? `${node.kind}:${node.key}:${node.url}`;
}
