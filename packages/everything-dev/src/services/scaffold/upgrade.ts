import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { PhaseTiming, UpgradeOptions, UpgradeResult } from "../../contract";
import { readJsonFile } from "../../utils/json-file";
import { timePhase } from "../../utils/timing";
import { readWorkspaceCatalog } from "../workspace/catalog";
import { runPnpmInstallForUpgrade } from "./init";
import { syncTemplate } from "./sync";
import { describeMigrationFailure, runMigrationPhase } from "./upgrade-migration";
import {
  diffCatalogEntries,
  ensureAuthCoreCatalogRef,
  FRAMEWORK_PACKAGES,
  findWorkspacePackageJsons,
  packageFileNeedsCatalogRefs,
  packageObjectNeedsAuthCoreCatalogRef,
  packageObjectNeedsCatalogRefs,
  readCurrentPackageSpecifier,
  readRootPackageJson,
  syncRootCatalogWithParent,
  updatePackageFileAuthCoreRef,
  updatePackageFileCatalogRefs,
  workspaceDirOf,
} from "./upgrade-packages";
import {
  buildChangelogUrl,
  loadParentPluginOptions,
  readExtendedRootSource,
} from "./upgrade-source";

export * from "./upgrade-migration";
export * from "./upgrade-packages";
export * from "./upgrade-source";

const UPSTREAM_ISSUE_URL = "https://github.com/NEARBuilders/everything-dev/issues";

export async function upgradeTemplate(
  projectDir: string,
  options: UpgradeOptions,
): Promise<UpgradeResult> {
  const timings: PhaseTiming[] = [];
  // `--check` is CI's drift alarm (ADR 0034 pt 6): dry-run semantics plus a
  // nonzero exit when updates are available (renderer-side).
  if (options.check) options.dryRun = true;
  const pkgPath = join(workspaceDirOf(projectDir), "package.json");
  if (!existsSync(pkgPath)) {
    return {
      status: "error",
      packages: [],
      timings,
      error: "No package.json found in current directory",
    };
  }

  const parentSource = await readExtendedRootSource(projectDir);
  const sourceRootCatalog = parentSource.catalog;
  const inheritedCatalogPackageNames = Object.keys(sourceRootCatalog);
  const currentCatalogEntries = readWorkspaceCatalog(workspaceDirOf(projectDir));
  const workspacePkgPaths = await findWorkspacePackageJsons(projectDir);
  const hasCatalogRefRewrites =
    inheritedCatalogPackageNames.length > 0 &&
    (packageObjectNeedsCatalogRefs(readRootPackageJson(projectDir), inheritedCatalogPackageNames) ||
      workspacePkgPaths.some((pkgPath) =>
        packageFileNeedsCatalogRefs(pkgPath, inheritedCatalogPackageNames),
      ));
  const hasAuthCoreRefRewrites =
    packageObjectNeedsAuthCoreCatalogRef(readRootPackageJson(projectDir)) ||
    workspacePkgPaths.some((pkgPath) =>
      packageObjectNeedsAuthCoreCatalogRef(readJsonFile<Record<string, unknown>>(pkgPath)),
    );

  const { packages, catalogVersionUpdates } = await timePhase(
    timings,
    "check package versions",
    async () => {
      const nextPackages: UpgradeResult["packages"] = [];

      for (const name of FRAMEWORK_PACKAGES) {
        const current = readCurrentPackageSpecifier(projectDir, name);
        const target = sourceRootCatalog[name] ?? current ?? "unknown";

        nextPackages.push({ name, from: current, to: target });
      }

      const nextCatalogVersionUpdates = diffCatalogEntries(
        sourceRootCatalog,
        currentCatalogEntries,
      );

      return { packages: nextPackages, catalogVersionUpdates: nextCatalogVersionUpdates };
    },
  );

  const hasFrameworkUpdates = packages.some((p) => p.from !== p.to && p.from !== undefined);
  const hasCatalogUpdates = catalogVersionUpdates.some((u) => u.from !== undefined);
  const hasUpdates =
    hasFrameworkUpdates || hasCatalogUpdates || hasCatalogRefRewrites || hasAuthCoreRefRewrites;

  if (options.dryRun) {
    let changelogUrl: string | undefined;
    const pluginOptions = options.noSync
      ? null
      : await timePhase(timings, "list parent plugins", () => loadParentPluginOptions(projectDir));
    if (hasUpdates) {
      const mainPkg = packages.find((p) => p.name === "everything-dev");
      if (mainPkg?.from && mainPkg.from !== mainPkg.to) {
        changelogUrl = buildChangelogUrl(mainPkg.from, mainPkg.to, parentSource.repository);
      }
    }

    return {
      status: "dry-run",
      packages: [
        ...packages,
        ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
      ],
      availablePlugins: pluginOptions?.newPluginKeys,
      platform: {
        resolved: parentSource.platform.manifest.frameworkVersion,
        source: `bos://${parentSource.platform.source.account}/${parentSource.platform.source.gateway}`,
        fromCache: parentSource.platform.fromCache,
      },
      updatesAvailable: hasUpdates,
      timings,
      changelogUrl,
    };
  }

  // The version delta that drives the whole migration phase. In the re-exec'd
  // child, packages compare new-installed vs new-catalog (no delta), so the
  // pre-upgrade version must ride the `--from` flag across the boundary;
  // `--migrations-only` without `--from` is a deliberate true no-op.
  const targetMainVersion = packages.find((p) => p.name === "everything-dev")?.to;
  const versionDelta =
    options.migrationsOnly && !options.from
      ? false
      : options.from !== undefined && targetMainVersion !== undefined
        ? options.from !== targetMainVersion
        : hasFrameworkUpdates;

  if (options.migrationsOnly) {
    return await runMigrationPhase(projectDir, options, parentSource, { versionDelta });
  }

  // Pre-flight (ADR 0032): refuse applies of new packages against stale
  // framework-owned files. The template reconciliation must be ready to run
  // when the new packages land; existing conflicts abort before Phase 1 so a
  // resolution (`--force`, or accepting the template) can happen cleanly.
  if (versionDelta && !options.noSync && !options.force) {
    const preflight = await timePhase(timings, "preflight template sync", () =>
      syncTemplate(projectDir, { dryRun: true }),
    );
    if (preflight.status === "conflicted" || (preflight.conflicted?.length ?? 0) > 0) {
      return {
        status: "error",
        packages: packages,
        timings,
        error:
          `Template files conflict with the upstream release — nothing was applied. ` +
          `Review the conflicts or run \`bos upgrade --force\` to overwrite (current copies are backed up). ` +
          `To make a local change permanent, file an issue: ${UPSTREAM_ISSUE_URL}. ` +
          `Conflicted: ${(preflight.conflicted ?? []).join(", ")}`,
      };
    }
  }

  // Phase 1: apply package updates, install, then re-exec migrations from the new package
  await timePhase(timings, "apply package updates", async () => {
    if (inheritedCatalogPackageNames.length > 0) {
      syncRootCatalogWithParent(projectDir, sourceRootCatalog);
    }

    if (inheritedCatalogPackageNames.length > 0) {
      for (const pkgPath of workspacePkgPaths) {
        updatePackageFileCatalogRefs(pkgPath, inheritedCatalogPackageNames);
      }
    }

    // @better-auth/core rides the catalog row its plugins need; it is not in
    // every template package.json, so it is ensured here rather than sync'd.
    const rootPkgPath = join(workspaceDirOf(projectDir), "package.json");
    const rootPkg = readJsonFile<Record<string, unknown>>(rootPkgPath);
    if (ensureAuthCoreCatalogRef(rootPkg)) {
      writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
    }
    for (const pkgPath of workspacePkgPaths) {
      updatePackageFileAuthCoreRef(pkgPath);
    }
  });

  const needsInstall = (hasUpdates || hasCatalogUpdates) && !options.noInstall;

  if (needsInstall) {
    await timePhase(timings, "install dependencies", () =>
      runPnpmInstallForUpgrade(workspaceDirOf(projectDir)),
    );
  }

  // If we installed new framework packages, re-exec from the new package so migrations
  // run with the latest code instead of the old cached modules.
  if (needsInstall && hasFrameworkUpdates) {
    const bosPath = join(workspaceDirOf(projectDir), "node_modules", ".bin", "bos");
    const prevMainPkg = packages.find((p) => p.name === "everything-dev");
    const childArgs = [
      "upgrade",
      "--migrations-only",
      "--no-install",
      "--from",
      prevMainPkg?.from ?? "unknown",
      ...(options.noSync ? ["--no-sync"] : []),
      ...(options.force ? ["--force"] : []),
      "--json",
    ];

    const childResult = spawnSync(bosPath, childArgs, {
      cwd: projectDir,
      stdio: ["inherit", "pipe", "pipe"],
      encoding: "utf-8",
      env: { ...process.env, BOS_NO_BANNER: "1" },
    });

    if (childResult.status !== 0) {
      return {
        status: "error",
        packages: [
          ...packages,
          ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
        ],
        timings,
        error: `Migration phase failed: ${describeMigrationFailure(childResult.stdout, childResult.stderr)}`,
      };
    }

    try {
      const childUpgrade: UpgradeResult = JSON.parse(childResult.stdout);
      const mainPkg = packages.find((p) => p.name === "everything-dev");
      const changelogUrl =
        mainPkg?.from && mainPkg.from !== mainPkg.to
          ? buildChangelogUrl(mainPkg.from, mainPkg.to, parentSource.repository)
          : undefined;
      return {
        ...childUpgrade,
        packages: [
          ...packages,
          ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
        ],
        timings: [...timings, ...(childUpgrade.timings ?? [])],
        changelogUrl,
      };
    } catch {
      return {
        status: "error",
        packages: [
          ...packages,
          ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
        ],
        timings,
        error: "Failed to parse migration phase output",
      };
    }
  }

  // No framework version change: run migrations inline (same-package, no re-exec needed)
  // runMigrationPhase handles types gen internally — no separate runTypesGen call needed here.
  // ADR 0032: template sync rides the framework version delta — with no delta the
  // framework-owned files are never reconciled; the release tag they target moves
  // only through this pathway.

  const migrationResult = await runMigrationPhase(projectDir, options, parentSource, {
    versionDelta,
  });
  const mainPkg = packages.find((p) => p.name === "everything-dev");
  const changelogUrl =
    mainPkg?.from && mainPkg.from !== mainPkg.to
      ? buildChangelogUrl(mainPkg.from, mainPkg.to, parentSource.repository)
      : undefined;
  return {
    ...migrationResult,
    packages: [
      ...packages,
      ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
    ],
    timings: [...timings, ...(migrationResult.timings ?? [])],
    changelogUrl,
  };
}
