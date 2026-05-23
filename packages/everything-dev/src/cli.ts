#!/usr/bin/env node
import * as p from "@clack/prompts";
import { findCommandDescriptor } from "./cli/catalog";
import { printHelp } from "./cli/help";
import { fetchParentConfig, runDockerComposeUp } from "./cli/init";
import { parseCommandInput } from "./cli/parse";
import { promptInitBasic, promptInitOverrides } from "./cli/prompts";
import { formatDuration, sumPhaseDurations } from "./cli/timing";
import { findConfigPath } from "./config";
import type {
  DevOptions,
  DevResult,
  InitOptions,
  InitResult,
  OverrideSection,
  StartOptions,
  StartResult,
} from "./contract";
import type { ProgressEvent, StartSummary } from "./plugin";
import bosPlugin, { consumeDevSession, pluginEvents } from "./plugin";
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

    const outdated = status.packages.filter(
      (p: { name: string; installed?: string; latest?: string }) =>
        p.installed &&
        p.latest &&
        normalizeVersion(p.installed) !== normalizeVersion(p.latest) &&
        frameworkPackages.includes(p.name),
    );

    if (outdated.length === 0) return;

    console.log();
    console.log(colors.yellow(`  ! Outdated packages detected:`));
    for (const pkg of outdated) {
      console.log(colors.dim(`    ${pkg.name}  ${pkg.installed} → ${pkg.latest}`));
    }
    console.log(
      colors.dim(
        `    Run ${colors.cyan("bos upgrade")} to update packages and sync template files.`,
      ),
    );
    console.log();
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
  const configPath = findConfigPath();

  const commandMatch = findCommandDescriptor(invocationArgs);
  if (!commandMatch) {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }

  const { descriptor, consumed } = commandMatch;
  const commandArgs = invocationArgs.slice(consumed);

  printBanner();

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
    },
    secrets: {},
  });

  const client = plugin.createClient();

  await warnIfOutdated(client, command);

  try {
    const input = parseCommandInput(descriptor, commandArgs);

    if (descriptor.key === "dev") {
      const devSpinner = p.spinner();
      devSpinner.start("Starting dev environment");

      const devPhaseLabels: Record<string, string> = {
        config: "Preparing config...",
        install: "Installing dependencies...",
        "build plugin": "Building plugin...",
        build: "Building everything-dev...",
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

      const session = consumeDevSession();
      if (session) {
        const { devApp } = await import("./dev-session");
        devApp(session.orchestrator, session.services, session.runtimeConfig);
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

      const session = consumeDevSession();
      if (session) {
        const summary = session.summary;
        if (summary) {
          printStartSummary(summary);
        }
        const { startApp } = await import("./dev-session");
        startApp(session.orchestrator, session.services, session.runtimeConfig);
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
          parentConfig = await fetchParentConfig(basic.extendsAccount, basic.extendsGateway);
          if (parentConfig?.plugins && typeof parentConfig.plugins === "object") {
            parentPluginKeys = Object.keys(parentConfig.plugins);
          }
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
        console.log(colors.dim("    docker compose up -d --wait"));
        console.log(colors.dim("    bun run dev"));
      } else {
        console.log(colors.dim("    bun install"));
        console.log(colors.dim("    docker compose up -d --wait"));
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
          try {
            await runDockerComposeUp(result.targetDir);
            dockerSpinner.stop("Docker services ready");
          } catch (error) {
            dockerSpinner.stop("Docker services not started");
            p.log.warn(
              `docker compose up -d --wait failed: ${error instanceof Error ? error.message : error}`,
            );
          }
        }
      }

      return;
    }

    const result = await (client as any)[descriptor.key](input);

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
      console.log();
      if (result.status === "error") {
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }
      if (result.status === "dry-run") {
        console.log(colors.cyan(`${icons.ok} Dry run — no files written`));
      } else {
        console.log(colors.green(`${icons.ok} Template synced`));
      }
      if (result.updated.length > 0) {
        console.log(`  ${colors.dim("Updated:")} ${result.updated.length} file(s)`);
        for (const f of result.updated) console.log(`    ${colors.dim(f)}`);
      }
      if (result.added.length > 0) {
        console.log(`  ${colors.dim("Added:")} ${result.added.length} file(s)`);
        for (const f of result.added) console.log(`    ${colors.dim(f)}`);
      }
      if (result.skipped.length > 0) {
        console.log(
          `  ${colors.yellow("Skipped:")} ${result.skipped.length} file(s) (locally modified, use --force to overwrite)`,
        );
        for (const f of result.skipped) console.log(`    ${colors.dim(f)}`);
      }
      if (result.updated.length === 0 && result.added.length === 0 && result.skipped.length === 0) {
        console.log(`  ${colors.dim("Already up to date")}`);
      }
      if (result.status !== "dry-run" && result.updated.length > 0) {
        console.log();
        console.log(colors.dim("  Review changes — your customizations take priority:"));
        console.log(
          colors.dim(
            "    • api/src/contract.ts, api/src/index.ts, api/src/db/schema.ts — never overwritten",
          ),
        );
        console.log(
          colors.dim("    • ui/src/components/**, ui/src/styles.css — never overwritten"),
        );
        console.log(
          colors.dim(
            "    • Other updated files — accept framework improvements, then restore your changes",
          ),
        );
        console.log(colors.dim("    • Skipped files — yours already, only update with --force"));
      }
      console.log();
      return;
    }

    if (descriptor.key === "upgrade") {
      console.log();
      if (result.status === "error") {
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }
      if (result.status === "dry-run") {
        console.log(colors.cyan(`${icons.ok} Dry run — no changes applied`));
      } else {
        console.log(colors.green(`${icons.ok} Upgrade successful`));
      }
      for (const pkg of result.packages) {
        if (pkg.from && pkg.from !== pkg.to) {
          console.log(`  ${colors.dim(`${pkg.name}:`)} ${pkg.from} → ${pkg.to}`);
        } else if (!pkg.from) {
          console.log(`  ${colors.dim(`${pkg.name}:`)} ${pkg.to} (new)`);
        } else {
          console.log(`  ${colors.dim(`${pkg.name}:`)} ${pkg.to} (up to date)`);
        }
      }
      if (result.changelogUrl) {
        console.log(`  ${colors.dim("Changelog:")} ${result.changelogUrl}`);
      }
      if (result.availablePlugins && result.availablePlugins.length > 0) {
        console.log(`  ${colors.dim("New parent plugins:")} ${result.availablePlugins.join(", ")}`);
      }
      if (result.selectedPlugins && result.selectedPlugins.length > 0) {
        console.log(`  ${colors.dim("Added plugins:")} ${result.selectedPlugins.join(", ")}`);
      }
      printTimingSummary(result.timings);
      if (result.sync) {
        const sync = result.sync;
        if (sync.updated.length > 0) {
          console.log(`  ${colors.dim("Updated:")} ${sync.updated.length} file(s)`);
          for (const f of sync.updated) console.log(`    ${colors.dim(f)}`);
        }
        if (sync.added.length > 0) {
          console.log(`  ${colors.dim("Added:")} ${sync.added.length} file(s)`);
          for (const f of sync.added) console.log(`    ${colors.dim(f)}`);
        }
        if (sync.skipped.length > 0) {
          console.log(
            `  ${colors.yellow("Skipped:")} ${sync.skipped.length} file(s) (locally modified, use --force to overwrite)`,
          );
          for (const f of sync.skipped) console.log(`    ${colors.dim(f)}`);
        }
        if (
          result.status !== "dry-run" &&
          (sync.updated.length > 0 || sync.added.length > 0 || sync.skipped.length > 0)
        ) {
          console.log();
          console.log(colors.dim("  Resolve differences — your code takes priority:"));
          console.log();
          console.log(colors.dim("  Never overwritten (safe):"));
          console.log(
            colors.dim("    • api/src/contract.ts, api/src/index.ts, api/src/db/schema.ts"),
          );
          console.log(colors.dim("    • ui/src/components/**, ui/src/styles.css"));
          console.log();
          console.log(colors.dim("  Replaced — review and keep your changes:"));
          console.log(
            colors.dim(
              "    • api/drizzle.config.ts, api/tsconfig.json, api/tsconfig.contract.json",
            ),
          );
          console.log(colors.dim("    • api/plugin.dev.ts, api/rspack.config.js"));
          console.log(colors.dim("    • ui/src/routes/* (core routes only)"));
          console.log();
          console.log(colors.dim("  Merged — your deps preserved:"));
          console.log(colors.dim("    • package.json, api/package.json, ui/package.json"));
          console.log();
          console.log(colors.dim("  Skipped — already yours:"));
          console.log(colors.dim("    • Use --force only if you want framework updates"));
        }
      }
      if (result.migrated && result.migrated.length > 0) {
        console.log(`  ${colors.yellow("Removed:")} ${result.migrated.length} obsolete file(s)`);
        for (const f of result.migrated) console.log(`    ${colors.dim(f)}`);
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

    if (descriptor.key === "typesGen") {
      console.log();
      if (result.status === "error") {
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }
      console.log(colors.green(`${icons.ok} Types generated`));
      if (result.source) {
        console.log(
          `  ${colors.dim("Mode:")} ${result.source === "remote" ? colors.cyan("remote") : colors.dim("local")}`,
        );
      }
      if (result.generated.length > 0) {
        console.log(`  ${colors.dim("Generated:")}`);
        for (const f of result.generated) console.log(`    ${colors.dim(f)}`);
      }
      if (result.fetched.length > 0) {
        console.log(`  ${colors.dim("Fetched (remote):")}`);
        for (const url of result.fetched) console.log(`    ${colors.dim(url)}`);
      }
      if (result.skipped.length > 0) {
        console.log(`  ${colors.dim("Skipped:")}`);
        for (const s of result.skipped) console.log(`    ${colors.dim(s)}`);
      }
      if (result.failed.length > 0) {
        console.log(`  ${colors.yellow("Failed:")}`);
        for (const f of result.failed) console.log(`    ${colors.error(f)}`);
      }
      console.log();
      return;
    }

    if (result?.status === "error") {
      console.error(`[CLI] ${result.error || "Unknown error"}`);
      process.exit(1);
    }

    if (descriptor.key === "keyPublish") {
      process.stdout.write(`Generated publish key for ${result.account}\n`);
      process.stdout.write(`  Network: ${result.network}\n`);
      process.stdout.write(`  Contract: ${result.contract}\n`);
      process.stdout.write(`  Allowance: ${result.allowance}\n`);
      process.stdout.write(`  Functions: ${result.functionNames.join(", ")}\n`);
      process.stdout.write(`  Public key: ${result.publicKey}\n`);
      process.stdout.write(`  Private key: ${result.privateKey}\n`);
      process.stdout.write(`  Copy: NEAR_PRIVATE_KEY=${result.privateKey}\n`);
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
      if (result.script) console.log(`  ${colors.dim("Script:")} bun run ${result.script}`);
      if (result.production) console.log(`  ${colors.dim("Production:")} ${result.production}`);
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
        console.log();
        return;
      }
    }

    if (descriptor.key === "deploy") {
      const deployResult = result as any;
      if (deployResult.status === "dry-run") {
        console.log();
        console.log(colors.cyan(`${icons.ok} Dry run complete`));
        console.log(`  ${colors.dim("Registry URL:")} ${deployResult.registryUrl}`);
        console.log();
        return;
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
        if (deployResult.redeployed) {
          console.log(
            `  ${colors.dim("Railway:")} redeployed ${deployResult.service ?? "service"}`,
          );
        } else if (!process.env.RAILWAY_TOKEN) {
          console.log(`  ${colors.yellow("Railway:")} skipped (RAILWAY_TOKEN not set)`);
        }
        console.log();
        return;
      }

      if (deployResult.status === "published") {
        console.log();
        console.log(colors.yellow(`${icons.err} Config published, but Railway redeploy failed`));
        console.log(`  ${colors.dim("Registry URL:")} ${deployResult.registryUrl}`);
        if (deployResult.txHash) {
          console.log(`  ${colors.dim("Transaction:")} ${deployResult.txHash}`);
        }
        if (deployResult.error) {
          console.log(`  ${colors.dim("Railway:")} ${deployResult.error}`);
        }
        console.log();
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(`[CLI] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[CLI] Fatal error:", error);
  process.exit(1);
});
