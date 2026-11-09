import { createHash } from "node:crypto";
import { WorkspaceVersionManifestSchema } from "every-plugin/version-manifest";
import type { BosConfigInput } from "../../types";
import { ManifestTagSchema } from "../platform/manifest-schema";
import { parseRuntimeRef } from "../registry/keys";
import { readManifestTag } from "../registry/pointer";
import { computeManifestSri, manifestDocumentUrl } from "./manifest-verify";
import { collectRemoteDescriptors, type RemoteDescriptor } from "./rollback";

/**
 * The pin→bytes proof (#826 drift alarm, the 061 `bos verify` core): for
 * every pinned remote, SRI-verify the pinned version manifest document, then
 * hash every file the manifest's `files` map names against the bytes the CDN
 * serves — the manual curl+sha384 sweep, automated. A published pin that no
 * longer resolves byte-for-byte is the mixed-build rot that killed pinned
 * children; this names the file instead of a webpack TypeError.
 */

export interface VerifyFileMismatch {
  file: string;
  expected: string;
  actual?: string;
  error?: string;
}

export interface VerifyRemoteResult {
  remote: string;
  base: string;
  manifest: string;
  manifestOk: boolean;
  manifestReason?: string;
  /** the immutable version directory the pin resolves into (absent on legacy pins) */
  dir?: string;
  legacy: boolean;
  filesChecked: number;
  mismatches: VerifyFileMismatch[];
}

export interface VerifyReport {
  remotes: VerifyRemoteResult[];
}

const sha384Of = (bytes: Uint8Array): string =>
  `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

const fileBaseOf = (base: string, dir: string | undefined): string =>
  dir ? `${base.replace(/\/$/, "")}/${dir}` : base.replace(/\/$/, "");

const VERIFY_CONCURRENCY = 8;

/** Verify one pinned remote: manifest document SRI, then every file it names. */
async function verifyRemotePin(
  descriptor: RemoteDescriptor,
  fetchImpl: typeof fetch,
): Promise<VerifyRemoteResult> {
  const manifestUrl = manifestDocumentUrl(descriptor.base, descriptor.digest.manifest);
  const result: VerifyRemoteResult = {
    remote: descriptor.remote,
    base: descriptor.base,
    manifest: descriptor.digest.manifest,
    manifestOk: false,
    legacy: true,
    filesChecked: 0,
    mismatches: [],
  };

  let text: string;
  try {
    const response = await fetchImpl(manifestUrl);
    if (!response.ok) {
      result.manifestReason = `manifest GET ${response.status}`;
      return result;
    }
    text = await response.text();
  } catch (error) {
    result.manifestReason = `manifest fetch failed: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }

  const integrity = computeManifestSri(text);
  if (integrity !== descriptor.digest.integrity) {
    result.manifestReason = `manifest SRI mismatch — pin ${descriptor.digest.integrity}, served ${integrity}`;
    return result;
  }

  let manifest: ReturnType<typeof WorkspaceVersionManifestSchema.parse>;
  try {
    manifest = WorkspaceVersionManifestSchema.parse(JSON.parse(text));
  } catch (error) {
    result.manifestReason = `manifest schema: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }

  result.manifestOk = true;
  if (manifest.dir) {
    result.dir = manifest.dir;
    result.legacy = false;
  }

  const fileBase = fileBaseOf(descriptor.base, manifest.dir);
  const entries = Object.entries(manifest.files ?? {});
  result.filesChecked = entries.length;

  const check = async ([path, expected]: [string, string]): Promise<VerifyFileMismatch | null> => {
    try {
      const response = await fetchImpl(`${fileBase}/${path}`);
      if (!response.ok) {
        return { file: path, expected, error: `GET ${response.status}` };
      }
      const actual = sha384Of(new Uint8Array(await response.arrayBuffer()));
      return actual === expected ? null : { file: path, expected, actual };
    } catch (error) {
      return {
        file: path,
        expected,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const mismatches: VerifyFileMismatch[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(VERIFY_CONCURRENCY, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      if (!entry) continue;
      const mismatch = await check(entry);
      if (mismatch) mismatches.push(mismatch);
    }
  });
  await Promise.all(workers);
  result.mismatches = mismatches.sort((a, b) => a.file.localeCompare(b.file));
  return result;
}

export async function verifyPublishedPins(input: {
  config: BosConfigInput;
  fetchImpl?: typeof fetch;
}): Promise<VerifyReport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const descriptors = collectRemoteDescriptors(input.config);
  const remotes: VerifyRemoteResult[] = [];
  for (const descriptor of descriptors) {
    remotes.push(await verifyRemotePin(descriptor, fetchImpl));
  }
  return { remotes };
}

export interface VerifyFreshness {
  behind: boolean;
  pinned?: string;
  published?: string;
  message: string;
}

/**
 * The freshness half of the drift alarm: the authored `release` vs the
 * parent's live thin-tag release. Behind is advisory only — drift never
 * blocks a deploy, `bos upgrade && bos deploy` realigns.
 */
export async function verifyReleaseFreshness(input: {
  config: BosConfigInput;
  registry?: string;
}): Promise<VerifyFreshness | undefined> {
  const pinned = typeof input.config.release === "string" ? input.config.release : undefined;
  const extendsRef = typeof input.config.extends === "string" ? input.config.extends : undefined;
  if (!pinned || !extendsRef) return undefined;
  try {
    const ref = parseRuntimeRef(extendsRef);
    const tagBytes = await readManifestTag(ref.accountId, ref.gatewayId, input.registry);
    if (!tagBytes) {
      return { behind: false, pinned, message: "the parent's release pointer is absent" };
    }
    const published = ManifestTagSchema.parse(tagBytes).version;
    return published === pinned
      ? { behind: false, pinned, published, message: `release ${pinned} is current` }
      : {
          behind: true,
          pinned,
          published,
          message: `parent release is ${published}, you target ${pinned} — run \`bos upgrade && bos deploy\` to realign`,
        };
  } catch (error) {
    return {
      behind: false,
      pinned,
      message: `freshness check failed (non-blocking): ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
