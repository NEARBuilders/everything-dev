import type { BosConfigInput } from "../../types";
import { readInstalledFrameworkVersion } from "../framework-version";
import {
  checkPlatformCompat,
  type PlatformReleaseManifest,
  type ReleaseSlotRecord,
  type ResolvePlatformManifestOptions,
  resolvePlatformManifest,
} from "../platform/manifest";
import { isPlainObject } from "../resolution/merge";
import { readWorkspaceCatalog } from "../workspace/catalog";
import { findWorkspaceRoot } from "../workspace/workspace";
import { collectSlotPinRefs } from "./rollback";
import { resolveSlotVersion } from "./version-manifest";

/**
 * The deploy train's composition plane (ADR 0034 amendment — release-scoped
 * extends inheritance): every remote slot the leaf does not author is a
 * base-runtime slot, and its bytes must come from the child's pinned release
 * instead of drifting with the parent's live config pointer.
 *
 * Without this plane, a root publish (rc.N+1) moves the inherited auth pin
 * while a platform-pinned child's own ui stays built against rc.N — the
 * host's shared-singleton guard (#546) refuses the composition at boot and
 * the child's health degrades after its next redeploy. Two layers close it:
 * the release manifest records its own slot-pin map (the `slots` field,
 * composed on the release leg), and the deploy train stamps those pins onto
 * the inherited slots of the child's publish payload — child-wins over the
 * parent's live pointer at every consumer boot.
 */

export interface ResolvedReleaseManifest {
  manifest: PlatformReleaseManifest;
}

/**
 * Resolve the release manifest for a deploy: the authored `platform` pin via
 * slot-first resolution (children), otherwise the latest pointer (root runtimes).
 * Returns null when no manifest is published; null is a normal state for
 * children pinned to pre-manifest releases. Resolution failures surface — the
 * caller warns and continues unpinned (the composition gate still cross-checks
 * the actual resolved bytes).
 */
export async function resolveReleaseManifestForDeploy(input: {
  configDir: string;
  authoredConfig: Record<string, unknown>;
  /** test/registry seam — threaded to the platform-manifest resolution */
  resolveOptions?: Partial<ResolvePlatformManifestOptions>;
}): Promise<ResolvedReleaseManifest | null> {
  const resolved = await resolvePlatformManifest({
    configDir: input.configDir,
    localConfig: input.authoredConfig,
    ...input.resolveOptions,
  });
  return resolved ? { manifest: resolved.manifest } : null;
}

/** Authored slot paths: every remote slot the leaf itself declares (extracted or null). */
export function authoredSlotPaths(config: Record<string, unknown>): Set<string> {
  const paths = new Set<string>();
  const app = config.app;
  if (isPlainObject(app)) {
    for (const [key, entry] of Object.entries(app)) {
      if (isPlainObject(entry)) {
        paths.add(`app.${key}`);
        if ("ui" in (entry as object)) paths.add(`app.${key}.ui`);
      }
    }
  }
  const plugins = config.plugins;
  if (isPlainObject(plugins)) {
    for (const [id, entry] of Object.entries(plugins)) {
      if (typeof entry === "string" && entry.length > 0) {
        paths.add(`plugins.${id}`);
        paths.add(`plugins.${id}.ui`);
        continue;
      }
      if (isPlainObject(entry)) {
        paths.add(`plugins.${id}`);
        if ("ui" in (entry as object)) paths.add(`plugins.${id}.ui`);
      }
    }
  }
  return paths;
}

/** Stamped slot paths (diagnostic), in stamp order. */
export interface StampOutcome {
  stamped: string[];
}

/**
 * Layer 2 — stamp inherited slots: for every slot in the release manifest's
 * `slots` map that the authored config does not declare, write the release's
 * recorded production URL + pin into the payload. Child-wins deep merge then
 * shadows the parent's live config pointer at every consumer boot, so the
 * child composes exactly the bytes its pinned release published. Slots the
 * child authors stay untouched, and a manifest without `slots` (pre-amendment
 * releases) stamps nothing — the composition gate covers those children.
 */
export function stampInheritedSlotsFromRelease(input: {
  payload: Record<string, unknown>;
  authoredConfig: Record<string, unknown>;
  manifest: PlatformReleaseManifest;
}): StampOutcome {
  const slots = input.manifest.slots ?? {};
  const authored = authoredSlotPaths(input.authoredConfig);
  const stamped: string[] = [];

  for (const [slotPath, record] of Object.entries(slots)) {
    if (authored.has(slotPath)) continue;
    stampSlotRecord(input.payload, slotPath, record);
    stamped.push(slotPath);
  }
  return { stamped };
}

/** Write `{ production, pin }` for one dotted slot path, creating containers. */
function stampSlotRecord(
  payload: Record<string, unknown>,
  slotPath: string,
  record: ReleaseSlotRecord,
): void {
  const segments = slotPath.split(".");
  if ((segments.length !== 2 && segments.length !== 3) || !segments[1]) return;
  let container: Record<string, unknown> = payload;
  for (const segment of segments.slice(0, -1)) {
    const next = container[segment];
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {};
      container[segment] = created;
      container = created;
    } else {
      container = next;
    }
  }
  const leaf = segments[segments.length - 1];
  const existing = container[leaf];
  const entry: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
  entry.production = record.base;
  entry.pin = { manifest: record.pin.manifest, integrity: record.pin.integrity };
  container[leaf] = entry;
}

export interface CompositionGateReport {
  ok: boolean;
  violations: string[];
}

/**
 * Layer 1 — the deploy-train composition gate: cross-compare the shared-single
 * versions of every pinned UI slot in the extends-merged shape (the deploy's
 * mirror of the host's boot guard, #546), plus — for authored platform pins —
 * the ADR 0034 compat check of the child against its own release. Runs after
 * pin verification, before publish.
 */
export async function runCompositionGate(input: {
  configDir: string;
  authoredConfig: Record<string, unknown>;
  resolvedShape: Record<string, unknown>;
  resolvedRelease: ResolvedReleaseManifest | null;
  /** test seam — threaded to the version-manifest fetch */
  fetchImpl?: typeof fetch;
}): Promise<CompositionGateReport> {
  const violations: string[] = [
    ...(await compositionSkewViolations(input.resolvedShape, input.fetchImpl)),
  ];
  if (typeof input.authoredConfig.platform === "string" && input.resolvedRelease) {
    violations.push(...platformCompatViolations(input.resolvedRelease.manifest, input.configDir));
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Cross-compare each pinned UI slot's embedded shared-singleton versions.
 * Slots whose pin does not resolve are skipped — the pin/SRI verification
 * already refused broken pins this train.
 */
export async function compositionSkewViolations(
  merged: Record<string, unknown>,
  fetchImpl?: typeof fetch,
): Promise<string[]> {
  const uiSlots = collectSlotPinRefs(merged as BosConfigInput).filter(
    (ref) => ref.slot === "app.ui" || ref.slot.endsWith(".ui"),
  );
  if (uiSlots.length === 0) return [];

  const versionsByName = new Map<string, Array<{ slot: string; version: string }>>();
  const violations: string[] = [];

  await Promise.all(
    uiSlots.map(async ({ slot, base, pin }) => {
      try {
        const resolved = await resolveSlotVersion({
          base,
          pin,
          ...(fetchImpl ? { fetchImpl } : {}),
        });
        for (const [name, version] of Object.entries(resolved.sharedVersions ?? {})) {
          const uses = versionsByName.get(name) ?? [];
          uses.push({ slot, version });
          versionsByName.set(name, uses);
        }
      } catch {
        // a pin that cannot resolve is either already rejected by the pin
        // verification leg or not a UI-skew concern — skip
      }
    }),
  );

  for (const [name, uses] of versionsByName) {
    const first = uses[0];
    if (!first) continue;
    const diverged = uses.find((use) => use.version !== first.version);
    if (!diverged) continue;
    violations.push(
      `Shared singleton "${name}" skew across UI sources: "${first.slot}" was built against ` +
        `${first.version}, "${diverged.slot}" against ${diverged.version} — the composition refuses to load ` +
        `a split module graph. Redeploy the older bundle: \`bos upgrade\` realigns the platform pin, ` +
        `\`bos deploy\` rebuilds against it (issue #546).`,
    );
  }
  return violations;
}

/**
 * The ADR 0034 compat check, scoping the child's installed framework version
 * and workspace catalog against its OWN pinned release — a child resolving
 * via slot-first never fails for being older than the parent's latest.
 */
export function platformCompatViolations(
  manifest: PlatformReleaseManifest,
  configDir: string,
): string[] {
  const root = findWorkspaceRoot(configDir)?.dir ?? configDir;
  const violations = checkPlatformCompat(manifest, {
    platformVersion: readInstalledFrameworkVersion(configDir, "everything-dev"),
    catalog: readWorkspaceCatalog(root),
  });
  return violations.map(
    (violation) =>
      `${violation.message} — run \`bos upgrade\` to realign your platform pin with \`bos deploy\``,
  );
}
