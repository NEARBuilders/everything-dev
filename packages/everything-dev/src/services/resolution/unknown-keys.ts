/**
 * The authored config's lossless parse seam. `BosConfigSchema` strips unknown
 * keys silently (published snapshots, rollback targets, and merge bases must
 * keep parsing), so a retired or mistyped key vanishes before any consumer
 * sees it — detection has to happen against the authored value itself. This
 * walker diffs the authored object against the schema's declared shapes and
 * returns the paths that would be dropped. `openResolution` surfaces them as
 * `ResolutionSession.unknownAuthoredKeys`; `bos deploy` fails on them.
 *
 * Walks plain zod object shapes (unwrapping optional/lazy wrappers by
 * feature-detection); arrays, records, and primitives are leaves — plugin
 * keys and dynamic records have no unknown-key concept.
 */

type Shape = Record<string, unknown>;

function innerShape(node: unknown, depth = 0): Shape | undefined {
  if (depth > 4 || !node || typeof node !== "object") return undefined;
  const candidate = node as {
    shape?: unknown;
    unwrap?: () => unknown;
    getter?: () => unknown;
  };
  if (candidate.shape && typeof candidate.shape === "object") {
    return candidate.shape as Shape;
  }
  if (typeof candidate.unwrap === "function") {
    return innerShape(candidate.unwrap(), depth + 1);
  }
  if (typeof candidate.getter === "function") {
    return innerShape(candidate.getter(), depth + 1);
  }
  return undefined;
}

export function collectUnknownKeys(value: unknown, schema: unknown, prefix = ""): string[] {
  const shape = innerShape(schema);
  if (!shape || !value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const unknown: string[] = [];
  for (const key of Object.keys(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const declared = shape[key];
    if (!declared) {
      unknown.push(path);
      continue;
    }
    const nested = innerShape(declared);
    if (nested) {
      unknown.push(...collectUnknownKeys((value as Shape)[key], declared, path));
    }
  }
  return unknown;
}
