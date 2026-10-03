import { createHash } from "node:crypto";
import type { BosConfig } from "./types";

/**
 * The published pointer's version identity (atomic-deploys 08/12): a hash
 * over every slot's `pin` — cheap to compute (no version-manifest fetch), and
 * stable exactly when the deployed set is. Shared so the CLI and the host
 * compute the same identity for the same pointer.
 */
export function pointerFingerprint(config: BosConfig): string {
  const parts: Array<string> = [];
  const slot = (prefix: string, s: { pin?: unknown; integrity?: unknown } | undefined) => {
    if (!s) return;
    const pin = s.pin as { manifest?: unknown; integrity?: unknown } | undefined;
    const pinPart =
      pin && typeof pin.manifest === "string" && typeof pin.integrity === "string"
        ? `${pin.manifest}:${pin.integrity}`
        : "";
    const directPart = typeof s.integrity === "string" ? s.integrity : "";
    parts.push(`${prefix}:${pinPart}:${directPart}`);
  };
  for (const [key, entry] of Object.entries(config.app ?? {})) {
    slot(`app.${key}`, entry);
    slot(`app.${key}.ui`, (entry as { ui?: { pin?: unknown; integrity?: unknown } }).ui);
  }
  for (const [key, entry] of Object.entries(config.plugins ?? {})) {
    if (typeof entry === "string") {
      parts.push(`plugins.${key}:${entry}`);
      continue;
    }
    slot(`plugins.${key}`, entry);
    slot(`plugins.${key}.ui`, (entry as { ui?: { pin?: unknown; integrity?: unknown } }).ui);
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** Per-slot pin ids for display (slot → versioned manifest filename). */
export function slotPins(config: BosConfig): Record<string, string> {
  const pins: Record<string, string> = {};
  const slot = (prefix: string, s: { pin?: unknown } | undefined) => {
    if (!s) return;
    const manifest = (s.pin as { manifest?: unknown } | undefined)?.manifest;
    if (typeof manifest === "string") pins[prefix] = manifest;
  };
  for (const [key, entry] of Object.entries(config.app ?? {})) {
    slot(`app.${key}`, entry);
    slot(`app.${key}.ui`, (entry as { ui?: { pin?: unknown } }).ui);
  }
  for (const [key, entry] of Object.entries(config.plugins ?? {})) {
    if (typeof entry === "string") continue;
    slot(`plugins.${key}`, entry);
    slot(`plugins.${key}.ui`, (entry as { ui?: { pin?: unknown } }).ui);
  }
  return pins;
}
