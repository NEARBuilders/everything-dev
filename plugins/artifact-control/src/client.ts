import { Data } from "effect";
import { z } from "zod";

export const ArtifactControlBundleFileSchema = z.object({
  path: z.string().min(1).max(512),
  contentBase64: z.string().min(1),
});

export const ArtifactControlUploadSessionInputSchema = z.object({
  account: z.string().min(1),
  gateway: z.string().min(1),
  workspace: z.string().min(1),
  files: z.array(ArtifactControlBundleFileSchema).min(1).max(10_000),
});

export const ArtifactControlUploadSessionSchema = ArtifactControlUploadSessionInputSchema.extend({
  sessionId: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const ArtifactControlTransferRequestSchema = ArtifactControlUploadSessionInputSchema.extend({
  sessionId: z.string().min(1).optional(),
});

export const ArtifactControlTransferResponseSchema = z.object({
  sessionId: z.string().min(1).optional(),
  stored: z.number().int(),
  totalBytes: z.number().int(),
  integrity: z.record(z.string(), z.string()),
  storage: z
    .enum(["s3", "memory"])
    .optional()
    .describe(
      "Resolved bundle-storage backend: `s3` (R2/MinIO, persistent) or `memory` (ephemeral — bytes are lost on restart)",
    ),
});

export const ArtifactControlTransferResultSchema = ArtifactControlTransferResponseSchema.extend({
  sessionId: z.string().min(1),
});

export const ArtifactControlFinalizeResultSchema = ArtifactControlTransferResultSchema.extend({
  finalizedAt: z.string().datetime(),
});

export type ArtifactControlBundleFile = z.infer<typeof ArtifactControlBundleFileSchema>;
export type ArtifactControlUploadSessionInput = z.infer<
  typeof ArtifactControlUploadSessionInputSchema
>;
export type ArtifactControlUploadSession = z.infer<typeof ArtifactControlUploadSessionSchema>;
export type ArtifactControlTransferRequest = z.infer<typeof ArtifactControlTransferRequestSchema>;
export type ArtifactControlTransferResponse = z.infer<typeof ArtifactControlTransferResponseSchema>;
export type ArtifactControlTransferResult = z.infer<typeof ArtifactControlTransferResultSchema>;
export type ArtifactControlFinalizeResult = z.infer<typeof ArtifactControlFinalizeResultSchema>;

export interface ArtifactControlClientConfig {
  origin: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sessionIdFactory?: () => string;
  now?: () => Date;
}

export interface ArtifactControlClient {
  createUploadSession(input: ArtifactControlUploadSessionInput): ArtifactControlUploadSession;
  transfer(session: ArtifactControlUploadSession): Promise<ArtifactControlTransferResult>;
  finalize(
    session: ArtifactControlUploadSession,
    transferResult: ArtifactControlTransferResult,
  ): Promise<ArtifactControlFinalizeResult>;
  uploadBundle(input: ArtifactControlUploadSessionInput): Promise<ArtifactControlFinalizeResult>;
}

const STATUS_ATTEMPTS = 3;
const TRANSPORT_ATTEMPTS = 5;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoffMs = (attempt: number) => 1000 * attempt + Math.floor(Math.random() * 500);
const defaultSessionIdFactory = (): string =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
const defaultNow = (): Date => new Date();

class ArtifactControlTransferError extends Data.TaggedError("ArtifactControlTransferError")<{
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
    return new ArtifactControlTransferError(this.status, this.detail, `${this.note ?? ""}${note}`);
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

async function postTransfer(
  config: ArtifactControlClientConfig,
  session: ArtifactControlUploadSession,
): Promise<ArtifactControlTransferResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) headers["x-api-key"] = config.apiKey;

  const body = JSON.stringify({
    sessionId: session.sessionId,
    account: session.account,
    gateway: session.gateway,
    workspace: session.workspace,
    files: session.files.map((file) => ({
      path: file.path,
      contentBase64: file.contentBase64,
    })),
  });

  let lastError: ArtifactControlTransferError | Error | undefined;
  let transportFailures = 0;
  let statusFailures = 0;
  for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(`${config.origin.replace(/\/$/, "")}/api/storage/bundles`, {
        method: "POST",
        headers:
          transportFailures > 0
            ? {
                ...headers,
                connection: "close",
              }
            : headers,
        body,
      });

      if (response.ok) {
        const parsed = ArtifactControlTransferResponseSchema.parse(await response.json());
        return ArtifactControlTransferResultSchema.parse({
          ...parsed,
          sessionId: parsed.sessionId ?? session.sessionId,
        });
      }

      const detail = await response.text().catch(() => "");
      lastError = new ArtifactControlTransferError(
        response.status,
        `[publish] bundle upload for ${session.workspace} failed: ${response.status} ${describeTransferFailure(response.status, detail)}`,
      );
      if (!RETRYABLE_STATUSES.has(response.status)) break;
      statusFailures += 1;
      if (statusFailures >= STATUS_ATTEMPTS) break;
    } catch (error) {
      transportFailures += 1;
      lastError = new ArtifactControlTransferError(
        0,
        `[publish] bundle upload for ${session.workspace} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (attempt < TRANSPORT_ATTEMPTS) await sleep(backoffMs(attempt));
  }

  if (lastError instanceof ArtifactControlTransferError && lastError.status === 0) {
    lastError = lastError.withNote(
      " (Bun fetch note: re-run with fetch verbose diagnostics for detail)",
    );
  }
  throw lastError ?? new Error(`[publish] bundle upload for ${session.workspace} failed`);
}

export function createArtifactControlClient(
  config: ArtifactControlClientConfig,
): ArtifactControlClient {
  const sessionIdFactory = config.sessionIdFactory ?? defaultSessionIdFactory;
  const now = config.now ?? defaultNow;

  return {
    createUploadSession(input) {
      return ArtifactControlUploadSessionSchema.parse({
        ...input,
        sessionId: sessionIdFactory(),
        createdAt: now().toISOString(),
      });
    },

    async transfer(session) {
      return postTransfer(config, session);
    },

    async finalize(session, transferResult) {
      return ArtifactControlFinalizeResultSchema.parse({
        ...transferResult,
        sessionId: transferResult.sessionId ?? session.sessionId,
        finalizedAt: now().toISOString(),
      });
    },

    async uploadBundle(input) {
      const session = ArtifactControlUploadSessionSchema.parse({
        ...input,
        sessionId: sessionIdFactory(),
        createdAt: now().toISOString(),
      });
      const transferResult = await postTransfer(config, session);
      return ArtifactControlFinalizeResultSchema.parse({
        ...transferResult,
        finalizedAt: now().toISOString(),
      });
    },
  };
}
