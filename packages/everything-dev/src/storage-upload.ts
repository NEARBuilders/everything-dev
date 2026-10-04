import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Data } from "effect";

export interface DistFile {
  path: string;
  bytes: Uint8Array;
}

export interface BundleUploadResult {
  stored: number;
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

const STATUS_ATTEMPTS = 3;
const TRANSPORT_ATTEMPTS = 5;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoffMs = (attempt: number) => 1000 * attempt + Math.floor(Math.random() * 500);

class BundleUploadError extends Data.TaggedError("BundleUploadError")<{
  readonly status: number;
  readonly detail: string;
  readonly note?: string;
}> {
  constructor(status: number, detail: string, note?: string) {
    super({ status, detail, note });
  }

  override get message() {
    return `${this.detail}${this.note ?? ""}`;
  }

  withNote(note: string) {
    return new BundleUploadError(this.status, this.detail, `${this.note ?? ""}${note}`);
  }
}

function describeUploadFailure(status: number, detail: string): string {
  const trimmed = detail.slice(0, 300);
  if (status === 408 || /request timeout|bundle upload timed out/i.test(trimmed)) {
    return `${trimmed} — the serving host timed out the upload; raise BOS_STORAGE_UPLOAD_TIMEOUT_MS there or upload smaller batches (BOS_MAX_BUNDLE_UPLOAD_BYTES)`;
  }
  try {
    const parsed = JSON.parse(detail) as { code?: unknown; message?: unknown };
    if (parsed?.code === "INTERNAL_SERVER_ERROR" && parsed?.message === "Internal Server Error") {
      return `${trimmed} — the host hid the underlying error; check the host logs for the cause`;
    }
  } catch {
    // not a JSON error body
  }
  return trimmed;
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
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.apiKey) headers["x-api-key"] = input.apiKey;

  const body = JSON.stringify({
    account: input.account,
    gateway: input.gateway,
    workspace: input.workspace,
    files: input.files.map((file) => ({
      path: file.path,
      contentBase64: Buffer.from(file.bytes).toString("base64"),
    })),
  });

  let lastError: BundleUploadError | Error | undefined;
  let transportFailures = 0;
  let statusFailures = 0;
  for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(`${input.origin.replace(/\/$/, "")}/api/storage/bundles`, {
        method: "POST",
        headers:
          transportFailures > 0
            ? // a transport failure killed the pooled keepalive socket — do not
              // reuse it (the "socket connection closed unexpectedly" incident)
              { ...headers, connection: "close" }
            : headers,
        body,
      });

      if (response.ok) {
        return (await response.json()) as BundleUploadResult;
      }

      const detail = await response.text().catch(() => "");
      lastError = new BundleUploadError(
        response.status,
        `[publish] bundle upload for ${input.workspace} failed: ${response.status} ${describeUploadFailure(response.status, detail)}`,
      );
      // Retries are safe: the storage route stores by account/gateway/
      // workspace/path, so re-posting a batch overwrites idempotently.
      if (!RETRYABLE_STATUSES.has(response.status)) break;
      statusFailures += 1;
      if (statusFailures >= STATUS_ATTEMPTS) break;
    } catch (error) {
      transportFailures += 1;
      lastError = new BundleUploadError(
        0,
        `[publish] bundle upload for ${input.workspace} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (attempt < TRANSPORT_ATTEMPTS) await sleep(backoffMs(attempt));
  }

  if (lastError instanceof BundleUploadError && lastError.status === 0) {
    lastError = lastError.withNote(
      " (Bun fetch note: re-run with fetch verbose diagnostics for detail)",
    );
  }
  throw lastError ?? new Error(`[publish] bundle upload for ${input.workspace} failed`);
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
