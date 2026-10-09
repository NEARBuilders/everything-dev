import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { collectSlotPinRefs } from "./rollback";
import type { DistFile } from "./storage-upload";
import type { BosConfigInput } from "./types";

/**
 * Differential bundle uploads (skip-unchanged): the previous deploy's version
 * manifest carries the dist's full per-file SRI map (`files`), so the next
 * deploy hashes its local dist, diffs against that map, and re-uploads only
 * new or changed files. Content-hashed dist filenames make an unchanged chunk
 * byte-identical, so a typical redeploy ships a handful of files instead of
 * the whole tree.
 *
 * Correctness: a skip requires (path, sha384) to match the previous
 * **server-computed** SRI map — client hashes decide only what to skip; the
 * published manifest keeps carrying the server-computed values. Any failure
 * to resolve the previous map (no pointer, fetch failed, SRI mismatch, manifest
 * predates `files`) degrades to a full upload.
 */

export interface PreviousPin {
  manifest: string;
  integrity: string;
}

export interface DeployStateFile {
  version: 1;
  /** key: `<account>/<gateway>`, then workspace key → pin */
  apps: Record<string, Record<string, PreviousPin>>;
}

export const BUNDLE_BASE_PATTERN = /\/bundles\/([^/]+)\/([^/]+)\/([^/]+)\/$/;

export function workspaceKeyOfBase(base: string): string | null {
  const match = BUNDLE_BASE_PATTERN.exec(`${base.replace(/\/$/, "")}/`);
  return match ? match[3]! : null;
}

/** The sha384 SRI the storage route would compute for these bytes. */
export function localObjectIntegrity(bytes: Uint8Array): string {
  return `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
}

export function localSriMap(files: DistFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.path, localObjectIntegrity(file.bytes)]));
}

const deployStatePath = (configDir: string) => join(configDir, ".bos", "deploy-state.json");

export function readDeployState(configDir: string): DeployStateFile {
  const path = deployStatePath(configDir);
  if (!existsSync(path)) return { version: 1, apps: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DeployStateFile>;
    if (parsed.version !== 1 || typeof parsed.apps !== "object" || parsed.apps === null) {
      return { version: 1, apps: {} };
    }
    return { version: 1, apps: parsed.apps as DeployStateFile["apps"] };
  } catch {
    return { version: 1, apps: {} };
  }
}

export function writeDeployState(configDir: string, state: DeployStateFile): void {
  const path = deployStatePath(configDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function upsertDeployStatePins(
  configDir: string,
  account: string,
  gateway: string,
  pins: Record<string, PreviousPin>,
): void {
  const state = readDeployState(configDir);
  const appKey = `${account}/${gateway}`;
  state.apps[appKey] = { ...(state.apps[appKey] ?? {}), ...pins };
  writeDeployState(configDir, state);
}

/** Previous pins by workspace key, from the local deploy-state pointer. */
export function pinsFromDeployState(
  configDir: string,
  account: string,
  gateway: string,
): Record<string, PreviousPin> {
  return readDeployState(configDir).apps[`${account}/${gateway}`] ?? {};
}

/** Previous pins by workspace key, from the published config's slot pins. */
export function pinsFromPublishedConfig(
  config: BosConfigInput,
  account: string,
  gateway: string,
): Record<string, PreviousPin> {
  const pins: Record<string, PreviousPin> = {};
  for (const ref of collectSlotPinRefs(config)) {
    const workspace = workspaceKeyOfBase(ref.base);
    const nsMatch = BUNDLE_BASE_PATTERN.exec(`${ref.base.replace(/\/$/, "")}/`);
    if (!workspace || !nsMatch || nsMatch[1] !== account || nsMatch[2] !== gateway) continue;
    pins[workspace] = ref.pin;
  }
  return pins;
}

export interface WorkspaceDiff {
  /** files that must be uploaded (new or changed) */
  upload: DistFile[];
  /** number of files skipped because the previous manifest holds identical bytes */
  skipped: number;
}

export function diffWorkspaceFiles(
  files: DistFile[],
  localSri: Record<string, string>,
  prevFiles: Record<string, string>,
): WorkspaceDiff {
  const upload: DistFile[] = [];
  let skipped = 0;
  for (const file of files) {
    if (prevFiles[file.path] !== undefined && prevFiles[file.path] === localSri[file.path]) {
      skipped += 1;
      continue;
    }
    upload.push(file);
  }
  return { upload, skipped };
}

/**
 * The manifest's merged per-file map for this deploy: uploaded files carry the
 * server-computed SRI from the upload response; skipped files carry the
 * previous manifest's server-computed SRI (byte-identical to the local hash by
 * the skip decision). Files that left the dist carry nothing.
 */
export function mergedFileIntegrity(
  files: DistFile[],
  uploadedIntegrity: Record<string, string>,
  prevFiles: Record<string, string> | undefined,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of files) {
    const uploaded = uploadedIntegrity[file.path];
    if (uploaded) {
      merged[file.path] = uploaded;
      continue;
    }
    const carried = prevFiles?.[file.path];
    if (carried) merged[file.path] = carried;
  }
  return merged;
}
