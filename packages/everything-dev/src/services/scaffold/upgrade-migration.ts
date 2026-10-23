import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MISSING_CONFIG_MESSAGE, readAuthoredConfigInput } from "../../config";
import type { PhaseTiming, UpgradeOptions, UpgradeResult } from "../../contract";
import { formatUnknownError } from "../../utils/errors";
import { saveBosConfig } from "../../utils/save-config";
import { timePhase } from "../../utils/timing";
import { openResolution } from "../resolution/session";
import { syncResolvedSharedDeps } from "../workspace/shared-deps";
import { runTypesGen } from "./init";
import { syncTemplate } from "./sync";
import { migrateChildRootPackageJson } from "./upgrade-packages";
import { buildChangelogUrl, type ExtendedRootSource } from "./upgrade-source";

/** Migration-phase scope (ADR 0032): template reconciliation rides the
 * framework version delta — with no delta nothing touches the tree. */
export interface MigrationScope {
  /** true when the upgrade moves framework versions (or `--from` says so) */
  versionDelta: boolean;
}

/**
 * Surgical platform-pin edit on the authored `bos.app.ts` source: rewrites
 * only the `platform: "…"` line (or inserts one after `extends`), leaving
 * every other byte — formatting, comments, attachments — untouched. Throws
 * with the version to set by hand when no safe anchor exists; the authored
 * file is never re-serialized.
 */
export function stampPlatformPin(source: string, version: string): string {
  const platformLineRe = /^([ \t]*)(platform|"platform")[ \t]*:[ \t]*"([^"]*)"(,?)[ \t]*$/;
  const extendsLineRe = /^([ \t]*)(extends|"extends")[ \t]*:[ \t]*("[^"]*")(,?)[ \t]*$/;
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(platformLineRe);
    if (match) {
      lines[i] = `${match[1]}platform: "${version}"${match[4]}`;
      return lines.join("\n");
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(extendsLineRe);
    if (match) {
      lines[i] = `${match[1]}${match[2]}: ${match[3]},`;
      lines.splice(i + 1, 0, `${match[1]}platform: "${version}",`);
      return lines.join("\n");
    }
  }

  throw new Error(
    `could not stamp the platform pin surgically — no platform or extends ` +
      `property found in the authored config; set platform: "${version}" ` +
      `in bos.app.ts manually and re-run`,
  );
}

/**
 * Stamp the resolved framework version into the authored config's `platform`
 * pin (ADR 0034). Runs at the top of the migration phase on both the inline
 * and re-exec'd paths, so everyday resolution (sync, init, runtime) always
 * freezes to the release this upgrade just landed from — whether or not the
 * package versions actually moved. The authored `bos.app.ts` is edited
 * surgically (the pin line only) — never re-serialized.
 */
export async function applyPlatformPin(
  projectDir: string,
  parentSource: ExtendedRootSource,
): Promise<string | undefined> {
  const version = parentSource.platform.manifest.frameworkVersion;
  const config = (await readAuthoredConfigInput(projectDir)) as Record<string, unknown> | null;
  if (!config) return undefined;
  if (config.platform === version) return undefined;

  const appConfigPath = join(projectDir, "bos.app.ts");
  if (existsSync(appConfigPath)) {
    const source = readFileSync(appConfigPath, "utf-8");
    writeFileSync(appConfigPath, stampPlatformPin(source, version));
    return "bos.app.ts";
  }

  config.platform = version;
  await saveBosConfig(projectDir, config);
  return "bos.config.json";
}

/**
 * The re-exec'd migration child runs `--json`, so its stdout is the structured
 * result — a failed run carries the real failure in its `error` field, which
 * raw stderr/stdout concatenation hides behind `[CLI] [object Object]`.
 */
export function describeMigrationFailure(
  stdout: string | undefined,
  stderr: string | undefined,
): string {
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout) as { error?: unknown };
      if (parsed && typeof parsed === "object" && parsed.error != null) {
        return formatUnknownError(parsed.error);
      }
    } catch {
      // not JSON — fall through to the raw streams
    }
  }
  const raw = (stderr || stdout || "").trim();
  return raw.length > 0 ? raw : "Unknown error";
}

export async function runMigrationPhase(
  projectDir: string,
  options: UpgradeOptions,
  parentSource: ExtendedRootSource,
  scope: MigrationScope,
): Promise<UpgradeResult> {
  const timings: PhaseTiming[] = [];

  const platformPinned = await timePhase(timings, "stamp platform pin", () =>
    applyPlatformPin(projectDir, parentSource),
  );

  const migratedRootPackageJson = await timePhase(timings, "migrate root package", () =>
    migrateChildRootPackageJson(projectDir),
  );

  let syncResult: UpgradeResult["sync"];
  // Same-version upgrades never touch framework-owned files (ADR 0032).
  // `--no-sync` opts out of a version-change sync.
  if (scope.versionDelta && !options.noSync) {
    syncResult = await timePhase(timings, "sync template", () =>
      syncTemplate(projectDir, {
        dryRun: false,
        noInstall: true,
        force: options.force,
      }),
    );
    if (syncResult?.status === "conflicted") {
      throw new Error(syncResult.error ?? "Template sync hit unresolvable local conflicts");
    }
  }

  await timePhase(timings, "sync shared deps", async () => {
    const configSession = await openResolution({ cwd: projectDir });
    if (!configSession?.config) {
      throw new Error(`${MISSING_CONFIG_MESSAGE} in current directory`);
    }

    return syncResolvedSharedDeps({
      configDir: projectDir,
      hostMode: "local",
      bosConfig: configSession.config,
    });
  });

  if (!options.noInstall) {
    await timePhase(timings, "generate types", () => runTypesGen(projectDir));
  }

  const migratedFiles = [
    ...(platformPinned ? [platformPinned] : []),
    ...(migratedRootPackageJson ? ["package.json"] : []),
  ];

  const mainPkg = parentSource.catalog["everything-dev"];
  const changelogUrl = mainPkg
    ? buildChangelogUrl(undefined, mainPkg, parentSource.repository)
    : undefined;

  return {
    status: "upgraded",
    packages: [],
    sync: syncResult,
    migrated: migratedFiles.length > 0 ? migratedFiles : undefined,
    timings,
    changelogUrl,
  };
}
