/**
 * The platform release manifest (ADR 0034) — schema, composer, inventory,
 * registry key helpers, and the compat check. One composer feeds both publish
 * homes (FastKV pointer slot + in-image staging); the image digest is
 * deliberately absent — it derives from the tags at deploy preflight. The
 * homes' one known divergence is the compat floor: publisher-side (previous
 * release) in FastKV, own version — failing closed — in the image, which
 * cannot read the registry inside the build.
 *
 * Resolution (the machine) and the cache live in `registry/resolution.ts` and
 * `registry/cache.ts`; the service below re-exposes the resolver through the
 * machine's compatibility adapter.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Context, Layer } from "effect";
import {
  SHARED_DEP_SPECS,
  type SharedDependencyConfig,
  shareConfigFor,
} from "every-plugin/shared-deps-spec";
import { glob } from "glob";
import { compareSemver, satisfiesConstraint } from "../../utils/semver";
import { resolvePlatformManifest } from "../registry/resolution";
import { AGENT_SYNC_GLOBS, FRAMEWORK_OWNED_SYNC_FILES } from "../scaffold/ownership";

export type {
  PlatformManifestCache,
  ResolvedPlatformManifest,
} from "../registry/resolution";
export {
  type ResolvePlatformManifestOptions,
  resolvePlatformManifest,
  walkExtendsChain,
} from "../registry/resolution";
export { type PlatformReleaseManifest, PlatformReleaseManifestSchema } from "./manifest-schema";

import { type PlatformReleaseManifest, PlatformReleaseManifestSchema } from "./manifest-schema";

/** One recorded release slot (see {@link PlatformReleaseManifestSchema.slots}). */
export interface ReleaseSlotRecord {
  base: string;
  pin: { manifest: string; integrity: string };
}

export interface TemplateInventoryEntry {
  path: string;
  sha256: string;
}

export function getPlatformManifestKey(accountId: string, gatewayId: string): string {
  return `apps/${accountId}/${gatewayId}/platform.json`;
}

/** The immutable per-release slot (#573): one key per released framework
 * version, written once, never mutated — a divergent republish is a burned
 * version and fails loud. `platform.json` remains the moving pointer; slot-
 * first resolution (#574) reads slots directly. */
export function getPlatformVersionSlotKey(
  accountId: string,
  gatewayId: string,
  version: string,
): string {
  return `apps/${accountId}/${gatewayId}/platform-versions/${version}.json`;
}

/**
 * The template-source file set a release inventory hashes: the ownership
 * inventory's static paths, the agent-sync globs, and the per-plugin template
 * scaffolding (`plugins/_template/*` — the sources of the per-plugin sync
 * patterns). Files absent from the release source are skipped, mirroring
 * sync's transitional tolerance.
 */
const TEMPLATE_SCAFFOLD_SOURCES = [
  "plugins/_template/rspack.config.js",
  "plugins/_template/tsconfig.json",
  "plugins/_template/tests/types.d.ts",
];

function templateSourcePaths(sourceDir: string): string[] {
  const paths = new Set<string>([...FRAMEWORK_OWNED_SYNC_FILES, ...TEMPLATE_SCAFFOLD_SOURCES]);
  for (const match of glob.sync(AGENT_SYNC_GLOBS, {
    cwd: sourceDir,
    nodir: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.bos/**"],
  })) {
    paths.add(relative(sourceDir, join(sourceDir, match)));
  }
  return [...paths].sort();
}

export function computeTemplateInventory(sourceDir: string): TemplateInventoryEntry[] {
  const inventory: TemplateInventoryEntry[] = [];
  for (const relativeFilePath of templateSourcePaths(sourceDir)) {
    const fullPath = join(sourceDir, relativeFilePath);
    if (!existsSync(fullPath)) continue;
    try {
      const content = readFileSync(fullPath);
      inventory.push({
        path: relativeFilePath,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    } catch {
      // unreadable at compose time → not part of the release inventory
    }
  }
  return inventory.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function composeSharedDepsFromCatalog(
  catalog: Record<string, string>,
): Record<string, SharedDependencyConfig> {
  const deps: Record<string, SharedDependencyConfig> = {};
  for (const spec of SHARED_DEP_SPECS) {
    const version = catalog[spec.name];
    if (!version) continue;
    deps[spec.name] = { version, ...shareConfigFor(spec, version) };
  }
  return deps;
}

export interface ComposePlatformReleaseManifestInputs {
  frameworkVersion: string;
  everyPluginVersion: string;
  gitSha?: string;
  imageRef: string;
  catalog: Record<string, string>;
  templateInventory: TemplateInventoryEntry[];
  compatMinChild: string;
  /** The release's own slot-pin map — sorted here so identical payloads
   * compose identical manifest bytes across machines (the burned-version
   * guard compares serialized bytes). */
  slots?: Record<string, ReleaseSlotRecord>;
}

export function composePlatformReleaseManifest(
  inputs: ComposePlatformReleaseManifestInputs,
): PlatformReleaseManifest {
  // The manifest carries only the derivable tag — the exact version tag the
  // tag scheme pushes for semver releases (ADR 0021). Sha-tags are git facts
  // an image build cannot see; derivation (`ref@v<version>` → digest) keys off
  // the version tag so both publish homes stay byte-identical without any
  // build-context plumbing.
  const semver = parseSemver(inputs.frameworkVersion.trim());
  const tags = semver
    ? [
        `v${semver.major}.${semver.minor}.${semver.patch}${semver.prerelease ? `-${semver.prerelease}` : ""}`,
      ]
    : [];
  const slots = inputs.slots
    ? Object.fromEntries(Object.entries(inputs.slots).sort(([a], [b]) => (a < b ? -1 : 1)))
    : undefined;
  return PlatformReleaseManifestSchema.parse({
    schemaVersion: 1,
    kind: "everything-dev/platform-manifest",
    frameworkVersion: inputs.frameworkVersion,
    everyPluginVersion: inputs.everyPluginVersion,
    ...(inputs.gitSha ? { gitSha: inputs.gitSha } : {}),
    image: { ref: inputs.imageRef, tags },
    catalog: inputs.catalog,
    sharedDeps: composeSharedDepsFromCatalog(inputs.catalog),
    templateInventory: inputs.templateInventory,
    compat: { minChild: inputs.compatMinChild },
    ...(slots ? { slots } : {}),
  });
}

/** The one serializer for both publish homes — byte-identical by construction. */
export function serializePlatformReleaseManifest(manifest: PlatformReleaseManifest): string {
  return JSON.stringify(manifest);
}

/**
 * The in-image copy (ADR 0034 pt 1): generated inside the docker build at
 * `packages/everything-dev/dist/platform-manifest.json`. Resolved relative to
 * this module — the compiled layout is `<pkg>/dist/services/platform/manifest.mjs`
 * (two directory levels up = `<pkg>/dist/`), the source layout is
 * `<pkg>/src/services/platform/manifest.ts` (four levels up = the pnpm parent
 * dir, then `<pkg>/dist/`). Both candidates are tried; absent or unparsable →
 * null.
 */
export function readInImagePlatformManifest(): PlatformReleaseManifest | null {
  const moduleFile = fileURLToPath(import.meta.url);
  const candidates = [
    join(moduleFile, "..", "..", "platform-manifest.json"),
    join(moduleFile, "..", "..", "..", "..", "dist", "platform-manifest.json"),
  ];
  for (const path of candidates) {
    try {
      return PlatformReleaseManifestSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
    } catch {
      // try the next layout candidate
    }
  }
  return null;
}

function parseSemver(
  version: string,
): { major: number; minor: number; patch: number; prerelease?: string } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] ? { prerelease: match[4] } : {}),
  };
}

export interface PlatformCompatSubject {
  /** The child's recorded platform pin / installed framework version. */
  platformVersion?: string;
  catalog: Record<string, string>;
}

export interface PlatformCompatViolation {
  kind: "minChild" | "shared-dep";
  name?: string;
  message: string;
}

/**
 * The additive compat gate (ADR 0034 pt 5): the child's framework version must
 * sit inside the release's compat window, and strict singletons must agree
 * exactly with the release's pins. A sibling of the federation check — never
 * a relaxation of it.
 */
export function checkPlatformCompat(
  manifest: PlatformReleaseManifest,
  subject: PlatformCompatSubject,
): PlatformCompatViolation[] {
  const violations: PlatformCompatViolation[] = [];

  if (subject.platformVersion) {
    if (compareSemver(subject.platformVersion, manifest.compat.minChild) < 0) {
      violations.push({
        kind: "minChild",
        message: `platform ${subject.platformVersion} is older than this release's compat floor ${manifest.compat.minChild}`,
      });
    }
    if (compareSemver(subject.platformVersion, manifest.frameworkVersion) > 0) {
      violations.push({
        kind: "minChild",
        message: `platform ${subject.platformVersion} is newer than this release ${manifest.frameworkVersion}`,
      });
    }
  }

  for (const [name, pin] of Object.entries(manifest.sharedDeps)) {
    const childVersion = subject.catalog[name];
    if (pin.strictVersion) {
      if (!childVersion) {
        violations.push({
          kind: "shared-dep",
          name,
          message: `strict singleton "${name}" is missing from the child catalog (release pins ${pin.version})`,
        });
        continue;
      }
      if (childVersion !== pin.version) {
        violations.push({
          kind: "shared-dep",
          name,
          message: `strict singleton "${name}" is ${childVersion}, the release pins ${pin.version}`,
        });
      }
      continue;
    }
    if (typeof pin.requiredVersion === "string" && childVersion) {
      if (!satisfiesConstraint(childVersion, pin.requiredVersion)) {
        violations.push({
          kind: "shared-dep",
          name,
          message: `"${name}" is ${childVersion}, which does not satisfy the release range ${pin.requiredVersion}`,
        });
      }
    }
  }

  return violations;
}

/**
 * The platform release manifest as a Context.Service: the same "module is
 * the implementation, the tag is the seam" shape as FastKVRegistryService —
 * CLI handlers `yield*` the tag; pure and standalone callers keep using the
 * plain functions. Tests provide `Layer.succeed` fakes instead of module
 * mocks. Resolution comes from `registry/resolution.ts` (the machine's
 * compatibility adapter).
 */
export class PlatformManifestService extends Context.Service<
  PlatformManifestService,
  {
    resolvePlatformManifest: typeof resolvePlatformManifest;
    composePlatformReleaseManifest: typeof composePlatformReleaseManifest;
    checkPlatformCompat: typeof checkPlatformCompat;
    readInImagePlatformManifest: typeof readInImagePlatformManifest;
  }
>()("everything-dev/platform/manifest") {
  static readonly Live = Layer.succeed(
    this,
    this.of({
      resolvePlatformManifest,
      composePlatformReleaseManifest,
      checkPlatformCompat,
      readInImagePlatformManifest,
    }),
  );
}

/**
 * The child-side upgrade-path line (`.scratch/catalog-drift/issues/05`):
 * when the resolved chain head is a NEWER release than this runtime's
 * authored pin, the runtime is servable-but-behind — the dev boot surfaces
 * the upgrade instead of waiting for a load-time skew to explain it. Empty
 * (no notice) when either side is unknown, or the pin is current-or-ahead.
 * Never reads npm: the FastKV pointer only advances when the parent's
 * release leg completed, so "pin trails pointer" already implies "the
 * chain is servable right now" — no transient mid-train state leaks in.
 */
export function chainHeadPinLagNotice(
  headFrameworkVersion: string | undefined,
  authoredPlatformPin: string | undefined,
): string | undefined {
  if (!headFrameworkVersion || !authoredPlatformPin) return undefined;
  if (compareSemver(headFrameworkVersion, authoredPlatformPin) <= 0) return undefined;
  return (
    `platform upgrade for this runtime: the chain head advanced to ${headFrameworkVersion}, ` +
    `this runtime pins ${authoredPlatformPin} — run bos upgrade; until then the pinned release ` +
    `keeps resolving the older chain`
  );
}
