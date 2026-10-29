import type { BosConfigInput } from "../../types";
import { BosConfigSchema } from "../../types";
import {
  CircularExtendsError,
  ConfigExtendsError,
  ConfigLoadError,
  ConfigNotfoundError,
  PUBLISHED_CONFIG_ENV,
} from "./load";
import { resolveExtendsRef } from "./merge";
import { type ResolutionIo, walkExtendsChain } from "./session";

/**
 * The publish boot-check: given a *hypothetical* leaf payload (the train's
 * canonicalized publish payload, or a rollback snapshot), decide whether a
 * consumer boot would accept it, and report why not.
 *
 * Boot truth is a property of the extends-merged shape, never the leaf: a
 * consumer fetches the stored leaf, walks the extends chain, merges
 * child-wins, and parses with BosConfigSchema (resolvePublishedConfig). The
 * check re-runs exactly that pipeline — the same walker, merge, and schema —
 * with the payload substituted for the leaf node (`seedConfig`), so parity
 * holds by construction rather than by imitation. It deliberately does NOT
 * parse the leaf as-is when the leaf carries an extends ref: that is the
 * leaf-vs-merged confusion behind the rc.23 gate regression, where every
 * extends child was rejected for an `app.host` slot it legitimately inherits.
 *
 * Invariants:
 * - `ok` is one-directional soundness: `ok: true` means a consumer boot of
 *   this payload — against the parent-chain state observed during the check —
 *   would parse. The parent can drift between check and boot; the
 *   post-publish smoke remains the authoritative whole-boot gate. This check
 *   covers the config plane only (walk + merge + schema); pin/SRI byte
 *   verification stays with `verifyRollbackSnapshot`.
 * - Root payloads (no resolvable extends ref) do zero I/O — the walk's seed
 *   short-circuit returns the payload untouched and the check degenerates to
 *   a plain `safeParse`.
 * - Never throws for data: unreachable parents, circular chains, network
 *   failures, and garbage payloads all become issues. Only a thrown non-Error
 *   (a programmer error) propagates.
 * - Never mutates the payload, never exposes the merged shape (defu's merge
 *   reuses input subtrees — handing callers the merged object would alias
 *   their payload).
 * - `chain` is diagnostic display only — callers never branch on it.
 */

export interface BootCheckIssue {
  /** "chain" — the extends walk itself failed (nothing to parse);
   *  "schema" — BosConfigSchema rejected the effective (merged) shape. */
  code: "schema" | "chain";
  /** Dotted config path for schema issues ("app.host"); the offending
   *  extends ref for chain issues; "" for whole-config schema failures. */
  path: string;
  /** Whose bytes contributed the failure: the payload itself, or a parent
   *  link (best-effort — a failing dotted path present in the leaf is
   *  attributed to the leaf; anything else to the chain). */
  origin: "payload" | "parent";
  message: string;
}

export interface BootCheckReport {
  /** Strictly mirrors what a consumer boot would accept — no false greens,
   *  no false reds relative to boot (against observed parent state). */
  ok: boolean;
  issues: readonly BootCheckIssue[];
  /** The parent refs walked (leaf excluded), in walk order — nearest parent
   *  first; empty for root payloads and failed walks (the issue message
   *  carries the tail). */
  chain: readonly string[];
}

export interface BootCheckOptions {
  /** Registry override, threaded to parent fetches exactly as
   *  resolvePublishedConfig threads it. */
  registry?: string;
  /** The one substitutable seam — the io `openResolution` itself takes.
   *  Tests supply in-memory fetchers; production never passes it. */
  io?: ResolutionIo;
}

export interface ResolvedBootShape {
  /** The parent refs walked (leaf excluded), in walk order — nearest parent
   *  first; empty for root payloads. */
  chain: readonly string[];
  /** The extends-merged (child-wins) shape — a structured clone, safe to
   *  hand to callers that may mutate it (the defu merge reuses input
   *  subtrees). Root payloads clone the payload itself. */
  config: BosConfigInput;
}

/**
 * The boot walk itself, exposed so consumers beside `verifyBootPayload` can
 * gate on the merged shape (the deploy train's composition gate) instead of
 * re-walking under their own walker. Throws on chain failure; the caller
 * decides how to report it.
 */
export async function resolveBootShape(
  payload: unknown,
  slot: { account: string; gateway: string },
  opts: BootCheckOptions = {},
): Promise<ResolvedBootShape> {
  if (payload === null || typeof payload !== "object") {
    throw new Error("payload is not a config object");
  }
  const input = payload as BosConfigInput;
  const extendsRef = input.extends
    ? resolveExtendsRef(input.extends, PUBLISHED_CONFIG_ENV)
    : undefined;
  if (!extendsRef) {
    return { chain: [], config: structuredClone(input) };
  }
  const walked = await walkExtendsChain(`bos://${slot.account}/${slot.gateway}`, {
    env: PUBLISHED_CONFIG_ENV,
    ...(opts.registry ? { registry: opts.registry } : {}),
    ...(opts.io ? { io: opts.io } : {}),
    seedConfig: structuredClone(input),
    visit: async () => {},
  });
  return { chain: walked.chain.slice(1), config: structuredClone(walked.config) };
}

export async function verifyBootPayload(
  payload: unknown,
  slot: { account: string; gateway: string },
  opts: BootCheckOptions = {},
  /** The caller may hand over a shape it already walked (the deploy train's
   * composition gate shares one walk with this check) — it must be the
   * result of `resolveBootShape` for this exact payload. */
  preResolved?: ResolvedBootShape,
): Promise<BootCheckReport> {
  const extendsRef =
    payload !== null && typeof payload === "object" && (payload as BosConfigInput).extends
      ? resolveExtendsRef((payload as BosConfigInput).extends, PUBLISHED_CONFIG_ENV)
      : undefined;

  if (!extendsRef) {
    return { chain: [], ...parseShape(payload as object, payload, false) };
  }

  let shape: ResolvedBootShape;
  if (preResolved) {
    shape = preResolved;
  } else {
    try {
      shape = await resolveBootShape(payload, slot, opts);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return {
        ok: false,
        chain: [],
        issues: [
          {
            code: "chain",
            path: extendsRef,
            origin: "parent",
            message: chainFailureMessage(error),
          },
        ],
      };
    }
  }
  return { chain: shape.chain, ...parseShape(payload as object, shape.config, true) };
}

/** Parse a shape with BosConfigSchema and map the outcome onto a report —
 *  the merged shape in the child path, the payload itself in the root path.
 *  Origin attribution (child path only): a failing dotted path that exists
 *  in the leaf payload is the leaf's; anything else came from the chain. */
function parseShape(
  payload: object,
  shape: unknown,
  attributed: boolean,
): Pick<BootCheckReport, "ok" | "issues"> {
  const parsed = BosConfigSchema.safeParse(shape);
  if (parsed.success) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      code: "schema" as const,
      path: issue.path.join("."),
      origin:
        !attributed || pathExistsIn(payload, issue.path)
          ? ("payload" as const)
          : ("parent" as const),
      message: issue.message,
    })),
  };
}

function pathExistsIn(payload: object, path: PropertyKey[]): boolean {
  let cursor: unknown = payload;
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object" || !(key in (cursor as object))) {
      return false;
    }
    cursor = (cursor as Record<PropertyKey, unknown>)[key];
  }
  return true;
}

function chainFailureMessage(error: Error): string {
  if (error instanceof CircularExtendsError) return `circular extends: ${error.message}`;
  if (error instanceof ConfigNotfoundError)
    return `a parent config could not be found: ${error.message}`;
  if (error instanceof ConfigLoadError)
    return `a parent config could not be loaded: ${error.message}`;
  if (error instanceof ConfigExtendsError)
    return `the extends chain could not be resolved: ${error.message}`;
  return `the extends chain could not be resolved: ${error.message}`;
}
