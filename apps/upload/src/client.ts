import { Data } from "effect";
import { WorkspaceVersionManifestSchema } from "every-plugin/version-manifest";
import { z } from "zod";

export const BundleFileSchema = z.object({
  path: z.string().min(1).max(512),
  contentBase64: z.string().min(1),
});

export const UploadRequestSchema = z.object({
  account: z.string().min(1),
  gateway: z.string().min(1),
  workspace: z.string().min(1),
  files: z.array(BundleFileSchema).min(1).max(10_000),
});

export const UploadResponseSchema = z.object({
  stored: z.number().int(),
  /** files recognized as byte-identical to what the store already holds (SRI metadata match) and skipped */
  unchanged: z.number().int().optional(),
  totalBytes: z.number().int(),
  integrity: z.record(z.string(), z.string()),
  storage: z
    .enum(["s3", "memory"])
    .optional()
    .describe(
      "Resolved bundle-storage backend: `s3` (R2/MinIO, persistent) or `memory` (ephemeral — bytes are lost on restart)",
    ),
});

const NamespaceQuerySchema = z.object({
  account: z.string().min(1),
  gateway: z.string().min(1),
});

export const ListBundlesQuerySchema = NamespaceQuerySchema.extend({
  workspace: z.string().min(1).optional(),
});

export const BundleObjectSummarySchema = z.object({
  key: z.string(),
  size: z.number().int(),
  lastModified: z.string().nullable().optional(),
});

export const ListBundlesResultSchema = z.object({
  storage: z.enum(["s3", "memory"]),
  prefix: z.string(),
  objects: z.array(BundleObjectSummarySchema),
  truncated: z.boolean(),
});

export const ListVersionsQuerySchema = NamespaceQuerySchema.extend({
  workspace: z.string().min(1),
});

export const VersionSummarySchema = z.object({
  version: z.string().regex(/^[0-9a-f]{16}$/),
  entry: z.string(),
  entryIntegrity: z.string(),
  gitSha: z.string().optional(),
  builtAt: z.string().optional(),
  fileCount: z.number().int().optional(),
  lastModified: z.string().nullable().optional(),
});

export const ListVersionsResultSchema = z.object({
  storage: z.enum(["s3", "memory"]),
  versions: z.array(VersionSummarySchema),
  truncated: z.boolean(),
});

export const IntegrityReportQuerySchema = NamespaceQuerySchema.extend({
  workspace: z.string().min(1),
  version: z.string().regex(/^[0-9a-f]{16}$/),
});

export const IntegrityReportResultSchema = z.object({
  storage: z.enum(["s3", "memory"]),
  manifest: WorkspaceVersionManifestSchema,
  /** SRI recompute of the manifest's entry object against `entryIntegrity`;
   *  null when the entry object is missing from the store. */
  entryVerified: z.boolean().nullable(),
});

export type BundleFile = z.infer<typeof BundleFileSchema>;
export type UploadRequest = z.infer<typeof UploadRequestSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
export type ListBundlesQuery = z.infer<typeof ListBundlesQuerySchema>;
export type BundleObjectSummary = z.infer<typeof BundleObjectSummarySchema>;
export type ListBundlesResult = z.infer<typeof ListBundlesResultSchema>;
export type ListVersionsQuery = z.infer<typeof ListVersionsQuerySchema>;
export type VersionSummary = z.infer<typeof VersionSummarySchema>;
export type ListVersionsResult = z.infer<typeof ListVersionsResultSchema>;
export type IntegrityReportQuery = z.infer<typeof IntegrityReportQuerySchema>;
export type IntegrityReportResult = z.infer<typeof IntegrityReportResultSchema>;

export interface UploadClientConfig {
  origin: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface UploadClient {
  uploadBundle(input: UploadRequest): Promise<UploadResponse>;
  listBundles(input: ListBundlesQuery): Promise<ListBundlesResult>;
  listVersions(input: ListVersionsQuery): Promise<ListVersionsResult>;
  integrityReport(input: IntegrityReportQuery): Promise<IntegrityReportResult>;
}

const STATUS_ATTEMPTS = 3;
const TRANSPORT_ATTEMPTS = 5;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoffMs = (attempt: number) => 1000 * attempt + Math.floor(Math.random() * 500);

class UploadTransferError extends Data.TaggedError("UploadTransferError")<{
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
    return new UploadTransferError(this.status, this.detail, `${this.note ?? ""}${note}`);
  }
}

function describeTransferFailure(status: number, detail: string): string {
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

async function requestJson<T>(
  config: UploadClientConfig,
  label: string,
  path: string,
  parse: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (config.apiKey) headers["x-api-key"] = config.apiKey;
  if (init?.body && !headers["content-type"]) headers["content-type"] = "application/json";

  let lastError: UploadTransferError | Error | undefined;
  let transportFailures = 0;
  let statusFailures = 0;
  for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(`${config.origin.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: transportFailures > 0 ? { ...headers, connection: "close" } : headers,
      });

      if (response.ok) {
        return parse(await response.json());
      }

      const detail = await response.text().catch(() => "");
      lastError = new UploadTransferError(
        response.status,
        `[upload] ${label} failed: ${response.status} ${describeTransferFailure(response.status, detail)}`,
      );
      if (!RETRYABLE_STATUSES.has(response.status)) break;
      statusFailures += 1;
      if (statusFailures >= STATUS_ATTEMPTS) break;
    } catch (error) {
      transportFailures += 1;
      lastError = new UploadTransferError(
        0,
        `[upload] ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (attempt < TRANSPORT_ATTEMPTS) await sleep(backoffMs(attempt));
  }

  if (lastError instanceof UploadTransferError && lastError.status === 0) {
    lastError = lastError.withNote(
      " (Bun fetch note: re-run with fetch verbose diagnostics for detail)",
    );
  }
  throw lastError ?? new Error(`[upload] ${label} failed`);
}

const parseJsonBody = <T>(label: string, schema: { parse: (value: unknown) => T }) => {
  return (response: unknown): T => {
    try {
      return schema.parse(response);
    } catch (error) {
      throw new UploadTransferError(
        0,
        `[upload] ${label} returned an unexpected payload: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
};

export function createUploadClient(config: UploadClientConfig): UploadClient {
  return {
    uploadBundle(input) {
      const payload = UploadRequestSchema.parse(input);
      return requestJson(
        config,
        `bundle upload for ${payload.workspace}`,
        "/api/storage/bundles",
        parseJsonBody("bundle upload", UploadResponseSchema),
        { method: "POST", body: JSON.stringify(payload) },
      );
    },

    listBundles(input) {
      const query = new URLSearchParams({ account: input.account, gateway: input.gateway });
      if (input.workspace) query.set("workspace", input.workspace);
      return requestJson(
        config,
        "bundle listing",
        `/api/storage/bundles?${query.toString()}`,
        parseJsonBody("bundle listing", ListBundlesResultSchema),
        { method: "GET" },
      );
    },

    listVersions(input) {
      const query = new URLSearchParams({
        account: input.account,
        gateway: input.gateway,
        workspace: input.workspace,
      });
      return requestJson(
        config,
        "version listing",
        `/api/storage/versions?${query.toString()}`,
        parseJsonBody("version listing", ListVersionsResultSchema),
        { method: "GET" },
      );
    },

    integrityReport(input) {
      const query = new URLSearchParams({
        account: input.account,
        gateway: input.gateway,
        workspace: input.workspace,
        version: input.version,
      });
      return requestJson(
        config,
        "integrity report",
        `/api/storage/integrity?${query.toString()}`,
        parseJsonBody("integrity report", IntegrityReportResultSchema),
        { method: "GET" },
      );
    },
  };
}
