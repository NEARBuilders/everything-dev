import type { BosConfigInput } from "../../types";
import { type ConfigSlot, ensureObjectContainers, walkConfigSlots } from "../config-slots";
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

/**
 * Resolve the release manifest for a deploy: the authored `platform` pin via
 * slot-first resolution (children), otherwise the latest pointer (root
 * runtimes). Returns null when no manifest is published — a normal state for
 * children pinned to pre-manifest releases. Resolution failures surface; the
 * caller warns and continues unpinned (the composition gate still
 * cross-checks the actual resolved bytes).
 */
export async function resolveReleaseManifestForDeploy(input: {
  configDir: string;
  authoredConfig: Record<string, unknown>;
  /** test/registry seam — threaded to the platform-manifest resolution */
  resolveOptions?: Partial<ResolvePlatformManifestOptions>;
}): Promise<PlatformReleaseManifest | null> {
  const resolved = await resolvePlatformManifest({
    configDir: input.configDir,
    localConfig: input.authoredConfig,
    ...input.resolveOptions,
  });
  return resolved?.manifest ?? null;
}

/** Keys that name where a slot's code comes from — owning the slot's bytes. */
const SLOT_SOURCE_KEYS = ["production", "development", "pin", "extends", "proxy"] as const;

/**
 * A slot is authored when its entry names a code source (or opts out with
 * `ui: false` / owns it via a bare plugin ref). An entry that only configures
 * an inherited slot — `variables`, `secrets`, `routes`, … — does not own its
 * bytes, so the release still pins them.
 */
function declaresSlotSource(entry: ConfigSlot["entry"]): boolean {
  if (entry === false || typeof entry === "string") return true;
  return SLOT_SOURCE_KEYS.some((key) => entry[key] !== undefined);
}

/** Authored slot paths: every slot whose code source the leaf itself declares. */
export function authoredSlotPaths(config: Record<string, unknown>): Set<string> {
  const paths = new Set<string>();
  walkConfigSlots(config, ({ slot, entry, isPluginRef }) => {
    if (declaresSlotSource(entry)) paths.add(slot);
    // KEEP: a bare-string plugin ref (`extends: "bos://…"`) owns its whole
    // surface — composed resolution derives its ui from the extended config,
    // so the ownership set must include it independently of the `ui` key.
    if (isPluginRef) paths.add(`${slot}.ui`);
  });
  return paths;
}

/** Stamped slot paths (diagnostic), in stamp order. */
export interface StampOutcome {
  stamped: string[];
}

/**
 * Stamp inherited slots: for every `app.*` slot in the release manifest's
 * `slots` map that the authored config does not author (see
 * `authoredSlotPaths` — configuring a slot is not authoring it), write the release's
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
    // KEEP: only app.* slots are stampable — a child's declared `plugins`
    // object owns the whole plugin domain in one wholesale replace
    // (mergeBosConfigWithExtends), so stamping parent plugin slots would
    // both expand the child's composed plugin set and produce
    // schema-invalid entries (the stamped ui record alone carries no
    // required `name`; the wholesale replace never fills it — the
    // feedback.nearbuilders.org rc.26 incident).
    if (!/^app\.[^.]+(\.ui)?$/.test(slotPath)) continue;
    if (authored.has(slotPath)) continue;
    stampSlotRecord(input.payload, slotPath, record);
    stamped.push(slotPath);
  }
  return { stamped };
}

/** Write `{ production, pin }` for one dotted slot path (2–3 segments),
 * merging into an existing entry rather than replacing it. */
function stampSlotRecord(
  payload: Record<string, unknown>,
  slotPath: string,
  record: ReleaseSlotRecord,
): void {
  const segments = slotPath.split(".");
  if ((segments.length !== 2 && segments.length !== 3) || !segments[1]) return;
  const leaf = segments[segments.length - 1];
  const container = ensureObjectContainers(payload, segments.slice(0, -1));
  if (!leaf) return;
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

export interface CompositionGateInput {
  configDir: string;
  authoredConfig: Record<string, unknown>;
  resolvedShape: Record<string, unknown>;
  resolvedRelease: PlatformReleaseManifest | null;
  /**
   * The slot names the leaf-payload pin verification leg proved servable;
   * an unresolvable merged-shape pin outside this set is reported as a
   * violation instead of skipped-silently (inherited pins are not covered
   * by that leg).
   */
  verifiedSlots?: ReadonlySet<string>;
  /** test seam — threaded to the version-manifest fetch */
  fetchImpl?: typeof fetch;
}

/**
 * The deploy-train composition gate: cross-compare the shared-singleton
 * versions of every pinned UI slot in the extends-merged shape (the boot
 * guard's mirror, #546), plus — for authored platform pins — the ADR 0034
 * compat check of the child against its own release. Runs after pin
 * verification, before publish.
 */
export async function runCompositionGate(
  input: CompositionGateInput,
): Promise<CompositionGateReport> {
  const violations: string[] = [
    ...(await compositionSkewViolations(input.resolvedShape, {
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.verifiedSlots ? { verifiedSlots: input.verifiedSlots } : {}),
    })),
  ];
  if (typeof input.authoredConfig.platform === "string" && input.resolvedRelease) {
    violations.push(...platformCompatViolations(input.resolvedRelease, input.configDir));
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Cross-compare each pinned UI slot's embedded shared-singleton versions. An
 * unresolvable pin the pin/SRI verification leg already proved servable is
 * skipped (transient fetch failure); any unresolvable pin outside that set is
 * reported — the boot's version-manifest derivation would refuse it anyway.
 */
export async function compositionSkewViolations(
  merged: Record<string, unknown>,
  opts: { fetchImpl?: typeof fetch; verifiedSlots?: ReadonlySet<string> } = {},
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
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        });
        for (const [name, version] of Object.entries(resolved.sharedVersions ?? {})) {
          const uses = versionsByName.get(name) ?? [];
          uses.push({ slot, version });
          versionsByName.set(name, uses);
        }
      } catch (error) {
        if (opts.verifiedSlots?.has(slot)) return;
        const reason = error instanceof Error ? error.message : String(error);
        violations.push(
          `Pinned UI slot "${slot}" version manifest does not serve at its production URL (${reason}) — ` +
            `a consumer boot cannot derive its shared singletons; investigate the storage origin or redeploy the bundle.`,
        );
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
