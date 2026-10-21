import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { glob } from "glob";
import { parse as parseYaml } from "yaml";
import { loadAppDescriptorConfig } from "../../config";
import type { SyncResult } from "../../contract";
import { materializeViaLayer } from "../../infra/materializer";
import { computeSnapshotHash as computeHash } from "../../utils/snapshot-hash";
import { resolvePlatformManifest } from "../platform/manifest";
import { isPlainObject as isPlainObjectFromMerge, resolveExtendsRef } from "../resolution/merge";
import { openResolution } from "../resolution/session";
import { readWorkspaceCatalog } from "../workspace/catalog";
import { syncResolvedSharedDeps } from "../workspace/shared-deps";
import { findWorkspaceRoot } from "../workspace/workspace";
import {
  buildChildAgentsMd,
  buildChildRootScripts,
  extractSkillsBlock,
  personalizeConfig,
  releaseRefCandidates,
  resolveSourceDir,
  runPnpmInstall,
  runTypesGen,
} from "./init";
import {
  AGENT_SYNC_GLOBS,
  CHILD_OWNED_BLOCK_START,
  extractChildOwnedBlock,
  FRAMEWORK_OWNED_SYNC_FILES,
  spliceChildOwnedBlock,
} from "./ownership";
import { readSnapshot, writeSnapshot } from "./snapshot";

export * from "./ownership";

/**
 * Service-level sync options — deliberately narrower than the CLI contract's
 * SyncOptionsSchema: `json` is a terminal-rendering concern and never crosses
 * this seam.
 */
export interface TemplateSyncOptions {
  dryRun?: boolean;
  /** Overwrite conflicted files anyway (with a backup). Without it, anything
   * the three-way comparison cannot resolve aborts the whole run — nothing is
   * written, not even the clean updates. */
  force?: boolean;
  noInstall?: boolean;
}

type PackageJson = Record<string, unknown>;

function computeLocalHash(projectDir: string, filePath: string): string | null {
  const fullPath = join(projectDir, filePath);
  if (!existsSync(fullPath)) return null;
  try {
    const content = readFileSync(fullPath);
    return computeHash(content);
  } catch {
    return null;
  }
}

function backupFiles(projectDir: string, filePaths: string[]): string | null {
  const filesToBackup = filePaths.filter((f) => existsSync(join(projectDir, f)));
  if (filesToBackup.length === 0) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(projectDir, ".bos", "sync-backup", timestamp);

  for (const filePath of filesToBackup) {
    const src = join(projectDir, filePath);
    const dest = join(backupDir, filePath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }

  return backupDir;
}

function mergeStringMaps(
  local: Record<string, string> | undefined,
  template: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!local && !template) return undefined;

  const merged: Record<string, string> = { ...local };
  for (const [name, value] of Object.entries(template ?? {})) {
    merged[name] = value;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeWorkspacePackages(local: unknown, template: unknown): string[] | undefined {
  const localPackages = Array.isArray(local) ? local : [];
  const templatePackages = Array.isArray(template) ? template : [];
  if (localPackages.length === 0 && templatePackages.length === 0) return undefined;

  const ordered = new Set<string>();
  for (const entry of templatePackages) {
    if (typeof entry === "string" && entry.length > 0) ordered.add(entry);
  }
  for (const entry of localPackages) {
    if (typeof entry === "string" && entry.length > 0) ordered.add(entry);
  }

  const hasPluginEntry = [...ordered].some((e) => e.startsWith("plugins/") && e !== "plugins/*");
  if (hasPluginEntry) {
    for (const entry of ordered) {
      if (entry.startsWith("plugins/") && entry !== "plugins/*") {
        ordered.delete(entry);
      }
    }
    ordered.add("plugins/*");
  }

  return ordered.size > 0 ? [...ordered] : undefined;
}

export function mergePackageJson(
  filePath: string,
  local: PackageJson,
  template: PackageJson,
  childScripts?: Record<string, string>,
): PackageJson {
  const merged: PackageJson = { ...local, ...template };

  if (filePath === "package.json") {
    for (const key of ["name", "private", "version"] as const) {
      if (key in local) {
        merged[key] = local[key];
      }
    }
  } else if ("version" in local) {
    merged.version = local.version;
  }

  for (const depField of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "overrides",
  ] as const) {
    const localDeps = local[depField] as Record<string, string> | undefined;
    const templateDeps = template[depField] as Record<string, string> | undefined;

    const mergedDeps = mergeStringMaps(localDeps, templateDeps);
    if (mergedDeps) {
      merged[depField] = mergedDeps;
    } else {
      delete merged[depField];
    }
  }

  if (
    (local.scripts && typeof local.scripts === "object") ||
    (template.scripts && typeof template.scripts === "object") ||
    childScripts
  ) {
    const mergedScripts = mergeStringMaps(
      local.scripts as Record<string, string> | undefined,
      filePath === "package.json" && childScripts
        ? childScripts
        : (template.scripts as Record<string, string> | undefined),
    );
    if (mergedScripts) {
      merged.scripts = mergedScripts;
    } else {
      delete merged.scripts;
    }
  }

  if (
    (local.workspaces && typeof local.workspaces === "object") ||
    (template.workspaces && typeof template.workspaces === "object")
  ) {
    const localWorkspaces = (local.workspaces ?? {}) as {
      packages?: string[];
      catalog?: Record<string, string>;
    };
    const templateWorkspaces = (template.workspaces ?? {}) as {
      packages?: string[];
      catalog?: Record<string, string>;
    };

    const mergedWorkspaces: { packages?: string[]; catalog?: Record<string, string> } = {
      ...localWorkspaces,
      ...templateWorkspaces,
    };

    const mergedPackages = mergeWorkspacePackages(
      localWorkspaces.packages,
      templateWorkspaces.packages,
    );
    if (mergedPackages) {
      mergedWorkspaces.packages = mergedPackages;
    } else {
      delete mergedWorkspaces.packages;
    }

    const mergedCatalog = mergeStringMaps(localWorkspaces.catalog, templateWorkspaces.catalog);
    if (mergedCatalog) {
      mergedWorkspaces.catalog = mergedCatalog;
    } else {
      delete mergedWorkspaces.catalog;
    }

    if (Object.keys(mergedWorkspaces).length > 0) {
      merged.workspaces = mergedWorkspaces;
    } else {
      delete merged.workspaces;
    }
  }

  return merged;
}

/**
 * Child-shape normalization for every manifest sync writes (#521): the parent
 * repo's own root manifest uses `workspace:^` specifiers, which only resolve
 * where the framework packages are vendored workspace members. A child has no
 * such members — any `workspace:` specifier that lands in a child manifest
 * breaks the next `pnpm install --frozen-lockfile`. Runs on the merged (or
 * raw-template) object before the bytes are written, so both the `updated`
 * and `conflicted` outcomes land in child shape. A `workspace:` specifier
 * without a catalog entry is left alone — there is no version to pin.
 */
export function normalizeChildManifest(pkg: PackageJson, catalog: Record<string, string>): boolean {
  let modified = false;

  for (const fieldName of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const field = pkg[fieldName] as Record<string, string> | undefined;
    if (!field) continue;
    for (const [name, specifier] of Object.entries(field)) {
      if (specifier.startsWith("workspace:") && catalog[name]) {
        field[name] = "catalog:";
        modified = true;
      }
    }
  }

  const dependencies = pkg.dependencies as Record<string, string> | undefined;
  const devDependencies = pkg.devDependencies as Record<string, string> | undefined;
  if (dependencies && devDependencies) {
    for (const name of Object.keys(devDependencies)) {
      if (name in dependencies) {
        delete devDependencies[name];
        modified = true;
      }
    }
  }

  return modified;
}

function toSourcePath(sourceDir: string, destPath: string): string | null {
  if (destPath.startsWith(".github/")) {
    const templatePath = destPath.replace(/^\.github\//, ".github/templates/");
    if (existsSync(join(sourceDir, templatePath))) {
      return templatePath;
    }
  }

  const directPath = join(sourceDir, destPath);
  if (existsSync(directPath)) {
    return destPath;
  }

  return null;
}

/**
 * Release-scoped workflow refs (ADR 0034 pt 4): when a platform manifest
 * resolves, the child's *framework-owned* reusable-workflow wrappers pin the
 * framework's version tag instead of `@main`. Only refs into the framework
 * repo's own `.github/workflows/` repoint — third-party actions tracking
 * `@main` are nobody's release contract. Applied at content-build time so the
 * three-way hash comparison and the written bytes stay consistent.
 */
export function applyReleaseRefs(content: string, releaseTag: string): string {
  return content.replace(
    /(uses:\s*\S*everything-dev\/\.github\/workflows\/[^\s@]+@)main\b/g,
    `$1${releaseTag}`,
  );
}

/**
 * The workflow pin derives from what the release tarball actually resolved
 * from: the canonical `v<version>` tag when it resolved, otherwise the
 * resolved commit sha. No resolved ref/sha → the release tag itself.
 */
export function resolveWorkflowReleasePin(
  releaseTag: string,
  resolvedRef?: string,
  resolvedSha?: string,
): string {
  if (resolvedRef?.startsWith("v")) return resolvedRef;
  return resolvedSha ?? releaseTag;
}

function buildSyncedFileContent(
  sourceDir: string,
  projectDir: string,
  filePath: string,
  explicitDestPath?: string,
  childScripts?: Record<string, string>,
  release?: string,
): string | Uint8Array {
  const src = join(sourceDir, filePath);
  const destPath =
    explicitDestPath ??
    (filePath.startsWith(".github/templates/")
      ? filePath.replace(/^\.github\/templates\//, ".github/")
      : filePath);
  const dest = join(projectDir, destPath);

  if (filePath.endsWith("package.json")) {
    const localContent = existsSync(dest) ? readFileSync(dest, "utf-8") : null;
    const templateContent = readFileSync(src, "utf-8");
    const catalog = readWorkspaceCatalog(findWorkspaceRoot(projectDir)?.dir ?? projectDir);

    if (localContent) {
      const local = JSON.parse(localContent) as Record<string, unknown>;
      const template = JSON.parse(templateContent) as Record<string, unknown>;
      const merged = mergePackageJson(destPath, local, template, childScripts);
      normalizeChildManifest(merged, catalog);
      return `${JSON.stringify(merged, null, 2)}\n`;
    }

    const template = JSON.parse(templateContent) as Record<string, unknown>;
    normalizeChildManifest(template, catalog);
    return `${JSON.stringify(template, null, 2)}\n`;
  }

  const raw = readFileSync(src);

  // The child-owned block protocol (#538): framework-owned files carrying the
  // markers get their marked span re-inserted from the child's local copy
  // before any hash is computed — the splice happens at content-build time,
  // so the side-by-side hash comparison and the written bytes agree. Files
  // synced before the markers existed lift their `variables` literal onto the
  // protocol on the first pass.
  const template = raw.toString("utf-8");
  if (template.includes(CHILD_OWNED_BLOCK_START) && filePath.endsWith("plugin.dev.ts")) {
    const destPathLocal = join(projectDir, destPath);
    if (existsSync(destPathLocal)) {
      const childBlock = extractChildOwnedBlock(readFileSync(destPathLocal, "utf-8"));
      if (childBlock) {
        return spliceChildOwnedBlock(template, childBlock);
      }
    }
    return template;
  }

  if (release && filePath.startsWith(".github/templates/workflows/")) {
    return applyReleaseRefs(raw.toString("utf-8"), release);
  }
  return raw;
}

function writeSyncedFile(
  sourceDir: string,
  projectDir: string,
  filePath: string,
  explicitDestPath?: string,
  childScripts?: Record<string, string>,
  release?: string,
): void {
  const destPath =
    explicitDestPath ??
    (filePath.startsWith(".github/templates/")
      ? filePath.replace(/^\.github\/templates\//, ".github/")
      : filePath);
  const dest = join(projectDir, destPath);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(
    dest,
    buildSyncedFileContent(sourceDir, projectDir, filePath, destPath, childScripts, release),
  );
}

/**
 * The child AGENTS.md the parent template's skills block personalizes to —
 * shared by the dry-run preview and the write path so both agree on when
 * AGENTS.md counts as drifted.
 */
function expectedChildAgentsMd(
  sourceDir: string,
  overrides: Array<"ui" | "api" | "host" | "plugins">,
  childPlugins: string[],
): { content: string; hash: string } | null {
  const agentsMdSourcePath = toSourcePath(sourceDir, "AGENTS.md");
  if (!agentsMdSourcePath) return null;
  const skillsBlock = extractSkillsBlock(
    readFileSync(join(sourceDir, agentsMdSourcePath), "utf-8"),
  );
  if (!skillsBlock) return null;
  const content = buildChildAgentsMd(skillsBlock, { overrides, plugins: childPlugins });
  return { content, hash: computeHash(content) };
}

async function getSelectedChildPlugins(
  projectDir: string,
  localConfig: Record<string, unknown>,
): Promise<string[]> {
  if (!localConfig.plugins || typeof localConfig.plugins !== "object") {
    return [];
  }

  const pluginDirs = new Set(
    (
      await glob("plugins/*/package.json", {
        cwd: projectDir,
        nodir: true,
        dot: false,
        absolute: false,
      })
    )
      .map((file) => file.match(/^plugins\/([^/]+)\/package\.json$/)?.[1])
      .filter((key): key is string => Boolean(key)),
  );

  const selected: string[] = [];
  for (const [pluginKey, rawEntry] of Object.entries(
    localConfig.plugins as Record<string, unknown>,
  )) {
    if (typeof rawEntry === "string") {
      if (!rawEntry.startsWith("local:")) {
        selected.push(pluginKey);
        continue;
      }

      const localPath = join(projectDir, rawEntry.slice("local:".length).trim());
      if (existsSync(localPath) || pluginDirs.has(pluginKey)) {
        selected.push(pluginKey);
      }
      continue;
    }

    if (!rawEntry || typeof rawEntry !== "object") {
      selected.push(pluginKey);
      continue;
    }

    const entry = rawEntry as Record<string, unknown>;
    const development = typeof entry.development === "string" ? entry.development : undefined;
    if (!development?.startsWith("local:")) {
      selected.push(pluginKey);
      continue;
    }

    const localPath = join(projectDir, development.slice("local:".length).trim());
    if (existsSync(localPath) || pluginDirs.has(pluginKey)) {
      selected.push(pluginKey);
    }
  }

  return selected;
}

function hasPluginsWorkspace(projectDir: string): boolean {
  const root = findWorkspaceRoot(projectDir);
  if (!root) return false;
  const rel = relative(root.dir, projectDir);
  const baseDir = rel.startsWith("..") || rel === "" ? root.dir : projectDir;
  for (const manifest of ["pnpm-workspace.yaml", "package.json"]) {
    const manifestPath = join(baseDir, manifest);
    if (!existsSync(manifestPath)) continue;
    try {
      const content = readFileSync(manifestPath, "utf-8");
      const packages =
        manifest === "pnpm-workspace.yaml"
          ? (parseYaml(content) as { packages?: unknown } | null)?.packages
          : (
              JSON.parse(content) as {
                workspaces?: { packages?: string[] } | string[];
              }
            ).workspaces;
      const globs: string[] = Array.isArray(packages)
        ? packages
        : Array.isArray((packages as { packages?: string[] })?.packages)
          ? ((packages as { packages?: string[] }).packages ?? [])
          : [];
      if (globs.includes("plugins/*")) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function syncTemplate(
  projectDir: string,
  options: TemplateSyncOptions = {},
): Promise<SyncResult> {
  // Sync reads the user's authored config — the materialized bos.app.ts
  // descriptor, not the resolved config: it needs the user's explicit local
  // settings (their extends ref, selected plugins, etc.). The resolved config
  // is the merged result and would include inherited parent values that the
  // user didn't explicitly choose, which would break sync filtering.
  const configPath = join(projectDir, "bos.app.ts");
  if (!existsSync(configPath)) {
    return {
      status: "error",
      updated: [],
      skipped: [],
      added: [],
      conflicted: [],
      error: "No bos.app.ts found — template sync only applies to TS-form children",
    };
  }
  const localConfig = (await loadAppDescriptorConfig(configPath)) as Record<string, unknown>;

  let extendsRef: string | undefined;
  if (typeof localConfig.extends === "string") {
    extendsRef = localConfig.extends;
  } else if (isPlainObjectFromMerge(localConfig.extends)) {
    extendsRef = resolveExtendsRef(localConfig.extends as Record<string, string>, "production");
  }
  if (!extendsRef?.startsWith("bos://")) {
    return {
      status: "error",
      updated: [],
      skipped: [],
      added: [],
      conflicted: [],
      error: "No extends field found in bos.app.ts — cannot determine parent",
    };
  }

  const extendsMatch = extendsRef.match(/^bos:\/\/([^/]+)\/(.+)$/);
  if (!extendsMatch) {
    return {
      status: "error",
      updated: [],
      skipped: [],
      added: [],
      conflicted: [],
      error: `Invalid extends reference: ${extendsRef}`,
    };
  }

  const extendsAccount = extendsMatch[1];
  const extendsGateway = extendsMatch[2];

  // ADR 0034 pt 4: release-scoped sync — the platform manifest is the chain's
  // release authority. An unresolved manifest means the child was never
  // pinned to a release; pulling main/moving HEAD on top of released bytes
  // would drift the snapshot, so this fails loud instead.
  const platform = await resolvePlatformManifest({ configDir: projectDir, localConfig });
  if (!platform) {
    return {
      status: "error",
      updated: [],
      skipped: [],
      added: [],
      conflicted: [],
      error:
        "No platform release manifest resolved (" +
        `platform pin missing in ${join(projectDir, "bos.app.ts")} and its extends chain) — ` +
        "run `bos upgrade` to pin a release, or `bos status` to inspect the chain",
    };
  }
  const releaseTag = releaseRefCandidates(platform.manifest.frameworkVersion);

  const { sourceDir, cleanup, resolvedRef, resolvedSha } = await resolveSourceDir({
    extendsAccount,
    extendsGateway,
    ref: releaseTag,
  });
  const workflowPin = resolveWorkflowReleasePin(releaseTag, resolvedRef, resolvedSha);

  try {
    const childPlugins = await getSelectedChildPlugins(projectDir, localConfig);
    const withUi = existsSync(join(projectDir, "ui", "package.json"));
    const withApi = existsSync(join(projectDir, "api", "package.json"));
    const withHost = existsSync(join(projectDir, "host", "package.json"));
    const withPlugins = childPlugins.length > 0 || hasPluginsWorkspace(projectDir);

    const childScripts = buildChildRootScripts({
      ui: withUi,
      api: withApi,
      host: withHost,
      plugins: withPlugins,
    });

    const destToSource = new Map<string, string>();
    for (const destPath of FRAMEWORK_OWNED_SYNC_FILES) {
      if (destPath.startsWith("ui/") && !withUi) continue;
      if (destPath.startsWith("api/") && !withApi) continue;
      if (destPath.startsWith("host/") && !withHost) continue;
      const sourcePath = toSourcePath(sourceDir, destPath);
      if (!sourcePath) continue;
      destToSource.set(destPath, sourcePath);
    }

    for (const destPath of await glob(AGENT_SYNC_GLOBS, {
      cwd: sourceDir,
      nodir: true,
      dot: true,
      absolute: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.bos/**"],
    })) {
      destToSource.set(destPath, destPath);
    }

    // Sync api/src/global.d.ts into each plugin's src/
    for (const pluginKey of childPlugins) {
      if (!existsSync(join(projectDir, "plugins", pluginKey, "src"))) continue;
      const sourceFile = "api/src/global.d.ts";
      if (!existsSync(join(sourceDir, sourceFile))) continue;
      destToSource.set(`plugins/${pluginKey}/src/global.d.ts`, sourceFile);
    }

    // Sync tests/types.d.ts into each plugin's tests/
    for (const pluginKey of childPlugins) {
      if (!existsSync(join(projectDir, "plugins", pluginKey))) continue;
      const sourceFile = "plugins/_template/tests/types.d.ts";
      if (!existsSync(join(sourceDir, sourceFile))) continue;
      destToSource.set(`plugins/${pluginKey}/tests/types.d.ts`, sourceFile);
    }

    // Sync rspack.config.js from the template into each plugin
    for (const pluginKey of childPlugins) {
      if (!existsSync(join(projectDir, "plugins", pluginKey))) continue;
      const sourceFile = "plugins/_template/rspack.config.js";
      if (!existsSync(join(sourceDir, sourceFile))) continue;
      destToSource.set(`plugins/${pluginKey}/rspack.config.js`, sourceFile);
    }

    // Sync drizzle.config.ts from api into each DB-enabled plugin
    for (const pluginKey of childPlugins) {
      if (!existsSync(join(projectDir, "plugins", pluginKey, "src", "db"))) continue;
      const sourceFile = "api/drizzle.config.ts";
      if (!existsSync(join(sourceDir, sourceFile))) continue;
      destToSource.set(`plugins/${pluginKey}/drizzle.config.ts`, sourceFile);
    }

    // Sync tsconfig from the template into each plugin
    for (const pluginKey of childPlugins) {
      if (!existsSync(join(projectDir, "plugins", pluginKey))) continue;
      const sourceFile = "plugins/_template/tsconfig.json";
      if (!existsSync(join(sourceDir, sourceFile))) continue;
      destToSource.set(`plugins/${pluginKey}/tsconfig.json`, sourceFile);
    }

    const updated: string[] = [];
    const skipped: string[] = [];
    const added: string[] = [];
    const conflicted: string[] = [];

    const snapshot = await readSnapshot(projectDir);
    const snapshotFiles = snapshot?.files ?? {};

    for (const [destPath, filePath] of destToSource.entries()) {
      if (!existsSync(join(sourceDir, filePath))) {
        // The template no longer ships this file — it was retired from the
        // scaffold. Leave the local copy untouched rather than crashing the
        // sync (the old-CLI + new-template transitional combo).
        skipped.push(destPath);
        continue;
      }
      const localHash = computeLocalHash(projectDir, destPath);
      const sourceHash = computeHash(
        buildSyncedFileContent(
          sourceDir,
          projectDir,
          filePath,
          undefined,
          childScripts,
          workflowPin,
        ),
      );

      if (localHash === null) {
        added.push(destPath);
        continue;
      }

      if (localHash === sourceHash) {
        skipped.push(destPath);
        continue;
      }

      const snapshotHash = snapshotFiles[destPath];
      if (!snapshotHash) {
        updated.push(destPath);
        continue;
      }

      if (localHash === snapshotHash) {
        updated.push(destPath);
        continue;
      }

      if (sourceHash === snapshotHash) {
        skipped.push(destPath);
        continue;
      }

      conflicted.push(destPath);
    }

    const account = (localConfig.account as string) || extendsAccount;
    const domain = (localConfig.domain as string) || extendsGateway;
    const overrides: Array<"ui" | "api" | "host" | "plugins"> = [];
    if (withUi) overrides.push("ui");
    if (withApi) overrides.push("api");
    if (withHost) overrides.push("host");
    if (withPlugins) overrides.push("plugins");

    // Conflicts never silently clobber: without --force a conflicted file
    // aborts the whole run before any write — the clean updates and additions
    // wait for a resolution, so a snapshot never half-advances.
    if (conflicted.length > 0 && !options.force && !options.dryRun) {
      return {
        status: "conflicted",
        updated: [],
        skipped,
        added: [],
        conflicted,
        error:
          "Local edits conflict with the upstream template (run `bos upgrade --force` to " +
          `overwrite — backups land in .bos/sync-backup/): ${conflicted.join(", ")}`,
      };
    }

    if (options.dryRun) {
      const agentsMd = expectedChildAgentsMd(sourceDir, overrides, childPlugins);
      if (agentsMd && computeLocalHash(projectDir, "AGENTS.md") !== agentsMd.hash) {
        updated.push("AGENTS.md");
      }

      return {
        status: "dry-run",
        updated,
        skipped,
        added,
        conflicted,
      };
    }

    const filesToWrite = [...updated, ...added, ...conflicted];

    let backupDir: string | undefined;
    if (filesToWrite.length > 0) {
      backupDir = backupFiles(projectDir, filesToWrite) ?? undefined;

      for (const destPath of filesToWrite) {
        const sourcePath = destToSource.get(destPath) ?? destPath;
        writeSyncedFile(sourceDir, projectDir, sourcePath, destPath, childScripts, workflowPin);
      }
    }

    await personalizeConfig(projectDir, {
      extendsAccount,
      extendsGateway,
      account,
      domain,
      overrides,
      plugins: childPlugins,
      workspaceOpts: { sourceDir },
      mode: "sync",
      existingConfig: localConfig,
    });

    await syncResolvedSharedDeps({
      configDir: projectDir,
      hostMode: "local",
    });

    const syncedConfig = await openResolution({ cwd: projectDir });
    if (syncedConfig?.runtime) {
      await materializeViaLayer(projectDir, syncedConfig.runtime!);
    }

    const newSnapshotFiles: Record<string, string> = {};
    for (const destPath of destToSource.keys()) {
      const hash = computeLocalHash(projectDir, destPath);
      if (hash) {
        newSnapshotFiles[destPath] = hash;
      }
    }

    const agentsMd = expectedChildAgentsMd(sourceDir, overrides, childPlugins);
    if (agentsMd) {
      if (computeLocalHash(projectDir, "AGENTS.md") !== agentsMd.hash) {
        writeFileSync(join(projectDir, "AGENTS.md"), agentsMd.content);
        updated.push("AGENTS.md");
      }

      newSnapshotFiles["AGENTS.md"] = agentsMd.hash;
    }

    await writeSnapshot(projectDir, {
      files: newSnapshotFiles,
    });

    if (!options.noInstall) {
      await runPnpmInstall(findWorkspaceRoot(projectDir)?.dir ?? projectDir);
      await runTypesGen(projectDir);
    }

    return {
      status: "synced",
      updated,
      skipped,
      added,
      conflicted,
      backupDir,
    };
  } finally {
    await cleanup();
  }
}
