import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatUnknownError } from "./errors";

const MODULE_RESOLUTION_FAILURE = /ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/;

function bootstrapCommand(projectDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts?.prepare ? "pnpm install && pnpm run prepare" : "pnpm install";
  } catch {
    return "pnpm install";
  }
}

/**
 * The fresh-checkout remedy (#956): a type-generation failure in a checkout
 * whose toolchain was never bootstrapped must name the bootstrap command
 * instead of surfacing a deep module-resolution error. Bootstrapped checkouts
 * keep the original error untouched — remote-source failures keep their own
 * remediation surface (#652).
 */
export function regenerationRemedy(projectDir: string, error: unknown): string | null {
  const detail = formatUnknownError(error);
  const unbootstrapped =
    !existsSync(join(projectDir, "node_modules")) || MODULE_RESOLUTION_FAILURE.test(detail);
  if (!unbootstrapped) return null;
  return `regeneration unavailable in this checkout — bootstrap it first: ${bootstrapCommand(projectDir)} (generation error: ${detail})`;
}
