import { createHash } from "node:crypto";
import type { BosConfigInput } from "./types";

/**
 * Rollback safety gate (atomic-deploys 11): before republishing a historical
 * snapshot, every pinned slot's version manifest must still serve and match
 * its SRI — Phase A made bytes additive and retention is keep-everything, so
 * a verify failure means the pointer is broken, never publishable. Snapshots
 * from before the pin existed cannot be verified this way; they are allowed
 * only with an explicit force (their bytes were overwritten in place), with
 * the caller expected to warn loudly.
 */

export interface RollbackSlotCheck {
  slot: string;
  manifest?: string;
  ok: boolean;
  reason?: string;
}

export interface RollbackVerification {
  /** false = pre-pin snapshot with no verifiable pins (force required) */
  verifiable: boolean;
  ok: boolean;
  slots: RollbackSlotCheck[];
}

interface PinnedSlotRef {
  production?: unknown;
  pin?: { manifest?: unknown; integrity?: unknown };
}

function collectPinnedSlots(config: BosConfigInput): Array<{ slot: string; ref: PinnedSlotRef }> {
  const slots: Array<{ slot: string; ref: PinnedSlotRef }> = [];
  const app = config.app as Record<string, PinnedSlotRef | undefined> | undefined;
  const plugins = config.plugins as Record<string, unknown> | undefined;

  const push = (slot: string, ref: unknown): void => {
    if (ref && typeof ref === "object") slots.push({ slot, ref: ref as PinnedSlotRef });
  };

  if (app) {
    for (const key of ["host", "ui", "api", "auth"] as const) push(`app.${key}`, app[key]);
    const auth = app.auth as { ui?: unknown } | undefined;
    if (auth?.ui) push("app.auth.ui", auth.ui);
  }
  if (plugins) {
    for (const [key, plugin] of Object.entries(plugins)) {
      if (typeof plugin !== "object" || plugin === null) continue;
      push(key, plugin);
      const ui = (plugin as { ui?: unknown }).ui;
      if (ui) push(`${key}.ui`, ui);
    }
  }
  return slots;
}

function pinOf(ref: PinnedSlotRef): { manifest: string; integrity: string } | null {
  const manifest = typeof ref.pin?.manifest === "string" ? ref.pin.manifest : undefined;
  const integrity = typeof ref.pin?.integrity === "string" ? ref.pin.integrity : undefined;
  return manifest && integrity ? { manifest, integrity } : null;
}

export interface SlotPinRef {
  slot: string;
  /** the slot's production base URL (…/bundles/<account>/<gateway>/<workspace>/) */
  base: string;
  pin: { manifest: string; integrity: string };
}

/** Every pinned slot with both a production base and a verifiable pin. */
export function collectSlotPinRefs(config: BosConfigInput): SlotPinRef[] {
  return collectPinnedSlots(config)
    .map(({ slot, ref }) => {
      const pin = pinOf(ref);
      const base = typeof ref.production === "string" ? ref.production : undefined;
      return pin && base ? { slot, base, pin } : null;
    })
    .filter((entry): entry is SlotPinRef => entry !== null);
}

async function verifySlot(
  slot: string,
  ref: PinnedSlotRef,
  fetchImpl: typeof fetch,
): Promise<RollbackSlotCheck> {
  const base = typeof ref.production === "string" ? ref.production : undefined;
  const pin = pinOf(ref);
  if (!pin) return { slot, ok: true };
  const { manifest, integrity } = pin;

  if (!base)
    return { slot, manifest, ok: false, reason: "no production URL to fetch the manifest from" };

  const manifestUrl = `${base.replace(/\/$/, "")}/${manifest.replace(/^\//, "")}`;
  try {
    const response = await fetchImpl(manifestUrl);
    if (!response.ok) {
      return { slot, manifest, ok: false, reason: `manifest fetch failed: ${response.status}` };
    }
    const body = await response.text();
    const computed = `sha384-${createHash("sha384").update(body).digest("base64")}`;
    if (computed !== integrity) {
      return {
        slot,
        manifest,
        ok: false,
        reason: `integrity mismatch for ${manifestUrl} (expected ${integrity}, computed ${computed})`,
      };
    }
    return { slot, manifest, ok: true };
  } catch (error) {
    return {
      slot,
      manifest,
      ok: false,
      reason: `manifest fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function verifyRollbackSnapshot(
  config: BosConfigInput,
  opts?: { fetchImpl?: typeof fetch },
): Promise<RollbackVerification> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const pinned = collectPinnedSlots(config).filter((entry) => pinOf(entry.ref) !== null);

  if (pinned.length === 0) {
    return { verifiable: false, ok: false, slots: [] };
  }

  const slots = await Promise.all(
    pinned.map((entry) => verifySlot(entry.slot, entry.ref, fetchImpl)),
  );
  return { verifiable: true, ok: slots.every((check) => check.ok), slots };
}

export function summarizeSlotPins(config: BosConfigInput): string {
  const pinned = collectPinnedSlots(config)
    .map((entry) => {
      const pin = pinOf(entry.ref);
      return pin ? `${entry.slot}=${pin.manifest}` : null;
    })
    .filter(Boolean) as string[];
  return pinned.length > 0 ? pinned.join(" ") : "no version pins (pre-pin snapshot)";
}

export function buildRollbackPayload<T extends Record<string, unknown>>(
  targetConfig: T,
  rolledBackFrom: string,
): T {
  return { ...targetConfig, rolledBackFrom } as T;
}
