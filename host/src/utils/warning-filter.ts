import { logger } from "./logger";

const SUPPRESSED_EXPERIMENTAL_WARNINGS = ["vm.USE_MAIN_CONTEXT_DEFAULT_LOADER"] as const;

export const isSuppressedWarning = (warning: Error): boolean =>
  warning.name === "ExperimentalWarning" &&
  SUPPRESSED_EXPERIMENTAL_WARNINGS.some((marker) => warning.message.includes(marker));

export const installWarningFilter = (): void => {
  process.on("warning", (warning) => {
    if (isSuppressedWarning(warning)) return;
    logger.warn(`[${warning.name}] ${warning.message}\n${warning.stack}`);
  });
};
