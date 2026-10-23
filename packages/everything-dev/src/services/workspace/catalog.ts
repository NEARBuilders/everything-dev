import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

interface PkgJsonLike {
  workspaces?: { packages?: string[]; catalog?: Record<string, string> };
}

interface WorkspaceYaml {
  packages?: string[];
  catalog?: Record<string, string>;
  [key: string]: unknown;
}

const WORKSPACE_YAML = "pnpm-workspace.yaml";

export function catalogFromPackageJson(pkgJson: PkgJsonLike): Record<string, string> {
  const catalog = pkgJson.workspaces?.catalog;
  return catalog && typeof catalog === "object" ? { ...catalog } : {};
}

export function readWorkspaceCatalog(root: string): Record<string, string> {
  const yamlPath = join(root, WORKSPACE_YAML);
  if (existsSync(yamlPath)) {
    const doc = parse(readFileSync(yamlPath, "utf8")) as WorkspaceYaml | null;
    const catalog = doc?.catalog;
    return catalog && typeof catalog === "object" ? { ...catalog } : {};
  }

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PkgJsonLike;
      return catalogFromPackageJson(pkg);
    } catch {
      return {};
    }
  }

  return {};
}

export function writeWorkspaceCatalog(root: string, catalog: Record<string, string>): void {
  const yamlPath = join(root, WORKSPACE_YAML);
  const pkgPath = join(root, "package.json");
  const usesYaml = existsSync(yamlPath);
  const sorted = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)));

  if (usesYaml) {
    const parsed = parse(readFileSync(yamlPath, "utf8")) as WorkspaceYaml | null;
    const doc: WorkspaceYaml = parsed && typeof parsed === "object" ? parsed : {};
    doc.catalog = sorted;
    const body = stringify(doc, { lineWidth: 0 }).trimEnd();
    writeFileSync(yamlPath, `${body}\n`);
    return;
  }

  let pkg: PkgJsonLike = {};
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PkgJsonLike;
    } catch {
      pkg = {};
    }
  }
  if (!pkg.workspaces) {
    pkg.workspaces = {};
  }
  pkg.workspaces.catalog = sorted;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
