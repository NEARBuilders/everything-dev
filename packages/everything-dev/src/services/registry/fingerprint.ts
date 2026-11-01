import { createHash } from "node:crypto";
import type { BosConfig } from "../../types";
import { walkConfigSlots } from "../config-slots";

/**
 * The published pointer's version identity (atomic-deploys 08/12): a hash
 * over every slot's `pin` — cheap to compute (no version-manifest fetch), and
 * stable exactly when the deployed set is. Shared so the CLI and the host
 * compute the same identity for the same pointer.
 */
export function pointerFingerprint(config: BosConfig): string {
  const parts: Array<string> = [];
  walkConfigSlots(config as unknown as Record<string, unknown>, ({ slot, entry, isPluginRef }) => {
    if (isPluginRef) {
      parts.push(`${slot}:${entry as string}`);
      return;
    }
    const s = entry as { pin?: unknown; integrity?: unknown } | undefined;
    if (!s) return;
    const pin = s.pin as { manifest?: unknown; integrity?: unknown } | undefined;
    const pinPart =
      pin && typeof pin.manifest === "string" && typeof pin.integrity === "string"
        ? `${pin.manifest}:${pin.integrity}`
        : "";
    const directPart = typeof s.integrity === "string" ? s.integrity : "";
    parts.push(`${slot}:${pinPart}:${directPart}`);
  });
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** Per-slot pin ids for display (slot → versioned manifest filename). */
export function slotPins(config: BosConfig): Record<string, string> {
  const pins: Record<string, string> = {};
  walkConfigSlots(config as unknown as Record<string, unknown>, ({ slot, entry, isPluginRef }) => {
    if (isPluginRef) return;
    const s = entry as { pin?: unknown } | undefined;
    if (!s) return;
    const manifest = (s.pin as { manifest?: unknown } | undefined)?.manifest;
    if (typeof manifest === "string") pins[slot] = manifest;
  });
  return pins;
}
