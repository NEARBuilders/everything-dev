import { type ConfigSlot, ensureObjectContainers, walkConfigSlots } from "../config-slots";
import type { ReleaseSlotRecord } from "../platform/manifest";
import { isPlainObject } from "./merge";

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
  if ((segments.length !== 2 && segments.length !== 3) || !segments[1]) return undefined;
  let node: unknown = config;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(node)) return undefined;
    node = node[segment];
  }
  if (!isPlainObject(node)) return undefined;
  const leaf = segments[segments.length - 1];
  return isPlainObject(node[leaf]) ? (node[leaf] as Record<string, unknown>) : undefined;
}

/** Write `{ production, pin }` for one dotted slot path (2–3 segments),
 * merging into an existing entry rather than replacing it. */
function stampSlotRecord(
  config: Record<string, unknown>,
  slotPath: string,
  record: ReleaseSlotRecord,
): void {
  const segments = slotPath.split(".");
  if ((segments.length !== 2 && segments.length !== 3) || !segments[1]) return;
  const leaf = segments[segments.length - 1];
  const container = ensureObjectContainers(config, segments.slice(0, -1));
  if (!leaf) return;
  const existing = container[leaf];
  const entry: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
  entry.production = record.base;
  entry.pin = { manifest: record.pin.manifest, integrity: record.pin.integrity };
  container[leaf] = entry;
}
