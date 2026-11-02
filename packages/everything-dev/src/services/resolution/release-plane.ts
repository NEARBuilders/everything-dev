import { type ConfigSlot, ensureObjectContainers, walkConfigSlots } from "../config-slots";
import type { ReleaseSlotRecord } from "../platform/manifest";
import { isPlainObject } from "./merge";
import { resolveSlotVersion } from "../deploy/version-manifest";
import { SHARED_DEP_SPECS } from "every-plugin/shared-deps-spec";

/**
 * The release plane (ADR 0034 amendment — release-scoped extends
 * inheritance): a platform-pinned child composes the slots the pinned
 * release recorded instead of drifting with the parent's live config
 * pointer. One implementation, two adapters: the deploy train stamps the
 * child's publish payload before it publishes, and every consumer boot
 * stamps the extends-merged shape before composition — so production, local
 * dev, and type generation all resolve the same release bytes.
 *
 * Without the plane, a root publish (rc.N+1) moves the inherited auth pin
 * while a platform-pinned child's own ui stays built against rc.N — the
 * host's shared-singleton guard (#546) refuses the composition at boot.
 */

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

/** Stamped and omitted slot paths (diagnostic), in stamp order. */
export interface StampOutcome {
  stamped: string[];
  omitted: string[];
}

/**
 * `payload` — the deploy train's publish-payload seam: `app.*` slots only,
 * created when absent (a payload's authored config may know nothing about an
 * inherited app slot; the stamp is its introduction). Creating plugin entries
 * is deliberately refused — a child's declared `plugins` object owns the
 * whole domain in one wholesale replace (`mergeBosConfigWithExtends`), so a
 * stamped plugin ui record alone carries no required `name` and the wholesale
 * replace never fills it (the feedback.nearbuilders.org rc.26 incident).
 *
 * `consumer` — every consumer boot (`bos dev`, host boot, tenant
 * resolution): `app.*` AND `plugins.*` stamp by **merging `{ production, pin
 * }` into the existing inherited entry** — schema-valid by construction (the
 * live entry already carries the slot's full shape). Nothing is created: a
 * path absent from the merged shape is a post-release provisioned slot the
 * pinned plane cannot claim, so it is omitted and reported for the dev
 * audit instead of being silently live-followed (the skew bug class).
 */
export type ReleasePlaneMode = "payload" | "consumer";

export function stampInheritedReleaseSlots(input: {
  config: Record<string, unknown>;
  authoredConfig: Record<string, unknown>;
  slots: Record<string, ReleaseSlotRecord> | undefined;
  mode: ReleasePlaneMode;
}): StampOutcome {
  const slots = input.slots ?? {};
  const authored = authoredSlotPaths(input.authoredConfig);
  const stamped: string[] = [];
  const omitted: string[] = [];

  for (const [slotPath, record] of Object.entries(slots)) {
    const isAppSlot = /^app\.[^.]+(\.ui)?$/.test(slotPath);
    if (input.mode === "payload" && !isAppSlot) continue;
    if (authored.has(slotPath)) continue;
    if (input.mode === "consumer" && !slotEntryAt(input.config, slotPath)) {
      omitted.push(slotPath);
      continue;
    }
    stampSlotRecord(input.config, slotPath, record);
    stamped.push(slotPath);
  }
  return { stamped, omitted };
}

/** The entry object at a dotted slot path (2–3 segments), if it exists. */
function slotEntryAt(
  config: Record<string, unknown>,
  slotPath: string,
): Record<string, unknown> | undefined {
  const segments = slotPath.split(".");
  if ((segments.length !== 2 && segments.length !== 3) || !segments[0] || !segments[1]) {
    return undefined;
  }
  let node: unknown = config;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(node)) return undefined;
    node = node[segment];
  }
  if (!isPlainObject(node)) return undefined;
  const leaf = segments.at(-1);
  if (leaf === undefined) return undefined;
  const entry = node[leaf];
  return isPlainObject(entry) ? entry : undefined;
}

/** Write `{ production, pin }` for one dotted slot path (2–3 segments),
 * merging into an existing entry rather than replacing it. */
function stampSlotRecord(
  config: Record<string, unknown>,
  slotPath: string,
  record: ReleaseSlotRecord,
): void {
  const segments = slotPath.split(".");
  if ((segments.length !== 2 && segments.length !== 3) || !segments[0] || !segments[1]) return;
  const leaf = segments.at(-1);
  const container = ensureObjectContainers(config, segments.slice(0, -1));
  if (!leaf) return;
  const existing = container[leaf];
  const entry: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
  entry.production = record.base;
  entry.pin = { manifest: record.pin.manifest, integrity: record.pin.integrity };
  container[leaf] = entry;
}

export interface PlaneAuditLine {
  slot: string;
  kind: "inherited" | "owned" | "provisioned";
  message: string;
}

/**
 * The dev-boot chain audit (ADR 0034 + #546's shared-singleton trust):
 * every pinned remote slot's embedded singleton versions are compared
 * against the local workspace catalog — the same `satisfiesConstraint`
 * family the deploy-train compat-window gate speaks, so one mismatch
 * reads the same way in the train and on screen. One line per divergent
 * slot, with the repair named for its ownership: inherited →
 * `bos upgrade` (the pin trails the chain serving the slot); owned →
 * `bos plugin publish <key>` (built against an older chain); provisioned
 * slots omitted from the pinned plane → inherit by upgrading. Empty out:
 * the whole plane composes coherently.
 */
export async function auditReleasePlane(input: {
  slots: Array<{ slot: string; base: string; pin: { manifest: string; integrity: string } }>;
  authoredPaths: Set<string>;
  /** The installed version this runtime composes for one singleton name —
   * the probe the boot guard consults too (catalog for framework names,
   * node_modules for the rest). */
  localVersionOf: (name: string) => string | undefined;
  provisionedSlots?: readonly string[];
  pinnedReleaseVersion?: string;
  /** test seam — threaded to the version-manifest fetch */
  fetchImpl?: typeof fetch;
}): Promise<PlaneAuditLine[]> {
  const lines: PlaneAuditLine[] = [];
  const strictness = new Map(SHARED_DEP_SPECS.map((spec) => [spec.name, spec.critical]));

  for (const { slot, base, pin } of input.slots) {
    const kind = input.authoredPaths.has(slot) ? "owned" : "inherited";
    const repair =
      kind === "owned"
        ? `run bos plugin publish ${slot.replace(/\.(ui)?$/, "")} (built against an older chain)`
        : "run bos upgrade (the pin trails the chain serving this slot)";
    try {
      const resolved = await resolveSlotVersion({
        base,
        pin,
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      });
      for (const [name, version] of Object.entries(resolved.sharedVersions ?? {})) {
        // Strict singletons must agree exactly (shareConfigFor: critical ⇒
        // strictVersion true); non-strict names range-coexist by design — no line.
        if (!strictness.get(name)) continue;
        const local = input.localVersionOf(name);
        if (local !== undefined && local === version) continue;
        lines.push({
          slot,
          kind,
          message:
            `${slot} was built against ${name}@${version}, this runtime composes ${name}@${local ?? "unknown"} — ` +
            `${repair}`,
        });
        break;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      lines.push({
        slot,
        kind,
        message: `${slot}'s version manifest does not serve at its production URL (${reason}) — ${repair}`,
      });
    }
  }

  for (const slot of input.provisionedSlots ?? []) {
    lines.push({
      slot,
      kind: "provisioned",
      message:
        `slot "${slot}" was provisioned upstream after ${input.pinnedReleaseVersion ?? "the pinned release"}` +
        ` — run bos upgrade to inherit`,
    });
  }
  return lines;
}
