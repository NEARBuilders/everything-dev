import type { BosConfigInput } from "../../types";
import { remoteDigests } from "../registry/digest";
import { walkRemotes } from "../remotes";

/**
 * The published-config diff the post-publish legs decide on (#826 follow-up):
 * a deploy that touches only SnapshotWatch-adopted surfaces — the ui slot,
 * folder-form plugin ui overrides — needs no host restart, so the Railway
 * leg skips and the soft-refresh banner carries the adoption. Everything
 * else (api/auth/plugin backends, any non-remote config change) is
 * boot-frozen and keeps the redeploy. Uncertainty reads cold: the worst case
 * is an unnecessary restart, never a missed one.
 */

export interface PublishedDiff {
  /** remote keys whose digest pin moved (added, removed, or re-pinned) */
  changedRemotes: string[];
  /** any published-config change outside the remote digest coordinates */
  configChanged: boolean;
}

/** Surfaces the running host adopts without a process restart. */
export function isHotRemote(remote: string): boolean {
  return remote === "app.ui" || /^plugins\.[^.]+\.ui$/.test(remote);
}

export function isUiOnlyDiff(diff: PublishedDiff): boolean {
  return (
    !diff.configChanged && diff.changedRemotes.length > 0 && diff.changedRemotes.every(isHotRemote)
  );
}

/** Key-sorted JSON so two serializations of the same document compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .sort()
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Deep clone with every remote's `digest` pin removed — the volatile
 * coordinates the hot/cold classification excludes from the body compare. */
function withoutRemoteDigests(config: BosConfigInput): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(config ?? {})) as Record<string, unknown>;
  walkRemotes(clone, ({ entry }) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      delete (entry as Record<string, unknown>).digest;
    }
  });
  return clone;
}

export function classifyPublishedDiff(
  previous: BosConfigInput | null,
  next: BosConfigInput,
): PublishedDiff {
  const previousRemotes = previous ? remoteDigests(previous as never) : {};
  const nextRemotes = remoteDigests(next as never);
  const changedRemotes = Object.keys(previousRemotes)
    .concat(Object.keys(nextRemotes))
    .filter((remote, index, all) => all.indexOf(remote) === index)
    .filter((remote) => previousRemotes[remote] !== nextRemotes[remote])
    .sort();
  const configChanged = previous
    ? canonical(withoutRemoteDigests(previous)) !== canonical(withoutRemoteDigests(next))
    : true;
  return { changedRemotes, configChanged };
}
