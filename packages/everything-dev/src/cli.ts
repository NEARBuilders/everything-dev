import { existsSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as p from "@clack/prompts";
import { installBundleFetchFromEnv } from "./bundle-fs-resolve";
import { findCommandDescriptor } from "./cli/catalog";
import { resolveFrameworkPackage } from "./cli/framework-version";
import { printHelp } from "./cli/help";
import { runDockerComposeUp } from "./cli/init";
import { parseCommandInput } from "./cli/parse";
import { promptInitBasic, promptInitOverrides } from "./cli/prompts";
import { formatDuration, sumPhaseDurations } from "./cli/timing";
import { fetchInitParent } from "./commands/init";
import { findConfigPath, readAuthoredConfigInput } from "./config";
import type {
  DevOptions,
  DevResult,
  InitOptions,
  InitResult,
  KeyPublishOptions,
  KillOptions,
  KillResult,
  LogsOptions,
  LogsResult,
  OverrideSection,
  PsResult,
  StartOptions,
  StartResult,
  TypecheckWorkspaceResult,
} from "./contract";
import type { StartSummary } from "./dev-program";
import { getRegistryNamespaceForAccount } from "./fastkv";
import { listPublishKeys } from "./near-cli";
import { getNetworkIdForAccount } from "./network";
import bosPlugin from "./plugin";
import { type ProgressEvent, pluginEvents } from "./progress";
import { createPluginRuntime } from "./sdk";
import { printBanner } from "./utils/banner";
import { colors, frames, gradients, icons } from "./utils/theme";

function printConfigView(result: {
  account: string;
  domain?: string;
  staging?: { domain: string };
  app?: {
    host: { name?: string; development: string; production?: string };
    ui: { name?: string; development?: string; production?: string; ssr?: string };
    api: { name?: string; development?: string; production?: string; proxy?: string };
  };
}) {
  console.log();
  console.log(colors.cyan(frames.top(52)));
  console.log(`  ${icons.app} ${gradients.cyber("CONFIG")}`);
  console.log(colors.cyan(frames.bottom(52)));
  console.log();

  console.log(`  ${colors.dim("Account")}  ${colors.cyan(result.account)}`);
  console.log(`  ${colors.dim("Domain")}   ${colors.white(result.domain ?? "not configured")}`);
  if (result.staging) {
    console.log(`  ${colors.dim("Staging")}  ${colors.magenta(result.staging.domain)}`);
  }
  console.log();
}

function formatTimeAgo(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return isoTimestamp.split("T")[0] ?? isoTimestamp;
}

function normalizeVersion(v: string): string {
  return v.replace(/^[\^~>=v]+/, "").trim();
}

function printTimingSummary(timings: Array<{ name: string; durationMs: number }> | undefined) {
  if (!timings || timings.length === 0) return;

  console.log(`  ${colors.dim("Timings:")}`);
  for (const timing of timings) {
    console.log(`    ${colors.dim(timing.name.padEnd(22))} ${formatDuration(timing.durationMs)}`);
  }
  console.log(
    `    ${colors.dim("total".padEnd(22))} ${formatDuration(sumPhaseDurations(timings))}`,
  );
}

function printStartSummary(summary: StartSummary) {
  console.log();
  console.log(`  ${colors.dim("Config Source:")}  ${summary.configSource}`);
  if (summary.configSourceHttp) {
    console.log(`                  ${colors.dim(summary.configSourceHttp)}`);
  }
  console.log(`  ${colors.dim("Account:")}        ${summary.account}`);
  console.log(`  ${colors.dim("Domain:")}         ${summary.domain ?? "not configured"}`);
  console.log();
  console.log(`  ${colors.dim("Modules:")}`);
  console.log(`    ${colors.dim("HOST")}  → ${summary.modules.host ?? "local"}`);
  console.log(`    ${colors.dim("UI")}   → ${summary.modules.ui ?? "local"}`);
  console.log(`    ${colors.dim("API")}  → ${summary.modules.api ?? "local"}`);
  if (summary.modules.auth) {
    console.log(`    ${colors.dim("AUTH")}  → ${summary.modules.auth}`);
  }
  if (summary.warnings.length > 0) {
    console.log();
    for (const w of summary.warnings) {
      console.log(`  ${colors.yellow(w)}`);
    }
  }
  console.log();
}

function clearSpinnerStopLine() {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\u001B[1A\u001B[2K\u001B[1G");
}

async function warnIfOutdated(client: any, command: string): Promise<void> {
  if (!["dev", "build", "start"].includes(command)) return;

  try {
    const status = await client.status();
    if (status.status === "error" || !status.packages) return;

    const frameworkPackages = ["everything-dev", "every-plugin"];

    const linked = status.packages.filter((p: { isLinked?: boolean }) => p.isLinked);
    const outdated = status.packages.filter(
      (p: { name: string; installed?: string; latest?: string; isLinked?: boolean }) =>
        !p.isLinked &&
        p.installed &&
        p.latest &&
        normalizeVersion(p.installed) !== normalizeVersion(p.latest) &&
        frameworkPackages.includes(p.name),
    );

    if (linked.length > 0) {
      for (const pkg of linked) {
        console.log(colors.dim(`    ${pkg.name} is linked locally (v${pkg.installed})`));
      }
    }

    if (outdated.length === 0) return;

    const warn = (line: string) => {
      if (command === "dev" || command === "start") process.stderr.write(`${line}\n`);
      else console.log(line);
    };
    warn("");
    warn(colors.yellow(`  ! Outdated packages detected:`));
    for (const pkg of outdated) {
      warn(colors.dim(`    ${pkg.name}  ${pkg.installed} → ${pkg.latest}`));
    }
    warn(
      colors.dim(
        `    Run ${colors.cyan("bos upgrade")} to update packages and sync template files.`,
      ),
    );
    warn("");
  } catch {
    // silently ignore if status check fails
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const invocationArgs = args.length > 0 ? args : ["dev"];
  const command = invocationArgs[0] ?? "dev";

  const commandMatch = findCommandDescriptor(invocationArgs);
  if (!commandMatch) {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }

  const { descriptor, consumed } = commandMatch;
  const commandArgs = invocationArgs.slice(consumed);

  // Parse before the plugin boot: `start --config-path` steers the whole CLI,
  // not just the stack — the plugin initialize resolves and pin-validates the
  // boot config, so it must be the config the command will actually run.
  let parsedInput: unknown;
  try {
    parsedInput = parseCommandInput(descriptor, commandArgs);
  } catch (error) {
    console.error(`[CLI] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const bootInput = parsedInput as { configPath?: string };

  const cwdConfigPath = findConfigPath();
  const configPath = bootInput.configPath ?? cwdConfigPath;
  installBundleFetchFromEnv({ configPath });

  const projectDir = cwdConfigPath ? dirname(cwdConfigPath) : undefined;
  const edResolved = projectDir ? resolveFrameworkPackage(projectDir, "everything-dev") : undefined;
  const displayVersion = edResolved?.installedVersion
    ? `${edResolved.installedVersion}${edResolved.isLinked ? " (linked)" : ""}`
    : undefined;
  if (!process.env.BOS_NO_BANNER) {
    printBanner("everything-dev", displayVersion);
  }

  const runtime = createPluginRuntime({
    registry: {
      bos: { module: bosPlugin },
    },
    secrets: {},
  });

  const pluginRuntime: any = runtime;
  const loadPlugin = pluginRuntime.usePlugin.bind(pluginRuntime);
  const plugin = await loadPlugin("bos", {
    variables: {
      configPath: configPath ?? undefined,
      configDir: cwdConfigPath ? dirname(cwdConfigPath) : undefined,
    },
    secrets: {},
  });

  const client = plugin.createClient();

  const outdatedWarning = warnIfOutdated(client, command);

  try {
    const input = parsedInput;

    const rollbackInput = input as {
      listOnly?: boolean;
      version?: string;
      previous?: boolean;
      [key: string]: unknown;
    };
    if (
      descriptor.key === "rollback" &&
      !rollbackInput.listOnly &&
      !rollbackInput.version &&
      !rollbackInput.previous
    ) {
      const listing = await (client as any).rollback({ ...rollbackInput, listOnly: true });
      if (listing.status !== "list" || !listing.history?.length) {
        console.error(listing.error ?? "No publish history found");
        process.exit(1);
      }
      console.log();
      const selection = await p.select({
        message: "Roll back to which publish?",
        options: listing.history.map(
          (entry: {
            blockHeight: number;
            blockTimestamp: string;
            txHash?: string;
            summary: string;
          }) => ({
            value: String(entry.blockHeight),
            label: `${entry.blockTimestamp}  (block ${entry.blockHeight})`,
            hint: entry.summary,
          }),
        ),
      });
      if (p.isCancel(selection)) {
        return;
      }
      rollbackInput.version = selection as string;
    }

    if (descriptor.key === "keyPublish") {
      const keyPublishInput = input as KeyPublishOptions;
      if (keyPublishInput.removeOldKeys === undefined) {
        if (process.stdin.isTTY) {
          const authored = configPath ? await readAuthoredConfigInput(dirname(configPath)) : null;
          const account =
            keyPublishInput.env === "staging"
              ? (authored?.staging?.account ?? authored?.account)
              : authored?.account;
          let listed: string[] | null = null;
          if (account) {
            const network = getNetworkIdForAccount(account);
            const contract = getRegistryNamespaceForAccount(account, keyPublishInput.registry);
            try {
              listed = await listPublishKeys({ account, contract, network });
            } catch {
              listed = null;
            }
          }
          if (listed?.length) {
            const removeOldKeys = await p.confirm({
              message: `Remove ${listed.length} existing publish key${listed.length > 1 ? "s" : ""}?`,
              initialValue: true,
            });
            if (p.isCancel(removeOldKeys)) {
              return;
            }
            keyPublishInput.removeOldKeys = removeOldKeys;
          } else {
            keyPublishInput.removeOldKeys = true;
          }
        } else {
          keyPublishInput.removeOldKeys = true;
        }
      }
    }

    if (descriptor.key === "dev") {
      const devSpinner = p.spinner();
      devSpinner.start("Starting dev environment");

      const devPhaseLabels: Record<string, string> = {
        "shared deps": "Preparing config...",
        install: "Installing dependencies...",
        build: "Building...",
        "resolve config": "Resolving config...",
        ports: "Finding available ports...",
        "docker compose up": "Starting local Postgres...",
        "generate artifacts": "Generating code artifacts...",
      };

      const onDevProgress = (event: ProgressEvent) => {
        const label = devPhaseLabels[event.phase] ?? event.phase;
        if (event.status === "running") {
          devSpinner.message(label);
        }
      };
      pluginEvents.on("progress", onDevProgress);

      let result: DevResult;
      try {
        result = await client.dev(input as DevOptions);
      } finally {
        pluginEvents.off("progress", onDevProgress);
      }

      if (result.status === "error") {
        devSpinner.stop("Failed");
        console.error(`[CLI] ${result.description}`);
        process.exit(1);
      }

      devSpinner.stop();
      clearSpinnerStopLine();

      const session = result.session;
      void outdatedWarning;
      if (session) {
        const { devApp } = await import("./dev-session");
        devApp(
          projectDir ?? process.cwd(),
          session.orchestrator,
          session.services,
          session.runtimeConfig,
          session.envGenerated,
          session.shellEnv,
        );
      }
      return;
    }

    if (descriptor.key === "start") {
      const startSpinner = p.spinner();
      startSpinner.start("Starting production environment");

      const startPhaseLabels: Record<string, string> = {
        config: "Preparing config...",
        "generate artifacts": "Generating code artifacts...",
      };

      const onStartProgress = (event: ProgressEvent) => {
        const label = startPhaseLabels[event.phase] ?? event.phase;
        if (event.status === "running") {
          startSpinner.message(label);
        }
      };
      pluginEvents.on("progress", onStartProgress);

      let result: StartResult;
      try {
        result = await client.start(input as StartOptions);
      } finally {
        pluginEvents.off("progress", onStartProgress);
      }

      if (result.status === "error") {
        startSpinner.stop("Failed");
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }

      startSpinner.stop("Ready");

      const session = result.session;
      const summary = result.summary;
      void outdatedWarning;
      if (session) {
        if (summary) {
          printStartSummary(summary);
        }
        const { startApp } = await import("./dev-session");
        startApp(
          projectDir ?? process.cwd(),
          session.orchestrator,
          session.services,
          session.runtimeConfig,
          session.envGenerated,
          session.shellEnv,
        );
      }
      return;
    }

    if (descriptor.key === "init") {
      let initInput: InitOptions = { ...(input as InitOptions) };

      if (!initInput.noInteractive) {
        const basic = await promptInitBasic({
          extends: initInput.extends,
          account: initInput.account,
          domain: initInput.domain,
        });

        let parentPluginKeys: string[] = [];
        let parentConfig: {
          title?: string;
          description?: string;
          plugins?: Record<string, unknown>;
        } | null = null;

        const fetchSpinner = p.spinner();
        fetchSpinner.start("Fetching parent config");
        try {
          const parent = await fetchInitParent(basic.extendsAccount, basic.extendsGateway);
          parentConfig = parent.parentConfig;
          parentPluginKeys = parent.parentPluginKeys;
        } catch {
          fetchSpinner.stop("Config not found");
          console.error(
            `[CLI] No config found at bos://${basic.extendsAccount}/${basic.extendsGateway}`,
          );
          process.exit(1);
        }
        fetchSpinner.stop("Config fetched");

        if (
          typeof parentConfig?.title === "string" &&
          parentConfig.title.trim() &&
          typeof parentConfig?.description === "string" &&
          parentConfig.description.trim()
        ) {
          const shouldContinue = await p.confirm({
            message: `You will be extending ${parentConfig.title} - ${parentConfig.description}. Continue?`,
            initialValue: true,
          });

          if (p.isCancel(shouldContinue) || !shouldContinue) {
            process.exit(0);
          }
        }

        const overrides = await promptInitOverrides({
          parentPluginKeys,
          plugins: initInput.plugins,
          overrides: initInput.overrides as OverrideSection[] | undefined,
          level: initInput.level,
        });

        const directory = initInput.directory || basic.domain || basic.extendsGateway;

        initInput = {
          ...initInput,
          extends: `bos://${basic.extendsAccount}/${basic.extendsGateway}`,
          directory,
          account: basic.account,
          domain: basic.domain || undefined,
          plugins: overrides.plugins,
          overrides: overrides.overrides,
          level: overrides.level ?? initInput.level,
          noInteractive: true,
        };
      }

      const initSpinner = p.spinner();
      initSpinner.start("Initializing project");

      const phaseLabels: Record<string, string> = {
        "parent config": "Fetching parent config...",
        "template source": "Resolving template source...",
        "scaffold project": "Creating project scaffold...",
        "copy files": "Copying template files...",
        "personalize config": "Personalizing config...",
        "write snapshot": "Writing snapshot...",
        "resolve config": "Resolving config...",
        "generate env/docker": "Generating environment config...",
        "create env file": "Creating .env file...",
        "install dependencies": "Installing dependencies...",
        "generate types": "Generating types...",
        "generate migrations": "Generating database migrations...",
        "generate code artifacts": "Generating code artifacts...",
      };

      const onProgress = (event: ProgressEvent) => {
        const label = phaseLabels[event.phase] ?? event.phase;
        if (event.status === "running") {
          initSpinner.message(label);
        }
      };
      pluginEvents.on("progress", onProgress);

      let result: InitResult;
      try {
        result = await client.init(initInput);
      } finally {
        pluginEvents.off("progress", onProgress);
      }

      if (result.status === "error") {
        initSpinner.stop("Failed");
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }

      initSpinner.stop("Project initialized");

      console.log(`  ${colors.dim("Extends:")} ${result.extends}`);
      console.log(`  ${colors.dim("Directory:")} ${result.directory}`);
      if (result.account) console.log(`  ${colors.dim("Account:")} ${result.account}`);
      if (result.domain) console.log(`  ${colors.dim("Domain:")} ${result.domain}`);
      if (result.overrides && result.overrides.length > 0)
        console.log(`  ${colors.dim("Overrides:")} ${result.overrides.join(", ")}`);
      if (result.plugins && result.plugins.length > 0)
        console.log(`  ${colors.dim("Plugins:")} ${result.plugins.join(", ")}`);
      console.log(`  ${colors.dim("Files copied:")} ${result.filesCopied}`);
      printTimingSummary(result.timings);
      console.log();
      console.log(colors.dim("  Next steps:"));
      console.log(colors.dim(`    cd ${result.directory}`));
      if (!initInput.noInstall) {
        console.log(colors.dim("    bun run dev"));
      } else {
        console.log(colors.dim("    bun install"));
        console.log(colors.dim("    bun run dev"));
      }
      console.log();

      if (initInput.noInteractive !== true && !initInput.noInstall && result.targetDir) {
        const shouldStartDocker = await p.confirm({
          message: "Run docker compose up -d --wait?",
          initialValue: true,
        });

        if (shouldStartDocker === true) {
          const dockerSpinner = p.spinner();
          dockerSpinner.start("Starting Docker services");
          const compose = await runDockerComposeUp(result.targetDir);
          if (compose.ok) {
            dockerSpinner.stop("Docker services ready");
          } else {
            dockerSpinner.stop("Docker services not started");
            p.log.warn(
              `docker compose up -d --wait failed${compose.tail ? `:\n${compose.tail}` : ""}`,
            );
          }
        }
      }

      return;
    }

    const result = await (client as any)[descriptor.key](input);

    if (descriptor.key === "dbStudio") {
      if (result.status === "error") {
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }

      return;
    }

    if (descriptor.key === "dbDoctor") {
      if (result.status === "error") {
        console.error(`[CLI] ${result.error || "Diagnosis failed"}`);
        process.exit(1);
      }

      const statusIcon = (() => {
        switch (result.diagnosis) {
          case "healthy":
            return "✓";
          case "empty":
            return "○";
          case "unapplied":
            return "○";
          case "untracked-existing-schema":
            return "○";
          case "drift-safe-repair":
            return "⚠";
          case "drift-manual":
            return "✗";
          default:
            return "?";
        }
      })();

      console.log(`\n${statusIcon}  ${result.plugin}`);
      console.log(`  ${colors.dim(`Journal:`)} ${result.journalSchema}.${result.journalTable}`);
      console.log(`  ${colors.dim(`Local migrations:`)} ${result.localMigrationCount}`);
      console.log(`  ${colors.dim(`Applied hashes:`)} ${result.appliedHashCount}`);
      if (result.expectedTables.length > 0) {
        console.log(`  ${colors.dim(`Expected tables:`)} ${result.expectedTables.join(", ")}`);
      }
      if (result.missingTables.length > 0) {
        console.log(`  ${colors.yellow(`Missing tables:`)} ${result.missingTables.join(", ")}`);
      }
      console.log(`  ${colors.dim(`Diagnosis:`)} ${result.diagnosis}`);
      if (result.workspaceDir) {
        console.log(`  ${colors.dim(`Workspace:`)} ${result.workspaceDir}`);
      }
      console.log();
      return;
    }

    if (descriptor.key === "dbRepair") {
      if (result.status === "refused") {
        console.log(
          `\n${colors.yellow("!")}  Repair refused for ${result.diagnosis?.plugin ?? result.message}`,
        );
        console.log(`  ${result.message}`);
        console.log();
        process.exit(0);
      }

      if (result.status === "error") {
        console.error(`\n${colors.error("✗")}  Repair failed`);
        console.error(`  ${result.message}`);
        console.error();
        process.exit(1);
      }

      console.log(`\n${colors.green("✓")}  Repair complete`);
      console.log(`  ${result.message}`);
      console.log();
      return;
    }

    if (descriptor.key === "config") {
      if (!result.config) {
        console.error("No bos.config.json found");
        process.exit(1);
      }

      printConfigView(result.config);
      process.stdout.write(`${JSON.stringify(result.config, null, 2)}\n`);
      return;
    }

    if (descriptor.key === "sync") {
      if ((input as any).json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log();
      if (result.status === "error") {
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }
      if (result.status === "dry-run") {
        console.log(colors.cyan(`${icons.ok} Dry run — no files written`));
      } else {
        console.log(colors.green(`${icons.ok} Synced`));
      }
      if (result.updated.length > 0 || result.added.length > 0 || result.conflicted.length > 0) {
        console.log(
          `  ${colors.dim("Sync results:")} ${result.updated.length} updated, ${result.added.length} added, ${result.conflicted.length} conflicted`,
        );
        if (result.updated.length > 0) {
          for (const f of result.updated) console.log(`    ${colors.dim(f)}`);
        }
        if (result.added.length > 0) {
          for (const f of result.added) console.log(`    ${colors.dim(f)}`);
        }
        if (result.conflicted.length > 0) {
          console.log(
            `  ${colors.yellow("Conflicted")} (template applied, your changes backed up):`,
          );
          if (result.backupDir) console.log(`    ${colors.dim(result.backupDir)}`);
          for (const f of result.conflicted) console.log(`    ${colors.dim(f)}`);
        }
      }
      if (
        result.updated.length === 0 &&
        result.added.length === 0 &&
        result.conflicted.length === 0
      ) {
        console.log(`  ${colors.dim("Already up to date")}`);
      }
      console.log();
      return;
    }

    if (descriptor.key === "upgrade") {
      if ((input as any).json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log();
      if (result.status === "error") {
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }
      if (result.status === "dry-run") {
        console.log(colors.cyan(`${icons.ok} Dry run — no changes applied`));
      } else {
        console.log(colors.green(`${icons.ok} Upgrade complete`));
      }
      const mainPkg = result.packages.find(
        (p: { name: string; from?: string; to: string }) => p.name === "everything-dev",
      );
      const versionDelta =
        mainPkg?.from && mainPkg.from !== mainPkg.to ? `${mainPkg.from} → ${mainPkg.to}` : null;
      if (versionDelta) {
        console.log(`  ${colors.dim(`Upgraded everything-dev ${versionDelta}`)}`);
      }
      for (const pkg of result.packages) {
        if (pkg.name === "everything-dev") continue;
        if (pkg.from && pkg.from !== pkg.to) {
          console.log(`  ${colors.dim(`${pkg.name}  ${pkg.from} → ${pkg.to}`)}`);
        } else if (!pkg.from) {
          console.log(`  ${colors.dim(`${pkg.name}  ${pkg.to} (new)`)}`);
        } else {
          console.log(`  ${colors.dim(`${pkg.name}  ${pkg.to} (up to date)`)}`);
        }
      }
      if (result.changelogUrl) {
        console.log(`  Changelog: ${result.changelogUrl}`);
      }
      if (result.selectedPlugins && result.selectedPlugins.length > 0) {
        console.log(`  Added plugins: ${result.selectedPlugins.join(", ")}`);
      }
      if (result.sync) {
        const sync = result.sync;
        console.log(`  ${colors.dim("Sync results:")}`);
        if (sync.updated.length > 0 || sync.added.length > 0 || sync.conflicted.length > 0) {
          console.log(
            `  ${sync.updated.length} updated, ${sync.added.length} added, ${sync.conflicted.length} conflicted`,
          );
          if (sync.conflicted.length > 0) {
            console.log(
              `  ${colors.yellow("Conflicted")} (template applied, your changes backed up):`,
            );
            if (sync.backupDir) console.log(`    ${colors.dim(sync.backupDir)}`);
            for (const f of sync.conflicted) console.log(`    ${colors.dim(f)}`);
          }
        } else {
          console.log(`  ${colors.dim("Already up to date")}`);
        }
      }
      if (result.migrated && result.migrated.length > 0) {
        console.log(`  Migrated: ${result.migrated.length} file(s)`);
        for (const f of result.migrated) console.log(`    ${colors.dim(f)}`);
      }
      if (versionDelta || (result.sync && result.sync.conflicted.length > 0)) {
        console.log();
        console.log(colors.dim("  For AI agents:"));
        const parentRepo = "nearbuilders/everything-dev";
        const somedelta =
          mainPkg?.from && mainPkg.to
            ? `v${mainPkg.from.replace(/^[\^~>=v]+/, "")}...v${mainPkg.to.replace(/^[\^~>=v]+/, "")}`
            : "";
        console.log(
          colors.dim(
            `  This upgrade applied template changes${somedelta ? ` (${somedelta})` : ""}.`,
          ),
        );
        if (result.sync && result.sync.conflicted.length > 0) {
          console.log(
            colors.dim(
              `  ${result.sync.conflicted.length} file(s) had local conflicts — template version applied, backups at ${result.sync.backupDir || ".bos/sync-backup/"}.`,
            ),
          );
          console.log(
            colors.dim(
              `  If local changes should be preserved upstream, open a PR: https://github.com/${parentRepo}${somedelta ? `/compare/${somedelta}` : ""}`,
            ),
          );
        }
        console.log(
          colors.dim(
            "  Load matching intent skills: bunx @tanstack/intent@latest load everything-dev#...",
          ),
        );
        console.log(colors.dim("  Review AGENTS.md — local updates may need merging."));
      }
      console.log();
      return;
    }

    if (descriptor.key === "status") {
      console.log();
      if (result.status === "error") {
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }
      console.log(colors.cyan(frames.top(52)));
      console.log(`  ${icons.app} ${gradients.cyber("STATUS")}`);
      console.log(colors.cyan(frames.bottom(52)));
      console.log();
      if (result.extends) console.log(`  ${colors.dim("Extends:")}     ${result.extends}`);
      if (result.account) console.log(`  ${colors.dim("Account:")}     ${result.account}`);
      if (result.domain) console.log(`  ${colors.dim("Domain:")}      ${result.domain}`);
      console.log();
      console.log(`  ${colors.dim("Packages:")}`);
      for (const pkg of result.packages) {
        const hasUpdate =
          pkg.installed &&
          pkg.latest &&
          normalizeVersion(pkg.installed) !== normalizeVersion(pkg.latest);
        const versionStr = hasUpdate
          ? `${pkg.installed}  →  ${pkg.latest}`
          : pkg.installed || "not installed";
        const label = hasUpdate ? colors.yellow(versionStr) : colors.dim(versionStr);
        console.log(`    ${colors.dim(`${pkg.name}`)}  ${label}`);
      }
      console.log();
      if (result.lastSync) {
        const ago = formatTimeAgo(result.lastSync);
        console.log(`  ${colors.dim("Last sync:")}   ${ago}`);
      } else {
        console.log(`  ${colors.dim("Last sync:")}   never`);
      }
      const envLabel =
        result.envFile === "found"
          ? colors.green("found")
          : result.envFile === "example-only"
            ? colors.yellow("missing (only .env.example found)")
            : colors.error("missing");
      console.log(`  ${colors.dim(".env:")}         ${envLabel}`);
      if (result.parentReachable !== undefined) {
        const parentLabel = result.parentReachable
          ? colors.green("reachable")
          : colors.error("unreachable");
        console.log(`  ${colors.dim("Parent:")}      ${parentLabel}`);
      }
      const hasUpdates = result.packages.some(
        (p: { installed?: string; latest?: string }) =>
          p.installed && p.latest && normalizeVersion(p.installed) !== normalizeVersion(p.latest),
      );
      if (hasUpdates) {
        console.log();
        console.log(
          colors.dim(
            `  Run ${colors.cyan("bos upgrade")} to update packages and sync template files.`,
          ),
        );
      }
      console.log();
      return;
    }

    if (descriptor.key === "ps") {
      const psResult = result as PsResult;
      console.log();
      if (psResult.status === "error") {
        console.error(`[CLI] ${psResult.error || "Unknown error"}`);
        process.exit(1);
      }
      const entries = psResult.entries ?? [];
      if (entries.length === 0) {
        console.log(colors.dim("  No tracked development processes running."));
        console.log();
        console.log(
          colors.dim(`  Start one with ${colors.cyan("bos dev")} and it will appear here.`),
        );
        console.log();
        return;
      }
      console.log(colors.cyan(frames.top(60)));
      console.log(`  ${icons.app} ${gradients.cyber("PROCESSES")}`);
      console.log(colors.cyan(frames.bottom(60)));
      console.log();
      for (const entry of entries) {
        const ageMs = Date.now() - entry.startedAt;
        const ageStr =
          ageMs < 60_000
            ? `${Math.floor(ageMs / 1000)}s`
            : ageMs < 3_600_000
              ? `${Math.floor(ageMs / 60_000)}m`
              : `${Math.floor(ageMs / 3_600_000)}h`;
        const roleTag =
          entry.role === "workspace-parent"
            ? colors.magenta("parent")
            : entry.role === "workspace-child"
              ? colors.blue("child")
              : colors.dim("dev");
        console.log(`  ${colors.green(`pid ${entry.pid}`)}  ${roleTag}  ${colors.dim(ageStr)}`);
        console.log(`    ${colors.dim("dir:")}    ${entry.configDir}`);
        if (entry.parentPid !== undefined) {
          console.log(`    ${colors.dim("parent:")} ${entry.parentPid}`);
        }
        const portPairs = Object.entries(entry.ports ?? {})
          .filter(([, p]) => typeof p === "number")
          .map(([k, v]) => `${k}=${v}`);
        if (portPairs.length > 0) {
          console.log(`    ${colors.dim("ports:")}  ${portPairs.join("  ")}`);
        }
        if (entry.budget) {
          console.log(`    ${colors.dim("budget:")} [${entry.budget.min}, ${entry.budget.max}]`);
        }
        console.log(`    ${colors.dim("desc:")}   ${entry.description}`);
        console.log();
      }
      return;
    }

    if (descriptor.key === "logs") {
      const logsResult = result as LogsResult;
      const opts = input as LogsOptions;
      for (const line of logsResult.lines) {
        console.log(line);
      }
      if (logsResult.lines.length === 0) {
        console.log(colors.dim(`  No matching log lines in ${logsResult.logFile}.`));
      }
      if (opts.follow) {
        if (logsResult.logFile === "unknown" || !existsSync(logsResult.logFile)) {
          console.log(colors.dim("  No log file to follow — nothing was found on disk."));
        } else {
          const filter = opts.service;
          let byteOffset = 0;
          for (const line of logsResult.lines) byteOffset += Buffer.byteLength(line, "utf8") + 1;
          const followMatch = (line: string): boolean => {
            if (!filter) return true;
            const source = /\] \[([^\]]+)\] \[(?:OUT|ERR)\] /.exec(line)?.[1];
            return source === filter || source === `plugin:${filter}`;
          };
          const watcher = watch(logsResult.logFile, (event) => {
            if (event !== "change") return;
            void readFile(logsResult.logFile, "utf8")
              .then((text) => {
                const newLines = text
                  .slice(byteOffset)
                  .split("\n")
                  .filter((line) => line.length > 0 && followMatch(line));
                byteOffset = Buffer.byteLength(text, "utf8");
                for (const line of newLines) {
                  console.log(line);
                }
              })
              .catch(() => {
                // the followed file was rotated or deleted — stop following
                watcher.close();
              });
          });
          console.log(colors.dim("  Following — Ctrl+C to stop."));
          process.on("SIGINT", () => {
            watcher.close();
            process.exit(0);
          });
        }
      }
      return;
    }

    if (descriptor.key === "kill") {
      const killResult = result as KillResult;
      console.log();
      if (killResult.status === "error") {
        console.error(`[CLI] ${killResult.error || "Unknown error"}`);
        process.exit(1);
      }
      if (killResult.killed.length > 0) {
        console.log(colors.green(`${icons.ok} Sent ${killResult.killed.length} kill signal(s)`));
        for (const k of killResult.killed) {
          console.log(`  ${colors.dim("pid")} ${k.pid}  ${colors.dim(k.configDir)}`);
        }
      }
      if (killResult.skipped.length > 0) {
        console.log(colors.yellow(`${icons.err} ${killResult.skipped.length} skipped`));
        for (const s of killResult.skipped) {
          console.log(`  ${colors.dim("pid")} ${s.pid}  ${colors.dim(s.reason)}`);
        }
      }
      if (killResult.killed.length === 0 && killResult.skipped.length === 0) {
        const opts = input as KillOptions;
        if (opts.all) {
          console.log(colors.dim("  No tracked processes to kill."));
        } else {
          const configPath = findConfigPath();
          const dir = opts.configDir ?? (configPath ? resolve(dirname(configPath)) : process.cwd());
          console.log(colors.dim(`  No tracked processes for ${dir}`));
          console.log(colors.dim(`  Use ${colors.cyan("--all")} to kill across all directories.`));
        }
      }
      console.log();
      return;
    }

    if (descriptor.key === "typesGen") {
      console.log();
      if (result.status === "error") {
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }
      console.log(colors.green(`${icons.ok} Types generated`));
      if (result.generated.length > 0) {
        console.log(`  ${colors.dim("Written:")}`);
        for (const f of result.generated) console.log(`    ${colors.dim(f)}`);
      }
      if (result.fetched.length > 0 || result.skipped.length > 0 || result.failed.length > 0) {
        console.log(`  ${colors.dim("Contract sources:")}`);
        for (const entry of result.fetched) {
          const space = entry.indexOf(" ");
          const key = space !== -1 ? entry.slice(0, space) : entry;
          const rest = space !== -1 ? entry.slice(space + 1) : "";
          const restSpace = rest.indexOf(" ");
          const detail = restSpace !== -1 ? rest.slice(restSpace + 1) : "";
          console.log(
            `    ${key} ${colors.cyan("remote")}${detail ? ` ${colors.dim(detail)}` : ""}`,
          );
        }
        for (const entry of result.skipped) {
          const space = entry.indexOf(" ");
          const key = space !== -1 ? entry.slice(0, space) : entry;
          const rest = space !== -1 ? entry.slice(space + 1) : "";
          if (rest === "no URL resolved") {
            console.log(`    ${key} ${colors.dim("no URL resolved")}`);
            continue;
          }
          const restSpace = rest.indexOf(" ");
          const detail = restSpace !== -1 ? rest.slice(restSpace + 1) : "";
          console.log(`    ${key} ${colors.dim("local")}${detail ? ` ${colors.dim(detail)}` : ""}`);
        }
      }
      if (result.failed.length > 0) {
        console.log(`  ${colors.yellow("Failed:")}`);
        for (const f of result.failed) {
          const colon = f.indexOf(": ");
          if (colon !== -1) {
            console.log(`    ${colors.error(f.slice(0, colon))}${colors.dim(f.slice(colon))}`);
          } else {
            console.log(`    ${colors.error(f)}`);
          }
        }
      }
      console.log();
      return;
    }

    if (descriptor.key === "typecheck") {
      console.log();
      if (result.status === "error") {
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }
      const failed = result.results.filter((r: TypecheckWorkspaceResult) => !r.passed);
      const passed = result.results.filter((r: TypecheckWorkspaceResult) => r.passed);
      console.log(colors.cyan(frames.top(52)));
      console.log(`  ${icons.app} ${gradients.cyber("TYPECHECK")}`);
      console.log(colors.cyan(frames.bottom(52)));
      console.log();
      for (const r of result.results) {
        const icon = r.passed ? colors.green("✓") : colors.error("✗");
        console.log(`  ${icon} ${r.workspace}`);
      }
      if (result.skipped.length > 0) {
        console.log(`  ${colors.dim(`Skipped: ${result.skipped.join(", ")}`)}`);
      }
      console.log();
      if (failed.length > 0) {
        console.log(`  ${colors.error(`${failed.length} failed`)}`);
        for (const f of failed) {
          if (f.error) console.log(`    ${colors.dim(f.error)}`);
        }
        console.log();
        process.exit(1);
      }
      console.log(`  ${colors.green(`${passed.length} passed`)}`);
      console.log();
      return;
    }

    if (descriptor.key === "mfCheck") {
      console.log();
      console.log(
        `  ${colors.dim("Host")}   ${result.hostReachable ? colors.green("OK  ") : colors.error("FAIL")}  ${
          result.hostVersion ?? "unreachable"
        }${result.hostReason ? `  (${result.hostReason})` : ""}`,
      );
      for (const r of result.remotes) {
        const tag = r.ok ? colors.green("OK  ") : colors.error("FAIL");
        console.log(
          `  ${colors.dim(r.role.padEnd(10))} ${tag} ${r.url}  pluginVersion=${r.pluginVersion ?? "?"}${
            r.reason ? `  ↳ ${r.reason}` : ""
          }`,
        );
      }
      console.log();
      if (result.status !== "ok") {
        console.log(
          colors.error(
            "  mf-compat: ✗ federation manifests NOT compatible — redeploy affected plugin(s) so pluginVersion and shared versions match host",
          ),
        );
        console.log();
        process.exit(1);
      }
      console.log(colors.green("  mf-compat: ✓ all federation manifests compatible"));
      console.log();
      return;
    }

    if (result?.status === "error" && descriptor.key !== "publish" && descriptor.key !== "deploy") {
      console.error(`[CLI] ${result.error || "Unknown error"}`);
      process.exit(1);
    }

    if (descriptor.key === "login") {
      console.log();
      console.log(colors.green(`${icons.ok} Logged in to ${result.siteUrl}`));
      if (result.accountId) console.log(`  ${colors.dim("Account:")} ${result.accountId}`);
      if (result.expiresAt) console.log(`  ${colors.dim("Expires:")} ${result.expiresAt}`);
      if (result.warning) console.log(`  ${colors.yellow("⚠")} ${result.warning}`);
      if (result.publishKey) {
        console.log(
          `  ${colors.dim("Publish key:")} ${result.publishKey.publicKey} ${colors.dim(
            `(${result.publishKey.network}, exported to ${result.publishKey.exportedTo})`,
          )}`,
        );
      }
      console.log();
      return;
    }

    if (descriptor.key === "logout") {
      console.log();
      console.log(colors.green(`${icons.ok} Logged out`));
      if (result.revokedApiKey) console.log(`  ${colors.dim("Revoked API key")}`);
      if (result.removedPublishKey) console.log(`  ${colors.dim("Removed exported publish key")}`);
      if (result.warning) console.log(`  ${colors.yellow("⚠")} ${result.warning}`);
      console.log();
      return;
    }

    if (descriptor.key === "keyPublish") {
      process.stdout.write(`Generated publish key for ${result.account}\n`);
      process.stdout.write(`  Network: ${result.network}\n`);
      process.stdout.write(`  Allowance: ${result.allowance}\n`);
      process.stdout.write(`\n`);
      const secretName = result.env === "staging" ? "NEAR_TESTNET_PRIVATE_KEY" : "NEAR_PRIVATE_KEY";
      if (!process.stdout.isTTY) {
        process.stderr.write(
          `  ⚠ Non-interactive stdout: this private key will be captured in any log or pipe (GitHub Actions logs persist stdout).\n`,
        );
      }
      process.stdout.write(
        `  Set this as ${secretName} in GitHub Actions or before calling publish:\n`,
      );
      process.stdout.write(`${secretName}=${result.privateKey}\n`);
    }

    if (descriptor.key === "pluginAdd") {
      console.log();
      console.log(colors.green(`${icons.ok} Added plugin ${result.key}`));
      if (result.development) console.log(`  ${colors.dim("Development:")} ${result.development}`);
      if (result.production) console.log(`  ${colors.dim("Production:")} ${result.production}`);
      console.log();
      return;
    }

    if (descriptor.key === "pluginRemove") {
      console.log();
      console.log(colors.green(`${icons.ok} Removed plugin ${result.key}`));
      console.log();
      return;
    }

    if (descriptor.key === "pluginList") {
      console.log();
      console.log(colors.cyan(frames.top(52)));
      console.log(`  ${icons.config} ${gradients.cyber("PLUGINS")}`);
      console.log(colors.cyan(frames.bottom(52)));
      console.log();
      if (result.plugins.length === 0) {
        console.log(colors.dim("  No plugins configured"));
      } else {
        for (const pluginItem of result.plugins) {
          console.log(`  ${colors.cyan(pluginItem.key)}`);
          if (pluginItem.development)
            console.log(`    ${colors.dim("Development:")} ${pluginItem.development}`);
          if (pluginItem.production)
            console.log(`    ${colors.dim("Production:")} ${pluginItem.production}`);
        }
      }
      console.log();
      return;
    }

    if (descriptor.key === "pluginPublish") {
      console.log();
      console.log(colors.green(`${icons.ok} Published plugin ${result.key}`));
      if (result.path) console.log(`  ${colors.dim("Path:")} ${result.path}`);
      if (result.production) console.log(`  ${colors.dim("Production:")} ${result.production}`);
      if (result.version) console.log(`  ${colors.dim("Version:")} ${result.version}`);
      if (result.fingerprint) console.log(`  ${colors.dim("Fingerprint:")} ${result.fingerprint}`);
      console.log();
      return;
    }

    if (descriptor.key === "registryUse") {
      console.log();
      if (result.status === "error") {
        console.error(colors.error(`${icons.err} ${result.error || "Unknown error"}`));
        process.exit(1);
      }
      console.log(
        colors.green(
          `${icons.ok} ${result.status === "dry-run" ? "Dry run" : "Composed"} from ${result.from}`,
        ),
      );
      for (const section of result.applied) {
        console.log(`  ${colors.green("+")} ${section}`);
      }
      if (result.configPath) {
        console.log(`  ${colors.dim("Config:")} ${result.configPath}`);
      }
      if (result.status === "updated") {
        console.log(colors.dim("  Run bos types gen to refresh generated types."));
      }
      console.log();
      return;
    }

    if (descriptor.key === "publish") {
      if (result.status === "dry-run") {
        console.log();
        console.log(colors.cyan(`${icons.ok} Dry run complete`));
        console.log(`  ${colors.dim("Registry URL:")} ${result.registryUrl}`);
        console.log();
        return;
      }

      if (result.status === "error") {
        console.log();
        console.log(colors.error(`${icons.err} Publish failed`));
        if (result.error) {
          console.log(`  ${colors.dim("Error:")} ${result.error}`);
        }
        if (result.deployResults && result.deployResults.length > 0) {
          const failures = result.deployResults.filter((r: any) => !r.success);
          if (failures.length > 0) {
            console.log();
            for (const f of failures) {
              const errorLine = (f.error ?? "Failed").split("\n")[0];
              console.log(`  ${colors.error(icons.err)} ${f.key}: ${errorLine}`);
            }
          }
        }
        console.log();
        process.exit(1);
      }

      if (result.status === "published") {
        console.log();
        console.log(colors.green(`${icons.ok} Published successfully`));
        console.log(`  ${colors.dim("Registry URL:")} ${result.registryUrl}`);
        if (result.txHash) {
          console.log(`  ${colors.dim("Transaction:")} ${result.txHash}`);
        }
        if (result.built && result.built.length > 0) {
          console.log(`  ${colors.dim("Built:")} ${result.built.join(", ")}`);
        }
        if (result.skipped && result.skipped.length > 0) {
          console.log(`  ${colors.dim("Skipped:")} ${result.skipped.join(", ")}`);
        }
        if (result.deployResults) {
          const warnings = result.deployResults.flatMap((r: any) => r.warnings ?? []);
          if (warnings.length > 0) {
            console.log();
            console.log(`  ${colors.yellow("⚠")} Build warnings:`);
            for (const w of warnings) {
              console.log(`    ${colors.dim(w)}`);
            }
          }
        }
        console.log();
        return;
      }
    }

    if (descriptor.key === "rollback") {
      const rollbackResult = result as any;
      if (rollbackResult.status === "error") {
        console.log();
        console.log(colors.error(`${icons.err} Roll back failed`));
        if (rollbackResult.error) {
          console.log(`  ${colors.dim("Error:")} ${rollbackResult.error}`);
        }
        if (rollbackResult.verification) {
          console.log();
          for (const check of rollbackResult.verification) {
            const mark = check.ok ? colors.green(icons.ok) : colors.error(icons.err);
            const reason = check.reason ? colors.dim(` — ${check.reason}`) : "";
            console.log(`  ${mark} ${check.slot}${reason}`);
          }
        }
        console.log();
        process.exit(1);
      }

      if (rollbackResult.status === "dry-run") {
        console.log();
        console.log(colors.cyan(`${icons.ok} Rollback dry run complete`));
        console.log(`  ${colors.dim("Registry URL:")} ${rollbackResult.registryUrl}`);
        console.log();
        return;
      }

      console.log();
      console.log(colors.green(`${icons.ok} Rolled back`));
      console.log(`  ${colors.dim("Registry URL:")} ${rollbackResult.registryUrl}`);
      if (rollbackResult.txHash) {
        console.log(`  ${colors.dim("Transaction:")} ${rollbackResult.txHash}`);
      }
      console.log();
      return;
    }

    if (descriptor.key === "deploy") {
      const deployResult = result as any;
      if (deployResult.status === "list") {
        console.log();
        console.log(colors.cyan("Recent publishes (audit trail)"));
        for (const entry of deployResult.history ?? []) {
          console.log(
            `  ${entry.blockTimestamp}  ${colors.dim(`block ${entry.blockHeight}`)}${entry.publishedAt ? colors.dim(`  ${entry.publishedAt}`) : ""}`,
          );
        }
        console.log();
        return;
      }
      if (deployResult.fingerprint) {
        console.log(`  ${colors.dim("Fingerprint:")} ${deployResult.fingerprint}`);
      }
      if (deployResult.status === "dry-run") {
        console.log();
        console.log(colors.cyan(`${icons.ok} Dry run complete`));
        console.log(`  ${colors.dim("Registry URL:")} ${deployResult.registryUrl}`);
        console.log();
        return;
      }

      if (deployResult.status === "error") {
        console.log();
        console.log(colors.error(`${icons.err} Deploy failed`));
        if (deployResult.error) {
          console.log(`  ${colors.dim("Error:")} ${deployResult.error}`);
        }
        if (deployResult.deployResults && deployResult.deployResults.length > 0) {
          const failures = deployResult.deployResults.filter((r: any) => !r.success);
          if (failures.length > 0) {
            console.log();
            for (const f of failures) {
              const errorLine = (f.error ?? "Failed").split("\n")[0];
              console.log(`  ${colors.error(icons.err)} ${f.key}: ${errorLine}`);
            }
          }
        }
        console.log();
        process.exit(1);
      }

      if (deployResult.status === "deployed") {
        console.log();
        console.log(colors.green(`${icons.ok} Deployed successfully`));
        console.log(`  ${colors.dim("Registry URL:")} ${deployResult.registryUrl}`);
        if (deployResult.txHash) {
          console.log(`  ${colors.dim("Transaction:")} ${deployResult.txHash}`);
        }
        if (deployResult.built && deployResult.built.length > 0) {
          console.log(`  ${colors.dim("Built:")} ${deployResult.built.join(", ")}`);
        }
        if (deployResult.skipped && deployResult.skipped.length > 0) {
          console.log(`  ${colors.dim("Skipped:")} ${deployResult.skipped.join(", ")}`);
        }
        if (deployResult.deployResults) {
          const warnings = deployResult.deployResults.flatMap((r: any) => r.warnings ?? []);
          if (warnings.length > 0) {
            console.log();
            console.log(`  ${colors.yellow("⚠")} Build warnings:`);
            for (const w of warnings) {
              console.log(`    ${colors.dim(w)}`);
            }
          }
        }
        if (deployResult.image) {
          console.log(`  ${colors.dim("Image:")} ${deployResult.image}`);
        }
        if (deployResult.service) {
          console.log(`  ${colors.dim("Railway:")} deployed ${deployResult.service}`);
        }
        console.log();
        return;
      }

      if (deployResult.status === "published") {
        console.log();
        console.log(colors.yellow(`${icons.err} Config published, but a deploy leg failed`));
        console.log(`  ${colors.dim("Registry URL:")} ${deployResult.registryUrl}`);
        if (deployResult.txHash) {
          console.log(`  ${colors.dim("Transaction:")} ${deployResult.txHash}`);
        }
        if (deployResult.error) {
          console.log(`  ${colors.dim("Error:")} ${deployResult.error}`);
        }
        console.log();
        process.exit(1);
      }
    }

    if (descriptor.key === "infraExport") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
  } catch (error) {
    console.error(`[CLI] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error("[CLI] Fatal error:", error);
  process.exit(1);
});
