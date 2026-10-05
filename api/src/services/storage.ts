import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { Context, Effect, Layer } from "effect";
import { cacheControlOf } from "every-plugin/build/artifact-names";

export interface StoragePutInput {
  key: string;
  bytes: Uint8Array;
  contentType: string;
  cacheControl: string;
}

export interface StorageObject {
  bytes: Uint8Array;
  contentType: string;
  cacheControl: string;
}

export interface StorageClient {
  put(input: StoragePutInput): Promise<void>;
  get(key: string): Promise<StorageObject | null>;
}

export interface StorageService {
  put(input: StoragePutInput): Effect.Effect<void>;
  get(key: string): Effect.Effect<StorageObject | null>;
  readonly backend: "s3" | "memory";
}

export class StorageTag extends Context.Service<StorageTag, StorageService>()("api/Storage") {}

const BUNDLE_MIME_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".html": "text/html",
  ".htm": "text/html",
  ".webmanifest": "application/manifest+json",
  ".md": "text/markdown",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

export { BUNDLE_MIME_TYPES };

export function bundleContentType(name: string): string {
  return (
    BUNDLE_MIME_TYPES[name.slice(name.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream"
  );
}

export const bundleCacheControl = cacheControlOf;

const NAMESPACE_LABEL = "[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?";
const PART_PATTERNS: Record<"account" | "gateway" | "workspace", RegExp> = {
  account: new RegExp(`^${NAMESPACE_LABEL}(\\.${NAMESPACE_LABEL})*$`),
  gateway: new RegExp(`^${NAMESPACE_LABEL}(\\.${NAMESPACE_LABEL})*$`),
  workspace: /^[a-zA-Z0-9_-]+$/,
};

export function validateNamespacePart(
  value: string,
  kind: "account" | "gateway" | "workspace",
): boolean {
  if (value.length === 0 || value.length > 253) return false;
  if (value.includes("..")) return false;
  if (kind === "account" && (value.length < 2 || value.length > 64)) return false;
  return PART_PATTERNS[kind].test(value);
}

export function validateObjectPath(objectPath: string): string | null {
  if (!objectPath || objectPath.includes("\\")) return null;
  const segments = objectPath.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.includes("%")) return null;
  }
  return segments.join("/");
}

export function buildBundleKey(
  account: string,
  gateway: string,
  workspace: string,
  objectPath: string,
): string {
  return `bundles/${account}/${gateway}/${workspace}/${objectPath}`;
}

export function validateUploadSize(
  files: Array<{ bytes: Uint8Array }>,
  maxTotalBytes: number,
): boolean {
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  return total <= maxTotalBytes;
}

export function computeObjectIntegrity(bytes: Uint8Array): string {
  return `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
}

export class MemoryStorageClient implements StorageClient {
  private objects = new Map<string, StorageObject>();

  async put(input: StoragePutInput): Promise<void> {
    this.objects.set(input.key, {
      bytes: input.bytes,
      contentType: input.contentType,
      cacheControl: input.cacheControl,
    });
  }

  async get(key: string): Promise<StorageObject | null> {
    return this.objects.get(key) ?? null;
  }
}

function summarizeStorageErrorBody(detail: string): string {
  const collapsed = detail.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, 300) || "(no response body)";
}

/**
 * A storage-backend failure worth retrying: the request never got a response
 * (undici wraps these as "fetch failed" — resets, timeouts, socket errors)
 * or the remote answered with a transient status.
 */
export class TransientStorageError extends Error {
  constructor(
    readonly operation: string,
    readonly detail: string,
  ) {
    super(`[storage] ${operation} failed: ${detail}`);
    this.name = "TransientStorageError";
  }
}

/** A definitive backend rejection (auth, bad request) — retrying cannot help. */
export class StorageHttpError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`[storage] ${operation} failed: ${status} ${detail}`);
    this.name = "StorageHttpError";
  }
}

function describeFetchCause(error: unknown): string {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return `fetch failed (${code ?? cause.message})`;
  }
  return error instanceof Error ? error.message : String(error);
}

const STORAGE_OP_ATTEMPTS = 3;
const TRANSIENT_STATUS_PATTERN = /^(429|5\d\d)/;

/** Retry a single object operation on transient failures. aws4fetch signs and
 * sends but never retries — one keep-alive reset over a home uplink would
 * otherwise kill a whole multi-hundred-file bundle batch. */
export async function withStorageRetries<T>(op: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= STORAGE_OP_ATTEMPTS; attempt++) {
    try {
      return await op();
    } catch (error) {
      lastError = error;
      if (!(error instanceof TransientStorageError)) break;
    }
    if (attempt < STORAGE_OP_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

export class S3StorageClient implements StorageClient {
  private client: AwsClient;

  constructor(
    input: { accessKeyId: string; secretAccessKey: string; region: string },
    private options: { endpoint: string; bucket: string },
  ) {
    this.client = new AwsClient({
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      region: input.region,
      service: "s3",
    });
  }

  private objectUrl(key: string): string {
    return `${this.options.endpoint.replace(/\/$/, "")}/${this.options.bucket}/${key}`;
  }

  private async request(
    operation: "PUT" | "GET",
    key: string,
    init?: RequestInit,
  ): Promise<Response> {
    const opLabel = `${operation} ${key}`;
    return withStorageRetries(async () => {
      let response: Response;
      try {
        response = await this.client.fetch(this.objectUrl(key), init);
      } catch (error) {
        throw new TransientStorageError(opLabel, describeFetchCause(error));
      }
      if (response.ok || (operation === "GET" && response.status === 404)) {
        return response;
      }
      const detail = await response.text().catch(() => "");
      if (TRANSIENT_STATUS_PATTERN.test(String(response.status))) {
        throw new TransientStorageError(
          opLabel,
          `${response.status} ${summarizeStorageErrorBody(detail)}`,
        );
      }
      throw new StorageHttpError(opLabel, response.status, summarizeStorageErrorBody(detail));
    });
  }

  async put(input: StoragePutInput): Promise<void> {
    await this.request("PUT", input.key, {
      method: "PUT",
      body: input.bytes,
      headers: {
        "content-type": input.contentType,
        "cache-control": input.cacheControl,
      },
    });
  }

  async get(key: string): Promise<StorageObject | null> {
    const response = await this.request("GET", key);
    if (response.status === 404) return null;
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      cacheControl: response.headers.get("cache-control") ?? "",
    };
  }
}

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const DEFAULT_MAX_BUNDLE_UPLOAD_BYTES = 64 * 1024 * 1024;

export function maxBundleUploadBytes(): number {
  const raw = process.env.BOS_MAX_BUNDLE_UPLOAD_BYTES;
  if (!raw) return DEFAULT_MAX_BUNDLE_UPLOAD_BYTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BUNDLE_UPLOAD_BYTES;
}

function storageConfigFromEnv(): StorageConfig | null {
  const endpoint = process.env.BOS_STORAGE_ENDPOINT;
  const bucket = process.env.BOS_STORAGE_BUCKET;
  const accessKeyId = process.env.BOS_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BOS_STORAGE_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.BOS_STORAGE_REGION || "auto",
  };
}

export const StorageLive = Layer.effect(
  StorageTag,
  Effect.gen(function* () {
    const config = storageConfigFromEnv();
    if (!config) {
      yield* Effect.logWarning(
        "[storage] BOS_STORAGE_* not configured — using in-memory storage (dev only; bundle bytes are lost on restart)",
      );
      const memory = new MemoryStorageClient();
      return StorageTag.of({
        put: (input) => Effect.promise(() => memory.put(input)),
        get: (key) => Effect.promise(() => memory.get(key)),
        backend: "memory" as const,
      });
    }
    const s3 = new S3StorageClient(
      {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        region: config.region,
      },
      { endpoint: config.endpoint, bucket: config.bucket },
    );
    return StorageTag.of({
      put: (input) => Effect.promise(() => s3.put(input)),
      get: (key) => Effect.promise(() => s3.get(key)),
      backend: "s3" as const,
    });
  }),
);
