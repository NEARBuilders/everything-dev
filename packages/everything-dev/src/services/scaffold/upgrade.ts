import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { PhaseTiming, UpgradeOptions, UpgradeResult } from "../../contract";
import { readJsonFile } from "../../utils/json-file";
import { timePhase } from "../../utils/timing";
import { executeClean } from "../clean";
import { readWorkspaceCatalog } from "../workspace/catalog";
import {
  reconcilePackageManagerPin,
  reconcileWorkspaceYamlFile,
  verifyReleaseAgeExcludes,
} from "../workspace/catalog-overrides";
import { runPnpmApproveAll, runPnpmInstallForUpgrade } from "./init";
import { installWithReleaseAgeRemediation } from "./install-remediation";
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

/** The interactive upgrade's post-step (`bos clean`): prune the regenerable
 * sediment an upgrade leaves behind — never the sync backups this run just
 * created (they are the review surface for the files it overwrote).
 * Best-effort: an uncleanable state never fails an applied upgrade. */
async function finalizeWithClean(
  projectDir: string,
  result: UpgradeResult,
  options: UpgradeOptions,
): Promise<UpgradeResult> {
  if (!options.cleanAfter || result.status !== "upgraded") return result;
  try {
    const report = executeClean(projectDir, { skip: ["sync-backup", "import-backup"] });
    return {
      ...result,
      notes: [
        ...(result.notes ?? []),
        `post-upgrade clean: removed ${report.entries.filter((e) => e.action === "removed").length} regenerable target(s) — upgrade backups kept`,
      ],
    };
  } catch {
    return result;
  }
}

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

  // The version delta that drives the whole migration phase, derived from
  // durable state — nothing version-shaped rides across the re-exec boundary:
  // the authored release still holds the release the tree is aligned to
  // (applyRelease stamps the new one at the top of the migration phase),
  // while the upgrade source resolves the manifest *ignoring* that field. So
  // `authoredRelease !== manifest` is the pending-delta fact — identical in
  // the parent and in the re-exec'd child, where packages compare
  // new-installed vs new-catalog and cannot self-diff. An absent release also
  // counts as a delta (a tree never aligned to a release needs the migration
  // phase).
  const manifestVersion = parentSource.platform.manifest.frameworkVersion;
  const releaseDelta =
    parentSource.authoredRelease === undefined || parentSource.authoredRelease !== manifestVersion;

  const hasFrameworkUpdates = packages.some((p) => p.from !== p.to && p.from !== undefined);
  const hasCatalogUpdates = catalogVersionUpdates.some((u) => u.from !== undefined);
  // An aligned release with matching packages is the only "nothing to do"
  // state: a release that lags (or is absent) means pending migration work
  // even when the packages already sit on the release — the
  // half-upgraded-tree repair case.
  const hasUpdates =
    hasFrameworkUpdates ||
    hasCatalogUpdates ||
    hasCatalogRefRewrites ||
    hasAuthCoreRefRewrites ||
    releaseDelta;

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
      release: {
        resolved: parentSource.platform.manifest.frameworkVersion,
        source: `bos://${parentSource.platform.source.account}/${parentSource.platform.source.gateway}`,
        fromCache: parentSource.platform.fromCache,
        provenance: parentSource.platform.provenance,
      },
      updatesAvailable: hasUpdates,
      timings,
      changelogUrl,
    };
  }

  const versionDelta = releaseDelta || hasFrameworkUpdates;

  if (options.migrationsOnly) {
    return await runMigrationPhase(projectDir, options, parentSource, { versionDelta });
  }

  // Pre-flight (ADR 0032): refuse applies of new packages against stale
  // framework-owned files. The template reconciliation must be ready to run
  // when the new packages land; existing conflicts abort before Phase 1 so a
  // resolution (`--force`, or the interactive file selection) can happen
  // cleanly. An approved write set (`overwrite`) IS the resolution — the
  // per-file selection governs the migration phase's sync instead.
  if (versionDelta && !options.noSync && !options.force && !options.overwrite) {
    const preflight = await timePhase(timings, "preflight template sync", () =>
      syncTemplate(projectDir, {
        dryRun: true,
        resolvedRelease: parentSource.platform,
      }),
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

    // Overrides and release-age excludes follow the synced catalog (#659/#682):
    // a literal override re-pinning an old version beats the new catalog row
    // at resolution time, so the build silently keeps running stale shared
    // deps and the #546 skew gate blames the wrong fix.
    reconcileWorkspaceYamlFile(workspaceDirOf(projectDir));

    // Pre-install invariant: the release-age excludes must cover every exact
    // framework catalog row, or pnpm's supply-chain holdback fails the
    // install on the freshly-released rows (the Nov-03 stranded rc).
    const excludeGaps = verifyReleaseAgeExcludes(workspaceDirOf(projectDir));
    if (excludeGaps.length > 0) {
      throw new Error(
        `pnpm-workspace.yaml is missing minimumReleaseAgeExclude rows for ${excludeGaps.join(", ")} — ` +
          "the install would fail pnpm's supply-chain holdback; re-run `bos upgrade` (reconciliation repairs the file)",
      );
    }

    // Forward-only pnpm pin propagation — migrate-pnpm is a one-time v1→v2
    // step, so existing v2 children only see a parent toolchain bump here.
    reconcilePackageManagerPin(pkgPath);

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
      installWithReleaseAgeRemediation({
        workspaceDir: workspaceDirOf(projectDir),
        run: () => runPnpmInstallForUpgrade(workspaceDirOf(projectDir)),
        log: (message) => console.error(`  [install] ${message}`),
      }),
    );
    // The new dependency set may ship agent skills / build scripts pnpm gates
    // behind `pnpm approve` — approve them in the same train so the tree it
    // leaves behind installs clean on every machine (best-effort; see the
    // helper).
    await timePhase(timings, "approve pnpm permissions", () =>
      runPnpmApproveAll(workspaceDirOf(projectDir)),
    );
  }

  // If we installed new framework packages, re-exec from the new package so migrations
  // run with the latest code instead of the old cached modules. The migration-phase
  // delta is derived from the authored platform pin vs the resolved manifest (see
  // above) — the child reads the same durable state, so nothing version-shaped
  // is passed here.
  if (needsInstall && hasFrameworkUpdates) {
    const bosPath = join(workspaceDirOf(projectDir), "node_modules", ".bin", "bos");
    const childArgs = [
      "upgrade",
      "--migrations-only",
      "--no-install",
      ...(options.noSync ? ["--no-sync"] : []),
      ...(options.force ? ["--force"] : []),
      ...(options.overwrite?.length ? ["--overwrite", options.overwrite.join(",")] : []),
      ...(options.noRealign ? ["--no-realign"] : []),
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
      // The re-exec'd child pipes its own stdout for the structured result, so
      // everything it relayed to stderr (realign deploy output, migration
      // warnings) would be swallowed on the success path — surface it here.
      if (childResult.stderr?.trim()) process.stderr.write(childResult.stderr);
      const mainPkg = packages.find((p) => p.name === "everything-dev");
      const changelogUrl =
        mainPkg?.from && mainPkg.from !== mainPkg.to
          ? buildChangelogUrl(mainPkg.from, mainPkg.to, parentSource.repository)
          : undefined;
      return await finalizeWithClean(
        projectDir,
        {
          ...childUpgrade,
          packages: [
            ...packages,
            ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
          ],
          timings: [...timings, ...(childUpgrade.timings ?? [])],
          changelogUrl,
        },
        options,
      );
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
  return await finalizeWithClean(
    projectDir,
    {
      ...migrationResult,
      packages: [
        ...packages,
        ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
      ],
      timings: [...timings, ...(migrationResult.timings ?? [])],
      changelogUrl,
    },
    options,
  );
}
