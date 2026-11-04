import {
  UI_REMOTE_ENTRY_FILENAME,
  UI_REMOTE_SERVER_ENTRY_FILENAME,
} from "every-plugin/ui/manifest";
import type { BosEnv } from "../services/resolution/merge";

/**
 * The host's entry-URL EntryResolver: one pure derivation from a stamped
 * config remote to the URLs each surface loads. `RemoteEntry` is structural —
 * the version-manifest derivation (atomic-deploys 04) stamps exactly these
 * fields onto `RuntimeConfig` remotes, so they satisfy it as-is. Each surface
 * of `entryUrls` resolves (and throws) lazily — a caller reading only `ui`
 * never trips the ssr surface's resolution, and vice versa.
 */
export interface RemoteEntry {
  /** remote identity, verbatim in resolution errors */
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
  /** pin-derived hashed browser manifest — absent for local remotes, which no
   * pin derivation ever stamps (atomic-deploys 08) and the resolver drops
   * even if one were stamped */
  browserManifestUrl?: string;
  localPath?: string;
}

export interface EntryUrls {
  /** browser script src / registration entry — bustered fixed name in dev, hashed in prod */
  readonly ui: string;
  /** server container entry; undefined when the remote has no SSR coordinates */
  readonly ssr?: string;
  /** pin-derived hashed mf-manifest; undefined ⟺ local remote (atomic-deploys 08, STRUCTURAL) */
  readonly browserManifest?: string;
}

const trimBase = (value: string | undefined): string => (value ?? "").replace(/\/$/, "");

const withBuster = (url: string, buster: string | undefined): string =>
  buster ? `${url}?v=${encodeURIComponent(buster)}` : url;

function requireEntry(
  entryUrl: string | undefined,
  env: BosEnv,
  remote: string,
  surface: string,
  devFixed: string,
): string {
  if (entryUrl) return entryUrl;
  if (env === "development") return devFixed;
  throw new Error(
    `remote "${remote}" has no derived ${surface} entry — pins resolve it from the version manifest ` +
      `(the fixed dev name is development-only)`,
  );
}

function ssrEntryUrl(remote: RemoteEntry, env: BosEnv): string | undefined {
  if (remote.ssrEntryUrl) return remote.ssrEntryUrl;
  if (env === "development") {
    return remote.ssrUrl
      ? withBuster(
          `${trimBase(remote.ssrUrl)}/${UI_REMOTE_SERVER_ENTRY_FILENAME}`,
          remote.ssrIntegrity ?? remote.containerVersion,
        )
      : undefined;
  }
  if (!remote.ssrUrl) return undefined;
  throw new Error(
    `remote "${remote.name}" has no derived ssr entry — pins resolve it from the version manifest ` +
      `(the fixed dev name is development-only)`,
  );
}

export function entryUrls(remote: RemoteEntry, env: BosEnv): EntryUrls {
  const base = trimBase(remote.publicUrl ?? remote.url);
  return {
    get ui() {
      return requireEntry(
        remote.entryUrl,
        env,
        remote.name,
        "ui",
        withBuster(`${base}/${UI_REMOTE_ENTRY_FILENAME}`, remote.integrity),
      );
    },
    get ssr() {
      return ssrEntryUrl(remote, env);
    },
    get browserManifest() {
      return remote.localPath ? undefined : remote.browserManifestUrl;
    },
  };
}
