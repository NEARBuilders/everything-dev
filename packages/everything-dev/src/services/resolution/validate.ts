import { ConfigExtendsError } from "./load";

type RuntimeOverrideTarget = "ui" | "api" | "plugins" | `plugins.${string}`;

export function parseRuntimeOverrideTargets(value?: string | null): RuntimeOverrideTarget[] {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].map((entry) => {
    if (entry === "ui" || entry === "api" || entry === "plugins") {
      return entry;
    }

    if (entry.startsWith("plugins.") && entry.length > "plugins.".length) {
      return entry as RuntimeOverrideTarget;
    }

    throw new ConfigExtendsError({ message: `Invalid runtime override target: ${entry}` });
  });
}

export function isRuntimeOverrideAllowed(
  allowedTargets: ReadonlyArray<RuntimeOverrideTarget>,
  target: "ui" | "api" | "plugins" | `plugins.${string}`,
): boolean {
  if (allowedTargets.includes(target as RuntimeOverrideTarget)) {
    return true;
  }

  if (target.startsWith("plugins.")) {
    return allowedTargets.includes("plugins.*");
  }

  return false;
}
