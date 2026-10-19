import { dirname } from "node:path";
import process from "node:process";
import { Data, Effect, Exit } from "effect";
import { findConfigPath } from "../config";
import bosPlugin from "../plugin";
import { createPluginRuntime } from "../sdk";
import { installBundleFetchFromEnv } from "../services/resolution/resolver";
import { printBanner } from "../utils/banner";
import { findCommandDescriptor } from "./catalog";
import type { CommandContext } from "./commands/context";
import { dbRenderers } from "./commands/db";
import { runDev, runStart } from "./commands/dev";
import { runInit } from "./commands/init";
import { inspectRenderers } from "./commands/inspect";
import { keyPublishPreCall, lifecycleRenderers } from "./commands/lifecycle";
import { publishRenderers, rollbackPreCall } from "./commands/publish";
import { scaffoldRenderers } from "./commands/scaffold";
import { resolveFrameworkPackage } from "./framework-version";
import { printCommandHelp, printHelp } from "./help";
import { parseCommandInput } from "./parse";
import { warnIfOutdated } from "./status";

export class CliError extends Data.TaggedError("CliError")<{ message: string }> {}

const customRunners: Record<string, (ctx: CommandContext) => Promise<void>> = {
  dev: runDev,
  start: runStart,
  init: runInit,
};

const preCalls: Record<string, (ctx: CommandContext) => Promise<void>> = {
  rollback: rollbackPreCall,
  keyPublish: keyPublishPreCall,
};

const renderers = {
  ...dbRenderers,
  ...inspectRenderers,
  ...lifecycleRenderers,
  ...publishRenderers,
  ...scaffoldRenderers,
};

const cliProgram: Effect.Effect<void, CliError> = Effect.tryPromise({
  try: async (): Promise<void> => {
    const args = process.argv.slice(2);

    const helpIndex = args.indexOf("--help") !== -1 ? args.indexOf("--help") : args.indexOf("-h");
    if (helpIndex !== -1) {
      const helpTarget = findCommandDescriptor(args.slice(0, helpIndex));
      if (helpTarget) {
        printCommandHelp(helpTarget.descriptor);
        return;
      }
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
      throw new CliError({ message: error instanceof Error ? error.message : String(error) });
    }
    const bootInput = parsedInput as { configPath?: string };

    const cwdConfigPath = findConfigPath();
    const configPath = bootInput.configPath ?? cwdConfigPath;
    installBundleFetchFromEnv({ configPath });

    const projectDir = cwdConfigPath ? dirname(cwdConfigPath) : undefined;
    const edResolved = projectDir
      ? resolveFrameworkPackage(projectDir, "everything-dev")
      : undefined;
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
      const ctx: CommandContext = {
        client,
        input,
        descriptor,
        projectDir,
        configPath,
        outdatedWarning,
      };

      await preCalls[descriptor.key]?.(ctx);

      const custom = customRunners[descriptor.key];
      if (custom) {
        await custom(ctx);
        return;
      }

      const result = await client[descriptor.key](input);

      if (
        result?.status === "error" &&
        descriptor.key !== "publish" &&
        descriptor.key !== "deploy"
      ) {
        console.error(`[CLI] ${result.error || "Unknown error"}`);
        process.exit(1);
      }

      await renderers[descriptor.key]?.(result, ctx);
    } catch (error) {
      throw new CliError({ message: error instanceof Error ? error.message : String(error) });
    }
  },
  catch: (error) =>
    new CliError({ message: error instanceof Error ? error.message : String(error) }),
});

export const runCli = async (): Promise<void> => {
  const exit = await Effect.runPromiseExit(cliProgram);
  if (Exit.isFailure(exit)) {
    const reasons = exit.cause.reasons ?? [];
    for (const reason of reasons) {
      if (reason?._tag === "Fail" && reason.error instanceof CliError) {
        console.error(`[CLI] ${reason.error.message}`);
      }
    }
    process.exit(1);
  }
};
