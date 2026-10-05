import { ORPCError } from "@orpc/server";
import { Cause, Data } from "effect";
import type { z } from "zod";

export class PluginRuntimeError extends Data.TaggedError("PluginRuntimeError")<{
  readonly pluginId?: string;
  readonly operation?: string;
  readonly procedureName?: string;
  readonly cause?: Error;
}> {
  override get message() {
    return this.cause?.message ?? "Plugin operation failed";
  }
}

export class ModuleFederationError extends Data.TaggedError("ModuleFederationError")<{
  readonly pluginId: string;
  readonly remoteUrl: string;
  readonly cause?: Error;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly pluginId: string;
  readonly stage: "config" | "input" | "output" | "state";
  readonly zodError: z.ZodError;
}> {}

const extractErrorMessage = (error: unknown): string => {
  if (!error) return "Unknown error";

  if (error instanceof Error) {
    if (error.message) return error.message;
    if ((error as any).cause instanceof Error) {
      return extractErrorMessage((error as any).cause);
    }
  }

  if (error instanceof AggregateError && error.errors?.length) {
    return error.errors.map((e) => extractErrorMessage(e)).join("; ");
  }

  if (typeof error === "object" && "message" in error) {
    return String((error as any).message);
  }

  return String(error);
};

/**
 * The deepest Error along the cause chain — the original throw site. Wrapper
 * errors (PluginRuntimeError, ModuleFederationError) carry their own stacks
 * (the wrapping frames); diagnosis needs the cause's stack (the actual
 * failing module inside the evaluated remote entry).
 */
export const deepestErrorStack = (error: unknown): string | undefined => {
  let current = error;
  let deepest: string | undefined;
  let hops = 0;
  while (current instanceof Error && hops < 8) {
    if (current.stack) deepest = current.stack;
    current = (current as { cause?: unknown }).cause as unknown;
    hops += 1;
  }
  if (current instanceof Error && current.stack) deepest = current.stack;
  return deepest;
};

const formatValidationIssue = (issue: any, index: number, maxDisplay: number): string => {
  if (index >= maxDisplay) return "";

  const path =
    Array.isArray(issue.path) && issue.path.length > 0
      ? issue.path.join(".")
      : issue.path || "root";

  const message = issue.message || "Validation failed";

  return `│    ${index + 1}. ${path}: ${message}`;
};

const formatDataPreview = (data: unknown, maxLength = 100): string => {
  if (!data) return "undefined";

  try {
    const str = JSON.stringify(data);
    if (str.length <= maxLength) return str;

    if (typeof data === "object" && data !== null) {
      if (Array.isArray(data)) {
        return `Array(${data.length}) [...]`;
      }
      const keys = Object.keys(data);
      return `{ ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", ..." : ""} }`;
    }

    return `${str.slice(0, maxLength)}...`;
  } catch {
    return String(data).slice(0, maxLength);
  }
};

const formatORPCValidationError = (error: any): string[] | null => {
  const cause = error?.cause || error;

  if (!cause?.issues || !Array.isArray(cause.issues) || cause.issues.length === 0) {
    return null;
  }

  const lines: string[] = [];
  const errorType = error?.message || cause?.message || "Validation failed";

  lines.push(`\n╭─ oRPC Validation Error ${"─".repeat(30)}`);
  lines.push(`│  ${errorType}`);
  lines.push(`│`);

  const maxDisplay = 10;
  const totalIssues = cause.issues.length;

  lines.push(`│  Issues (${totalIssues}):`);

  const displayedIssues = cause.issues.slice(0, maxDisplay);
  displayedIssues.forEach((issue: any, idx: number) => {
    const formatted = formatValidationIssue(issue, idx, maxDisplay);
    if (formatted) lines.push(formatted);
  });

  if (totalIssues > maxDisplay) {
    lines.push(`│    ... and ${totalIssues - maxDisplay} more`);
  }

  if (cause.data !== undefined) {
    lines.push(`│`);
    lines.push(`│  Data preview: ${formatDataPreview(cause.data, 80)}`);
  }

  lines.push(`╰${"─".repeat(50)}\n`);

  return lines;
};

const formatUnknownError = (error: any): string | null => {
  if (!error) return null;
  const message = extractErrorMessage(error);
  const lines: string[] = [];
  lines.push(`\n╭─ Unhandled error ${"─".repeat(37)}`);
  for (const line of message.split("\n")) {
    lines.push(`│  ${line}`);
  }
  const stack = error instanceof Error ? error.stack?.split("\n").slice(1, 6) : undefined;
  if (stack && stack.length > 0) {
    lines.push(`│`);
    for (const line of stack) {
      lines.push(`│  ${line.trim()}`);
    }
  }
  lines.push(`╰${"─".repeat(50)}\n`);
  return lines.join("\n");
};

export const formatORPCError = (error: any): string | null => {
  if (!(error instanceof ORPCError)) {
    // Unknown errors used to return null, leaving internal failures (e.g. a
    // storage backend throw) invisible in host logs while oRPC serialized
    // them client-side as a bare INTERNAL_SERVER_ERROR.
    return formatUnknownError(error);
  }

  const validationLines = formatORPCValidationError(error);
  if (validationLines) {
    return validationLines.join("\n");
  }

  const lines: string[] = [];
  const code = error.code || "UNKNOWN";
  const message = error.message || "An error occurred";

  lines.push(`\n╭─ oRPC Error ${"─".repeat(40)}`);
  const messageLines = message.split("\n");
  for (const line of messageLines) {
    lines.push(`│  ${line}`);
  }
  lines.push(`│  Code: ${code}`);
  lines.push(`│`);

  if (error.data) {
    const dataType = typeof error.data;
    if (dataType === "object" && error.data !== null) {
      if ("retryAfter" in error.data) {
        lines.push(`│  Retry after: ${error.data.retryAfter} seconds`);
      }
      if ("remainingRequests" in error.data) {
        lines.push(`│  Remaining: ${error.data.remainingRequests} requests`);
      }
      if ("host" in error.data) {
        lines.push(`│  Host: ${error.data.host}`);
      }
      if ("port" in error.data) {
        lines.push(`│  Port: ${error.data.port}`);
      }
      if ("suggestion" in error.data) {
        lines.push(`│  → ${error.data.suggestion}`);
      }
      if ("resource" in error.data) {
        lines.push(`│  Resource: ${error.data.resource}`);
      }
      if ("resourceId" in error.data) {
        lines.push(`│  ID: ${error.data.resourceId}`);
      }
    }
  }

  switch (code) {
    case "UNAUTHORIZED":
      lines.push(`│  → Check your API key or credentials`);
      break;
    case "TOO_MANY_REQUESTS":
      lines.push(`│  → Wait before retrying`);
      break;
    case "SERVICE_UNAVAILABLE":
    case "BAD_GATEWAY":
    case "GATEWAY_TIMEOUT":
      lines.push(`│  → The service may be temporarily unavailable`);
      break;
    case "TIMEOUT":
      lines.push(`│  → The operation took too long`);
      break;
  }

  lines.push(`╰${"─".repeat(50)}\n`);
  return lines.join("\n");
};

export type PluginFailureKind =
  | "mf"
  | "integrity"
  | "config"
  | "validation"
  | "network"
  | "unknown";

export interface PluginFailureClassification {
  kind: PluginFailureKind;
  retryable: boolean;
  message: string;
  suggestion?: string;
}

/**
 * Structured report of one plugin-load failure, built by a loader (the host's
 * plugin boot, the dev server) from a `PluginFailureClassification` plus
 * loader context. This is the shape health endpoints and dashboards consume —
 * keep it serializable.
 */
export interface PluginLoadFailureInfo {
  /** loader-side key (host entry key, dev plugin id) */
  pluginKey: string;
  pluginUrl?: string;
  /** failing runtime stage when the cause is stage-attributed */
  operation?: string;
  kind: PluginFailureKind | string;
  retryable: boolean;
  message: string;
  suggestion?: string;
  /** loader context: which env secret the plugin's DB binding expects */
  dbSecret?: string;
  dbUrlMasked?: string;
}

const NETWORK_RETRYABLE_PATTERNS = ["ETIMEDOUT", "ECONNRESET", "timeout", "503", "429"] as const;
const NETWORK_DEAD_PATTERNS = ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH"] as const;
const RETRYABLE_ORPC_CODES = new Set([
  "TOO_MANY_REQUESTS",
  "SERVICE_UNAVAILABLE",
  "BAD_GATEWAY",
  "GATEWAY_TIMEOUT",
  "TIMEOUT",
]);

/**
 * One classification for plugin lifecycle failures across MF / validation /
 * network sources. This is the recovery policy — nothing in the runtime
 * retries on it today by design (the host degrades and runs without a failed
 * plugin); consumers (host bootstrap messages, the dev server retry loop)
 * read kind / retryable / suggestion to decide what to tell the author.
 */
export const classifyPluginFailure = (error: unknown): PluginFailureClassification => {
  let current: unknown = extractFromFiberFailure(error);
  let hops = 0;
  while (current && typeof current === "object" && hops < 8) {
    if (current instanceof ModuleFederationError) {
      return {
        kind: "mf",
        retryable: false,
        message: extractErrorMessage(current),
        suggestion:
          "Run bos mf check — the deployed plugin bundle is likely stale (sharedDep / pluginVersion skew), then redeploy the plugin and bos publish --deploy --packages local",
      };
    }
    if (current instanceof ValidationError) {
      return {
        kind: "validation",
        retryable: false,
        message: `${current.stage}: ${extractErrorMessage(current.zodError)}`,
        suggestion: `Fix the plugin's ${current.stage} schema at plugins/${current.pluginId}`,
      };
    }
    if (current instanceof ORPCError) {
      const retryableByCode = RETRYABLE_ORPC_CODES.has(current.code);
      return {
        kind: "network",
        retryable: retryableByCode,
        message: current.message,
        suggestion: retryableByCode
          ? "The plugin procedure failed transiently — retry the call"
          : undefined,
      };
    }
    current = (current as { cause?: unknown }).cause;
    hops += 1;
  }

  const message = extractErrorMessage(error);
  const lower = message.toLowerCase();

  if (NETWORK_RETRYABLE_PATTERNS.some((p) => lower.includes(p.toLowerCase()))) {
    return {
      kind: "network",
      retryable: true,
      message,
      suggestion: "The remote may be temporarily unavailable — retry after redeploying the plugin",
    };
  }
  if (NETWORK_DEAD_PATTERNS.some((p) => lower.includes(p.toLowerCase()))) {
    return {
      kind: "network",
      retryable: false,
      message,
      suggestion:
        "The plugin host is unreachable — check plugins.<id> entry URLs in bos.config.json",
    };
  }
  if (lower.includes("integrity") || lower.includes("sri")) {
    return {
      kind: "integrity",
      retryable: true,
      message,
      suggestion:
        "The deployed bundle content does not match its recorded integrity — redeploy the plugin so bos.config.json is republished with a fresh hash",
    };
  }

  return { kind: "unknown", retryable: false, message };
};

// Convert ORPC errors from plugin procedures to PluginRuntimeError
export const wrapORPCError = (
  orpcError: ORPCError<string, unknown>,
  pluginId?: string,
  procedureName?: string,
  operation?: string,
): PluginRuntimeError => {
  return new PluginRuntimeError({
    pluginId,
    operation,
    procedureName,
    cause: orpcError as Error,
  });
};

/**
 * Extracts the underlying error from Effect's FiberFailure wrapper.
 * When Effect.runPromise rejects, errors are wrapped in FiberFailure.
 * This extracts the original error so oRPC can handle it properly.
 */
export const extractFromFiberFailure = (error: unknown): unknown => {
  if (!error || typeof error !== "object") return error;

  if ("cause" in error) {
    const cause = (error as { cause?: unknown }).cause;

    if (cause && typeof cause === "object" && "_tag" in cause) {
      try {
        const squashed = Cause.squash(cause as unknown as Cause.Cause<unknown>);
        if (squashed instanceof ORPCError) {
          return squashed;
        }
        return squashed;
      } catch {
        // Not a valid Cause
      }
    }

    if (cause instanceof ORPCError) {
      return cause;
    }
  }

  return error;
};

// Universal error converter for the runtime
export const toPluginRuntimeError = (
  error: unknown,
  pluginId?: string,
  procedureName?: string,
  operation?: string,
): PluginRuntimeError => {
  if (error instanceof ORPCError) {
    return wrapORPCError(error, pluginId, procedureName, operation);
  }

  if (error instanceof PluginRuntimeError) {
    return error;
  }

  return new PluginRuntimeError({
    pluginId,
    operation,
    procedureName,
    cause: error instanceof Error ? error : new Error(extractErrorMessage(error)),
  });
};
