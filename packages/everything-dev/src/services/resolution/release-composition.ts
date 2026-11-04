import { SHARED_DEP_SPECS } from "every-plugin/shared-deps-spec";
import { resolveSlotVersion } from "../deploy/version-manifest";
import type { RemoteRecord } from "../platform/manifest";
import { ensureObjectContainers, type Remote, walkRemotes } from "../remotes";
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
const SLOT_SOURCE_KEYS = ["production", "development", "digest", "extends", "proxy"] as const;

/**
 * A slot is authored when its entry names a code source (or opts out with
 * `ui: false` / owns it via a bare plugin ref). An entry that only configures
 * an inherited slot — `variables`, `secrets`, `routes`, … — does not own its
 * bytes, so the release still pins them.
 */
function declaresSlotSource(entry: Remote["entry"]): boolean {
  if (entry === false || typeof entry === "string") return true;
  return SLOT_SOURCE_KEYS.some((key) => entry[key] !== undefined);
}

/** Authored slot paths: every slot whose code source the leaf itself declares. */
export function authoredRemoteKeys(config: Record<string, unknown>): Set<string> {
  const paths = new Set<string>();
  walkRemotes(config, ({ slot, entry, isPluginRef }) => {
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
export type CompositionMode = "payload" | "consumer";

export function stampInheritedRemotes(input: {
  config: Record<string, unknown>;
  authoredConfig: Record<string, unknown>;
  remotes: Record<string, RemoteRecord> | undefined;
  mode: CompositionMode;
}): StampOutcome {
  const remotes = input.remotes ?? {};
  const authored = authoredRemoteKeys(input.authoredConfig);
  const stamped: string[] = [];
  const omitted: string[] = [];

  for (const [slotPath, record] of Object.entries(remotes)) {
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

/** Write `{ production, digest }` for one dotted remote path (2–3 segments),
 * merging into an existing entry rather than replacing it. */
function stampSlotRecord(
  config: Record<string, unknown>,
  slotPath: string,
  record: RemoteRecord,
): void {
  const segments = slotPath.split(".");
  if ((segments.length !== 2 && segments.length !== 3) || !segments[0] || !segments[1]) return;
  const leaf = segments.at(-1);
  const container = ensureObjectContainers(config, segments.slice(0, -1));
  if (!leaf) return;
  const existing = container[leaf];
  const entry: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
  entry.production = record.base;
  entry.digest = { manifest: record.digest.manifest, integrity: record.digest.integrity };
  container[leaf] = entry;
}

export interface CompositionAuditLine {
  remote: string;
  kind: "inherited" | "owned" | "provisioned" | "uncomposed";
  message: string;
}

/**
 * The publish key an owned slot realigns through: the workspace key the
 * scoped deploy train and `bos plugin publish` understand — `app.<key>` and
 * `app.<key>.ui` publish as the app key (`ui`, `api`, …), `plugins.<id>` and
 * `plugins.<id>.ui` as the plugin id. Remote paths themselves are not keys.
 */
export function workspaceKeyOfRemote(slot: string): string {
  const [domain, key] = slot.split(".");
  return domain === "app" || domain === "plugins" ? (key ?? slot) : slot;
}

/** The repair instruction for an owned remote diverging on shared singletons:
 * app remotes republish through the scoped deploy train (they are not plugins);
 * plugin remotes through the single-plugin publish. */
function ownedRemoteRepair(slot: string): string {
  const key = workspaceKeyOfRemote(slot);
  const command = slot.startsWith("app.")
    ? `bos deploy --packages ${key}`
    : `bos plugin publish ${key}`;
  return `run ${command} (built against an older chain)`;
}

/**
 * The dev-boot chain audit (ADR 0034 + #546's shared-singleton trust):
 * every pinned remote's embedded singleton versions are compared
 * against the local workspace catalog — the same `satisfiesConstraint`
 * family the deploy-train compat-window gate speaks, so one mismatch
 * reads the same way in the train and on screen. One line per divergent
 * slot, with the repair named for its ownership: inherited →
 * `bos upgrade` (the pin trails the chain serving the remote); owned →
 * `bos plugin publish <key>` (built against an older chain). Empty out:
 * the whole composition composes coherently.
 *
 * Two composition-shape signals ride beside the version check:
 * - a config remote the pinned manifest does not record is genuinely
 *   provisioned upstream after the pin — it composes live, unpinned bytes,
 *   and `bos upgrade` claims it;
 * - a manifest remote the merged config does not compose is NOT an upgrade
 *   candidate — a child declaring its own `plugins` domain wholesale-
 *   replaces the inherited one by design, so that is an uncomposed remote
 *   note, never a "run bos upgrade" instruction (an upgrade cannot change
 *   the merged shape).
 */
export async function auditReleaseComposition(input: {
  remotes: Array<{ slot: string; base: string; digest: { manifest: string; integrity: string } }>;
  authoredPaths: Set<string>;
  /** The installed version this runtime composes for one singleton name —
   * the probe the boot guard consults too (catalog for framework names,
   * node_modules for the rest). */
  localVersionOf: (name: string) => string | undefined;
  provisionedRemotes?: readonly string[];
  /** Every slot path the merged resolved config walks (authored + inherited). */
  configRemotePaths?: readonly string[];
  /** Slot paths the pinned release manifest records. */
  manifestRemotePaths?: readonly string[];
  pinnedReleaseVersion?: string;
  /** test seam — threaded to the version-manifest fetch */
  fetchImpl?: typeof fetch;
}): Promise<CompositionAuditLine[]> {
  const lines: CompositionAuditLine[] = [];
  const strictness = new Map(SHARED_DEP_SPECS.map((spec) => [spec.name, spec.critical]));
  const manifestRemotePaths = new Set(input.manifestRemotePaths ?? []);

  for (const { slot, base, digest } of input.remotes) {
    const kind = input.authoredPaths.has(slot) ? "owned" : "inherited";
    const repair =
      kind === "owned"
        ? ownedRemoteRepair(slot)
        : "run bos upgrade (the pin trails the chain serving this slot)";
    try {
      const resolved = await resolveSlotVersion({
        base,
        digest,
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      });
      for (const [name, version] of Object.entries(resolved.sharedVersions ?? {})) {
        // Strict singletons must agree exactly (shareConfigFor: critical ⇒
        // strictVersion true); non-strict names range-coexist by design — no line.
        if (!strictness.get(name)) continue;
        const local = input.localVersionOf(name);
        if (local !== undefined && local === version) continue;
        lines.push({
          remote: slot,
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
        remote: slot,
        kind,
        message: `${slot}'s version manifest does not serve at its production URL (${reason}) — ${repair}`,
      });
    }
  }

  // Config remotes the pinned manifest does not record: genuinely provisioned
  // upstream after the pin — they compose live, unpinned bytes, so the repair
  // is a real re-pin. Inherited only (authored slots are the leaf's own
  // decision, and pinned ones are already claimed by the manifest).
  const pinnedRemotes = new Set(input.remotes.map((ref) => ref.slot));
  for (const slot of input.configRemotePaths ?? []) {
    if (
      !manifestRemotePaths.has(slot) &&
      !pinnedRemotes.has(slot) &&
      !input.authoredPaths.has(slot)
    ) {
      lines.push({
        remote: slot,
        kind: "provisioned",
        message:
          `remote "${slot}" is served by the extends chain but missing from the ` +
          `${input.pinnedReleaseVersion ?? "pinned"} release composition — it composes live, unpinned bytes; ` +
          `run bos upgrade to re-pin and claim it`,
      });
    }
  }

  for (const slot of input.provisionedRemotes ?? []) {
    lines.push({
      remote: slot,
      kind: "uncomposed",
      message:
        `remote "${slot}" is recorded in the ${input.pinnedReleaseVersion ?? "pinned"} release ` +
        `but not composed by this config — declare it in your config's app/plugins domain to compose it`,
    });
  }
  return lines;
}
