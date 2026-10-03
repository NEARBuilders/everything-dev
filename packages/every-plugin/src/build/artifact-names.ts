import crypto from "node:crypto";
import { z } from "zod";

/** Dev-mode entry names: the in-memory dev server serves these exact names,
 * and dev consumers (the host's html shell, the compose client payload, the
 * readiness probe) append them — dev has no build report to discover hashed
 * names from. */
export const DEV_ENTRY_FILENAME = "remoteEntry.js";
export const DEV_SERVER_ENTRY_FILENAME = "remoteEntry.server.js";
/** Fixed-name build outputs that get additive immutable hashed copies. */
export const MF_MANIFEST_FILENAME = "mf-manifest.json";
export const STYLE_FILENAME = "style.css";
export const HASHED_ENTRY_PATTERN = "remoteEntry.[contenthash].js";
export const HASHED_SERVER_ENTRY_PATTERN = "remoteEntry.server.[contenthash].js";

/** The dev-stack signal: everything a dev server spawns (watch or no-watch
 * one-shot builds) serves the fixed dev entry names, because every dev
 * consumer appends them and no build report exists to discover hashed names
 * from. Every other invocation — local builds, host-test production builds,
 * regression container builds, deploys — is a build and emits content-hashed
 * entries + build reports. NODE_ENV cannot carry this decision (vitest runs
 * as "test", bundler CLIs default "production" even for dev watches), and
 * DEPLOY=true only marks deploy builds — so the dev server stamps its own
 * children. */
export function isBuildInvocation(): boolean {
  return process.env.BOS_DEV_SERVER !== "1";
}

export function uiEntryFilename(input: { isBuild: boolean; server?: boolean }): string {
  if (!input.isBuild) return input.server ? DEV_SERVER_ENTRY_FILENAME : DEV_ENTRY_FILENAME;
  return input.server ? HASHED_SERVER_ENTRY_PATTERN : HASHED_ENTRY_PATTERN;
}

const HASH_SEGMENT_PATTERN = /\.[a-f0-9]{8,}\./;

/**
 * Serving classification for bundle objects: anything whose name carries a
 * content-hash segment (including hashed entrypoints like
 * `remoteEntry.8f3a….js`) is immutable by construction; fixed-name
 * entrypoints and non-hashed files a redeploy replaces in place must
 * revalidate.
 */
export function isImmutableBundlePath(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  return HASH_SEGMENT_PATTERN.test(base);
}

export function cacheControlOf(name: string): string {
  return isImmutableBundlePath(name)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}

/** Short content hash used to mint additive hashed copies of fixed-name artifacts. */
export function contentHashOf(content: string | Uint8Array): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function hashedArtifactName(base: string, hash: string, ext: string): string {
  return `${base}.${hash}.${ext.replace(/^\./, "")}`;
}

/** Find the content-hashed entry asset for a base name ("remoteEntry", "remoteEntry.server"). */
export function findHashedEntry(assetNames: string[], base: string): string | null {
  const hashed = assetNames.find((name) => {
    const rest = name.startsWith(`${base}.`) ? name.slice(base.length + 1) : null;
    if (rest === null) return false;
    const hash = rest.slice(0, -3);
    return name.endsWith(".js") && /^[a-f0-9]{8,}$/.test(hash);
  });
  return hashed ?? null;
}

export const BuildEntryReportSchema = z.object({
  entry: z.string().min(1),
  browserManifest: z.string().min(1).optional(),
  css: z.string().min(1).optional(),
});
export type BuildEntryReport = z.infer<typeof BuildEntryReportSchema>;

export interface ArtifactCopy {
  from: string;
  to: string;
}

/**
 * The additive-copy plan for one compiled dist root: each supplied fixed-name
 * artifact gets an immutable hashed copy. The hashed entry itself needs no
 * copy — the build report carries its name to the deploy leg. Returns null
 * when the build predates hashed entry names (only fixed names emitted).
 */
export function planArtifactCopies(input: {
  assetNames: string[];
  entryBase: string;
  contents?: Record<string, string | Uint8Array | undefined>;
}): { copies: Array<ArtifactCopy>; report: BuildEntryReport } | null {
  const entry = findHashedEntry(input.assetNames, input.entryBase);
  if (!entry) return null;

  const copies: Array<ArtifactCopy> = [];
  const report: BuildEntryReport = { entry };

  const hashedCopy = (fixedName: string, reportField: "browserManifest" | "css") => {
    const content = input.contents?.[fixedName];
    if (content === undefined) return;
    const dot = fixedName.lastIndexOf(".");
    const base = fixedName.slice(0, dot);
    const ext = fixedName.slice(dot + 1);
    const hashed = hashedArtifactName(base, contentHashOf(content), ext);
    copies.push({ from: fixedName, to: hashed });
    report[reportField] = hashed;
  };
  hashedCopy(MF_MANIFEST_FILENAME, "browserManifest");
  hashedCopy(STYLE_FILENAME, "css");

  return { copies, report };
}
