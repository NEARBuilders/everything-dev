import * as p from "@clack/prompts";
import type { InitOptions, InitResult, OverrideSection } from "../../contract";
import { fetchInitParent } from "../../handlers/init";
import { type ProgressEvent, pluginEvents } from "../../services/dev/progress";
import { colors } from "../../utils/theme";
import { exitCodeFor } from "../exit-codes";
import { promptInitBasic, promptInitOverrides } from "../prompts";
import { printTimingSummary } from "../render/dev";
import type { CommandContext } from "./context";

export const runInit = async (ctx: CommandContext): Promise<void> => {
  const client = ctx.client;
  const input = ctx.input;
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
    "generate env": "Generating environment config...",
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

  if (exitCodeFor(result) === 1) {
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
    console.log(colors.dim("    pnpm run dev"));
  } else {
    console.log(colors.dim("    pnpm install"));
    console.log(colors.dim("    pnpm run dev"));
  }
  console.log();

  return;
};
