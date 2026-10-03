import { createHash } from "node:crypto";

export function computeSnapshotHash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 16);
}
