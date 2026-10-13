import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createUploadClient } from "@everything-dev/upload-app/client";

export interface DistFile {
  path: string;
  bytes: Uint8Array;
}

export interface BundleUploadResult {
  stored: number;
  unchanged?: number;
  totalBytes: number;
  integrity: Record<string, string>;
  storage?: "s3" | "memory";
}

async function walkDist(dir: string, baseDir: string): Promise<DistFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: DistFile[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDist(fullPath, baseDir)));
      continue;
    }
    const info = await stat(fullPath);
    if (!info.isFile()) continue;
    files.push({
      path: relative(baseDir, fullPath).split(sep).join("/"),
      bytes: new Uint8Array(await readFile(fullPath)),
    });
  }
  return files;
}

export async function collectDistFiles(distDir: string): Promise<DistFile[]> {
  return walkDist(distDir, distDir);
}

export async function uploadBundle(input: {
  origin: string;
  apiKey?: string;
  account: string;
  gateway: string;
  workspace: string;
  files: DistFile[];
  fetchImpl?: typeof fetch;
}): Promise<BundleUploadResult> {
  const client = createUploadClient({
    origin: input.origin,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
  });
  const result = await client.uploadBundle({
    account: input.account,
    gateway: input.gateway,
    workspace: input.workspace,
    files: input.files.map((file) => ({
      path: file.path,
      contentBase64: Buffer.from(file.bytes).toString("base64"),
    })),
  });
  return result;
}

export async function uploadWorkspaceDist(input: {
  origin: string;
  apiKey?: string;
  account: string;
  gateway: string;
  workspace: string;
  files: DistFile[];
  maxRequestBytes?: number;
}): Promise<BundleUploadResult> {
  const maxRequestBytes =
    input.maxRequestBytes ?? (Number(process.env.BOS_MAX_BUNDLE_UPLOAD_BYTES) || 64 * 1024 * 1024);

  const merged: BundleUploadResult = { stored: 0, totalBytes: 0, integrity: {} };
  let batch: DistFile[] = [];
  let batchBytes = 0;
  const overheadPerFile = (file: DistFile): number =>
    Math.ceil(file.bytes.byteLength / 3) * 4 + file.path.length + 64;

  const flush = async () => {
    if (batch.length === 0) return;
    const result = await uploadBundle({
      origin: input.origin,
      apiKey: input.apiKey,
      account: input.account,
      gateway: input.gateway,
      workspace: input.workspace,
      files: batch,
    });
    merged.stored += result.stored;
    merged.totalBytes += result.totalBytes;
    merged.unchanged = (merged.unchanged ?? 0) + (result.unchanged ?? 0);
    Object.assign(merged.integrity, result.integrity);
    merged.storage = result.storage;
    batch = [];
    batchBytes = 0;
  };

  for (const file of input.files) {
    const cost = overheadPerFile(file);
    if (cost > maxRequestBytes) {
      throw new Error(
        `[publish] ${input.workspace}/${file.path} (${file.bytes.byteLength} bytes) exceeds the per-request upload ceiling`,
      );
    }
    if (batchBytes + cost > maxRequestBytes) {
      await flush();
    }
    batch.push(file);
    batchBytes += cost;
  }
  await flush();

  return merged;
}
