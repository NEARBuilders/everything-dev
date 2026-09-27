import { spawn } from "node:child_process";
import { generateContractTypes } from "./build/contract-types";
import { ensureGeneratedRspackConfig } from "./build/rspack/generated-config";
import {
  ensureGeneratedCoreUiRsbuildConfig,
  ensureGeneratedUiRsbuildConfig,
  hasCoreUiWorkspace,
} from "./build/ui/generated-config";

function run(
  cmd: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
    });
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`)),
    );
    child.on("error", reject);
  });
}

export async function emitContractTypes(): Promise<void> {
  const status = await generateContractTypes();
  if (status === "skipped") {
    console.log("[every-plugin] No src/contract.ts — nothing to emit.");
  } else {
    console.log(`[every-plugin] Contract types ${status}.`);
  }
}

/**
 * Workspace-form core ui build surface — the /api model applied to the ui:
 * the generated config (or a local rsbuild.config.ts override) drives
 * rsbuild; extra args pass through (`--environment web|node`).
 */
async function runCoreUi(args: string[]): Promise<void> {
  const generatedConfig = ensureGeneratedCoreUiRsbuildConfig();
  const [command = "build", ...rest] = args;
  const configArgs = generatedConfig ? ["--config", generatedConfig] : [];
  await run("rsbuild", [command, ...configArgs, ...rest], {});
}

async function runRspack(): Promise<void> {
  const generatedConfig = ensureGeneratedRspackConfig();

  const args = generatedConfig ? ["build", "--config", generatedConfig] : ["build"];
  await run("rspack", args, {});

  const uiConfig = ensureGeneratedUiRsbuildConfig(process.cwd());
  if (uiConfig) {
    console.log("[every-plugin] Building folder-form ui source…");
    await run("rsbuild", ["build", "--config", uiConfig], {});
  }
}

export function runCliCommand(raw: string, args: string[] = []): Promise<void> {
  const command = raw.replace(/=.*/, "");
  // The core ui workspace form routes build/dev/preview through rsbuild;
  // plugin workspaces keep the rspack/dev-server surface.
  if (hasCoreUiWorkspace()) {
    switch (command) {
      case "build":
        return runCoreUi(["build", ...args]);
      case "preview":
        return runCoreUi(["preview", ...args]);
      case "dev":
        return runCoreUi(["dev", ...args]);
      default:
        return Promise.reject(
          new Error(`Unknown every-plugin command for a core ui workspace: ${raw}`),
        );
    }
  }
  switch (command) {
    case "types":
      return emitContractTypes();
    case "build":
    case "deploy":
      return runRspack();
    case "dev":
      return (async () => {
        const { startPluginDevServer } = await import("./dev/serve");
        await startPluginDevServer();
        return new Promise<void>(() => {});
      })();
    default:
      return Promise.reject(
        new Error(`Unknown every-plugin command: ${raw} (expected dev|types|build|deploy)`),
      );
  }
}
