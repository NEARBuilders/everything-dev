import type { BosConfigInput } from "../../types";
import { ManifestTagSchema } from "../platform/manifest-schema";
import { parseRuntimeRef } from "../registry/keys";
import { readManifestTag } from "../registry/pointer";
import {
  type VerifyReport,
  verifyChain,
} from "../verify/chain";

/**
 * The pin→bytes proof (#826 drift alarm, the 061 `bos verify` core): for
 * every pinned remote, SRI-verify the pinned version manifest document, then
 * hash every file the manifest's `files` map names against the bytes the CDN
 * serves — the manual curl+sha384 sweep, automated. A published pin that no
 * longer resolves byte-for-byte is the mixed-build rot that killed pinned
 * children; this names the file instead of a webpack TypeError.
 */

export type { VerifyFileMismatch, VerifyRemoteResult, VerifyReport } from "../verify/chain";

export async function verifyPublishedPins(input: {
  config: BosConfigInput;
  fetchImpl?: typeof fetch;
}): Promise<VerifyReport> {
  const chain = await verifyChain({
    config: input.config,
    depth: "files",
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
  });
  return { remotes: chain.remotes };
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
