import {
  UI_REMOTE_ENTRY_FILENAME,
  UI_REMOTE_SERVER_ENTRY_FILENAME,
} from "every-plugin/ui/manifest";
import type { BosEnv } from "../merge";

/**
 * The host's entry-URL SlotResolver: one pure derivation from a stamped
 * config slot to the URLs each surface loads. `EntrySlot` is structural —
 * the version-manifest derivation (atomic-deploys 04) stamps exactly these
 * fields onto `RuntimeConfig` slots, so they satisfy it as-is. Each surface
 * of `entryUrls` resolves (and throws) lazily — a caller reading only `web`
 * never trips the ssr surface's resolution, and vice versa.
 */
export interface EntrySlot {
  /** slot identity, verbatim in resolution errors */
  name: string;
  url?: string;
  /** browser-facing base (ADR 0011) — the base rule is publicUrl ?? url, inside this module */
  publicUrl?: string;
  /** pin-derived hashed browser entry (absent in development) */
  entryUrl?: string;
  ssrUrl?: string;
  /** pin-derived hashed SSR entry */
  ssrEntryUrl?: string;
  integrity?: string;
  ssrIntegrity?: string;
  /** dev-only freshness token (localUiRemoteEntry's container mtime) */
  containerVersion?: string;
  /** pin-derived hashed browser manifest — absent for local slots, which no
   * pin derivation ever stamps (atomic-deploys 08) and the resolver drops
   * even if one were stamped */
  browserManifestUrl?: string;
  localPath?: string;
}

export interface EntryUrls {
  /** browser script src / registration entry — bustered fixed name in dev, hashed in prod */
  readonly web: string;
  /** server container entry; undefined when the slot has no SSR coordinates */
  readonly ssr?: string;
  /** pin-derived hashed mf-manifest; undefined ⟺ local slot (atomic-deploys 08, STRUCTURAL) */
  readonly browserManifest?: string;
}

const trimBase = (value: string | undefined): string => (value ?? "").replace(/\/$/, "");

const withBuster = (url: string, buster: string | undefined): string =>
  buster ? `${url}?v=${encodeURIComponent(buster)}` : url;

function requireEntry(
  entryUrl: string | undefined,
  env: BosEnv,
  slot: string,
  surface: string,
  devFixed: string,
): string {
  if (entryUrl) return entryUrl;
  if (env === "development") return devFixed;
  throw new Error(
    `slot "${slot}" has no derived ${surface} entry — pins resolve it from the version manifest ` +
      `(the fixed dev name is development-only)`,
  );
}

function ssrEntryUrl(slot: EntrySlot, env: BosEnv): string | undefined {
  if (slot.ssrEntryUrl) return slot.ssrEntryUrl;
  if (env === "development") {
    return slot.ssrUrl
      ? withBuster(
          `${trimBase(slot.ssrUrl)}/${UI_REMOTE_SERVER_ENTRY_FILENAME}`,
          slot.ssrIntegrity ?? slot.containerVersion,
        )
      : undefined;
  }
  if (!slot.ssrUrl) return undefined;
  throw new Error(
    `slot "${slot.name}" has no derived ssr entry — pins resolve it from the version manifest ` +
      `(the fixed dev name is development-only)`,
  );
}

export function entryUrls(slot: EntrySlot, env: BosEnv): EntryUrls {
  const base = trimBase(slot.publicUrl ?? slot.url);
  return {
    get web() {
      return requireEntry(
        slot.entryUrl,
        env,
        slot.name,
        "web",
        withBuster(`${base}/${UI_REMOTE_ENTRY_FILENAME}`, slot.integrity),
      );
    },
    get ssr() {
      return ssrEntryUrl(slot, env);
    },
    get browserManifest() {
      return slot.localPath ? undefined : slot.browserManifestUrl;
    },
  };
}
