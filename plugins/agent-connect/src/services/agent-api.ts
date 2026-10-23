import type {
  AgentApiOptions,
  AgentPage,
  AgentView,
  GenerateIntentRequest,
  GenerateIntentResponse,
  GrantView,
  IdempotentResult,
  StatusResponse,
  SubmitIntentRequest,
} from "@near-intents-agent-api/sdk";
import {
  AgentApi,
  AgentApiError,
  AgentApiRequestError,
  DEFAULT_BASE_URL,
} from "@near-intents-agent-api/sdk";
import { ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";

/**
 * Typed wrapper over the hosted Agent API client (`@near-intents-agent-api/sdk`).
 *
 * The SDK is the only protocol dependency — no endpoint shapes, amount math,
 * or retry semantics live here. This layer maps SDK failures onto the
 * contract's error surface and nothing else.
 */

export type AgentApiServiceError = ORPCError<
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOO_MANY_REQUESTS"
  | "BAD_GATEWAY"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_SERVER_ERROR",
  unknown
>;

const STATUS_MAP: Record<
  number,
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOO_MANY_REQUESTS"
  | "BAD_GATEWAY"
  | "SERVICE_UNAVAILABLE"
> = {
  400: "BAD_REQUEST",
  401: "BAD_REQUEST",
  403: "BAD_REQUEST",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "NOT_FOUND",
  429: "TOO_MANY_REQUESTS",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
};

function mapDownstreamError(error: unknown): AgentApiServiceError {
  if (error instanceof AgentApiRequestError) {
    return new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Agent API is unreachable — retry with the same request",
      data: { retryable: true },
    });
  }
  if (error instanceof AgentApiError) {
    const code = STATUS_MAP[error.status] ?? "INTERNAL_SERVER_ERROR";
    return new ORPCError(code, {
      message: error.detail || error.title,
      data: {
        code: error.code,
        retryable: error.retryable,
        ...(error.availableAt ? { availableAt: error.availableAt } : {}),
      },
    });
  }
  return new ORPCError("INTERNAL_SERVER_ERROR", {
    message: error instanceof Error ? error.message : "Agent API call failed",
  });
}

export interface AgentApiClientShape {
  generateIntent(
    request: GenerateIntentRequest,
    options?: { idempotencyKey?: string },
  ): Effect.Effect<IdempotentResult<GenerateIntentResponse>, AgentApiServiceError>;
  submitIntent(request: SubmitIntentRequest): Effect.Effect<StatusResponse, AgentApiServiceError>;
  getStatus(
    correlationId: string,
    waitMs?: number,
  ): Effect.Effect<StatusResponse, AgentApiServiceError>;
  listAgents(externalUserId: string): Effect.Effect<AgentPage, AgentApiServiceError>;
  getAgent(agentId: string): Effect.Effect<AgentView, AgentApiServiceError>;
  listGrants(agentId: string): Effect.Effect<GrantView[], AgentApiServiceError>;
}

export class AgentApiClient extends Context.Service<AgentApiClient, AgentApiClientShape>()(
  "agent-connect/AgentApiClient",
) {}

export const agentApiClientLayer = (options: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Layer.Layer<AgentApiClient> => {
  const api = new AgentApi({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  } satisfies AgentApiOptions);

  return Layer.succeed(AgentApiClient, {
    generateIntent: (request, opts) =>
      Effect.tryPromise({
        try: () => api.generateIntent(request as never, opts as never),
        catch: mapDownstreamError,
      }),
    submitIntent: (request) =>
      Effect.tryPromise({
        try: () => api.submitIntent(request),
        catch: mapDownstreamError,
      }),
    getStatus: (correlationId, waitMs) =>
      Effect.tryPromise({
        try: () => api.getStatus(correlationId, waitMs !== undefined ? { waitMs } : undefined),
        catch: mapDownstreamError,
      }),
    listAgents: (externalUserId) =>
      Effect.tryPromise({
        try: () => api.listAgents({ external_user_id: externalUserId }),
        catch: mapDownstreamError,
      }),
    getAgent: (agentId) =>
      Effect.tryPromise({
        try: () => api.getAgent(agentId),
        catch: mapDownstreamError,
      }),
    listGrants: (agentId) =>
      Effect.tryPromise({
        try: () => api.listGrants(agentId),
        catch: mapDownstreamError,
      }),
  });
};
