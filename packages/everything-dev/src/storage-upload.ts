import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface DistFile {
  path: string;
  bytes: Uint8Array;
}

export interface BundleUploadResult {
  stored: number;
  totalBytes: number;
  integrity: Record<string, string>;
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
}): Promise<BundleUploadResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.apiKey) headers["x-api-key"] = input.apiKey;

  const response = await fetch(`${input.origin.replace(/\/$/, "")}/api/storage/bundles`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      account: input.account,
      gateway: input.gateway,
      workspace: input.workspace,
      files: input.files.map((file) => ({
        path: file.path,
        contentBase64: Buffer.from(file.bytes).toString("base64"),
      })),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `[publish] bundle upload for ${input.workspace} failed: ${response.status} ${detail.slice(0, 200)}`,
    );
  }

  return (await response.json()) as BundleUploadResult;
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
    Object.assign(merged.integrity, result.integrity);
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
