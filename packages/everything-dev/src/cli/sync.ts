import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { glob } from "glob";
import { loadResolvedConfig } from "../config";
import type { SyncOptions, SyncResult } from "../contract";
import {
  isPlainObject as isPlainObjectFromMerge,
  mergeBosConfigWithTemplate,
  resolveExtendsRef,
} from "../merge";
import { syncResolvedSharedDeps } from "../shared-deps";
import { writeGeneratedInfra } from "./infra";
import {
  buildChildAgentsMd,
  extractSkillsBlock,
  personalizeConfig,
  resolveSourceDir,
  runBunInstall,
  runTypesGen,
} from "./init";
import { writeSnapshot } from "./snapshot";

const FRAMEWORK_OWNED_SYNC_FILES = new Set([
  ".env.example",
  ".gitignore",
  "biome.json",
  "bos.config.json",
  "bunfig.toml",
  "package.json",
  ".changeset/config.json",
  ".changeset/README.md",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy.yml",
  ".github/workflows/staging.yml",
  ".github/workflows/release.yml",
  "railway.toml",
  "ui/package.json",
  "ui/postcss.config.mjs",
  "ui/rsbuild.config.ts",
  "ui/tsconfig.json",
  "ui/src/app.ts",
  "ui/src/globals.d.ts",
  "ui/src/hydrate.tsx",
  "ui/src/lib/api.ts",
  "ui/src/lib/auth.ts",
  "ui/src/router.server.tsx",
  "ui/src/router.tsx",
  "ui/src/routes/__root.tsx",
  "api/package.json",
  "api/plugin.dev.ts",
  "api/rspack.config.js",
  "api/tsconfig.contract.json",
  "api/tsconfig.json",
  "api/src/lib/auth.ts",
  "api/src/lib/context.ts",
  "api/drizzle.config.ts",
  "api/src/db/index.ts",
  "api/src/db/layer.ts",
  "api/src/db/migrate.ts",
  "api/src/global.d.ts",
]);

type PackageJson = Record<string, unknown>;

function computeHash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 16);
}

export function isFrameworkOwnedSyncFile(filePath: string): boolean {
  if (FRAMEWORK_OWNED_SYNC_FILES.has(filePath)) return true;
  if (/^plugins\/[^/]+\/src\/lib\/(auth|context)\.ts$/.test(filePath)) return true;
  if (/^plugins\/[^/]+\/src\/db\/(index|layer|migrate)\.ts$/.test(filePath)) return true;
  if (/^plugins\/[^/]+\/rspack\.config\.js$/.test(filePath)) return true;
  if (/^plugins\/[^/]+\/drizzle\.config\.ts$/.test(filePath)) return true;
  if (/^plugins\/[^/]+\/src\/global\.d\.ts$/.test(filePath)) return true;
  return false;
}

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

  const merged: Record<string, string> = { ...(local ?? {}) };
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
    for (const entry of [...ordered]) {
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
    (template.scripts && typeof template.scripts === "object")
  ) {
    const mergedScripts = mergeStringMaps(
      local.scripts as Record<string, string> | undefined,
      template.scripts as Record<string, string> | undefined,
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

function buildSyncedFileContent(
  sourceDir: string,
  projectDir: string,
  filePath: string,
  explicitDestPath?: string,
): string | Uint8Array {
  const src = join(sourceDir, filePath);
  const destPath =
    explicitDestPath ??
    (filePath.startsWith(".github/templates/")
      ? filePath.replace(/^\.github\/templates\//, ".github/")
      : filePath);
  const dest = join(projectDir, destPath);

  if (filePath.endsWith("bos.config.json")) {
    const localContent = existsSync(dest) ? readFileSync(dest, "utf-8") : null;
    const templateContent = readFileSync(src, "utf-8");

    if (localContent) {
      const local = JSON.parse(localContent) as Record<string, unknown>;
      const template = JSON.parse(templateContent) as Record<string, unknown>;
      const merged = mergeBosConfigWithTemplate(local, template);
      return `${JSON.stringify(merged, null, 2)}\n`;
    }
  }

  if (filePath.endsWith("package.json")) {
    const localContent = existsSync(dest) ? readFileSync(dest, "utf-8") : null;
    const templateContent = readFileSync(src, "utf-8");

    if (localContent) {
      const local = JSON.parse(localContent) as Record<string, unknown>;
      const template = JSON.parse(templateContent) as Record<string, unknown>;
      const merged = mergePackageJson(destPath, local, template);
      return `${JSON.stringify(merged, null, 2)}\n`;
    }
  }

  return readFileSync(src);
}

function writeSyncedFile(
  sourceDir: string,
  projectDir: string,
  filePath: string,
  explicitDestPath?: string,
): void {
  const destPath =
    explicitDestPath ??
    (filePath.startsWith(".github/templates/")
      ? filePath.replace(/^\.github\/templates\//, ".github/")
      : filePath);
  const dest = join(projectDir, destPath);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buildSyncedFileContent(sourceDir, projectDir, filePath, destPath));
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
  const packageJsonPath = join(projectDir, "package.json");
  if (!existsSync(packageJsonPath)) return false;

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      workspaces?: { packages?: string[] } | string[];
    };
    const workspaces = pkg.workspaces;
    const packages = Array.isArray(workspaces)
      ? workspaces
      : Array.isArray(workspaces?.packages)
        ? workspaces.packages
        : [];
    return packages.includes("plugins/*");
  } catch {
    return false;
  }
}

export async function syncTemplate(projectDir: string, options: SyncOptions): Promise<SyncResult> {
  // Sync reads the raw bos.config.json (not the resolved config) because it needs
  // the user's explicit local settings: their extends ref, selected plugins, etc.
  // The resolved config is the merged result and would include inherited parent
  // values that the user didn't explicitly choose, which would break sync filtering.
  const localConfig = JSON.parse(
    readFileSync(join(projectDir, "bos.config.json"), "utf-8"),
  ) as Record<string, unknown>;

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
      error: "No extends field found in bos.config.json — cannot determine parent",
    };
  }

  const extendsMatch = extendsRef.match(/^bos:\/\/([^/]+)\/(.+)$/);
  if (!extendsMatch) {
    return {
      status: "error",
      updated: [],
      skipped: [],
      added: [],
      error: `Invalid extends reference: ${extendsRef}`,
    };
  }

  const extendsAccount = extendsMatch[1];
  const extendsGateway = extendsMatch[2];

  const { sourceDir, cleanup } = await resolveSourceDir({
    extendsAccount,
    extendsGateway,
  });

  try {
    const childPlugins = await getSelectedChildPlugins(projectDir, localConfig);
    const withUi = existsSync(join(projectDir, "ui", "package.json"));
    const withApi = existsSync(join(projectDir, "api", "package.json"));
    const withHost = existsSync(join(projectDir, "host", "package.json"));
    const withPlugins = childPlugins.length > 0 || hasPluginsWorkspace(projectDir);

    const destToSource = new Map<string, string>();
    for (const destPath of FRAMEWORK_OWNED_SYNC_FILES) {
      if (destPath.startsWith("ui/") && !withUi) continue;
      if (destPath.startsWith("api/") && !withApi) continue;
      if (destPath.startsWith("host/") && !withHost) continue;
      const sourcePath = toSourcePath(sourceDir, destPath);
      if (!sourcePath) continue;
      destToSource.set(destPath, sourcePath);
    }

    // Sync api/src/lib/{auth,context}.ts into each plugin's src/lib/
    for (const pluginKey of childPlugins) {
      if (!existsSync(join(projectDir, "plugins", pluginKey, "src"))) continue;
      for (const libFile of ["auth.ts", "context.ts"]) {
        const sourceFile = `api/src/lib/${libFile}`;
        if (!existsSync(join(sourceDir, sourceFile))) continue;
        destToSource.set(`plugins/${pluginKey}/src/lib/${libFile}`, sourceFile);
      }
    }

    // Sync api/src/global.d.ts into each plugin's src/
    for (const pluginKey of childPlugins) {
      if (!existsSync(join(projectDir, "plugins", pluginKey, "src"))) continue;
      const sourceFile = "api/src/global.d.ts";
      if (!existsSync(join(sourceDir, sourceFile))) continue;
      destToSource.set(`plugins/${pluginKey}/src/global.d.ts`, sourceFile);
    }

    // Sync api/src/db/{index,layer,migrate}.ts into each plugin's src/db/
    for (const pluginKey of childPlugins) {
      if (!existsSync(join(projectDir, "plugins", pluginKey, "src", "db"))) continue;
      for (const dbFile of ["index.ts", "layer.ts", "migrate.ts"]) {
        const sourceFile = `api/src/db/${dbFile}`;
        if (!existsSync(join(sourceDir, sourceFile))) continue;
        destToSource.set(`plugins/${pluginKey}/src/db/${dbFile}`, sourceFile);
      }
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

    const updated: string[] = [];
    const skipped: string[] = [];
    const added: string[] = [];

    for (const [destPath, filePath] of destToSource.entries()) {
      const localHash = computeLocalHash(projectDir, destPath);
      const sourceHash = computeHash(buildSyncedFileContent(sourceDir, projectDir, filePath));

      if (localHash === null) {
        added.push(destPath);
        continue;
      }

      if (localHash !== sourceHash) {
        updated.push(destPath);
      }
    }

    const account = (localConfig.account as string) || extendsAccount;
    const domain = (localConfig.domain as string) || extendsGateway;
    const overrides: Array<"ui" | "api" | "host" | "plugins"> = [];
    if (withUi) overrides.push("ui");
    if (withApi) overrides.push("api");
    if (withHost) overrides.push("host");
    if (withPlugins) overrides.push("plugins");

    if (options.dryRun) {
      const agentsMdSourcePath = toSourcePath(sourceDir, "AGENTS.md");
      if (agentsMdSourcePath) {
        const agentsMdSourceContent = readFileSync(join(sourceDir, agentsMdSourcePath), "utf-8");
        const skillsBlock = extractSkillsBlock(agentsMdSourceContent);
        if (skillsBlock) {
          const expectedContent = buildChildAgentsMd(skillsBlock, {
            overrides,
            plugins: childPlugins,
          });
          const expectedHash = computeHash(expectedContent);
          const agentsMdLocalHash = computeLocalHash(projectDir, "AGENTS.md");
          if (agentsMdLocalHash !== expectedHash) {
            updated.push("AGENTS.md");
          }
        }
      }

      return {
        status: "dry-run",
        updated,
        skipped,
        added,
      };
    }

    const filesToWrite = [...updated, ...added];

    if (filesToWrite.length > 0) {
      backupFiles(projectDir, filesToWrite);

      for (const destPath of filesToWrite) {
        const sourcePath = destToSource.get(destPath) ?? destPath;
        writeSyncedFile(sourceDir, projectDir, sourcePath, destPath);
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

    const syncedConfig = await loadResolvedConfig({ cwd: projectDir });
    if (syncedConfig?.runtime) {
      writeGeneratedInfra(projectDir, syncedConfig.runtime);
    }

    const newSnapshotFiles: Record<string, string> = {};
    for (const destPath of destToSource.keys()) {
      const hash = computeLocalHash(projectDir, destPath);
      if (hash) {
        newSnapshotFiles[destPath] = hash;
      }
    }

    const agentsMdSourcePath = toSourcePath(sourceDir, "AGENTS.md");
    if (agentsMdSourcePath) {
      const agentsMdSourceContent = readFileSync(join(sourceDir, agentsMdSourcePath), "utf-8");
      const skillsBlock = extractSkillsBlock(agentsMdSourceContent);
      if (skillsBlock) {
        const expectedContent = buildChildAgentsMd(skillsBlock, {
          overrides,
          plugins: childPlugins,
        });
        const expectedHash = computeHash(expectedContent);

        const agentsMdLocalHash = computeLocalHash(projectDir, "AGENTS.md");
        if (agentsMdLocalHash !== expectedHash) {
          writeFileSync(join(projectDir, "AGENTS.md"), expectedContent);
          updated.push("AGENTS.md");
        }

        newSnapshotFiles["AGENTS.md"] = expectedHash;
      }
    }

    await writeSnapshot(projectDir, {
      parentRef: `bos://${extendsAccount}/${extendsGateway}`,
      files: newSnapshotFiles,
    });

    if (!options.noInstall) {
      await runBunInstall(projectDir);
      await runTypesGen(projectDir);
    }

    return {
      status: "synced",
      updated,
      skipped,
      added,
    };
  } finally {
    await cleanup();
  }
}
