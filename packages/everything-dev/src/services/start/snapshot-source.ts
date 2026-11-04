/**
 * The degraded boot rung (ADR 0041, ticket 02): the registry identity is set,
 * the registry is unreachable, and an approved boot snapshot exists — boot
 * from the snapshot instead of failing, loudly and visibly. The rung applies
 * ONLY to transport failures; a definitive negative (the runtime has no
 * published config) is a state change, not an outage, and fails loud without
 * consulting the snapshot. The snapshot's own integrity is checked without
 * the network (fingerprint recomputation — `verifiedBootSnapshot`), so a
 * snapshot boot never serves bytes nobody verified.
 */
import type { BosConfig } from "../../types";
import { type BootSnapshot, verifiedBootSnapshot } from "../snapshot/schema";

export interface RegistryResolution {
  config: BosConfig;
  source: "registry" | "snapshot";
  /** Degradation and persist notes — the boot surfaces them in the start
   * summary's warnings (and the renderer prints them). */
  warnings: string[];
}

export interface RegistryConfigSourceDeps {
  /** The registry fetch. Throws on transport failure; returns null for the
   * definitive "no config published" negative. */
  fetchPublishedConfig: (
    account: string,
    gateway: string,
    registry?: string,
  ) => Promise<BosConfig | null>;
  loadSnapshot: (account: string, gateway: string, dir?: string) => Promise<BootSnapshot | null>;
  /** The writer seam: called on every registry resolution so the first
   * restart after a cold boot is covered even before any watch adopt. */
  persistSnapshot: (account: string, gateway: string, config: BosConfig) => Promise<void>;
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createRegistryConfigSource(deps: RegistryConfigSourceDeps) {
  return {
    resolve: async (input: {
      account: string;
      gateway: string;
      registry?: string;
      allowSnapshot: boolean;
      dir?: string;
    }): Promise<RegistryResolution | null> => {
      let fetched: BosConfig | null;
      try {
        fetched = await deps.fetchPublishedConfig(input.account, input.gateway, input.registry);
      } catch (fetchError) {
        if (!input.allowSnapshot) throw fetchError;
        const snapshot = await usableSnapshot(input, fetchError);
        if (!snapshot) throw fetchError;
        const tag = snapshot.manifestTag ? `, ${snapshot.manifestTag.version}` : "";
        return {
          config: snapshot.config,
          source: "snapshot",
          warnings: [
            `registry unreachable — serving the approved boot snapshot (written ${snapshot.writtenAt}${tag}); the pointer watch adopts the published config when the registry returns`,
          ],
        };
      }
      if (!fetched) return null;
      const warnings: string[] = [];
      try {
        await deps.persistSnapshot(input.account, input.gateway, fetched);
      } catch (error) {
        warnings.push(`approved-snapshot persist failed (non-fatal): ${describe(error)}`);
      }
      return { config: fetched, source: "registry", warnings };
    },
  };

  /** Absent snapshot → null (the original transport error is rethrown by the
   * caller). Corrupt or unverifiable → a combined error naming both causes. */
  async function usableSnapshot(
    input: { account: string; gateway: string; dir?: string },
    fetchError: unknown,
  ): Promise<BootSnapshot | null> {
    let loaded: BootSnapshot | null;
    try {
      loaded = await deps.loadSnapshot(input.account, input.gateway, input.dir);
    } catch (snapshotError) {
      throw new Error(bothBroken(fetchError, snapshotError));
    }
    if (!loaded) return null;
    try {
      return verifiedBootSnapshot(loaded);
    } catch (snapshotError) {
      throw new Error(bothBroken(fetchError, snapshotError));
    }
  }

  function bothBroken(fetchError: unknown, snapshotError: unknown): string {
    return `the registry is unreachable (${describe(fetchError)}), and the approved boot snapshot is unusable (${describe(snapshotError)}) — refusing to serve an unverified composition (ADR 0041; BOS_SNAPSHOT_BOOT=never disables the snapshot rung)`;
  }
}
