import * as p from "@clack/prompts";
import type { DevOptions, DevResult, StartOptions, StartResult } from "../../contract";
import { type ProgressEvent, pluginEvents } from "../../services/dev/progress";
import type { DevSessionData } from "../../services/dev/session";
import { exitCodeFor } from "../exit-codes";
import { clearSpinnerStopLine, printStartSummary } from "../render/dev";
import type { CommandContext } from "./context";

const _runWithProgress = async <T>(
  spinner: ReturnType<typeof p.spinner>,
  phaseLabels: Record<string, string>,
  call: () => Promise<T>,
): Promise<T> => {
  const onProgress = (event: ProgressEvent) => {
    const label = phaseLabels[event.phase] ?? event.phase;
    if (event.status === "running") spinner.message(label);
  };
  pluginEvents.on("progress", onProgress);
  try {
    return await call();
  } finally {
    pluginEvents.off("progress", onProgress);
  }
};

const mountSession = async (
  projectDir: string | undefined,
  session: DevSessionData,
): Promise<void> => {
  const [{ devApp }, { DevRendererCliLive }] = await Promise.all([
    import("../../services/dev/session"),
    import("../render/dev-render"),
  ]);
  devApp(projectDir ?? process.cwd(), session, DevRendererCliLive);
};

export const runDev = async (ctx: CommandContext): Promise<void> => {
  const client = ctx.client;
  const input = ctx.input;
  const outdatedWarning = ctx.outdatedWarning;
  const projectDir = ctx.projectDir;
  void outdatedWarning;
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

  if (exitCodeFor(result) === 1) {
    devSpinner.stop("Failed");
    console.error(`[CLI] ${result.description}`);
    process.exit(1);
  }

  devSpinner.stop();
  clearSpinnerStopLine();

  const session = result.session;
  void outdatedWarning;
  if (session) {
    await mountSession(projectDir, session);
  }
  return;
};

export const runStart = async (ctx: CommandContext): Promise<void> => {
  const client = ctx.client;
  const input = ctx.input;
  const outdatedWarning = ctx.outdatedWarning;
  const projectDir = ctx.projectDir;
  void outdatedWarning;
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

  if (exitCodeFor(result) === 1) {
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
    await mountSession(projectDir, session);
  }
  return;
};
